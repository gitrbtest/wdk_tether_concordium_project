/**
 * Exercises the three not-yet-verified methods:
 *   - quoteSendTransaction  (estimate a transfer fee, no send)
 *   - sign / verify         (sign an arbitrary message, then verify it)
 *
 * None of these spend anything. The account must already exist on-chain
 * (it does, from Phase 0). Run:  npm run example:verify
 */

import WalletManagerConcordium from './index.js';

const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';

const config = {
  network: 'Testnet',
  endpoint: { host: 'grpc.testnet.concordium.com', port: 20000, secure: true },
  identityProviderIndex: 0,
  identityIndex: 899424164,
};

async function main() {
  const manager = new WalletManagerConcordium(TEST_SEED, config);
  const account = await manager.getAccount(0);
  const address = await account.getAddress();
  console.log('Account:', address);

  console.log('\n[A] quoteSendTransaction — estimate fee for sending 1 CCD...');
  try {
    const q = await account.quoteSendTransaction({ to: address, value: 1_000_000n });
    console.log('    ✅ estimated fee (microCCD):', q.fee.toString());
  } catch (e) {
    console.log('    ⚠️ ', e.message);
  }

  console.log('\n[B] sign — sign an arbitrary message...');
  let signature;
  try {
    signature = await account.sign('hello concordium');
    console.log('    ✅ signature:', signature.slice(0, 80) + (signature.length > 80 ? '…' : ''));
  } catch (e) {
    console.log('    ⚠️ ', e.message);
  }

  console.log('\n[C] verify — verify the signature just produced...');
  if (signature) {
    try {
      const ok = await account.verify('hello concordium', signature);
      console.log('    verify result:', ok === true ? '✅ true (valid)' : '⚠️  ' + ok);
      const tampered = await account.verify('a different message', signature);
      console.log('    verify wrong message:', tampered === false ? '✅ false (correctly rejected)' : '⚠️  ' + tampered);
    } catch (e) {
      console.log('    ⚠️ ', e.message);
    }
  } else {
    console.log('    (skipped — no signature from step B)');
  }

  manager.dispose();
  console.log('\nDone.');
}

main().catch((e) => { console.error('Unexpected failure:', e); process.exit(1); });
