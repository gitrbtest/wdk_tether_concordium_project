# Phase 0 Spike — Concordium × Tether WDK

A tiny, read-only program that proves whether the Concordium ⇄ WDK
integration is technically doable, before we commit to building it.
It talks only to **Concordium testnet** and never spends anything.

## Run it

```bash
# Node.js 18+ required
cd phase0-spike
npm install
npm run spike
```

Optional — test a real balance read against a live account:

```bash
# grab any address from https://testnet.ccdscan.io
CCD_ACCOUNT=<paste-address> npm run spike
```

## What each check proves

| Check | Question it answers | Why it matters for WDK |
|-------|--------------------|------------------------|
| 1 | Does the Concordium SDK + its WebAssembly crypto load under plain Node.js? | This was our biggest unknown. If it loads, the riskiest blocker is gone. |
| 2 | Can we derive an account key from a 12-word seed phrase? | WDK's whole model is "seed in → keys out". This confirms Concordium fits it. |
| 3 | Can we connect to the testnet node and read live chain data? | Confirms connectivity works the same way as the other WDK chains' RPC. |
| 4 | Can we read an existing account's CCD balance? | This is exactly what WDK's `getBalance()` must do. |
| 5 | Does a freshly-derived key already have an account? (It should **not**.) | Makes the core challenge concrete: Concordium needs identity + credential before an account exists. |

## Already verified live (no install needed)

Before you even run the script, two things are already confirmed from
Concordium's public testnet wallet-proxy:

- **The testnet is reachable and live** (it returned real data).
- **The identity-provider layer is real.** Testnet currently lists these
  identity providers, which are the "gatekeepers" a user would verify with
  to open an account:
  - Concordium testnet IP
  - Digital Trust Solutions (TestNet)
  - Notabene (Staging)

This is the practical face of Check 5: opening a Concordium account routes
through one of these providers — unlike Bitcoin or Ethereum, where an
address is usable the instant it is created.

## Reading the results

- **All five checks pass** → the integration is de-risked. We proceed to
  Phase 1 (a real read-only WDK module) with confidence.
- **Check 1 fails** → note the exact error and the installed version
  (`npm ls @concordium/web-sdk`); the SDK API may have shifted and the
  script needs a small tweak. The *concepts* still hold.
- **Check 3 fails** → likely a network/egress issue on port 20000. Note:
  the public testnet node requires **TLS** (`credentials.createSsl()`),
  which the spike now uses. If it still fails, a firewall is probably
  blocking outbound port 20000.

None of these would change the overall plan — they only tell us which small
details to pin down before Phase 1.
