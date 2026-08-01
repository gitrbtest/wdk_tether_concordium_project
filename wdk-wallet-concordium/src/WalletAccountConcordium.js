/**
 * WalletAccountConcordium
 * -------------------------------------------------------------------
 * Now built on Tether's base: it EXTENDS `WalletAccountReadOnly` from
 * `@tetherto/wdk-wallet` (which defines the read-only interface) and adds
 * the read-write `IWalletAccount` members. Phase 1 implements the read
 * slice; write/token methods throw NotImplementedError until their phase.
 *
 * Implemented now (Phase 1):
 *   getAddress()            derive the on-chain address
 *   getBalance()            native CCD balance
 *   getBalanceForAddress()  convenience: balance of any known address
 *   index / path / keyPair  account identity + keys
 *
 * Later:
 *   verify / quoteSendTransaction / quoteTransfer / getTransactionReceipt
 *   sign / signTransaction / sendTransaction / transfer   (Phase 2)
 *   getTokenBalance                                        (Phase 4)
 *
 * Concordium-specific: an address only exists on-chain after identity +
 * credential onboarding, so getBalance throws AccountNotCreatedError for an
 * account that hasn't been created yet (rather than a misleading 0).
 */

import WalletAccountReadOnly, { NotImplementedError } from '@tetherto/wdk-wallet';

export class AccountNotCreatedError extends Error {
  constructor(address) {
    super(`Concordium account ${address ?? '(derived)'} does not exist on-chain yet. ` +
          `It must be created via identity + credential onboarding first.`);
    this.name = 'AccountNotCreatedError';
    this.address = address;
  }
}

export default class WalletAccountConcordium extends WalletAccountReadOnly {
  constructor({ sdk, wallet, getClient, getGlobal, network,
                providerIndex, identityIndex, credNumber, address }) {
    super(address);                 // base keeps the address (if known up front)
    this._sdk = sdk;
    this._wallet = wallet;
    this._getClient = getClient;
    this._getGlobal = getGlobal;
    this._network = network;
    this._providerIndex = providerIndex;
    this._identityIndex = identityIndex;
    this._credNumber = credNumber;
    this._addr = address || null;   // subclass cache for the derived address
  }

  // ---- IWalletAccount identity ----

  /** WDK account index (the credential counter). */
  get index() { return this._credNumber; }

  /** Concordium path "provider/identity/cred". */
  get path() { return `${this._providerIndex}/${this._identityIndex}/${this._credNumber}`; }

  /** The account's key pair (Ed25519). */
  get keyPair() {
    return {
      publicKey: this._wallet.getAccountPublicKey(this._providerIndex, this._identityIndex, this._credNumber),
      privateKey: this._disposed ? null
        : this._wallet.getAccountSigningKey(this._providerIndex, this._identityIndex, this._credNumber),
    };
  }

  // ---- read operations (Phase 1) ----

  /** Derive and return the Base58 account address. Overrides the base. */
  async getAddress() {
    if (this._addr) return this._addr;
    const global = await this._getGlobal();
    const onChainCommitmentKey = global?.onChainCommitmentKey ?? global?.value?.onChainCommitmentKey;
    const credId = this._wallet.getCredentialId(
      this._providerIndex, this._identityIndex, this._credNumber, { onChainCommitmentKey }
    );
    this._addr = credIdToAddress(this._sdk, credId).toString();
    return this._addr;
  }

  /** Native CCD balance (microCCD). Throws AccountNotCreatedError if not on-chain. */
  async getBalance() {
    return this.getBalanceForAddress(await this.getAddress());
  }

  /** Read the CCD balance of an explicit Base58 address. */
  async getBalanceForAddress(addressStr) {
    const client = await this._getClient();
    const addr = this._sdk.AccountAddress.fromBase58(addressStr);
    try {
      const info = await client.getAccountInfo(addr);
      const micro = info?.accountAmount?.microCcdAmount ?? info?.accountAmount ?? 0n;
      return BigInt(micro);
    } catch (e) {
      if (/not found/i.test(e.message || '')) throw new AccountNotCreatedError(addressStr);
      throw e;
    }
  }

