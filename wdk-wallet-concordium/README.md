# @tetherto/wdk-wallet-concordium

A WDK wallet module that teaches the [Tether Wallet Development Kit](https://github.com/tetherto/wdk)
to speak **Concordium**. It plugs in alongside the EVM / Solana / TON / TRON
modules and is driven through the same WDK interface.

> **Status: feature-complete on testnet (Phases 1–6), with an automated test
> suite.** Account derivation, native CCD, dev/testnet onboarding, generic
> PLT + CIS-2 tokens, sponsored transactions (all four signing scenarios), and
> seed-based account *recovery* (`findAccountByPublicKey` / `recoverAccounts`) are
> implemented and proven against Concordium testnet.

## Install

```bash
npm install @tetherto/wdk-wallet-concordium
```

## Use with WDK

```js
import WDK from '@tetherto/wdk'
import WalletManagerConcordium from '@tetherto/wdk-wallet-concordium'

const wdk = new WDK(seedPhrase)
  .registerWallet('concordium', WalletManagerConcordium, {
    network: 'Testnet',
    endpoint: { host: 'grpc.testnet.concordium.com', port: 20000, secure: true },
  })

const account = await wdk.getAccount('concordium', 0)
console.log(await account.getAddress())
console.log(await account.getBalance(), 'microCCD')
```

## Try it standalone

```bash
npm install
npm run example            # read: address + CCD balance
npm run example:send       # native CCD transfer + fee quote
npm run example:verify     # message sign / verify
npm run example:token      # PLT + CIS-2 balances, quotes, transfers, metadata
npm run example:sponsored  # sponsored transfer — all four signing scenarios
npm run onboard:request    # dev/testnet onboarding (step 1)
npm run onboard:create     # dev/testnet onboarding (step 3)
```

## Testing

An automated suite built on Node's built-in test runner (`node:test`) — no extra
dependencies.

```bash
npm test                            # unit: offline, fast, no network
npm run test:integration            # integration: reads/quotes against testnet
WRITE=1 npm run test:integration    # also runs real transfers (spends testnet fees)
```

(Windows PowerShell: `$env:WRITE="1"; npm run test:integration`.)

- **Unit** (offline): account derivation, token-identifier routing, config
  merging, the error contract, and a mocked tier (an injected fake node client)
  covering the node-calling methods' error handling.
- **Integration** (testnet): address/balance reads, PLT + CIS-2 balances, fee
  quotes, CIS-2 metadata, and sponsored-transaction construction (all four
  scenarios).
- **Write tier** (gated behind `WRITE=1`): CCD/PLT/CIS-2 transfers and sponsored
  submission, asserting `quote == actual` fee. Off by default so the suite is
  safe to run repeatedly.

## Built on the Tether base package

The classes are not standalone — they build on `@tetherto/wdk-wallet`:

- `WalletManagerConcordium` **extends** `WalletManager` (inherits seed handling,
  signer management, account tracking; implements the abstract `getAccount`,
  `getAccountByPath`, `getFeeRates`).
- `WalletAccountConcordium` **extends** `WalletAccountReadOnly` and provides the
  `IWalletAccount` members.

This is what lets WDK's shared machinery (e.g. the transaction-policy engine)
operate on Concordium accounts the same way it does on the other chains.

## Account onboarding

Creating an account on Concordium needs an identity plus a credential deployment
— a step no other chain requires.

**Production path: the Concordium ID App.** Real onboarding goes through the
Concordium **ID App** (`@concordium/id-app-sdk`) at the **host-app layer**
(browser/mobile popup + WalletConnect) — a headless Node library can't drive it.
There, WDK's role is small: expose the account's **public key**
(`account.keyPair` / `getAccountPublicKey`) for the ID-App handoff, and
**discover** the created account from that key via Concordium's wallet-proxy
recovery endpoint (`findAccountByPublicKey` / `recoverAccounts`). The KYC UX
lives in the ID App, not in this module.

**Dev/testnet utility: `ConcordiumOnboarding`.** For headless account creation
*without* the ID App (automated tests, CI, local dev, reproducible testnet
setups), the `ConcordiumOnboarding` class (via `manager.getOnboarding()`) drives
an identity provider's HTTP flow directly. This is **not** the production path —
it's a testing convenience and was our feasibility proof. It has one interactive
step:

```js
const onboarding = manager.getOnboarding()

// 1. Build the request; open issuanceUrl in a browser (provider verifies).
const { issuanceUrl, identityIndex } = await onboarding.createIdentityRequest()

// 2. After the browser redirect, poll for the issued identity.
const identityObject = await onboarding.retrieveIdentity(callbackUrl)

// 3. Deploy the credential — the account now exists on-chain.
const { address } = await onboarding.createAccount({ identityObject, identityIndex })
```

See `example-onboard.mjs` (`npm run onboard:request` / `npm run onboard:create`).
This dev/testnet flow was proven end-to-end in Phase 0. Production onboarding
uses the ID App as described above.

## Design decisions

**Account-index mapping.** Concordium identifies a key by three numbers —
`(identityProviderIndex, identityIndex, credentialCounter)` — but WDK hands us a
single integer. We map WDK's `index` to the **credential counter** under a fixed
provider + identity chosen in config. `getAccountByPath("p/id/cred")` addresses
all three explicitly. This keeps the common case simple while leaving the full
key space reachable.

**Account existence is real.** On most chains a derived address is immediately
usable. On Concordium an account only exists after identity + credential
onboarding. So `getBalance()` throws `AccountNotCreatedError` (rather than
returning a misleading `0`) when the account isn't on-chain yet. Use
`getBalanceForAddress(addr)` to read any known address directly.

**Runtime.** Targets Node.js (per the agreed v1 scope). The SDK's WebAssembly
crypto is confirmed working under Node in Phase 0.

## Config

| Field | Default | Meaning |
|---|---|---|
| `network` | `'Testnet'` | `'Testnet'` or `'Mainnet'` |
| `endpoint.host` | `grpc.testnet.concordium.com` | Concordium gRPC node host |
| `endpoint.port` | `20000` | node port |
| `endpoint.secure` | `true` | TLS — the public testnet node requires it |
| `identityProviderIndex` | `0` | provider that WDK indices live under |
| `identityIndex` | `0` | identity that WDK indices live under |

## Interface

Standard WDK members plus Concordium-specific extras — all implemented and
verified on testnet.

| Method | Notes |
|---|---|
| `getAccount(index)` / `getAccountByPath("p/id/cred")` | ✅ |
| `account.getAddress()` | ✅ |
| `account.getBalance()` / `getBalanceForAddress(addr)` | ✅ |
| `account.keyPair` / `index` / `path` | ✅ |
| `sendTransaction` / `signTransaction` (native CCD) | ✅ |
| `quoteSendTransaction` (fee estimate) | ✅ matches actual |
| `sign` / `verify` (messages) | ✅ |
| `getTransactionReceipt` | ✅ |
| `getTokenBalance` / `transfer` / `quoteTransfer` (PLT **and** CIS-2) | ✅ |
| `getFeeRates` | throws — Concordium prices by energy; use the quote methods |
| _Extras:_ `getCis2Metadata`, `getBalanceForAddress`, `manager.getOnboarding()`, `manager.listTokens()`, sponsored methods | ✅ Concordium-specific |

## Status

All proven end-to-end against Concordium testnet and covered by the test suite:

- **Phase 1 — Read-only:** derivation, `getAddress()`, `getBalance()`.
- **Phase 2 — Native CCD:** `sendTransaction` / `signTransaction`,
  `quoteSendTransaction` (exact fee), `sign` / `verify`, `getTransactionReceipt`.
- **Phase 3 — Onboarding:** dev/testnet flow via `getOnboarding()`; production
  uses the Concordium ID App at the app layer.
- **Phase 4 — Tokens (PLT + CIS-2):** `getTokenBalance`, `transfer`,
  `quoteTransfer`, `getCis2Metadata`, routed by token identifier. Real PLT and
  CIS-2 transfers executed; both fee quotes match actual exactly.
- **Phase 5 — Sponsored transactions:** all four signing scenarios, signing
  separated from submission, proven with the sponsor paying the fee and the
  sender spending 0 CCD.
- **Phase 6 — Recovery + hardening:** seed-based account recovery
  (`findAccountByPublicKey` / `recoverAccounts`), plus the automated test suite.

### Account recovery

On Concordium a derived key does not reveal its on-chain account, so recovery is
a lookup, not a local computation. The module derives each account's public key
from the seed and asks Concordium's wallet-proxy which account it controls, via
the documented endpoint `GET /v0/keyAccounts/{publicKeyHex}[?onlySimple=y]`.

```js
// Low-level: accounts controlled by one public key.
const accounts = await manager.findAccountByPublicKey(account.keyPair.publicKey);
// -> [{ address, credentialIndex, keyIndex, isSimpleAccount, publicKey }]

// High-level: rebuild the wallet from the seed (scans credential counters,
// stops after `gapLimit` consecutive empty indexes).
const recovered = await manager.recoverAccounts({ gapLimit: 3 });
// -> [{ index, path, address, publicKey }]
```

### Sponsored transactions (Concordium extension)

Lets a token holder transact without any CCD — a sponsor pays the fee. A
sponsored transaction has two signatures (account + sponsor) and **either may
sign first**, so the module exposes all **four signing scenarios**, with signing
separated from submission:

```js
// SENDER builds the unsigned sponsorable transfer (told who the sponsor is)
const tx0 = await sender.buildSponsorableTransfer({ token: 'USDT', recipient, amount: 10n, sponsorAddress })

// Order A — sponsor signs first:
const a = await sponsor.signAsSponsorToBeSigned(tx0)    // (3) -> awaiting account
const b = await sender.signAsAccountPreSponsored(a)     // (2) -> complete

// Order B — account signs first:
const c = await sender.signAsAccountToBeSponsored(tx0)  // (1) -> awaiting sponsor
const d = await sponsor.signAsSponsorSigned(c)          // (4) -> complete

// Submit a fully-signed transaction (from either order)
const { hash, fee } = await sender.submitSponsored(b)
```

The four scenarios: **(1)** sign as account, to be sponsored; **(2)** sign as
account, pre-sponsored; **(3)** sign as sponsor, to be signed; **(4)** sign as
sponsor, signed. See `example-sponsored.mjs` (`npm run example:sponsored`).
Building the sponsor's backend *service* is the integrator's concern; WDK
provides the sponsor-signing capability.

### Token identifier convention

The `token` / `tokenAddress` string tells the module which standard to use:

- **PLT:** `"USDT"` or `"plt:USDT"` — a protocol-level token symbol.
- **CIS-2:** `"cis2:<index>:<subindex>:<tokenIdHex>"` — e.g. `"cis2:1234:0:"` (empty
  token id for a single-token contract) or `"cis2:1234:0:01"`.

Amounts are always in the token's base units (integer). Example:

```js
await account.getTokenBalance('USDT')                 // PLT
await account.getTokenBalance('cis2:1234:0:')         // CIS-2
await account.transfer({ token: 'cis2:1234:0:', recipient: addr, amount: 5n })
```

A CIS-2 token's descriptive fields (name / symbol / decimals) live off-chain
behind a URL stored on the contract; `getCis2Metadata` resolves them:

```js
const { url, metadata } = await account.getCis2Metadata('cis2:1234:0:01')
console.log(metadata.name, metadata.symbol, metadata.decimals)
```

## License

Apache-2.0
