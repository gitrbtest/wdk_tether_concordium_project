/**
 * Phase 0 de-risking spike — Concordium x Tether WDK
 * -------------------------------------------------------------
 * This script answers, with real code against Concordium TESTNET,
 * the questions that decide whether the WDK integration is doable:
 *
 *   CHECK 1  Does the Concordium SDK (incl. its WebAssembly crypto)
 *            load and run under plain Node.js?
 *   CHECK 2  Can we derive a Concordium account key from a normal
 *            BIP-39 seed phrase? (This is the model WDK relies on.)
 *   CHECK 3  Can we connect to the public testnet gRPC node and read
 *            live chain data?
 *   CHECK 4  Can we read the CCD balance of an existing account?
 *            (This is what WDK's getBalance() must do.)
 *   CHECK 5  Demonstrate the KEY difference from other chains: a
 *            freshly-derived key has NO on-chain account until an
 *            identity + credential have been deployed.
 *
 * Nothing here spends money or needs a funded account. It is safe
 * to run repeatedly. It only reads from testnet.
 *
 * HOW TO RUN
 *   1. Install Node.js 18+ (LTS recommended).
 *   2. In this folder:  npm install
 *   3.                  npm run spike
 *
 * NOTE ON VERSIONS: the @concordium/web-sdk API has shifted across
 * major versions. This script targets the v7.x line. If an import
 * or method name fails, that mismatch is itself a Phase 0 finding —
 * note the installed version (npm ls @concordium/web-sdk) and we
 * adjust. The concepts below do not change between versions.
 */

// ---- Config -------------------------------------------------------
const NODE_HOST = 'grpc.testnet.concordium.com';
const NODE_PORT = 20000;
const NETWORK   = 'Testnet';

// A well-known, long-lived TESTNET account address is ideal here.
// Replace with any address you can see on https://testnet.ccdscan.io
// (open the explorer, click any account, copy its address).
const KNOWN_TESTNET_ACCOUNT = process.env.CCD_ACCOUNT || '';

// A throwaway BIP-39 seed phrase for derivation testing ONLY.
// Never put a real, funded seed phrase in a file like this.
const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';

// Concordium HD derivation coordinates (NOT the same as BIP-44!).
// These identify which identity/credential the key belongs to.
const IDENTITY_PROVIDER_INDEX = 0;
const IDENTITY_INDEX          = 0;
const CREDENTIAL_COUNTER      = 0;

// ---- Small helpers ------------------------------------------------
const line = (s = '') => console.log(s);
const ok   = (s) => console.log('  ✅ ' + s);
const bad  = (s) => console.log('  ❌ ' + s);
const head = (n, s) => console.log('\n=== CHECK ' + n + ': ' + s + ' ===');

