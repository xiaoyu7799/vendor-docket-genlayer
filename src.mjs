import { createAccount } from 'genlayer-js';
import { calldataAddress, clientFor, execution, explorer, finalized, fund, leaderReceipt, read } from './network.mjs';
import deployment from './deployment.json';
import './style.css';

const byId = id => document.getElementById(id);
const publicClient = clientFor();
const address = deployment.address;
const dialog = byId('dialog');
const notice = byId('notice');
const wallets = [];
let active;
const requestedTrial = new URLSearchParams(window.location.search).get('trial');
let selected = /^[1-9][0-9]{0,19}$/.test(requestedTrial ?? '') ? BigInt(requestedTrial) : undefined;
let currentTrial;
let total = 0n;
let first;
let busy = false;
let action;

function node(tag, content, className) {
  const result = document.createElement(tag);
  if (content !== undefined) result.textContent = content;
  if (className) result.className = className;
  return result;
}
function link(label, url) {
  const result = node('a', label);
  result.href = url;
  result.target = '_blank';
  result.rel = 'noreferrer';
  return result;
}
function button(label, handler, variant) {
  const element = node('button', label, variant);
  element.type = 'button';
  element.addEventListener('click', handler);
  element.disabled = busy;
  return element;
}
function matches(address) {
  return active?.address.toLowerCase() === address?.toLowerCase();
}
function inform(message, hash) {
  notice.replaceChildren(node('span', message));
  if (hash) notice.append(' ', link('View transaction ↗', explorer + '/transactions/' + hash));
}
function errorText(error) {
  return error.shortMessage ?? error.message ?? String(error);
}
function displayWallet() {
  byId('wallet').textContent = active ? active.address.slice(0, 8) + '…' + active.address.slice(-4) : 'Test wallets';
  byId('open').disabled = !active || !address || busy;
}
function modal(title, fields, handler, signing = true) {
  byId('dialogTitle').textContent = title;
  byId('fields').replaceChildren(...fields);
  byId('signingContext').textContent = signing
    ? 'Stable Studionet (61999) · Signing as ' + active.address
    : 'Session-only Studionet wallets. Use test funds only. Closing or refreshing the page clears all keys.';
  byId('confirm').hidden = !handler;
  action = handler;
  dialog.showModal();
}
function field(label, name, attrs) {
  const result = node('label', label);
  const input = node('input');
  input.name = name;
  input.required = true;
  for (const [key, value] of Object.entries(attrs)) input.setAttribute(key, value);
  result.append(input);
  return result;
}
byId('cancel').onclick = () => dialog.close();
byId('actionForm').onsubmit = event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  dialog.close();
  action?.(values);
};
byId('wallet').onclick = () => {
  const fields = wallets.map(wallet => button(wallet.address + (wallet === active ? ' · Active' : ''), () => {
    active = wallet;
    dialog.close();
    displayWallet();
    update().catch(error => inform(errorText(error)));
  }, 'walletRow'));
  fields.push(button('Create session wallet', () => {
    active = createAccount();
    wallets.push(active);
    dialog.close();
    displayWallet();
    update().catch(error => inform(errorText(error)));
  }));
  if (active) {
    const walletInfo = node('p', 'Reading test GEN balance…', 'mono');
    const walletAddress = active.address;
    clientFor(active).getBalance({address: walletAddress}).then(balance => {
      const whole = balance / 10n ** 18n;
      const decimals = (balance % (10n ** 18n)).toString().padStart(18, '0').replace(/0+$/, '');
      walletInfo.textContent = whole + (decimals ? '.' + decimals : '') + ' test GEN · 61999';
    }).catch(error => { walletInfo.textContent = errorText(error); });
    fields.push(walletInfo, button('Copy active address', async event => {
      try {
        await navigator.clipboard.writeText(walletAddress);
        event.currentTarget.textContent = 'Address copied';
      } catch {
        inform('Copy the full address from the wallet list.');
      }
    }));
    fields.push(button('Fund active wallet', async event => {
      event.currentTarget.disabled = true;
      try {
        const client = clientFor(active);
        await fund(client, active.address);
        inform('Test balance: ' + await client.getBalance({address: active.address}) + ' base units');
        dialog.close();
      } catch (error) {
        inform(errorText(error));
        dialog.close();
      }
    }));
    fields.push(button('Disconnect', () => {
      active = undefined;
      dialog.close();
      displayWallet();
      update().catch(error => inform(errorText(error)));
    }));
    fields.push(button('Clear session wallets', () => {
      active = undefined;
      wallets.length = 0;
      dialog.close();
      displayWallet();
      update().catch(error => inform(errorText(error)));
    }));
  }
  modal('Test wallets', fields, null, false);
};
async function send(method, args, label) {
  if (busy || !active || !address) return;
  busy = true;
  displayWallet();
  byId('detail').querySelectorAll('button').forEach(element => element.disabled = true);
  let hash;
  try {
    const client = clientFor(active);
    if (await client.getChainId() !== 61999) throw new Error('RPC chain does not match Studionet.');
    inform('Signing ' + label + '…');
    hash = await client.writeContract({address, functionName: method, args, value: 0n, leaderOnly: false, fees: await client.estimateTransactionFees()});
    inform('Submitted. Waiting for consensus and finality…', hash);
    const receipt = await finalized(client, hash);
    const leader = leaderReceipt(receipt);
    const status = receipt.statusName ?? (receipt.status === 7 ? "FINALIZED" : receipt.status);
    if (status !== 'FINALIZED' || execution(receipt) !== 'SUCCESS') {
      throw new Error([status, execution(receipt) ?? 'execution result unavailable',
        typeof leader?.result?.payload === 'string' ? leader.result.payload : ''].filter(Boolean).join(' / '));
    }
    if (method === 'open_trial') {
      const trialNumber = leader?.result?.payload?.readable;
      selected = BigInt(/^\d+$/.test(trialNumber ?? '') ? trialNumber : await read(client, address, 'get_count'));
      first = selected;
    }
    inform('Finalized · Success. Reading chain state…', hash);
    await update();
    inform('Finalized · Success. Final chain state refreshed.', hash);
  } catch (error) {
    inform(errorText(error), hash);
  } finally {
    busy = false;
    displayWallet();
    byId('trials').querySelectorAll('button').forEach(element => element.disabled = false);
    if (currentTrial) renderDetail(currentTrial);
  }
}
byId('open').onclick = () => modal('Open a pilot trial', [
  field('Deliverable', 'brief', {maxlength: '280', placeholder: 'Describe the test deliverable'}),
], data => send('open_trial', [data.get('brief')], 'open trial'));

