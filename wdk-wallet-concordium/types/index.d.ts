// Type definitions for @tetherto/wdk-wallet-concordium
//
// Built on the Tether base package: the manager extends WalletManager and the
// account extends WalletAccountReadOnly / implements IWalletAccount, plus
// Concordium-specific extras (tokens, sponsored transactions, onboarding).

import WalletManager, {
  WalletAccountReadOnly,
  IWalletAccount,
  WalletConfig,
} from '@tetherto/wdk-wallet';

export interface ConcordiumEndpoint {
  host: string;
  port: number;
  /** true = TLS (createSsl). The public testnet node requires it. */
  secure?: boolean;
}

export interface WalletManagerConcordiumConfig extends WalletConfig {
  network?: 'Testnet' | 'Mainnet';
  endpoint?: ConcordiumEndpoint;
  /** Wallet-proxy base URL (used for onboarding + account recovery). */
  walletProxy?: string;
  /** Concordium identity-provider index WDK indices live under. Default 0. */
  identityProviderIndex?: number;
  /** Concordium identity index WDK indices live under. Default 0. */
  identityIndex?: number;
}

/** One account returned by the wallet-proxy /v0/keyAccounts lookup. */
export interface KeyAccount {
  address: string;
  credentialIndex: number;
  keyIndex: number;
  isSimpleAccount: boolean;
  publicKey: { schemeId: string; verifyKey: string };
}

/** Options for {@link WalletManagerConcordium.findAccountByPublicKey}. */
export interface FindAccountByPublicKeyOptions {
  /** Only return simple (single-credential, single-key) accounts. Default false. */
  onlySimple?: boolean;
}

/** Options for {@link WalletManagerConcordium.recoverAccounts}. */
export interface RecoverAccountsOptions {
  providerIndex?: number;
  identityIndex?: number;
  /** First credential counter to try. Default 0. */
  startIndex?: number;
  /** Stop after this many consecutive empty indexes. Default 3. */
  gapLimit?: number;
  /** Hard cap on how far to scan. Default 50. */
  maxIndex?: number;
  onlySimple?: boolean;
}

/** A recovered account: its derived index/path and the on-chain address. */
export interface RecoveredAccount {
  index: number;
  path: string;
  address: string;
  publicKey: string;
}

/** A native CCD transfer request. */
export interface TransactionRequest {
  to: string;
  /** microCCD. */
  value: number | bigint;
}

/** Result of a broadcast transaction/transfer (fee in microCCD). */
export interface TransactionResult {
  hash: string;
  fee: bigint;
}

/** A fee quote (microCCD), returned without broadcasting. */
export interface FeeQuote {
  fee: bigint;
}

/** Options for a token transfer (PLT or CIS-2), amount in base units. */
export interface TransferOptions {
  /** Token identifier: "USDT"/"plt:USDT" (PLT) or "cis2:<index>:<subindex>:<tokenIdHex>". */
  token: string;
  recipient: string;
  amount: number | bigint;
}

/** CIS-2 off-chain metadata: a URL on the contract and the parsed JSON (null if unreachable). */
export interface Cis2Metadata {
  url: string;
  metadata: Record<string, unknown> | null;
}

/**
 * A serialized sponsored transaction (Transaction.JSON) passed between the
 * build/sign/submit steps. Treat it as an opaque value.
 */
export type SponsoredTransactionJSON = Record<string, unknown>;

/** Options to build an unsigned sponsorable PLT transfer. */
export interface BuildSponsorableTransferOptions {
  /** PLT token identifier (sponsored transfers currently target PLT). */
  token: string;
  recipient: string;
  amount: number | bigint;
  /** The account that will co-sign and pay the fee. */
  sponsorAddress: string;
}

export class AccountNotCreatedError extends Error {
  address?: string;
}

export class WalletAccountConcordium extends WalletAccountReadOnly implements IWalletAccount {
  get index(): number;
  get path(): string;
  get keyPair(): { publicKey: Uint8Array; privateKey: Uint8Array | null };

  // ---- reads ----
  getAddress(): Promise<string>;
  getBalance(): Promise<bigint>;
  /** Read the CCD balance of an explicit Base58 address (any account). */
  getBalanceForAddress(address: string): Promise<bigint>;
  getTransactionReceipt(hash: string): Promise<unknown | null>;
  toReadOnlyAccount(): Promise<WalletAccountReadOnly>;
  dispose(): void;