  /** Read-only view of this account. */
  async toReadOnlyAccount() { return this; }

  /** Erase key references. */
  dispose() { this._disposed = true; this._wallet = null; }

  // ================= Phase 2: sending native CCD =================

  /** Lazily load the PLT (protocol-level token) module. */
  async _plt() {
    if (!this.__plt) this.__plt = await import('@concordium/web-sdk/plt');
    return this.__plt;
  }

  /** Build an AccountSigner for this single-credential, single-key account. */
  _signer() {
    const keyHex = Buffer.from(
      this._wallet.getAccountSigningKey(this._providerIndex, this._identityIndex, this._credNumber)
    ).toString('hex');
    const s = this._sdk;
    return s.buildBasicAccountSigner ? s.buildBasicAccountSigner(keyHex) : s.buildAccountSigner(keyHex);
  }

  /** Build an unsigned simple-transfer transaction for { to, value(microCCD) }. */
  async _buildTransfer({ to, value }) {
    const s = this._sdk;
    const client = await this._getClient();
    const sender = s.AccountAddress.fromBase58(await this.getAddress());
    const toAddress = s.AccountAddress.fromBase58(to);
    const { nonce } = await client.getNextAccountNonce(sender);
    const amount = s.CcdAmount.fromMicroCcd(BigInt(value));
    const header = { sender, nonce, expiry: s.TransactionExpiry.futureMinutes(60) };
    return s.Transaction.transfer({ toAddress, amount }).addMetadata(header).build();
  }

  /** Sign a transfer, returning the finalized signed transaction (not broadcast). */
  async signTransaction(tx) {
    const transaction = await this._buildTransfer(tx);
    return this._sdk.Transaction.signAndFinalize(transaction, this._signer());
  }

  /**
   * Send native CCD. Accepts either a { to, value } transaction (built + signed
   * here) or an already-signed transaction. Waits for finalization to report
   * the real fee.
   * @returns {Promise<{hash: string, fee: bigint}>}
   */
  async sendTransaction(tx) {
    const client = await this._getClient();
    const isRequest = tx && typeof tx === 'object' && 'to' in tx && 'value' in tx;
    const signed = isRequest ? await this.signTransaction(tx) : tx;

    const hash = await client.sendTransaction(signed);
    const status = await client.waitForTransactionFinalization(hash);
    return { hash: hash.toString(), fee: extractFee(status) };
  }

  /**
   * Estimate the fee of a transfer without sending, using the SDK's own cost
   * functions: getEnergyCost(type, payload) then convertEnergyToMicroCcd().
   * @returns {Promise<{fee: bigint}>} fee in microCCD
   */
  async quoteSendTransaction(tx) {
    const s = this._sdk;
    const client = await this._getClient();
    const payload = {
      toAddress: s.AccountAddress.fromBase58(tx.to),
      amount: s.CcdAmount.fromMicroCcd(BigInt(tx.value)),
    };
    const energy = s.getEnergyCost(s.AccountTransactionType.Transfer, payload, 1n);
    const chainParams = (await client.getBlockChainParameters());
    const feeAmount = s.convertEnergyToMicroCcd(energy, chainParams?.value ?? chainParams);
    const fee = BigInt(feeAmount?.microCcdAmount ?? feeAmount?.value ?? feeAmount);
    return { fee };
  }

  /** Sign an arbitrary message (Ed25519). */
  async sign(message) {
    const s = this._sdk;
    if (!s.signMessage) throw new NotImplementedError('sign: message signing helper not found in this SDK version.');
    const sender = s.AccountAddress.fromBase58(await this.getAddress());
    const sig = await s.signMessage(sender, message, this._signer());
    return JSON.stringify(sig);
  }

  /** Verify a message signature produced by sign(). */
  async verify(message, signature) {
    const s = this._sdk;
    if (!s.verifyMessageSignature) throw new NotImplementedError('verify: helper not found in this SDK version.');
    const sender = s.AccountAddress.fromBase58(await this.getAddress());
    const info = await (await this._getClient()).getAccountInfo(sender);
    return s.verifyMessageSignature(message, JSON.parse(signature), info);
  }

