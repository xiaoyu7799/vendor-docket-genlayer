import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { connectedSigner, walletConnector } from '../wallet.mjs';

const alice='0x0000000000000000000000000000000000000001';
const bob='0x0000000000000000000000000000000000000002';
class Provider extends EventEmitter {
  network='0x1';
  accounts=[alice];
  requests=[];
  added=false;
  async request({method,params}) {
    this.requests.push(method);
    if(method==='eth_requestAccounts'||method==='eth_accounts') return this.accounts;
    if(method==='eth_chainId') return this.network;
    if(method==='wallet_addEthereumChain') {
      assert.equal(params[0].chainId,'0xf22f');
      assert.deepEqual(params[0].rpcUrls,['https://studio.genlayer.com/api']);
      this.added=true;
      return null;
    }
    if(method==='wallet_switchEthereumChain'){
      assert.equal(params[0].chainId,'0xf22f');
      if(!this.added) throw Object.assign(Error('Unknown network'),{code:4902});
      this.network=params[0].chainId;
      this.emit('chainChanged',this.network);
      return null;
    }
    if(method==='eth_sendTransaction'){
      this.transaction=params[0];
      throw Object.assign(Error('Declined test signature'),{code:4001});
    }
    throw Error('Unexpected method '+method);
  }
}

test('discovers both providers, adds 61999 and tracks account, chain and disconnect events',async()=>{
  const host=new EventTarget();
  const metamask=new Provider();
  const okx=new Provider();
  host.okxwallet={ethereum:okx};
  host.addEventListener('eip6963:requestProvider',()=>{
    host.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask'},provider:metamask}}));
  });
  let current;
  const connector=walletConnector(host,wallet=>{current=wallet;});
  const wallets=connector.discover();
  assert.deepEqual(wallets.map(wallet=>wallet.name),['MetaMask','OKX Wallet']);
  await connector.connect(wallets[0]);
  assert.equal(current.ready,false);
  await connector.switchNetwork(current);
  assert.equal(current.ready,true);
  metamask.accounts=[bob];
  metamask.emit('accountsChanged',[bob]);
  assert.equal(current.address,bob);
  await connector.connect(wallets[1]);
  assert.equal(current.name,'OKX Wallet');
  metamask.emit('accountsChanged',[alice]);
  assert.equal(current.name,'OKX Wallet');
  okx.emit('accountsChanged',[]);
  assert.equal(current,undefined);
  await connector.connect(wallets[0]);
  connector.disconnect();
  assert.equal(current,undefined);
});

test('SDK 2.0.0 routes a fee-bearing Studionet write to the chosen provider and blocks changed identity',async t=>{
  const provider=new Provider();
  const wallet={address:alice,provider};
  let selected=true;
  const signer=connectedSigner(wallet,()=>selected,()=>assert.fail('Rejected signatures cannot report a transaction hash'));
  const fakeRpc={
    sim_getFeeConfig:{enabled:true,policy:{genPerTimeUnit:'1',storageUnitPrice:'250000000',receiptGasPrice:'250000000',timeUnitOverlayBps:'1500'}},
    eth_getTransactionCount:'0x0',eth_estimateGas:'0x100000',eth_gasPrice:'0x1',
  };
  t.mock.method(console,'warn',()=>{});
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    assert.equal(url,'https://studio.genlayer.com/api');
    const {method,id}=JSON.parse(opts.body);
    assert.ok(Object.hasOwn(fakeRpc,method),'Unexpected RPC '+method);
    return Response.json({jsonrpc:'2.0',id,result:fakeRpc[method]});
  });
  const fees=await signer.estimateTransactionFees();
  const write=()=>signer.writeContract({address:bob,functionName:'test_write',args:[1n],value:0n,leaderOnly:false,fees});
  await assert.rejects(write,/Switch your wallet/);
  provider.network='0xf22f';
  provider.accounts=[bob];
  await assert.rejects(write,/account changed/);
  provider.accounts=[alice];
  selected=false;
  await assert.rejects(write,/selection changed/);
  assert.ok(!provider.transaction);
  selected=true;
  await assert.rejects(write,/Declined test signature|User rejected/);
  assert.equal(provider.transaction.from,alice);
  assert.equal(provider.transaction.chainId,'0xf22f');
  assert.ok(BigInt(provider.transaction.value)>0n);
  assert.match(provider.transaction.data,/^0x[0-9a-f]+$/i);
  assert.equal(provider.requests.filter(method=>method==='eth_sendTransaction').length,1);
});
