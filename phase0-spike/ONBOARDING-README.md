# Account-Creation Prototype — how to run it

First working build of the hardest part of the project: creating a real
Concordium account (identity + on-chain credential) on **testnet**, using
Concordium's own **test** identity provider (no real KYC/documents).

Corrected to follow Concordium's official identity-provider interface spec.

## Run it — three commands, one browser step

**1. Build the identity request**

```
npm run onboard:request
```

Prints an issuance **URL**.

**2. The one-time browser step**

1. Open the printed URL in a browser.
2. The test provider auto-verifies (no documents) and redirects to
   `http://localhost:4000/callback#code_uri=...`.
3. That page **will fail to load — that is expected.** Copy the **entire
   address-bar URL** (it contains `#code_uri=...`).

**3. Create the account**

Easiest (avoids Windows shell line-length limits): paste the copied callback
URL into a new file named `callback.txt` in this folder, then run:

```
npm run onboard:create
```

Or pass it inline if you prefer:

```
npm run onboard:create -- "<paste the full URL here>"
```

This polls the provider until the identity is issued, saves
it, then builds, signs and submits the credential. When it finishes it prints
the **new account address**. Confirm the account is real:

```
$env:CCD_ACCOUNT="<the new address>"; npm run spike
```

If Check 5 no longer says "account not found" for that address, the account
exists — the full create-account flow worked end to end.

## What to expect

This is a **prototype of a version-sensitive flow**. The earlier "Malformed
request" was a request-format bug (now fixed per Concordium's spec). If
something still fails, it's most likely one of:

- an SDK function name/shape differing in your installed version, or
- the test provider expecting a slightly different issuance URL.

Either way: note the exact error and `npm ls @concordium/web-sdk`, paste it
back, and we adjust. The **steps and their order are correct**; only fine
details may need aligning. Everything underneath (key derivation, provider
info, global parameters, node submission) reuses paths the earlier spikes
already proved.