  async getTransactionReceipt(hash) {
    const s = this._sdk;
    const client = await this._getClient();
    const h = s.TransactionHash?.fromHexString ? s.TransactionHash.fromHexString(hash) : hash;
    try { return (await client.getBlockItemStatus(h)) ?? null; }
    catch { return null; }
  }

  // ============ Phase 4: tokens (PLT + CIS-2), generic ============
  //
  // Token identifier convention (the WDK `tokenAddress` / `token` string):
  //   PLT:    "USDT"  or  "plt:USDT"            (a protocol-level token symbol)
  //   CIS-2:  "cis2:<index>:<subindex>:<tokenIdHex>"   e.g. "cis2:1234:0:" or
  //           "cis2:1234:0:01"  (tokenIdHex may be empty for single-token contracts)
  // All amounts are in the token's base units (integer bigint).

  /** Balance of a PLT or CIS-2 token for this account, in base units. */
  async getTokenBalance(tokenAddress) {
    const ref = parseTokenRef(tokenAddress);
    return ref.kind === 'cis2' ? this._cis2Balance(ref) : this._pltBalance(ref);
  }

  /** Transfer a PLT or CIS-2 token. amount is in base units. */
  async transfer({ token, recipient, amount }) {
    const ref = parseTokenRef(token);
    return ref.kind === 'cis2'
      ? this._cis2Transfer(ref, recipient, BigInt(amount))
      : this._pltTransfer(ref, recipient, BigInt(amount));
  }

  /** Estimate the fee of a PLT or CIS-2 token transfer. */
  async quoteTransfer({ token, recipient, amount }) {
    const ref = parseTokenRef(token);
    return ref.kind === 'cis2'
      ? this._cis2QuoteTransfer(ref, recipient, BigInt(amount))
      : this._pltQuoteTransfer(ref, recipient, BigInt(amount));
  }

  /**
   * Read a CIS-2 token's descriptive metadata (name, symbol, decimals, ...).
   * Per the CIS-2 standard the contract stores only a metadata *URL* on-chain;
   * the human-readable fields live in the JSON document at that URL. This proves
   * a token's identity is its (contract, tokenId) ref, not its symbol — two
   * different tokens may share a name.
   * @param {string} tokenAddress  a "cis2:<index>:<subindex>:<tokenIdHex>" ref
   * @returns {Promise<{url: string, metadata: object | null}>}
   */
  async getCis2Metadata(tokenAddress) {
    const ref = parseTokenRef(tokenAddress);
    if (ref.kind !== 'cis2') {
      throw new NotImplementedError('getCis2Metadata: only CIS-2 tokens carry an on-chain metadata URL.');
    }
    const contract = await this._cis2Contract(ref);
    const { url } = await contract.tokenMetadata(ref.tokenId);
    let metadata = null;
    try { metadata = await (await fetch(url)).json(); } catch { /* url unreachable / not JSON */ }
    return { url, metadata };
  }

  // ---- PLT (protocol-level token) ----

  async _pltBalance(ref) {
    const s = this._sdk;
    const plt = await this._plt();
    const client = await this._getClient();
    const token = await plt.Token.fromId(client, plt.TokenId.fromString(ref.symbol));
    const addr = s.AccountAddress.fromBase58(await this.getAddress());
    const bal = await plt.Token.balanceOf(token, addr);
    return bal ? BigInt(bal.value) : 0n;
  }

  async _pltTransfer(ref, recipient, amount) {
    const s = this._sdk;
    const plt = await this._plt();
    const client = await this._getClient();
    const tok = await plt.Token.fromId(client, plt.TokenId.fromString(ref.symbol));
    const sender = s.AccountAddress.fromBase58(await this.getAddress());
    const recip = s.AccountAddress.fromBase58(recipient);
    const decimals = tokenDecimals(tok);
    if (decimals == null) {
      throw new Error('transfer: could not determine PLT decimals. token.info keys = [' +
        Object.keys(tok?.info || {}).join(', ') + ']');
    }
    const amt = plt.TokenAmount.create(amount, decimals);   // base units, no scaling
    const hash = await plt.Token.transfer(
      tok, sender, { recipient: recip, amount: amt }, this._signer(),
      undefined, { autoScale: false, validate: true }
    );
    const status = await client.waitForTransactionFinalization(hash);
    return { hash: hash.toString(), fee: extractFee(status) };
  }

