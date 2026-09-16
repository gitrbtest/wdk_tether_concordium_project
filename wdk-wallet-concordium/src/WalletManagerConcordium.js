/**
 * WalletManagerConcordium
 * -------------------------------------------------------------------
 * The "factory" half of the module. Now built on Tether's base class:
 * it EXTENDS `WalletManager` from `@tetherto/wdk-wallet`, so it inherits
 * seed handling, signer management and account bookkeeping, and provides
 * the Concordium-specific implementations of the abstract methods
 * (getAccount, getAccountByPath, getFeeRates).
 *
 * Account-index mapping (design decision — see README):
 *   Concordium keys are identified by THREE numbers
 *     (identityProviderIndex, identityIndex, credentialCounter).
 *   WDK gives one integer `index`. We map it to the credential counter
 *   under a fixed provider + identity chosen in config:
 *     getAccount(i) -> (cfg.identityProviderIndex, cfg.identityIndex, i)
 *   getAccountByPath("provider/identity/cred") sets all three explicitly.
 */

import WalletManager, { NotImplementedError } from '@tetherto/wdk-wallet';
import WalletAccountConcordium from './WalletAccountConcordium.js';
import ConcordiumOnboarding from './ConcordiumOnboarding.js';

const DEFAULTS = {
  network: 'Testnet',                                   // 'Testnet' | 'Mainnet'
  endpoint: { host: 'grpc.testnet.concordium.com', port: 20000, secure: true },
  walletProxy: 'https://wallet-proxy.testnet.concordium.com',
  identityProviderIndex: 0,
  identityIndex: 0,
};

export default class WalletManagerConcordium extends WalletManager {
  /**
   * @param {string | Uint8Array} seed  BIP-39 mnemonic or raw seed bytes.
   * @param {object} config  WDK WalletConfig plus Concordium fields (see DEFAULTS).
   */
  constructor(seed, config = {}) {
    super(seed, config);                       // base stores the seed + config
    this._ccd = {
      ...DEFAULTS,
      ...config,
      endpoint: { ...DEFAULTS.endpoint, ...(config.endpoint || {}) },
    };
    this._client = null;   // shared gRPC client (lazy)
    this._sdk = null;      // SDK (lazy)
    this._global = null;   // cached cryptographic parameters
  }

  /** The 64-byte BIP-39 seed (inherited from the base) as hex, for ConcordiumHdWallet. */
  get _seedHex() {
    return Buffer.from(this.seed).toString('hex');
  }

  async _getSdk() {
    if (!this._sdk) this._sdk = await import('@concordium/web-sdk');
    return this._sdk;
  }

  async _getClient() {
    if (!this._client) {
      const { ConcordiumGRPCNodeClient, credentials } = await import('@concordium/web-sdk/nodejs');
      const { host, port, secure } = this._ccd.endpoint;
      this._client = new ConcordiumGRPCNodeClient(
        host, port, secure ? credentials.createSsl() : credentials.createInsecure()
      );
    }
    return this._client;
  }

  async _getGlobal() {
    if (!this._global) this._global = await (await this._getClient()).getCryptographicParameters();
    return this._global;
  }

  /** HTTP fetch used for wallet-proxy calls. Overridable so tests can inject a fake. */
  async _fetch(url, options) {
    return fetch(url, options);
  }

  /**
   * Get the account at a WDK index (mapped to a credential counter).
   * @param {number} [index=0]
   * @returns {Promise<import('@tetherto/wdk-wallet').IWalletAccount>}
   */
  async getAccount(index = 0, _options = {}) {
    if (typeof index === 'string') {
      throw new NotImplementedError('Signer-name accounts are not supported yet (Phase 1).');
    }
    return this._makeAccount(this._ccd.identityProviderIndex, this._ccd.identityIndex, index);
  }

  /**
   * Get an account by explicit Concordium path "provider/identity/cred".
   * (Concordium's key space is a 3-tuple, so we use this form rather than a
   * BIP-44 string.)
   */
  async getAccountByPath(path, _options = {}) {
    const [p, id, cred] = String(path).split('/').map((n) => parseInt(n, 10));
    if ([p, id, cred].some((n) => Number.isNaN(n))) {
      throw new Error(`Invalid Concordium path "${path}". Use "provider/identity/cred", e.g. "0/0/3".`);
    }
    return this._makeAccount(p, id, cred);
  }

  /**
   * Concordium fees are energy-based (not a simple gas rate), so a meaningful
   * implementation belongs with the send flow in Phase 2.
   */
  async getFeeRates() {
    throw new NotImplementedError('getFeeRates: Phase 2 (Concordium uses energy-based fees).');
  }

  /**
   * DEV / TESTNET ONLY — headless account creation without the Concordium ID App.
   * Production onboarding uses the ID App at the host-app layer; WDK's production
   * role is public-key exposure + account discovery (see ConcordiumOnboarding).
   * Useful for automated testing, local dev, and reproducible testnet setups.
   * @returns {ConcordiumOnboarding}
   */
  getOnboarding() {
    return new ConcordiumOnboarding(this);
  }

