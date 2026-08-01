/**
 * ConcordiumOnboarding — DEV / TESTNET UTILITY (not the production path)
 * -------------------------------------------------------------------
 * Creates on-chain Concordium accounts by driving an identity provider's HTTP
 * flow directly (identity request -> issuance -> credential deployment).
 *
 * IMPORTANT — this is NOT how production onboarding works. In production,
 * account creation goes through the Concordium **ID App** (@concordium/id-app-sdk),
 * an app-layer flow (browser/mobile popup + WalletConnect) that a headless Node
 * library cannot drive. In production, WDK's onboarding role is limited to:
 *   - exposing the account's public key (WalletAccountConcordium.keyPair /
 *     ConcordiumHdWallet.getAccountPublicKey), and
 *   - discovering the created account from that public key via Concordium's
 *     wallet-proxy recovery endpoint (a small helper to be added in Phase 6).
 *
 * This class stays because it is genuinely useful for:
 *   - headless automated testing / CI (create real accounts with no ID App UI),
 *   - local development and reproducible testnet setups,
 *   - it was the end-to-end feasibility proof that account creation works.
 *
 * Obtain one via `manager.getOnboarding()`.
 *
 * The flow has an unavoidable interactive step (the user verifies with the
 * provider in a browser), so it is split into three calls:
 *
 *   1. createIdentityRequest(opts)  -> { issuanceUrl, identityIndex, ... }
 *        Open issuanceUrl in a browser; the provider redirects to your
 *        redirect_uri with "#code_uri=..." on completion.
 *   2. retrieveIdentity(callbackUrl) -> identityObject
 *        Polls the provider until the identity is issued.
 *   3. createAccount({ identityObject, identityIndex, ... }) -> { address }
 *        Deploys the credential; the account then exists on-chain.
 *
 * This is a direct port of the flow proven end-to-end in Phase 0.
 */

export default class ConcordiumOnboarding {
  /** @param {import('./WalletManagerConcordium.js').default} manager */
  constructor(manager) {
    this._m = manager;
  }

  get _network() { return this._m._ccd.network; }
  get _seedHex() { return this._m._seedHex; }
  get _walletProxy() { return this._m._ccd.walletProxy; }

  async _ctx() {
    return {
      sdk: await this._m._getSdk(),
      client: await this._m._getClient(),
      global: await this._m._getGlobal(),
    };
  }

  /** List the identity providers available on this network. */
  async listIdentityProviders() {
    const list = await (await fetch(this._walletProxy + '/v0/ip_info')).json();
    return list.map((e) => ({
      index: e.ipInfo?.ipIdentity,
      name: e.ipInfo?.ipDescription?.name,
    }));
  }

  async _provider(providerIndex) {
    const list = await (await fetch(this._walletProxy + '/v0/ip_info')).json();
    return list.find((x) => x.ipInfo?.ipIdentity === providerIndex) ?? list[0];
  }

  /**
   * Step 1: build the identity request and the browser issuance URL.
   */
  async createIdentityRequest({
    providerIndex = this._m._ccd.identityProviderIndex,
    identityIndex = this._m._ccd.identityIndex,
    arThreshold,
    redirectUri = 'http://localhost:4000/callback',
  } = {}) {
    const { sdk, global } = await this._ctx();
    const entry = await this._provider(providerIndex);
    const { ipInfo, arsInfos, metadata } = entry;

    const wallet = sdk.ConcordiumHdWallet.fromHex(this._seedHex, this._network);
    const idCredSec = toHex(wallet.getIdCredSec(providerIndex, identityIndex));
    const prfKey = toHex(wallet.getPrfKey(providerIndex, identityIndex));
    const blindingRandomness = toHex(wallet.getSignatureBlindingRandomness(providerIndex, identityIndex));
    const arThresholdFinal = arThreshold ?? Math.max(1, Object.keys(arsInfos).length - 1);

    const idRequest = sdk.createIdentityRequestWithKeys({
      ipInfo, globalContext: global, arsInfos, arThreshold: arThresholdFinal,
      idCredSec, prfKey, blindingRandomness,
    });

    // v1 request must go to the v1 endpoint; state is WRAPPED under idObjectRequest.
    const issuanceStart = (metadata?.issuanceStart
      || 'https://id-service.testnet.concordium.com/api/v0/identity').replace('/v0/', '/v1/');
    const params = new URLSearchParams({
      state: JSON.stringify({ idObjectRequest: idRequest }),
      response_type: 'code',
      scope: 'identity',
      redirect_uri: redirectUri,
    });
    return {
      providerIndex,
      identityIndex,
      issuanceUrl: issuanceStart + '?' + params.toString(),
    };
  }

