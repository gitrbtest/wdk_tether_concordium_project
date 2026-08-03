/**
 * Phase 4 example — tokens, generic over PLT and CIS-2.
 *
 * The SAME getTokenBalance / quoteTransfer / transfer calls work for both token
 * standards; the identifier string decides which backend runs (see the token
 * convention in WalletAccountConcordium.js). This example:
 *   1. Lists the PLTs available on testnet.
 *   2. Reads this account's PLT balance.
 *   3. Reads this account's CIS-2 balance (same method, different id).
 *   4. Quotes a transfer fee.
 *   5. Transfers — runs for real when the account holds the token.
 *
 * Tokens used (override with env vars):
 *   PLT_TOKEN   default "TN"                a protocol-level token symbol
 *   CIS2_TOKEN  default "cis2:12754:0:01"   "cis2:<index>:<subindex>:<tokenIdHex>"
 *
 * Run:  npm run example:token
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

const PLT_TOKEN = process.env.PLT_TOKEN || 'TN';
const CIS2_TOKEN = process.env.CIS2_TOKEN || 'cis2:12754:0:01';

/** Read one token's balance and print it; returns the balance (0n on error). */
async function showBalance(account, token, label = token) {
  try {
    const bal = await account.getTokenBalance(token);
    console.log(`    ${label}: ${bal} base units`);
    return bal;
  } catch (e) {
    console.log(`    ${label}: ⚠️  ${e.message}`);
    return 0n;
  }
}

async function main() {
  const manager = new WalletManagerConcordium(TEST_SEED, config);
  const account = await manager.getAccount(0);
  const address = await account.getAddress();
  console.log('Account:', address);

  console.log('\n[1] Listing PLTs on testnet...');
  const tokens = await manager.listTokens(12);
  console.log('    tokens:', tokens.join(', ') || '(none)');

  // Prefer our PLT symbol (case-insensitive); fall back to the first one listed.
  const plt = tokens.find((t) => t.toUpperCase() === PLT_TOKEN.toUpperCase()) ?? tokens[0];

  console.log('\n[2] Reading balances (same getTokenBalance call for both standards)...');
  const pltBal = plt ? await showBalance(account, plt) : 0n;
  if (!plt) console.log('    (no PLT available on this network)');
  await showBalance(account, CIS2_TOKEN);

  // The CIS-2 token's own name/symbol live off-chain (a URL on the contract).
  // Printing them shows this is a DISTINCT token from the PLT above, even if the
  // symbols happen to match — identity is the (contract, tokenId) ref, not a name.
  console.log('\n[2b] CIS-2 token metadata (name/symbol resolved via its on-chain URL)...');
  try {
    const { url, metadata } = await account.getCis2Metadata(CIS2_TOKEN);
    console.log('    id:      ', CIS2_TOKEN, '(vs the PLT symbol above)');
    console.log('    name:    ', metadata?.name ?? '(none in metadata)');
    console.log('    symbol:  ', metadata?.symbol ?? '(none in metadata)');
    console.log('    decimals:', metadata?.decimals ?? '(n/a)');
    console.log('    url:     ', url);
  } catch (e) {
    console.log('    ⚠️ ', e.message);
  }

  if (plt) {
    console.log(`\n[3] Quoting a transfer of 1 base unit of ${plt} to self...`);
    try {
      const q = await account.quoteTransfer({ token: plt, recipient: address, amount: 1n });
      console.log('    ✅ estimated fee (microCCD):', q.fee.toString());
    } catch (e) {
      console.log('    ⚠️ ', e.message);
    }

    console.log(`\n[4] Transfer 1 base unit of ${plt} to self (only if held)...`);
    if (pltBal > 0n) {
      const r = await account.transfer({ token: plt, recipient: address, amount: 1n });
      console.log('    ✅ sent. hash:', r.hash, 'fee:', r.fee.toString());
    } else {
      console.log('    (skipped — account holds 0 of this token)');
    }
  }

  // The SAME quoteTransfer / transfer calls, now for the CIS-2 (smart-contract)
  // token — exercising the other backend behind the generic token API.
  console.log(`\n[5] CIS-2 transfer of 1 base unit of ${CIS2_TOKEN} to self (only if held)...`);
  try {
    const cis2Bal = await account.getTokenBalance(CIS2_TOKEN);
    if (cis2Bal > 0n) {
      const q = await account.quoteTransfer({ token: CIS2_TOKEN, recipient: address, amount: 1n });
      console.log('    quoted fee (microCCD):', q.fee.toString());
      const r = await account.transfer({ token: CIS2_TOKEN, recipient: address, amount: 1n });
      console.log('    ✅ sent. hash:', r.hash, 'fee:', r.fee.toString());
    } else {
      console.log('    (skipped — account holds 0 of this CIS-2 token)');
    }
  } catch (e) {
    console.log('    ⚠️ ', e.message);
  }

  manager.dispose();
  console.log('\nDone.');
}

main().catch((e) => { console.error('Unexpected failure:', e); process.exit(1); });