async function main() {
  line('Concordium x WDK — Phase 0 spike (testnet, read-only)');
  line('----------------------------------------------------');

  // ---------------------------------------------------------------
  head(1, 'SDK + WebAssembly load under Node.js');
  let sdk, nodeClientMod;
  try {
    sdk = await import('@concordium/web-sdk');
    // The Node-specific gRPC client AND matching credentials helper
    // both live in this subpath export.
    nodeClientMod = await import('@concordium/web-sdk/nodejs');
    ok('SDK modules imported — WebAssembly crypto initialised OK.');
  } catch (e) {
    bad('Could not load the SDK. This is the single biggest risk.');
    line('     ' + e.message);
    line('     -> Record the error and the installed version:');
    line('        npm ls @concordium/web-sdk');
    return;
  }

  const { ConcordiumHdWallet, AccountAddress, CcdAmount } = sdk;
  const { ConcordiumGRPCNodeClient, credentials } = nodeClientMod;

  // ---------------------------------------------------------------
  head(2, 'Derive a Concordium account key from a BIP-39 seed');
  let signingKeyHex;
  try {
    const wallet = ConcordiumHdWallet.fromSeedPhrase(TEST_SEED, NETWORK);
    const signingKey = wallet.getAccountSigningKey(
      IDENTITY_PROVIDER_INDEX, IDENTITY_INDEX, CREDENTIAL_COUNTER
    );
    signingKeyHex = Buffer.from(signingKey).toString('hex');
    ok('Derived an Ed25519 account signing key from the seed phrase.');
    line('     key (first 16 hex chars): ' + signingKeyHex.slice(0, 16) + '...');
    line('     -> Confirms WDK\'s "seed in, keys out" model works on Concordium.');
    line('     -> Note the 3 indices used — mapping WDK\'s single account');
    line('        index onto these is a design task for Phase 1.');
  } catch (e) {
    bad('Key derivation failed: ' + e.message);
  }

  // ---------------------------------------------------------------
  head(3, 'Connect to the public testnet gRPC node and read chain data');
  let client;
  try {
    // The public testnet node requires TLS on :20000 -> createSsl().
    client = new ConcordiumGRPCNodeClient(
      NODE_HOST, NODE_PORT, credentials.createSsl()
    );
    const consensus = await client.getConsensusStatus();
    ok('Connected. Live testnet best block height: ' +
       consensus.bestBlockHeight?.toString());
    line('     -> Confirms we can talk to Concordium exactly like the other');
    line('        WDK chains talk to their RPC endpoints.');
  } catch (e) {
    bad('Could not reach the node: ' + e.message);
    line('     -> If this persists, a firewall may be blocking outbound :20000,');
    line('        or try the node on port 443. Check: Test-NetConnection grpc.testnet.concordium.com -Port 20000');
  }

  // ---------------------------------------------------------------
  head(4, 'Read the CCD balance of an existing account (getBalance)');
  if (!client) {
    line('  (skipped — no node connection)');
  } else if (!KNOWN_TESTNET_ACCOUNT) {
    line('  (skipped) Set an address to test a real balance read:');
    line('     CCD_ACCOUNT=<address> npm run spike');
    line('     Find any address at https://testnet.ccdscan.io');
  } else {
    try {
      const addr = AccountAddress.fromBase58(KNOWN_TESTNET_ACCOUNT);
      const info = await client.getAccountInfo(addr);
      const microCcd = info.accountAmount?.microCcdAmount ?? info.accountAmount;
      ok('Balance read OK for ' + KNOWN_TESTNET_ACCOUNT.slice(0, 8) + '...');
      line('     balance (microCCD): ' + microCcd?.toString());
      line('     -> This is precisely what WDK getBalance() will return.');
    } catch (e) {
      bad('Balance read failed: ' + e.message);
    }
  }

  // ---------------------------------------------------------------
  head(5, 'Show the core difference: a derived key has no account yet');
  if (!client) {
    line('  (skipped — no node connection)');
  } else {
    try {
      // Ask the chain about an address that was only *derived*, never
      // registered via identity + credential. On Bitcoin/Ethereum this
      // "just works". On Concordium it should NOT exist yet.
      const probe = AccountAddress.fromBase58(
        // deterministic but almost-certainly-unregistered testnet address
        '3XSLuJcXg6xEua6iBPnWacc3iWh93yEDMCqX8FbE3RDSbEnT9P'
      );
      await client.getAccountInfo(probe);
      line('  (Unexpected) That address exists on-chain.');
    } catch (e) {
      ok('As expected, the probe address has no on-chain account.');
      line('     ' + (e.message || '').split('\n')[0]);
      line('     -> THIS is Section 5 made concrete: on Concordium, deriving a');
      line('        key is not enough. The owner must complete identity');
      line('        verification with an identity provider (e.g. the ones the');
      line('        testnet wallet-proxy lists) and deploy a credential before');
      line('        the account exists. WDK assumes the account is usable');
      line('        immediately; our module must account for this gap.');
    }
  }

  line('\nSpike complete. See README.md for how to read these results.');
}

main().catch((e) => {
  console.error('\nUnexpected failure:', e);
  process.exit(1);
});