  // ---- messages ----
  sign(message: string): Promise<string>;
  verify(message: string, signature: string): Promise<boolean>;

  // ---- native CCD ----
  /** Sign a native CCD transfer, returning the finalized (unbroadcast) transaction. */
  signTransaction(tx: TransactionRequest): Promise<unknown>;
  /** Send native CCD. Accepts a { to, value } request or an already-signed transaction. */
  sendTransaction(tx: TransactionRequest | unknown): Promise<TransactionResult>;
  quoteSendTransaction(tx: TransactionRequest): Promise<FeeQuote>;

  // ---- tokens (generic over PLT and CIS-2) ----
  getTokenBalance(tokenAddress: string): Promise<bigint>;
  transfer(options: TransferOptions): Promise<TransactionResult>;
  quoteTransfer(options: TransferOptions): Promise<FeeQuote>;
  /** Resolve a CIS-2 token's off-chain metadata (name/symbol/decimals) via its URL. */
  getCis2Metadata(tokenAddress: string): Promise<Cis2Metadata>;

  // ---- sponsored transactions (Concordium extension) ----
  /** SENDER builds the unsigned sponsorable PLT transfer (sets sender metadata + sponsor). */
  buildSponsorableTransfer(options: BuildSponsorableTransferOptions): Promise<SponsoredTransactionJSON>;
  /** (1) account signs first — result still awaits the sponsor. */
  signAsAccountToBeSponsored(tx: SponsoredTransactionJSON): Promise<SponsoredTransactionJSON>;
  /** (2) account signs a sponsor-signed transaction — result is complete. */
  signAsAccountPreSponsored(tx: SponsoredTransactionJSON): Promise<SponsoredTransactionJSON>;
  /** (3) sponsor signs first — result still awaits the account. */
  signAsSponsorToBeSigned(tx: SponsoredTransactionJSON): Promise<SponsoredTransactionJSON>;
  /** (4) sponsor signs an account-signed transaction — result is complete. */
  signAsSponsorSigned(tx: SponsoredTransactionJSON): Promise<SponsoredTransactionJSON>;
  /** Broadcast a fully-signed sponsored transaction (both signatures present). */
  submitSponsored(tx: SponsoredTransactionJSON): Promise<TransactionResult>;
}

/**
 * Dev/testnet headless onboarding utility (identity + credential deployment).
 * NOT the production path — production onboarding uses the Concordium ID App at
 * the host-app layer. Obtain via `manager.getOnboarding()`.
 */
export class ConcordiumOnboarding {
  constructor(manager: WalletManagerConcordium);
  /** Step 1 — build the identity request; open issuanceUrl in a browser. */
  createIdentityRequest(): Promise<{ issuanceUrl: string; identityIndex: number }>;
  /** Step 2 — after the browser redirect, poll for the issued identity object. */
  retrieveIdentity(callbackUrl: string): Promise<unknown>;
  /** Step 3 — deploy the credential; the account now exists on-chain. */
  createAccount(options: { identityObject: unknown; identityIndex: number }): Promise<{ address: string }>;
}

export default class WalletManagerConcordium extends WalletManager {
  constructor(seed: string | Uint8Array, config?: WalletManagerConcordiumConfig);
  getAccount(index?: number): Promise<WalletAccountConcordium>;
  getAccountByPath(path: string): Promise<WalletAccountConcordium>;
  /** Not applicable on Concordium (energy-based fees) — throws. Use the quote methods. */
  getFeeRates(): Promise<never>;
  /** Dev/testnet onboarding helper (see ConcordiumOnboarding). */
  getOnboarding(): ConcordiumOnboarding;
  /** List Protocol-Level Token ids available on this network. */
  listTokens(limit?: number): Promise<string[]>;

  // ---- account recovery (Phase 6) ----
  /**
   * Look up the on-chain accounts controlled by a signing-key public key, via
   * the wallet-proxy /v0/keyAccounts endpoint. Empty array = no such account.
   */
  findAccountByPublicKey(
    publicKey: string | Uint8Array,
    options?: FindAccountByPublicKeyOptions,
  ): Promise<KeyAccount[]>;
  /**
   * Recover accounts from the seed by scanning credential counters and looking
   * up each derived public key. Stops after `gapLimit` consecutive empty indexes.
   */
  recoverAccounts(options?: RecoverAccountsOptions): Promise<RecoveredAccount[]>;

  dispose(): void;
}

export { WalletManagerConcordium };
