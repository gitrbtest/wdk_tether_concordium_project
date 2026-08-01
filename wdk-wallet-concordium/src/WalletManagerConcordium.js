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
    for (const method of ['getTokenList', 'getTokenInfos', 'getTokens']) {
      if (typeof client[method] === 'function') {
        for await (const t of client[method]()) {
          ids.push(t?.id?.toString?.() ?? t?.tokenId?.toString?.() ?? String(t));
          if (ids.length >= limit) break;
        }
        break;
      }
    }
    return ids;
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