  /**
   * Step 2: poll the provider (via the code_uri in the browser callback) until
   * the identity object is issued.
   * @param {string} callbackUrlOrCodeUri  the full redirect URL (with #code_uri=)
   */
  async retrieveIdentity(callbackUrlOrCodeUri, { timeoutMs = 180000, intervalMs = 3000 } = {}) {
    const codeUri = extractCodeUri(callbackUrlOrCodeUri);
    if (!codeUri) throw new Error('No code_uri found in the provided callback URL.');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await (await fetch(codeUri)).json();
      if (r.status === 'done') return r.token?.identityObject ?? r.token;
      if (r.status === 'error') throw new Error('Identity issuance failed: ' + (r.detail || ''));
      await sleep(intervalMs);
    }
    throw new Error('Timed out waiting for the identity to be issued.');
  }

  /**
   * Step 3: create the on-chain account by deploying a credential from the
   * issued identity object.
   * @returns {Promise<{address: string, providerIndex: number, identityIndex: number, credNumber: number}>}
   */
  async createAccount({
    identityObject,
    providerIndex = this._m._ccd.identityProviderIndex,
    identityIndex = this._m._ccd.identityIndex,
    credNumber = 0,
    revealedAttributes = [],
  }) {
    const { sdk, client, global } = await this._ctx();
    const entry = await this._provider(providerIndex);

    const credInput = {
      ipInfo: entry.ipInfo,
      globalContext: global,
      arsInfos: entry.arsInfos,
      idObject: identityObject.value ?? identityObject,
      revealedAttributes,
      seedAsHex: this._seedHex,
      net: this._network,
      identityIndex,
      credNumber,
    };

    const expiryDate = new Date(Date.now() + 3600_000);
    const expiry = sdk.TransactionExpiry?.fromDate
      ? sdk.TransactionExpiry.fromDate(expiryDate)
      : new sdk.TransactionExpiry(expiryDate);

    const create = sdk.createCredentialPayload ?? sdk.createCredentialTransaction;
    const credentialDeployment = create(credInput, expiry);

    const wallet = sdk.ConcordiumHdWallet.fromHex(this._seedHex, this._network);
    const signingKey = wallet.getAccountSigningKey(providerIndex, identityIndex, credNumber);
    const signatures = [await sdk.signCredentialTransaction(credentialDeployment, signingKey)];

    const address = sdk.getAccountAddress(credentialDeployment.unsignedCdi.credId).toString();
    const payload = sdk.serializeCredentialDeploymentPayload(signatures, credentialDeployment);
    const sendFn = (client.sendCredentialDeploymentTransaction
      || client.sendCredentialDeployment || client.sendCredentialDeploymentPayload).bind(client);
    await sendFn(payload, expiry);

    return { address, providerIndex, identityIndex, credNumber };
  }
}

function toHex(x) {
  if (typeof x === 'string') return x;
  if (x instanceof Uint8Array || Buffer.isBuffer(x)) return Buffer.from(x).toString('hex');
  return x;
}

function extractCodeUri(arg) {
  if (!arg) return null;
  if (typeof arg === 'string' && arg.includes('code_uri=')) {
    const frag = arg.split('#')[1] ?? arg.split('?')[1] ?? '';
    return new URLSearchParams(frag).get('code_uri');
  }
  return arg; // assume a raw code_uri was passed
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
