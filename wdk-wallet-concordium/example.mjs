/**
 * Example / smoke test for the Phase 1 read-only module.
 *
 * Demonstrates two things against Concordium testnet:
 *   1. getBalanceForAddress — read the balance of the real account we
 *      created in Phase 0 (works regardless of address derivation).
 *   2. getAddress + getBalance — derive the address for a WDK index and
 *      read it (this exercises the credId derivation, the one Phase-1
 *      detail still being pinned down; it may need a small tweak).
 *
 * Run:  npm install   (once)
 *       npm run example
 */

import WalletManagerConcordium, { AccountNotCreatedError } from './index.js';

// The throwaway test seed + the exact identity index used to create the
// account in Phase 0, so index 0 here maps to that same account.
const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';
const KNOWN_ACCOUNT = '3GEmZc57STNxVqWykUceXAeCVsDzaogq6wNZhDLAV8bRNYzUYd';

const wdkLikeConfig = {
  network: 'Testnet',
  endpoint: { host: 'grpc.testnet.concordium.com', port: 20000, secure: true },
  identityProviderIndex: 0,
  identityIndex: 899424164,   // the fresh identity index from the Phase 0 run
};

async function main() {
  const manager = new WalletManagerConcordium(TEST_SEED, wdkLikeConfig);
  const account = await manager.getAccount(0); // -> cred 0 under that identity

  console.log('Account path (provider/identity/cred):', account.path);

  // 1) Definitely-working: read a known account's balance.
  console.log('\n[1] Reading the known Phase-0 account by address...');
  try {
    const bal = await account.getBalanceForAddress(KNOWN_ACCOUNT);
    console.log('    ✅ balance (microCCD):', bal.toString(), '  (0 = created but unfunded)');
  } catch (e) {
    console.log('    ❌', e.message);
  }

  // 2) Exercise address derivation + getBalance via the WDK interface.
  console.log('\n[2] Deriving the address for index 0 via getAddress()...');
  try {
    const addr = await account.getAddress();
    console.log('    address:', addr);
    console.log('    matches known account:', addr === KNOWN_ACCOUNT ? '✅ yes' : '⚠️  no');
    const bal = await account.getBalance();
    console.log('    ✅ getBalance (microCCD):', bal.toString());
  } catch (e) {
    if (e instanceof AccountNotCreatedError) console.log('    (account not created yet):', e.message);
    else console.log('    ⚠️  address derivation needs a tweak for this SDK version:\n       ', e.message);
  }

  manager.dispose();
  console.log('\nDone.');
}

main().catch((e) => { console.error('Unexpected failure:', e); process.exit(1); });
