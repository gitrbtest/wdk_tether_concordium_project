/**
 * @concordium/wdk-wallet-concordium
 * -------------------------------------------------------------------
 * Entry point. Mirrors the shape of the other WDK wallet modules:
 * the default export is the WalletManager class that WDK registers.
 *
 *   import WDK from '@tetherto/wdk'
 *   import WalletManagerConcordium from '@concordium/wdk-wallet-concordium'
 *
 *   const wdk = new WDK(seedPhrase)
 *     .registerWallet('concordium', WalletManagerConcordium, {
 *       network: 'Testnet',
 *       endpoint: { host: 'grpc.testnet.concordium.com', port: 20000 },
 *     })
 *
 *   const account = await wdk.getAccount('concordium', 0)
 *   console.log(await account.getAddress(), await account.getBalance())
 */

import WalletManagerConcordium from './src/WalletManagerConcordium.js';
import WalletAccountConcordium, { AccountNotCreatedError } from './src/WalletAccountConcordium.js';
import ConcordiumOnboarding from './src/ConcordiumOnboarding.js';

export default WalletManagerConcordium;
export { WalletManagerConcordium, WalletAccountConcordium, ConcordiumOnboarding, AccountNotCreatedError };
