import { createAccount } from 'genlayer-js';
import { chainId, walletConnector } from './wallet.mjs';

export function walletPanel({client, fund, change, report}) {
  const panel = document.querySelector('#walletPanel');
  const choices = panel.querySelector('#walletChoices');
  const toggle = document.querySelector('#wallet');
  const demos = [];
  let active;
  let applying = false;
  const connector = walletConnector(window, select);

  function select(wallet) {
    active = wallet;
    toggle.textContent = wallet ? (wallet.external ? wallet.name : 'Demo') + ' · ' + wallet.address.slice(0, 6) + '…' + wallet.address.slice(-4) : 'Connect Wallet';
    change(wallet);
    if (panel.open) render();
  }

  function render() {
    const nodes = [];
    const text = (value, tag = 'p') => {
      const item = document.createElement(tag);
      item.textContent = value;
      nodes.push(item);
      return item;
    };
    function action(label, run) {
      const button = text(label, 'button');
      button.type = 'button';
      button.disabled = applying;
      button.onclick = async () => {
        if (applying) return;
        applying = true;
        render();
        try { await run(); }
        catch (error) { report(error.shortMessage ?? error.message ?? String(error)); panel.querySelector('#walletFeedback').textContent = error.message ?? String(error); }
        finally { applying = false; if (panel.open) render(); }
      };
    }
    if (active) {
      const current = active;
      text(current.external ? current.name : 'Demo / Test Wallet', 'h3');
      text(current.address).className = 'wallet-address';
      text(current.ready ? 'Stable Studionet · 61999' : 'Wrong network · Chain ' + current.chain);
      if (current.ready) {
        const balance = text('Reading Studionet balance…');
        client.getBalance({address:current.address}).then(value => {
          const fraction = (value % 10n**18n).toString().padStart(18,'0').replace(/0+$/,'');
          balance.textContent = (value / 10n**18n) + (fraction ? '.' + fraction : '') + ' test GEN';
        }).catch(() => { balance.textContent = 'Studionet balance unavailable.'; });
        action('Request test GEN', async () => {
          const before = await client.getBalance({address:current.address});
          await fund(client, current.address);
          const after = await client.getBalance({address:current.address});
          panel.querySelector('#walletFeedback').textContent = after > before ? 'Test GEN received.' : 'Funding requested. Check the balance before signing.';
        });
      } else if (current.external) {
        action('Switch to Stable Studionet', () => connector.switchNetwork(current));
      }
      action('Disconnect', () => connector.disconnect());
    }
    text('Browser wallets','h3');
    const found = connector.discover(false);
    if (!found.length) text('No browser wallet detected. Open this site in a browser with MetaMask or OKX Wallet, or use a demo wallet.');
    for (const candidate of found) action('Connect ' + candidate.name, () => connector.connect(candidate));
    text('Demo / Test Wallet','h3');
    text('Temporary accounts use test GEN. Refreshing or closing this page clears their keys.');
    const useDemo = account => {
      connector.disconnect();
      select({address:account.address, account, ready:true, chain:chainId});
    };
    for (const demo of demos) action('Use ' + demo.address, () => useDemo(demo));
    action('Create demo wallet', () => {
      const account = createAccount();
      demos.push(account);
      useDemo(account);
    });
    choices.replaceChildren(...nodes);
  }

  toggle.onclick = () => {
    if (toggle.disabled) return;
    panel.querySelector('#walletFeedback').textContent = '';
    panel.showModal();
    connector.discover();
    render();
  };
  panel.querySelector('#walletClose').onclick = () => panel.close();
  window.addEventListener('eip6963:announceProvider', () => {
    // Asynchronously announced providers appear without reopening the dialog.
    if (panel.open) queueMicrotask(() => {
      const names = choices.textContent;
      if (connector.discover(false).some(({name}) => !names.includes('Connect ' + name))) render();
    });
  });
}