const nextSteps = {
  OPEN: 'The buyer can invite a supplier. A blocked or withdrawn invitation releases the slot.',
  INVITED: 'The invited supplier can submit its LEI for independent verification. The buyer can withdraw.',
  CLEARED: 'The invited supplier can accept the trial. The buyer can withdraw before acceptance.',
  AWARDED: 'The trial is assigned. The work order below is the supplier’s receipt.',
};

function renderDetail(trial) {
  const detail = byId('detail');
  if (String(trial.id) !== String(selected)) return;
  const summary = node('dl', undefined, 'facts');
  function fact(label, value) {
    const line = node('div');
    line.append(node('dt', label), node('dd', value));
    summary.append(line);
  }
  fact('Buyer wallet', trial.buyer);
  if (trial.current) fact('Latest invited wallet', trial.supplier);
  if (trial.work_order) fact('Work order', trial.work_order);
  detail.replaceChildren(node('p', 'TRIAL / ' + String(trial.id).padStart(4, '0'), 'kicker'),
    node('h2', trial.brief), node('span', trial.status, 'chip ' + trial.status.toLowerCase()), summary,
    node('p', nextSteps[trial.status], 'next'));
  const controls = node('div', undefined, 'buttons');
  if (trial.status === 'OPEN' && matches(trial.buyer)) {
    controls.append(button('Invite supplier', () => modal('Reserve the trial slot', [
      field('Supplier test wallet', 'supplier', {pattern: '0x[0-9a-fA-F]{40}'}),
      field('Legal Entity Identifier', 'lei', {pattern: '[A-Z0-9]{18}[0-9]{2}', maxlength: '20'}),
    ], data => send('invite', [trial.id, calldataAddress(data.get('supplier')), data.get('lei')], 'invite supplier')), 'primary'));
  }
  const args = [trial.id, BigInt(trial.current)];
  const offer = (label, method, detail) => controls.append(button(label, () => modal(label,
    [node('p', detail)], () => send(method, args, label)), 'primary'));
  if (trial.status === 'INVITED' && matches(trial.supplier)) {
    offer('Verify GLEIF record', 'review_invitation', 'Validators query the assigned LEI. A blocked record releases the slot.');
  }
  if (trial.status === 'CLEARED' && matches(trial.supplier)) {
    offer('Accept work order', 'accept', 'Assign this trial permanently to the invited wallet.');
  }
  if (['INVITED', 'CLEARED'].includes(trial.status) && matches(trial.buyer)) {
    offer('Withdraw invitation', 'withdraw', 'Release the slot so the buyer can issue another invitation.');
  }
  if (controls.childElementCount) detail.append(controls);
  for (const [index, item] of trial.history) {
    const entry = node('details', undefined, 'invitation');
    entry.open = index === BigInt(trial.current);
    entry.append(node('summary', 'Invitation ' + index + ' / ' + item.decision));
    entry.append(node('p', item.supplier, 'mono'), link(item.lei + ' · GLEIF record ↗',
      'https://api.gleif.org/api/v1/lei-records/' + item.lei));
    if (item.legal_name) entry.append(node('p', item.legal_name + ' · ' + item.registration + ' / ' + item.entity),
      node('p', 'Registry update: ' + item.updated, 'mono'));
    if (item.decision === 'BLOCKED') entry.append(node('p', 'Policy requires ISSUED registration and ACTIVE entity status.'));
    if (item.decision === 'NOT_FOUND') entry.append(node('p', 'GLEIF returned no record for this LEI.'));
    detail.append(entry);
  }
}
async function update() {
  if (!address) {
    byId('detail').replaceChildren(node('h2', 'Deployment pending'));
    return;
  }
  total = BigInt(await read(publicClient, address, 'get_count'));
  if (!total) {
    byId('detail').replaceChildren(node('h2', 'No trials yet'));
    return;
  }
  if (selected && selected > total) selected = undefined;
  first ??= selected && selected + 7n < total ? selected + 7n : total;
  selected ??= total;
  const ids = Array.from({length: Number(first < 8n ? first : 8n)}, (_, index) => first - BigInt(index));
  const trials = await Promise.all(ids.map(async id => [id, await read(publicClient, address, 'get_trial', [id])]));
  byId('trials').replaceChildren(...trials.map(([id, trial]) => {
    const entry = button('', () => { selected = id; update().catch(error => inform(errorText(error))); }, 'trialButton');
    entry.setAttribute('aria-pressed', String(selected === id));
    entry.append(node('span', 'VD / ' + id + ' · ' + trial.status, 'kicker'), node('strong', trial.brief));
    return entry;
  }));
  byId('older').hidden = first <= 8n;
  byId('newest').hidden = first === total;
  const [id, trial] = trials.find(([id]) => id === selected) ?? trials[0];
  selected = id;
  const history = [];
  const latest = BigInt(trial.current);
  const detail = byId('detail');
  detail.replaceChildren(node('p', 'Reading final invitation history…'));
  for (let i = latest; i > 0n; i--) {
    history.push([i, await read(publicClient, address, 'get_invitation', [id, i])]);
  }
  if (selected !== id) return;
  currentTrial = {...trial, id, history};
  renderDetail(currentTrial);
}
byId('newest').onclick = () => {
  first = undefined;
  selected = undefined;
  update().catch(error => inform(errorText(error)));
};
byId('older').onclick = () => {
  first -= 8n;
  selected = first;
  update().catch(error => inform(errorText(error)));
};
const evidence = byId('evidence');
if (address) {
  evidence.append(node('h2', 'Studionet evidence'), link('Contract ↗', explorer + '/address/' + address));
  if (deployment.states?.awarded && deployment.states?.blocked) {
    evidence.append(node('p', 'The trials use test wallets and real public registry records. They do not represent the named entities.'));
    const samples = node('div', undefined, 'sampleLinks');
    samples.append(link('Trial 1 · Work order issued', '?trial=1'), link('Trial 2 · Slot released', '?trial=2'));
    evidence.append(samples);
  }
  const rows = node('ul');
  for (const [label, tx] of Object.entries(deployment.transactions ?? {})) {
    const line = node('li');
    const descriptions = {
      'invite-issued': 'Invite supplier with active registration',
      'review-issued': 'Consensus clears the active LEI',
      'review-lapsed': 'Consensus blocks the lapsed LEI',
      'award': 'Supplier accepts the work order',
      'reject-wrong-wallet': 'Uninvited wallet rejected',
      'reject-duplicate': 'Duplicate acceptance rejected',
      'reject-blocked-accept': 'Blocked supplier cannot accept',
    };
    const receipt = link(descriptions[label] ?? label.replaceAll('-', ' '), explorer + '/transactions/' + tx.hash);
    receipt.title = 'Sender: ' + tx.sender;
    line.append(receipt, node('span', tx.status + ' / ' + tx.execution, 'mono'));
    rows.append(line);
  }
  evidence.append(rows);
}
displayWallet();
update().catch(error => inform(errorText(error)));