  async _pltQuoteTransfer(ref, recipient, amount) {
    const s = this._sdk;
    const plt = await this._plt();
    const client = await this._getClient();
    const tok = await plt.Token.fromId(client, plt.TokenId.fromString(ref.symbol));
    const decimals = tokenDecimals(tok);
    if (decimals == null) throw new Error('quoteTransfer: could not determine PLT decimals.');
    const amt = plt.TokenAmount.create(amount, decimals);
    const op = { transfer: { recipient: plt.CborAccountAddress.fromAccountAddress(s.AccountAddress.fromBase58(recipient)), amount: amt } };
    const payload = plt.createTokenUpdatePayload
      ? plt.createTokenUpdatePayload(plt.TokenId.fromString(ref.symbol), op)
      : null;
    if (!payload || !s.getEnergyCost || !s.AccountTransactionType?.TokenUpdate) {
      throw new NotImplementedError('quoteTransfer(PLT): fee estimation needs confirmation for this SDK version.');
    }
    const energy = s.getEnergyCost(s.AccountTransactionType.TokenUpdate, payload, 1n);
    const cp = await client.getBlockChainParameters();
    const feeAmount = s.convertEnergyToMicroCcd(energy, cp?.value ?? cp);
    return { fee: BigInt(feeAmount?.microCcdAmount ?? feeAmount?.value ?? feeAmount) };
  }

  // ---- CIS-2 (smart-contract token) ----

  async _cis2Module() {
    if (!this.__cis2) {
      try { this.__cis2 = await import('@concordium/web-sdk/cis2'); }
      catch { this.__cis2 = this._sdk; }   // fall back to the main export
    }
    return this.__cis2;
  }

  async _cis2Contract(ref) {
    const s = this._sdk;
    const mod = await this._cis2Module();
    const CIS2Contract = mod.CIS2Contract ?? s.CIS2Contract;
    const client = await this._getClient();
    const addr = s.ContractAddress.create(ref.index, ref.subindex);
    return CIS2Contract.create(client, addr);
  }

  async _cis2Balance(ref) {
    const s = this._sdk;
    const contract = await this._cis2Contract(ref);
    const address = s.AccountAddress.fromBase58(await this.getAddress());
    const bal = await contract.balanceOf({ tokenId: ref.tokenId, address });
    return BigInt(bal);
  }

  async _cis2Transfer(ref, recipient, amount) {
    const s = this._sdk;
    const client = await this._getClient();
    const contract = await this._cis2Contract(ref);
    const from = s.AccountAddress.fromBase58(await this.getAddress());
    const to = s.AccountAddress.fromBase58(recipient);
    const transfer = { tokenId: ref.tokenId, tokenAmount: amount, from, to };
    const energy = await this._cis2Energy(contract, from, transfer);
    const hash = await contract.transfer({ senderAddress: from, energy }, transfer, this._signer());
    const status = await client.waitForTransactionFinalization(hash);
    return { hash: hash.toString(), fee: extractFee(status) };
  }

  /** Dry-run a CIS-2 transfer to size the max execution energy (+20% headroom). */
  async _cis2Energy(contract, from, transfer) {
    const s = this._sdk;
    const dry = await contract.dryRun.transfer(from, transfer);
    if (dry?.tag && dry.tag !== 'success') {
      throw new Error('CIS-2 transfer dry-run failed: ' + (dry?.reason?.tag ?? JSON.stringify(dry).slice(0, 140)));
    }
    const usedVal = BigInt(dry?.usedEnergy?.value ?? dry?.usedEnergy ?? 0n);
    const buffered = (usedVal * 12n) / 10n;
    return s.Energy?.create ? s.Energy.create(buffered) : buffered;
  }