  /**
   * List the Protocol-Level Token ids available on this network (convenience,
   * beyond the standard WDK interface).
   * @returns {Promise<string[]>}
   */
  async listTokens(limit = 50) {
    const client = await this._getClient();
    const ids = [];
    for await (const t of client.getTokenList()) {
      ids.push(t?.id?.toString?.() ?? t?.tokenId?.toString?.() ?? String(t));
      if (ids.length >= limit) break;
    }
    return ids;
  }

  // ================= Phase 6: seed-based account recovery =================
  //
  // On Concordium a derived key does NOT reveal its on-chain account (one
  // identity can back many accounts, and the key->account mapping lives on the
  // chain, not in the key). To recover a wallet from just the seed we derive
  // each account's public key locally and ask Concordium's wallet-proxy which
  // account(s) that key controls, via the documented endpoint:
  //   GET /v0/keyAccounts/{publicKeyHex}[?onlySimple=y]
  // See: https://github.com/Concordium/concordium-wallet-proxy (README).

  /**
   * Look up the on-chain accounts controlled by a signing-key public key.
   * This is the primitive behind recovery ("find the account BY the public key").
   *
   * @param {string | Uint8Array} publicKey  Ed25519 verify key (32-byte hex or bytes).
   * @param {object} [opts]
   * @param {boolean} [opts.onlySimple=false]  Only simple (single-credential, single-key) accounts.
   * @returns {Promise<Array<{
   *   address: string, credentialIndex: number, keyIndex: number,
   *   isSimpleAccount: boolean, publicKey: { schemeId: string, verifyKey: string }
   * }>>}  Empty array when the key controls no account.
   */
  async findAccountByPublicKey(publicKey, { onlySimple = false } = {}) {
    const hex = (typeof publicKey === 'string'
      ? publicKey.trim().replace(/^0x/i, '')
      : Buffer.from(publicKey).toString('hex')).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error(
        `findAccountByPublicKey: expected a 32-byte hex Ed25519 public key, got "${hex}".`
      );
    }
    const url = `${this._ccd.walletProxy}/v0/keyAccounts/${hex}${onlySimple ? '?onlySimple=y' : ''}`;
    const res = await this._fetch(url);
    if (res.status === 404) return [];                 // no accounts for this key
    if (!res.ok) {
      throw new Error(`wallet-proxy keyAccounts returned HTTP ${res.status} for ${hex}`);
    }
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body?.accounts ?? []);
    return rows.map((r) => ({
      address: r.address,
      credentialIndex: r.credential_index,
      keyIndex: r.key_index,
      isSimpleAccount: r.is_simple_account,
      publicKey: r.public_key,
    }));
  }

  /**
   * Recover accounts from the seed: scan credential counters under a fixed
   * (provider, identity), derive each public key, and ask the wallet-proxy which
   * accounts it controls. Stops after `gapLimit` consecutive empty indexes.
   *
   * @param {object} [opts]
   * @param {number}  [opts.providerIndex=cfg.identityProviderIndex]
   * @param {number}  [opts.identityIndex=cfg.identityIndex]
   * @param {number}  [opts.startIndex=0]   First credential counter to try.
   * @param {number}  [opts.gapLimit=3]     Stop after this many consecutive empty indexes.
   * @param {number}  [opts.maxIndex=50]    Hard cap on how far to scan.
   * @param {boolean} [opts.onlySimple=false]
   * @returns {Promise<Array<{ index: number, path: string, address: string, publicKey: string }>>}
   */
  async recoverAccounts({
    providerIndex = this._ccd.identityProviderIndex,
    identityIndex = this._ccd.identityIndex,
    startIndex = 0,
    gapLimit = 3,
    maxIndex = 50,
    onlySimple = false,
  } = {}) {
    const sdk = await this._getSdk();
    const wallet = sdk.ConcordiumHdWallet.fromHex(this._seedHex, this._ccd.network);
    const found = [];
    let gap = 0;
    for (let i = startIndex; i <= maxIndex && gap < gapLimit; i++) {
      const pub = Buffer.from(
        wallet.getAccountPublicKey(providerIndex, identityIndex, i)
      ).toString('hex');
      const accounts = await this.findAccountByPublicKey(pub, { onlySimple });
      if (accounts.length === 0) { gap++; continue; }
      gap = 0;
      for (const a of accounts) {
        found.push({
          index: i,
          path: `${providerIndex}/${identityIndex}/${i}`,
          address: a.address,
          publicKey: pub,
        });
      }
    }
    return found;
  }

  dispose() {
    super.dispose();     // disposes tracked accounts + clears the seed
    this._client = null;
    this._global = null;
  }

  async _makeAccount(providerIndex, identityIndex, credNumber) {
    const sdk = await this._getSdk();
    const wallet = sdk.ConcordiumHdWallet.fromHex(this._seedHex, this._ccd.network);
    const account = new WalletAccountConcordium({
      sdk,
      wallet,
      getClient: () => this._getClient(),
      getGlobal: () => this._getGlobal(),
      network: this._ccd.network,
      providerIndex,
      identityIndex,
      credNumber,
    });
    // Track it so the inherited dispose() cleans it up.
    this._accounts[account.path] = account;
    return account;
  }
}
