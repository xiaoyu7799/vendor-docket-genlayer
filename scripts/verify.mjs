import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { clientFor, execution, leaderReceipt, read } from '../network.mjs';

const deployment = JSON.parse(readFileSync(new URL('../deployment.json', import.meta.url)));
const { address, transactions, states, sourceSha256 } = deployment;
const client = clientFor();
assert.equal(await client.getChainId(), 61999);
const code = readFileSync(new URL('../contracts/vendor_docket.py', import.meta.url));
assert.equal(createHash('sha256').update(code).digest('hex'), sourceSha256);
const remote = await client.request({method: 'gen_getContractCode', params: [address]});
assert.deepEqual(Buffer.from(remote, 'base64'), code);
async function verifyReceipt([name, expected]) {
  const receipt = await client.getTransaction({hash: expected.hash});
  assert.equal(receipt.statusName ?? receipt.status, 'FINALIZED', name);
  assert.equal(execution(receipt), expected.execution, name);
  assert.equal(receipt.to_address?.toLowerCase(), address.toLowerCase(), name);
  assert.equal(receipt.from_address?.toLowerCase(), expected.sender.toLowerCase(), name);
  if (expected.result) assert.deepEqual(leaderReceipt(receipt)?.result, expected.result, name);
  return [name, 'FINALIZED', expected.execution, expected.hash];
}
const records = Object.entries(transactions);
for (let i = 0; i < records.length; i += 4) {
  const verified = await Promise.all(records.slice(i, i + 4).map(verifyReceipt));
  for (const receipt of verified) console.log(...receipt);
}
assert.deepEqual(states.cleared, states.afterWrongWallet);
assert.deepEqual(states.awarded, states.afterDuplicate);
assert.deepEqual(states.blocked, states.afterBlockedAccept);
assert.equal(states.awarded.trial.work_order, 'VD-1-1');
assert.equal(states.awarded.invitation.registration, 'ISSUED');
assert.equal(states.awarded.invitation.entity, 'ACTIVE');
assert.equal(states.blocked.trial.work_order, '');
assert.equal(states.blocked.invitation.registration, 'LAPSED');
for (const [id, sample] of [[1n, states.awarded], [2n, states.blocked]]) {
  const actual = await read(client, address, 'get_trial', [id]);
  assert.deepEqual(actual, sample.trial);
  const invitation = await read(client, address, 'get_invitation', [id, BigInt(actual.current)]);
  assert.deepEqual(invitation, sample.invitation);
  console.log('latest-final', String(id), actual.status, invitation.decision, actual.work_order || 'No work order');
}

if (states.browserTrial) {
  const browserTrial = await read(client, address, 'get_trial', [3n]);
  assert.deepEqual(browserTrial, states.browserTrial);
  console.log('latest-final 3', browserTrial.status, 'Browser signing and state readback verified');
}