  async _cis2QuoteTransfer(ref, recipient, amount) {
    const s = this._sdk;
    const client = await this._getClient();
    const contract = await this._cis2Contract(ref);
    const from = s.AccountAddress.fromBase58(await this.getAddress());
    const to = s.AccountAddress.fromBase58(recipient);
    const dry = await contract.dryRun.transfer(from, { tokenId: ref.tokenId, tokenAmount: amount, from, to });
    if (dry?.tag && dry.tag !== 'success') {
      throw new Error('CIS-2 quote dry-run failed: ' + (dry?.reason?.tag ?? 'see node'));
    }
    const cp = await client.getBlockChainParameters();
    const feeAmount = s.convertEnergyToMicroCcd(dry.usedEnergy, cp?.value ?? cp);
    return { fee: BigInt(feeAmount?.microCcdAmount ?? feeAmount?.value ?? feeAmount) };
  }

  // ============ Phase 5: sponsored transactions (extension) ============
  //
  // Concordium-specific; beyond the standard WDK interface. Lets a token holder
  // spend WITHOUT holding CCD: a separate sponsor account co-signs and pays the
  // fee. A sponsored transaction carries TWO signatures — the account (sender)
  // and the sponsor — and EITHER may sign first. That gives FOUR signing
  // scenarios, all supported here, with signing SEPARATED from submission:
  //
  //   buildSponsorableTransfer(...)   -> unsigned signable (sender metadata + sponsor set)
  //   1. signAsAccountToBeSponsored() account signs first -> awaiting sponsor
  //   2. signAsAccountPreSponsored()  account signs after -> complete
  //   3. signAsSponsorToBeSigned()    sponsor signs first -> awaiting account
  //   4. signAsSponsorSigned()        sponsor signs after -> complete
  //   submitSponsored(...)            broadcast a fully-signed transaction
  //
  //   Order "sponsor first":  build -> (3) -> (2) -> submit
  //   Order "account first":  build -> (1) -> (4) -> submit
  //
  // The sender builds (it owns the nonce and is told the sponsor address). Each
  // sign method only ADDS a signature and returns JSON; submit finalizes + sends.

  /**
   * SENDER builds the unsigned sponsorable PLT transfer: payload + sender
   * metadata (this account, nonce, expiry) + the sponsor address. No signatures.
   * @param {{token:string, recipient:string, amount:number|bigint, sponsorAddress:string}} o
   * @returns {Promise<object>} a Transaction.JSON signable object
   */
  async buildSponsorableTransfer({ token, recipient, amount, sponsorAddress }) {
    const s = this._sdk;
    const plt = await this._plt();
    const client = await this._getClient();
    const ref = parseTokenRef(token);
    if (ref.kind !== 'plt') {
      throw new NotImplementedError('Sponsored transfers currently target PLT tokens (the stablecoin case).');
    }
    const tok = await plt.Token.fromId(client, plt.TokenId.fromString(ref.symbol));
    const decimals = tokenDecimals(tok);
    if (decimals == null) throw new Error('buildSponsorableTransfer: could not determine PLT decimals.');
    const amt = plt.TokenAmount.create(BigInt(amount), decimals);
    const op = { transfer: { recipient: plt.CborAccountAddress.fromAccountAddress(s.AccountAddress.fromBase58(recipient)), amount: amt } };
    const payload = plt.createTokenUpdatePayload(plt.TokenId.fromString(ref.symbol), op);
    const sender = s.AccountAddress.fromBase58(await this.getAddress());
    const { nonce } = await client.getNextAccountNonce(sender);
    const signable = s.Transaction.tokenUpdate(payload)
      .addMetadata({ sender, nonce, expiry: s.TransactionExpiry.futureMinutes(30) })
      .addSponsor(s.AccountAddress.fromBase58(sponsorAddress))
      .build();
    return s.Transaction.toJSON(signable);
  }

