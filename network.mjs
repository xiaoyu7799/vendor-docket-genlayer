import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { CalldataAddress, TransactionHashVariant } from 'genlayer-js/types';

export const rpc = 'https://studio.genlayer.com/api';
export const explorer = 'https://explorer-studio.genlayer.com';
export const clientFor = account => createClient({ chain: studionet, endpoint: rpc, account });
export const read = (client, address, functionName, args = []) => client.readContract({
  address, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
});
export const finalized = (client, hash) => client.waitForTransactionReceipt({
  hash, waitUntil: "finalized", interval: 3000, retries: 250, fullTransaction: true,
});
export function leaderReceipt(receipt) {
  const leader = receipt.consensus_data?.leader_receipt;
  return Array.isArray(leader) ? leader[0] : leader;
}
export function execution(receipt) {
  return leaderReceipt(receipt)?.execution_result ?? receipt.txExecutionResultName;
}
export async function fund(client, address) {
  return client.request({ method: 'sim_fundAccount', params: [address, 100] });
}

export function calldataAddress(address) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error('Invalid EVM address.');
  return new CalldataAddress(Uint8Array.from(address.slice(2).match(/../g), byte => parseInt(byte, 16)));
}
