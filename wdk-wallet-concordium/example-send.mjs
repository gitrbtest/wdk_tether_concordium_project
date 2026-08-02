/**
 * Phase 2 example — send native CCD on testnet.
 *
 * Steps:
 *   1. Load account 0 (the account created in Phase 0).
 *   2. If it has no CCD, request a testnet faucet drop (wallet-proxy) and wait.
 *   3. Send a small amount of CCD to itself (a valid transfer that just pays
 *      the fee) — proves build + sign + send + finalize through the module.
 *
 * This SPENDS testnet CCD (only the fee). Testnet CCD is free via the drop.
 *
 * Run:  npm install   (once)
 *       npm run example:send
 */

import WalletManagerConcordium, { AccountNotCreatedError } from './index.js';

const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';
const WALLET_PROXY = 'https://wallet-proxy.testnet.concordium.com';

const config = {
  network: 'Testnet',
  endpoint: { host: 'grpc.testnet.concordium.com', port: 20000, secure: true },
  identityProviderIndex: 0,
  identityIndex: 899424164,      // the identity from Phase 0
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureFunded(account, address) {
  let bal = 0n;
  try { bal = await account.getBalanceForAddress(address); }
  catch (e) { if (!(e instanceof AccountNotCreatedError)) throw e; }
  if (bal > 0n) { console.log('    already funded:', bal.toString(), 'microCCD'); return bal; }

  console.log('    balance is 0 — requesting a testnet faucet drop...');
  const res = await fetch(`${WALLET_PROXY}/v0/testnetGTUDrop/${address}`, { method: 'PUT' });
  console.log('    drop request status:', res.status);

  for (let i = 0; i < 20; i++) {
    await sleep(5000);
    const b = await account.getBalanceForAddress(address);
    process.stdout.write(`    waiting for funds... ${b.toString()} microCCD\r`);
    if (b > 0n) { console.log('\n    funded:', b.toString(), 'microCCD'); return b; }
  }
  throw new Error('Timed out waiting for the faucet drop to finalize.');
}

async function main() {
  const manager = new WalletManagerConcordium(TEST_SEED, config);
  const account = await manager.getAccount(0);
  const address = await account.getAddress();
  console.log('Account:', address);

  console.log('\n[1] Ensuring the account has CCD to spend...');
  await ensureFunded(account, address);

  console.log('\n[2] Sending 1 CCD (1,000,000 microCCD) to itself...');
  try {
    const result = await account.sendTransaction({ to: address, value: 1_000_000n });
    console.log('    ✅ sent. tx hash:', result.hash);
    console.log('       fee (microCCD):', result.fee.toString());
    const bal = await account.getBalanceForAddress(address);
    console.log('    balance after:', bal.toString(), 'microCCD (down by the fee)');
  } catch (e) {
    console.log('    ⚠️  send failed:', e.message);
  }

  manager.dispose();
  console.log('\nDone.');
}

main().catch((e) => { console.error('Unexpected failure:', e); process.exit(1); });