  /** Scenario 1 — account signs first; result still awaits the sponsor. */
  async signAsAccountToBeSponsored(transactionJson) {
    return this._addAccountSignature(transactionJson);
  }

  /** Scenario 2 — account signs a sponsor-signed transaction; result is complete. */
  async signAsAccountPreSponsored(sponsorSignedJson) {
    return this._addAccountSignature(sponsorSignedJson);
  }

  /** Scenario 3 — sponsor signs first; result still awaits the account. */
  async signAsSponsorToBeSigned(transactionJson) {
    return this._addSponsorSignature(transactionJson);
  }

  /** Scenario 4 — sponsor signs an account-signed transaction; result is complete. */
  async signAsSponsorSigned(accountSignedJson) {
    return this._addSponsorSignature(accountSignedJson);
  }

  /** Broadcast a fully-signed sponsored transaction (both signatures present). */
  async submitSponsored(fullySignedJson) {
    const s = this._sdk;
    const client = await this._getClient();
    const finalized = s.Transaction.finalize(s.Transaction.signableFromJSON(fullySignedJson));
    const hash = await client.sendTransaction(finalized);
    const status = await client.waitForTransactionFinalization(hash);
    return { hash: hash.toString(), fee: extractFee(status) };
  }

  // -- internal: add one signature (account or sponsor) to a signable JSON --
  async _addAccountSignature(json) {
    const s = this._sdk;
    const signed = await s.Transaction.sign(s.Transaction.signableFromJSON(json), this._signer());
    return s.Transaction.toJSON(signed);
  }

  async _addSponsorSignature(json) {
    const s = this._sdk;
    const sponsored = await s.Transaction.sponsor(s.Transaction.signableFromJSON(json), this._signer());
    return s.Transaction.toJSON(sponsored);
  }
}

/** Classify a token identifier string as PLT or CIS-2 (see convention above). */
function parseTokenRef(ref) {
  const str = String(ref).trim();
  if (str.toLowerCase().startsWith('cis2:')) {
    const parts = str.split(':');            // ["cis2", index, subindex, ...idParts]
    return {
      kind: 'cis2',
      index: BigInt(parts[1]),
      subindex: BigInt(parts[2] ?? '0'),
      tokenId: parts.slice(3).join(':'),     // may be "" for single-token contracts
    };
  }
  const symbol = str.toLowerCase().startsWith('plt:') ? str.slice(4) : str;
  return { kind: 'plt', symbol };
}

/** Best-effort lookup of a PLT's decimals from the Token instance. */
function tokenDecimals(tok) {
  return tok?.info?.decimals
    ?? tok?.info?.state?.decimals
    ?? tok?.moduleState?.decimals
    ?? tok?.info?.moduleState?.decimals;
}

/** Pull the fee (microCCD bigint) out of a finalized transaction status. */
function extractFee(status) {
  const cost = status?.summary?.cost ?? status?.cost ?? status?.summary?.energyCost;
  try { return BigInt(cost?.microCcdAmount ?? cost ?? 0n); } catch { return 0n; }
}

/**
 * Convert whatever getCredentialId returns (a CredentialRegistrationId object
 * in v12, or a hex string / bytes in other versions) into an AccountAddress.
 */
function credIdToAddress(sdk, credId) {
  try { return sdk.getAccountAddress(credId); } catch { /* fall through */ }
  if (typeof credId === 'string') return sdk.getAccountAddress(asCredId(sdk, credId));
  if (credId instanceof Uint8Array || Buffer.isBuffer(credId) || Array.isArray(credId)) {
    return sdk.getAccountAddress(asCredId(sdk, Buffer.from(credId).toString('hex')));
  }
  const s = credId?.toString?.();
  if (typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s)) return sdk.getAccountAddress(asCredId(sdk, s));
  throw new Error('Unrecognised credId type from getCredentialId: ' + Object.prototype.toString.call(credId));
}

function asCredId(sdk, hex) {
  return sdk.CredentialRegistrationId?.fromHexString
    ? sdk.CredentialRegistrationId.fromHexString(hex)
    : hex;
}
