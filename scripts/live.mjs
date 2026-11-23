import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createAccount, generatePrivateKey } from 'genlayer-js';
import { calldataAddress, clientFor, execution, finalized, fund, leaderReceipt, read } from '../network.mjs';

const keyFile = process.env.VENDOR_DOCKET_KEYS ?? '../.vendor-docket-keys.json';
const journal = process.env.VENDOR_DOCKET_JOURNAL ?? '../vendor-live-journal-v2.json';
const lockFile = keyFile + '.lock';
closeSync(openSync(lockFile, 'wx', 0o600));
process.on('exit', () => unlinkSync(lockFile));
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
if (!existsSync(keyFile)) {
  writeFileSync(keyFile, JSON.stringify(Array.from({length: 3}, () => generatePrivateKey())), {mode: 0o600, flag: 'wx'});
}
const accounts = JSON.parse(readFileSync(keyFile)).map(key => createAccount(key));
const [buyer, supplier, observer] = accounts.map(clientFor);
const [buyerAddress, supplierAddress, observerAddress] = accounts.map(account => account.address);
const evidence = existsSync(journal) ? JSON.parse(readFileSync(journal)) : {transactions: {}, states: {}};
const save = () => {
  const temp = journal + '.tmp';
  writeFileSync(temp, JSON.stringify(evidence, (_, value) => typeof value === 'bigint' ? String(value) : value, 2));
  renameSync(temp, journal);
};
const source = readFileSync(new URL('../contracts/vendor_docket.py', import.meta.url));
const digest = createHash('sha256').update(source).digest('hex');
assert.equal(await buyer.getChainId(), 61999);
if (evidence.sourceSha256) assert.equal(evidence.sourceSha256, digest);
evidence.sourceSha256 = digest;

let submission = Promise.resolve();
async function tx(label, client, send, succeeds = true) {
  const sendOnce = submission.then(async () => {
    const entry = evidence.transactions[label] ??= {hash: await send(), sender: client.account.address};
    save();
    return entry;
  });
  submission = sendOnce.catch(() => {});
  const entry = await sendOnce;
  console.log(label, entry.hash);
  const receipt = await finalized(client, entry.hash);
  entry.status = receipt.statusName ?? (receipt.status === 7 ? "FINALIZED" : receipt.status);
  entry.execution = execution(receipt);
  const leader = leaderReceipt(receipt);
  entry.result = leader?.result ?? null;
  entry.validatorVotes = receipt.consensus_data?.votes ?? {};
  save();
  assert.equal(entry.status, 'FINALIZED');
  if (succeeds) assert.equal(entry.execution, 'SUCCESS');
  else {
    assert.match(entry.execution ?? '', /ERROR|REVERT/);
    assert.match(JSON.stringify(entry.result), /CLEARED_SUPPLIER_REQUIRED/);
  }
  return receipt;
}

for (const [client, address] of [[buyer,buyerAddress],[supplier,supplierAddress],[observer,observerAddress]]) {
  const balance = await client.getBalance({address});
  if (balance === 0n) await fund(client, address);
}
const deployed = await tx('deploy', buyer, async () => buyer.deployContract({code: new Uint8Array(source), leaderOnly: false, fees: await buyer.estimateTransactionFees()}));
const address = evidence.address ??= deployed.txDataDecoded?.contractAddress ?? deployed.data?.contract_address ?? deployed.to_address ?? deployed.recipient;
assert.match(address ?? '', /^0x[0-9a-f]{40}$/i);
save();
console.log('Contract', address);
const remoteCode = await buyer.request({method: "gen_getContractCode", params: [address]});
const remoteBytes = Buffer.from(remoteCode, "base64");
assert.deepEqual(remoteBytes, source);
evidence.deployedSourceMatches = true;
save();

const write = (label, client, functionName, args, succeeds = true) => tx(label, client, async () => client.writeContract({
  address, functionName, args, value: 0n, leaderOnly: false, fees: await client.estimateTransactionFees(),
}), succeeds);
async function snapshot(label, id, status, decision) {
  const trial = await read(buyer, address, 'get_trial', [id]);
  const invitation = await read(buyer, address, 'get_invitation', [id, BigInt(trial.current)]);
  assert.equal(trial.status, status);
  assert.equal(invitation.decision, decision);
  evidence.states[label] = {trial, invitation};
  save();
}

await write('open-primary', buyer, 'open_trial', ['Catalogue a pilot collection of spare parts and deliver a reconciled inventory file.']);
const flows = await Promise.allSettled([
  (async () => {
    await write('invite-issued', buyer, 'invite', [1n, calldataAddress(supplierAddress), '5493001KJTIIGC8Y1R12']);
    await write('review-issued', supplier, 'review_invitation', [1n, 1n]);
    if (!evidence.states.cleared) await snapshot('cleared', 1n, 'CLEARED', 'CLEARED');
    await write('reject-wrong-wallet', observer, 'accept', [1n, 1n], false);
    if (!evidence.states.afterWrongWallet) await snapshot('afterWrongWallet', 1n, 'CLEARED', 'CLEARED');
    await write('award', supplier, 'accept', [1n, 1n]);
    await snapshot('awarded', 1n, 'AWARDED', 'CLEARED');
    assert.equal(evidence.states.awarded.trial.work_order, 'VD-1-1');
    await write('reject-duplicate', supplier, 'accept', [1n, 1n], false);
    await snapshot('afterDuplicate', 1n, 'AWARDED', 'CLEARED');
    assert.deepEqual(evidence.states.afterWrongWallet, evidence.states.cleared);
    assert.deepEqual(evidence.states.afterDuplicate, evidence.states.awarded);
  })(),
  (async () => {
    await write('open-secondary', buyer, 'open_trial', ['Digitize ten sample receiving slips and return an indexed pilot bundle.']);
    await write('invite-lapsed', buyer, 'invite', [2n, calldataAddress(observerAddress), '353800SZHNPYLZTIX835']);
    await write('review-lapsed', observer, 'review_invitation', [2n, 1n]);
    await snapshot('blocked', 2n, 'OPEN', 'BLOCKED');
    await write('reject-blocked-accept', observer, 'accept', [2n, 1n], false);
    await snapshot('afterBlockedAccept', 2n, 'OPEN', 'BLOCKED');
    assert.deepEqual(evidence.states.afterBlockedAccept, evidence.states.blocked);
    assert.equal(evidence.states.blocked.trial.work_order, '');
  })(),
]);
const failures = flows.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
if (failures.length) throw new AggregateError(failures, 'Studionet workflow failed');
