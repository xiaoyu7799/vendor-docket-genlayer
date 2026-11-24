import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

export const chainId = 61999;
const hexId = '0xf22f';
const endpoint = 'https://studio.genlayer.com/api';
const valid = address => typeof address === 'string' && /^0x[0-9a-f]{40}$/i.test(address);

export function walletConnector(host = window, onChange = () => {}) {
  const announced = new Map();
  let connection;
  let generation = 0;
  host.addEventListener('eip6963:announceProvider', event => {
    const {info, provider} = event.detail ?? {};
    if (typeof provider?.request !== 'function' || typeof info?.name !== 'string') return;
    announced.set(provider, {name: info.name, provider});
  });
  const announce = () => host.dispatchEvent(new Event('eip6963:requestProvider'));
  announce();

  function disconnect() {
    generation++;
    connection?.remove();
    connection = undefined;
    onChange(undefined);
  }

  function discover(request = true) {
    if (request) announce();
    const providers = new Map(announced);
    for (const provider of [host.okxwallet?.ethereum, host.okxwallet, ...(host.ethereum?.providers ?? []), host.ethereum]) {
      if (typeof provider?.request !== 'function' || providers.has(provider)) continue;
      const name = provider.isOkxWallet || provider === host.okxwallet?.ethereum || provider === host.okxwallet
        ? 'OKX Wallet' : provider.isMetaMask ? 'MetaMask' : 'Browser wallet';
      providers.set(provider, {name, provider});
    }
    return [...providers.values()];
  }

  async function connect({provider, name}) {
    const requestId = ++generation;
    const accounts = await provider.request({method:'eth_requestAccounts'});
    const chain = Number(await provider.request({method:'eth_chainId'}));
    if (requestId !== generation) return;
    if (!valid(accounts?.[0])) throw Error('Wallet did not authorize an account.');
    if (!Number.isSafeInteger(chain) || chain <= 0) throw Error('Wallet did not report a valid network.');
    connection?.remove();
    const current = { provider, name, chain, address: accounts[0] };
    const publish = () => {
      if (connection === current) onChange({...current, external:true, ready:current.chain === chainId});
    };
    const accountsChanged = changed => {
      if (connection !== current) return;
      if (!valid(changed?.[0])) return disconnect();
      current.address = changed[0];
      publish();
    };
    const chainChanged = changed => { current.chain = Number(changed); publish(); };
    const disconnected = () => { if (connection === current) disconnect(); };
    current.remove = () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
      provider.removeListener?.('disconnect', disconnected);
    };
    connection = current;
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    provider.on?.('disconnect', disconnected);
    publish();
  }

  async function switchNetwork(wallet) {
    const {provider} = wallet;
    try {
      await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:hexId}]});
    } catch (error) {
      if (Number(error.code ?? error.data?.originalError?.code) !== 4902) throw error;
      await provider.request({method:'wallet_addEthereumChain',params:[{
        chainId:hexId, chainName:'GenLayer Stable Studionet',
        nativeCurrency:{name:'GEN Token',symbol:'GEN',decimals:18},
        rpcUrls:[endpoint],blockExplorerUrls:['https://explorer-studio.genlayer.com'],
      }]});
      if (Number(await provider.request({method:'eth_chainId'})) !== chainId) {
        await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:hexId}]});
      }
    }
    const chain = Number(await provider.request({method:'eth_chainId'}));
    if (connection?.provider === provider) {
      connection.chain = chain;
      onChange({...connection,external:true,ready:chain === chainId});
    }
    if (chain !== chainId) throw Error('The wallet is still on a different network.');
  }

  return {discover, connect, disconnect, switchNetwork};
}

export function connectedSigner(wallet, isCurrent, onSubmitted = () => {}) {
  const {address, provider} = wallet;
  const guardedProvider = {
    async request(request) {
      if (request.method !== 'eth_sendTransaction') return provider.request(request);
      const [network, accounts] = await Promise.all([
        provider.request({method:'eth_chainId'}), provider.request({method:'eth_accounts'}),
      ]);
      if (!isCurrent()) throw Error('Wallet selection changed before signing.');
      if (Number(network) !== chainId) throw Error('Switch your wallet to Stable Studionet (61999).');
      if (accounts?.[0]?.toLowerCase() !== address.toLowerCase()) throw Error('The wallet account changed before signing.');
      const tx = request.params?.[0];
      if (tx?.from?.toLowerCase() !== address.toLowerCase() || Number(tx.chainId) !== chainId) {
        throw Error('The transaction does not match the selected wallet or network.');
      }
      const hash = await provider.request(request);
      if (!/^0x[0-9a-f]{64}$/i.test(hash ?? '')) throw Error('Wallet did not return a transaction hash.');
      onSubmitted(hash);
      return hash;
    },
  };
  return createClient({chain:studionet,endpoint,account:address,provider:guardedProvider});
}
