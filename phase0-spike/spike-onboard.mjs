/**
 * Account-creation prototype — Concordium × Tether WDK  (v2)
 * ----------------------------------------------------------------------
 * Creates a real Concordium account on TESTNET using Concordium's own
 * TEST identity provider (no real KYC). Rewritten to match Concordium's
 * documented identity-provider interface:
 *   https://docs.concordium.com/en/mainnet/docs/network/web3-id/
 *       identity-provider-interfaces.html
 *
 * Flow (three small commands, one browser step):
 *
 *   1) npm run onboard:request
 *        Builds the identity request and prints an issuance URL.
 *
 *   -- BROWSER STEP --
 *        Open that URL. The test provider auto-verifies and redirects to
 *        your redirect_uri with "#code_uri=<url>" on the end. The page
 *        (http://localhost:4000/...) will fail to load — that's fine.
 *        Copy the FULL address-bar URL (it contains #code_uri=...).
 *
 *   2) npm run onboard:create -- "<paste that full URL>"
 *        Polls the code_uri until the identity is issued, saves the
 *        identity object, then builds + signs + submits the credential.
 *        The account now exists on-chain; it prints the new address.
 *
 * Still a PROTOTYPE of a version-sensitive flow: if an SDK call name or
 * shape doesn't match your installed @concordium/web-sdk, note the error
 * and the version (npm ls @concordium/web-sdk) — the STEPS are correct.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pbkdf2Sync } from 'node:crypto';

// ---- Config -------------------------------------------------------
const NETWORK        = 'Testnet';
const NODE_HOST      = 'grpc.testnet.concordium.com';
const NODE_PORT      = 20000;
const WALLET_PROXY   = 'https://wallet-proxy.testnet.concordium.com';
const IP_INDEX       = 0;   // 0 = "Concordium testnet IP" (the test/dev provider)
const IDENTITY_INDEX = 0;
const CRED_NUMBER    = 0;
const AR_THRESHOLD   = 2;   // reveal-threshold across anonymity revokers
const REDIRECT_URI   = 'http://localhost:4000/callback';

// Throwaway BIP-39 seed — testing ONLY. Never use a funded seed here.
const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';

const IDOBJECT_FILE = './identity-object.json';

const line = (s = '') => console.log(s);
const ok   = (s) => console.log('  ✅ ' + s);
const bad  = (s) => console.log('  ❌ ' + s);
const stepH= (s) => console.log('\n=== ' + s + ' ===');

// ---- gather the public inputs the flow needs ---------------------
async function gatherInputs() {
  const ipList = await (await fetch(WALLET_PROXY + '/v0/ip_info')).json();
  const entry = ipList.find((e) => e.ipInfo?.ipIdentity === IP_INDEX) ?? ipList[0];
  const { ConcordiumGRPCNodeClient, credentials } =
    await import('@concordium/web-sdk/nodejs');
  const client = new ConcordiumGRPCNodeClient(NODE_HOST, NODE_PORT, credentials.createSsl());
  const globalContext = await client.getCryptographicParameters();
  return {
    client,
    ipInfo: entry.ipInfo,
    arsInfos: entry.arsInfos,
    globalContext,
    metadata: entry.metadata,   // NB: metadata is a sibling of ipInfo, not inside it
    providerName: entry.ipInfo.ipDescription?.name,
  };
}

// ==================================================================
// STEP 1 — build the identity request, print the issuance URL
// ==================================================================
async function doRequest() {
  stepH('STEP 1 — Build identity request');
  const sdk = await import('@concordium/web-sdk');
  const { ipInfo, arsInfos, globalContext, metadata, providerName } = await gatherInputs();
  ok('Provider: ' + providerName + ' (index ' + IP_INDEX + ')');

  // Derive the three secrets the request needs, from the seed.
  // Pick a FRESH identity index so idCredPub is unique (the well-known test
  // seed at index 0 is already registered — that causes "Duplicate idCredPub").
  // Persist it so step 2 uses the same identity.
  const identityIndex = Math.floor(Math.random() * 2 ** 31);
  saveState({ identityIndex });
  ok('Using a fresh identity index: ' + identityIndex);

  const { ConcordiumHdWallet } = sdk;
  const wallet = ConcordiumHdWallet.fromHex(hexSeed(TEST_SEED), NETWORK);
  // These must be HEX STRINGS for the WASM core; coerce in case the
  // installed SDK returns byte arrays (the usual cause of an "unreachable"
  // trap here is passing raw bytes where a hex string is expected).
  const idCredSec   = toHex(wallet.getIdCredSec(IP_INDEX, identityIndex));
  const prfKey      = toHex(wallet.getPrfKey(IP_INDEX, identityIndex));
  const blindingRandomness = toHex(wallet.getSignatureBlindingRandomness(IP_INDEX, identityIndex));
  ok('Derived idCredSec, prfKey and blinding randomness (as hex).');

  const input = {
    ipInfo,
    globalContext,
    arsInfos,
    arThreshold: AR_THRESHOLD,
    idCredSec,
    prfKey,
    blindingRandomness,
  };

  let idRequest;
  try {
    idRequest = sdk.createIdentityRequestWithKeys(input);
    ok('Built the identity request.');
  } catch (e) {
    bad('createIdentityRequestWithKeys failed (version-sensitive): ' + e.message);
    line('     Check the installed SDK for the identity-request function.');
    return;
  }

  // Per the spec: state = the identity request, stringified EXACTLY as the
  // SDK returns it (NOT wrapped in any extra object).
  //
  // createIdentityRequestWithKeys produces a *version 1* request, which must
  // go to the provider's v1 endpoint. The advertised issuanceStart may point
  // at the older v0 endpoint, so prefer v1 (upgrade the path if needed).
  const advertised = metadata?.issuanceStart;
  const issuanceStart = advertised
    ? advertised.replace('/v0/', '/v1/')
    : 'https://id-service.testnet.concordium.com/api/v1/identity';
  // The identity-provider service expects the request WRAPPED under the
  // "idObjectRequest" key (confirmed from its server implementation):
  //   { "idObjectRequest": { "v": 0, "value": { ...PreIdentityObject } } }
  const params = new URLSearchParams({
    state: JSON.stringify({ idObjectRequest: idRequest }),
    response_type: 'code',
    scope: 'identity',
    redirect_uri: REDIRECT_URI,
  });
  const url = issuanceStart + '?' + params.toString();

  line('\n  ────────────────  ONE-TIME BROWSER STEP  ────────────────');
  line('  1. Open this URL in a browser:\n');
  line('     ' + url + '\n');
  line('  2. The TEST provider auto-verifies (no documents) and redirects to');
  line('     ' + REDIRECT_URI + '#code_uri=...  — that page will FAIL to load.');
  line('     That is expected. Copy the ENTIRE address-bar URL.');
  line('  3. Run:  npm run onboard:create -- "<paste the full URL here>"');
  line('  ──────────────────────────────────────────────────────────');
}

// ==================================================================
// STEP 2 — poll for the identity object, then create the account
// ==================================================================
async function doCreate(callbackArg) {
  stepH('STEP 2 — Retrieve identity, then create the on-chain account');
  const sdk = await import('@concordium/web-sdk');
  const { client, ipInfo, arsInfos, globalContext } = await gatherInputs();
  const { identityIndex } = loadState();
  ok('Using identity index from step 1: ' + identityIndex);

  // --- 2a. get the identity object (from the callback URL, or cached) ---
  let identityObject;
  if (existsSync(IDOBJECT_FILE)) {
    identityObject = JSON.parse(readFileSync(IDOBJECT_FILE, 'utf8'));
    ok('Loaded a previously-saved identity object.');
  } else {
    // Accept the callback either as a command argument OR from a file
    // (callback.txt) — the latter avoids Windows shell line-length limits.
    let source = callbackArg;
    if (!source && existsSync('./callback.txt')) {
      source = readFileSync('./callback.txt', 'utf8').trim();
      ok('Read callback URL from callback.txt');
    }
    const codeUri = extractCodeUri(source);
    if (!codeUri) {
      bad('No code_uri found. Either:');
      line('   • paste the callback URL into a file named callback.txt, then run: npm run onboard:create');
      line('   • or pass it inline: npm run onboard:create -- "http://localhost:4000/callback#code_uri=..."');
      return;
    }
    line('  Polling the provider for the issued identity...');
    identityObject = await pollForIdentity(codeUri);
    if (!identityObject) return;
    writeFileSync(IDOBJECT_FILE, JSON.stringify(identityObject, null, 2));
    ok('Identity issued and saved to ' + IDOBJECT_FILE);
  }

  // --- 2b. build + sign + submit the credential ---
  const credInput = {
    ipInfo,
    globalContext,
    arsInfos,
    idObject: identityObject.value ?? identityObject,
    revealedAttributes: [],
    seedAsHex: hexSeed(TEST_SEED),
    net: NETWORK,
    identityIndex,
    credNumber: CRED_NUMBER,
  };

  try {
    const { ConcordiumHdWallet } = sdk;
    // Resolve the credential API across the main module and the `id` submodule,
    // since v12 relocated some functions out of the main entry point.
    const api = await resolveCredentialApi(sdk);
    if (!api.create || !api.sign || !api.serialize || !api.getAddr) {
      bad('Could not resolve all credential functions in this SDK version.');
      line('   create=' + !!api.create + ' sign=' + !!api.sign +
           ' serialize=' + !!api.serialize + ' getAddr=' + !!api.getAddr);
      line('   Credential-related exports seen: ' + (api.diag.join(', ') || '(none)'));
      return;
    }

    const expiryDate = new Date(Date.now() + 3600_000);
    const expiry = api.Expiry?.fromDate
      ? api.Expiry.fromDate(expiryDate)
      : new api.Expiry(expiryDate);

    const credentialDeployment = api.create(credInput, expiry);
    ok('Built the credential-deployment transaction.');

    const wallet = ConcordiumHdWallet.fromHex(hexSeed(TEST_SEED), NETWORK);
    const signingKey = wallet.getAccountSigningKey(ipInfo.ipIdentity, identityIndex, CRED_NUMBER);
    const signatures = [await api.sign(credentialDeployment, signingKey)];
    ok('Signed the credential deployment.');

    const addr = api.getAddr(credentialDeployment.unsignedCdi.credId);
    const payload = api.serialize(signatures, credentialDeployment);
    // Client method name may vary by version; try the known variants.
    const sendFn = (client.sendCredentialDeploymentTransaction
      || client.sendCredentialDeployment || client.sendCredentialDeploymentPayload)?.bind(client);
    if (!sendFn) { bad('No credential-deployment send method found on the client.'); return; }
    const success = await sendFn(payload, expiry);
    if (success) {
      line('\n  🎉 Account creation submitted. New address: ' + addr.toString());
      line('  Wait ~15s for finalization, then confirm it is real:');
      line('     $env:CCD_ACCOUNT="' + addr.toString() + '"; npm run spike');
    } else {
      bad('The node rejected the credential deployment (format).');
    }
  } catch (e) {
    bad('Credential build/sign/submit failed (version-sensitive): ' + e.message);
    line('     Note the SDK version and adjust the credential calls.');
  }
}

// ---- helpers ------------------------------------------------------
function extractCodeUri(arg) {
  if (!arg) return null;
  if (arg.startsWith('http') && arg.includes('code_uri=')) {
    const frag = arg.split('#')[1] ?? arg.split('?')[1] ?? '';
    const p = new URLSearchParams(frag);
    return p.get('code_uri');
  }
  return arg; // assume the raw code_uri was pasted
}

async function pollForIdentity(codeUri, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await (await fetch(codeUri)).json();
      if (r.status === 'done') return r.token?.identityObject ?? r.token;
      if (r.status === 'error') { bad('Provider rejected issuance: ' + (r.detail || '')); return null; }
      process.stdout.write('.');
    } catch (e) { process.stdout.write('x'); }
    await sleep(3000);
  }
  line(''); bad('Timed out waiting for the identity to be issued.');
  return null;
}

function hexSeed(mnemonic) {
  // Standard BIP-39 seed (what ConcordiumHdWallet.fromSeedPhrase uses).
  return pbkdf2Sync(mnemonic.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512').toString('hex');
}

async function resolveCredentialApi(sdk) {
  // Merge the main module with the `id` submodule (v12 moved some exports).
  let idMod = {};
  try { idMod = await import('@concordium/web-sdk/id'); } catch { /* not present */ }
  const src = { ...idMod, ...sdk };
  const pick = (names) => {
    for (const n of names) if (typeof src[n] === 'function') return src[n];
    return undefined;
  };
  return {
    // v12 renamed createCredentialTransaction -> createCredentialPayload.
    create: pick(['createCredentialPayload', 'createCredentialTransaction',
                  'createCredentialDeploymentPayload', 'createCredentialDeploymentTransaction']),
    sign: pick(['signCredentialTransaction']),
    serialize: pick(['serializeCredentialDeploymentPayload']),
    getAddr: pick(['getAccountAddress']),
    Expiry: src.TransactionExpiry,
    diag: Object.keys(src).filter((k) => /credential/i.test(k)),
  };
}

const STATE_FILE = './onboard-state.json';
function saveState(obj) { writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2)); }
function loadState() {
  if (!existsSync(STATE_FILE)) {
    bad('No onboard-state.json — run "npm run onboard:request" first.');
    return { identityIndex: 0 };
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function toHex(x) {
  // Coerce a hex string / Uint8Array / Buffer to a hex string.
  if (typeof x === 'string') return x;
  if (x instanceof Uint8Array || Buffer.isBuffer(x)) return Buffer.from(x).toString('hex');
  if (x && typeof x.toString === 'function') return x.toString(); // last resort
  return x;
}

// ---- entry --------------------------------------------------------
const mode = process.argv[2];
const arg  = process.argv[3];
(async () => {
  line('Concordium × WDK — Account-creation prototype (testnet)');
  line('------------------------------------------------------');
  if (mode === 'request') await doRequest();
  else if (mode === 'create') await doCreate(arg);
  else {
    line('Usage:');
    line('  npm run onboard:request');
    line('  npm run onboard:create -- "<full callback URL with #code_uri=...>"');
  }
})().catch((e) => { console.error('\nUnexpected failure:', e); process.exit(1); });
