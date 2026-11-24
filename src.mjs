import { connectedSigner } from './wallet.mjs';
import { walletPanel } from './wallet-panel.mjs';
import { calldataAddress, clientFor, execution, explorer, finalized, fund, leaderReceipt, read } from './network.mjs';
import deployment from './deployment.json';
import './style.css';

const byId = id => document.getElementById(id);
const publicClient = clientFor();
const address = deployment.address;
const dialog = byId('dialog');
const notice = byId('notice');
let active;
const requestedTrial = new URLSearchParams(window.location.search).get('trial');
let selected = /^[1-9][0-9]{0,19}$/.test(requestedTrial ?? '')
  ? BigInt(requestedTrial)
  : deployment.states?.awarded ? 1n : undefined;
let currentTrial;
let view = 'docket';
let records = [];
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
  byId('wallet').disabled = busy;
  byId('open').disabled = !active?.ready || !address || busy;
}
function modal(title, fields, handler, signing = true) {
  byId('dialogTitle').textContent = title;
  byId('fields').replaceChildren(...fields);
  byId('signingContext').textContent = signing
    ? 'Stable Studionet (61999) · Signing as ' + active.address
    : '';
  byId('confirm').hidden = !handler;
  const wallet = active;
  action = values => active === wallet ? handler?.(values) : inform('Wallet changed. Reopen the action to sign.');
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
walletPanel({
  client: publicClient, fund, report: inform,
  change(wallet) {
    active = wallet;
    update().catch(error => inform(error.message));
  },
});
async function send(method, args, label) {
  if (busy || !address) return;
  if (!active?.ready) return inform('Connect a wallet on Stable Studionet first.');
  busy = true;
  displayWallet();
  byId('detail').querySelectorAll('button').forEach(element => element.disabled = true);
  let hash;
  let confirmed = false;
  try {
    const wallet = active;
    const submitted = tx => {
      hash = tx;
      inform('Submitted. Waiting for consensus and finality…', hash);
    };
    const client = wallet.external
      ? connectedSigner(wallet, () => active === wallet, submitted)
      : clientFor(wallet.account);
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
    confirmed = true;
    if (method === 'open_trial') {
      const trialNumber = leader?.result?.payload?.readable;
      selected = BigInt(/^\d+$/.test(trialNumber ?? '') ? trialNumber : await read(client, address, 'get_count'));
      first = selected;
    }
    inform('Finalized · Success. Reading chain state…', hash);
    await update();
    inform('Finalized · Success. Final chain state refreshed.', hash);
  } catch (error) {
    inform((confirmed ? 'FINALIZED / SUCCESS · Final state read failed. Refresh the trial. ' : '') + errorText(error), hash);
  } finally {
    busy = false;
    displayWallet();
    renderRegister();
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
  AWARDED: 'The trial is assigned. The work order identifies the assignment.',
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
      field('Supplier wallet address', 'supplier', {pattern: '0x[0-9a-fA-F]{40}'}),
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
  if (active?.ready && controls.childElementCount) detail.append(controls);
  if (trial.history.length) detail.append(node('h3', 'Invitation history'));
  for (const [index, item] of trial.history) {
    const entry = node('details', undefined, 'invitation');
    entry.open = index === BigInt(trial.current);
    entry.append(node('summary', 'Invitation ' + index + ' / ' + item.decision));
    entry.append(node('p', item.supplier, 'mono'), link(item.lei + ' · GLEIF record ↗',
      'https://api.gleif.org/api/v1/lei-records/' + item.lei));
    if (item.legal_name) entry.append(node('p', item.legal_name + ' · ' + item.registration + ' / ' + item.entity),
      node('p', 'Registry update: ' + item.updated, 'mono'));
    if (item.decision === 'CLEARED') entry.append(node('p', 'The record meets the ISSUED and ACTIVE requirement.'));
    if (item.decision === 'BLOCKED') entry.append(node('p', 'Policy requires ISSUED registration and ACTIVE entity status.'));
    if (item.decision === 'NOT_FOUND') entry.append(node('p', 'GLEIF returned no record for this LEI.'));
    detail.append(entry);
  }
  const demos = {
    '1': [['review-issued', 'Clearance receipt'], ['award', 'Work order receipt']],
    '2': [['review-lapsed-follow-up', 'Blocked review receipt'], ['reject-blocked-accept', 'Rejected acceptance receipt']],
    [deployment.browserWorkflow?.id]: [['browser-final-review', 'Clearance receipt'], ['browser-final-accept', 'Work order receipt']],
  };
  const links = (demos[String(trial.id)] ?? []).flatMap(([key, label]) => {
    const tx = deployment.transactions?.[key];
    return tx ? [link(label + ' ↗', explorer + '/transactions/' + tx.hash)] : [];
  });
  if (links.length) {
    const receipts = node('nav', undefined, 'sampleLinks');
    receipts.setAttribute('aria-label', 'Trial receipts');
    receipts.append(...links);
    detail.append(receipts);
  }
}
const columns = {
  docket: ['Trial', 'Deliverable', 'Status', 'Invitation'],
  registry: ['Trial', 'Legal entity', 'LEI', 'Registry status'],
  verification: ['Trial', 'LEI', 'Decision', 'Source updated'],
  orders: ['Trial', 'Work order', 'Deliverable', 'Assignee'],
};
function renderRegister() {
  byId('metrics').replaceChildren(...[
    ['Total trials', total],
    ['Pending verification · this page', records.filter(record => record.status === 'INVITED').length],
    ['Work orders · this page', records.filter(record => record.status === 'AWARDED').length],
  ].map(([label,value])=> {
    const card=node('div');
    card.append(node('span',label),node('strong',String(value)));
    return card;
  }));
  const header=node('tr');
  for(const label of columns[view]){
    const th=node('th',label);
    th.scope='col';
    header.append(th);
  }
  byId('tableHead').replaceChildren(header);
  const visible=records.filter(record=>view==='docket' || (view==='orders' ? record.work_order : record.latestInvitation));
  const rows=visible.map(record=>{
    const row=node('tr');
    if(selected===record.id) row.className='selected';
    const id=node('td');
    const open=button('VD-'+record.id,()=>{
      selected=record.id;
      update().catch(error=>inform(errorText(error)));
    },'record-button');
    open.setAttribute('aria-pressed',String(selected===record.id));
    id.append(open);
    const item=record.latestInvitation;
    const cells={
      docket:[record.brief,record.status,item?.decision ?? '—'],
      registry:[item?.legal_name || 'Awaiting registry check',item?.lei,item?.registration || '—'],
      verification:[item?.lei,item?.decision,item?.updated || '—'],
      orders:[record.work_order,record.brief,record.supplier],
    };
    row.append(id,...cells[view].map(value=>node('td',value)));
    return row;
  });
  if(!rows.length){
    const row=node('tr');
    const cell=node('td','No matching records on this page.');
    cell.colSpan=4;
    row.append(cell);
    rows.push(row);
  }
  byId('trials').replaceChildren(...rows);
}
for(const control of byId('views').querySelectorAll('button')){
  control.onclick=()=>{
    view=control.dataset.view;
    for(const option of byId('views').querySelectorAll('button')){
      option.setAttribute('aria-pressed',String(option===control));
    }
    renderRegister();
  };
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
  records = await Promise.all(trials.map(async ([id, trial]) => ({
    id, ...trial,
    latestInvitation: trial.current ? await read(publicClient,address,'get_invitation',[id,BigInt(trial.current)]) : null,
  })));
  renderRegister();
  byId('older').hidden = first <= 8n;
  byId('newest').hidden = first === total;
  const [id, trial] = trials.find(([id]) => id === selected) ?? trials[0];
  selected = id;
  const history = [];
  const latest = BigInt(trial.current);
  const detail = byId('detail');
  detail.replaceChildren(node('p', 'Reading final invitation history…'));
  for (let i = latest; i > 0n; i--) {
    history.push([i, i === latest ? records.find(row => row.id === id).latestInvitation : await read(publicClient, address, 'get_invitation', [id, i])]);
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
if (deployment.browserWorkflow?.id && deployment.states?.blocked) {
  const examples = byId('examples');
  for (const [id, label] of [
    [deployment.browserWorkflow.id, 'Example · Work order issued'],
    [2, 'Example · Supplier blocked'],
  ]) {
    const example = node('a', label);
    example.href = '?trial=' + id;
    examples.append(example);
  }
  examples.hidden = false;
}
displayWallet();
update().catch(error => inform(errorText(error)));
