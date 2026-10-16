import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';

// Executes actual panel callback, with modeled state/read seams, not React/Auth/HTTP.
const source=readFileSync(new URL('../../src/components/tracker/voice/TrackerVoicePanel.tsx',import.meta.url),'utf8');
const tree=parseSync(source,{syntax:'typescript',tsx:true});let callback,effect,connectCallback,disconnectCallback,deviceEffect;
const slice=node=>Buffer.from(source).subarray(node.span.start-tree.span.start,node.span.end-tree.span.start).toString();
function visit(node){
 if(!node||typeof node!=='object')return;
 if(node.type==='VariableDeclarator'&&node.id.value==='refreshRuntime')callback=node.init.arguments[0].expression;
 if(node.type==='VariableDeclarator'&&node.id.value==='connect')connectCallback=node.init;
 if(node.type==='VariableDeclarator'&&node.id.value==='disconnect')disconnectCallback=node.init;
 if(node.type==='CallExpression'&&node.callee.value==='useEffect'){
  const candidate=node.arguments[0]?.expression;
  if(candidate&&slice(candidate).includes('void refreshRuntime();'))effect=candidate;
  if(candidate&&slice(candidate).includes('const handleOffline'))deviceEffect=candidate;
 }
 for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}
}
visit(tree);assert.ok(callback);assert.ok(effect);
const expression=Buffer.from(source).subarray(callback.span.start-tree.span.start,callback.span.end-tree.span.start).toString();
const code=transformSync('const refresh='+expression+';refresh;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
 const first=deferred(),second=deferred(),queue=[first,second],writes=[];
 const runtimeReadGenerationRef={current:0},runtimeScopeRef={current:'scope'};
 const read=runInNewContext(code,{Error,hook:{tournamentId:'tour',tournamentTableId:'table'},runtimeOverride:null,
  loadRuntimeOverride:()=>queue.shift().promise,runtimeReadGenerationRef,
  runtimeScopeKey:'scope',runtimeScopeRef,
  setRuntime:value=>writes.push(['runtime',value]),setRuntimeError:value=>writes.push(['error',value])});
 return {first,second,read,writes,runtimeReadGenerationRef,runtimeScopeRef,queue};
}
test('old runtime success cannot overwrite a newer verified read',async()=>{
 const f=fixture(),old=f.read(),next=f.read();f.second.resolve({version:2});await next;
 const writes=f.writes.length;f.first.resolve({version:1});assert.equal(await old,null);
 assert.equal(f.writes.length,writes);assert.equal(f.writes[0][1].version,2);
});
test('old runtime rejection cannot erase a newer verified read',async()=>{
 const f=fixture(),old=f.read(),next=f.read();f.second.resolve({version:2});await next;
 const writes=f.writes.length;f.first.reject(new Error('old read failed'));await old;
 assert.equal(f.writes.length,writes);
});
test('invalidated read cannot publish into a replaced panel scope',async()=>{
 const f=fixture(),old=f.read();++f.runtimeReadGenerationRef.current;
 f.first.resolve({version:1});assert.equal(await old,null);assert.deepEqual(f.writes,[]);
});
test('captured callback cannot start an old-scope read after scope replacement',async()=>{
 const f=fixture();f.runtimeScopeRef.current='other-table';assert.equal(await f.read(),null);
 assert.equal(f.queue.length,2);assert.deepEqual(f.writes,[]);
});
test('current successful read and current rejected read still update runtime/error',async()=>{
 const f=fixture(),first=f.read();const runtime={version:1};f.first.resolve(runtime);
 assert.equal(await first,runtime);assert.equal(f.writes[0][1],runtime);
 const next=f.read();f.second.reject(new Error('current network failure'));assert.equal(await next,null);
 assert.equal(f.writes.at(-2)[0],'runtime');assert.equal(f.writes.at(-2)[1],null);
 assert.equal(f.writes.at(-1)[1],'current network failure');
});
test('actual runtime effect cleanup invalidates its unfinished request',async()=>{
 const f=fixture();let pending;
 const effectCode=transformSync('const effect='+slice(effect)+';effect;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
 const run=runInNewContext(effectCode,{runtimeReadGenerationRef:f.runtimeReadGenerationRef,refreshRuntime:()=>{pending=f.read();return pending;}});
 const cleanup=run();assert.equal(typeof cleanup,'function');cleanup();f.first.resolve({version:1});
 assert.equal(await pending,null);assert.deepEqual(f.writes,[]);
});

function connectionFixture(){
 assert.ok(connectCallback);assert.ok(disconnectCallback);
 const pending=deferred(),writes=[],runtime={can_mint_session:true,config:{provider_model:'test'},correction_pending:false};
 let callbacks,waiting=false,connections=0,disconnects=0;
 const refreshRuntime=()=>waiting?pending.promise:Promise.resolve(runtime);
 const provider={kind:'openai_realtime',connect:async handlers=>{connections++;callbacks=handlers;},disconnect:async()=>{disconnects++;}};
 const sandbox={Error,performance:{now:()=>1},runtime,runtimeError:null,refreshRuntime,refreshRuntimeRef:{current:refreshRuntime},
  providerOverride:provider,providerRef:{current:provider},hook:{tournamentId:'tour',tournamentTableId:'table',handId:'hand'},
  connectionGenerationRef:{current:0},connectionScopeKey:'scope',connectionScopeRef:{current:'scope'},runtimeScopeRef:{current:'hand-scope'},
  runtimeReadGenerationRef:{current:0},
  pendingAmountPrefixRef:{current:null},micTestActiveRef:{current:false},micTestFinalCountRef:{current:0},micTestMaxLevelRef:{current:0},
  runtimeRef:{current:runtime},finalReceivedAtRef:{current:new Map()},handsFreeActionCommitRef:{current:null},
  statusRef:{current:'listening'},cancelPendingActionRef:{current:null},
  isTrackerVoiceGeminiLiveModel:()=>false,isIncompleteAmountCommand:()=>false,combineSplitAmountFinal:()=>null,
 };
 for(const name of new Set((slice(connectCallback)+slice(disconnectCallback)+slice(deviceEffect)).match(/\bset[A-Z]\w+/g)))sandbox[name]=value=>writes.push([name,value]);
 const compiled=transformSync('const connect='+slice(connectCallback).replaceAll('import.meta.env.VITE_TRACKER_VOICE_PROVIDER','undefined')+';const disconnect='+slice(disconnectCallback)+';({connect,disconnect});',{
  jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
 const functions=runInNewContext(compiled,sandbox);
 const events={};sandbox.window={addEventListener:(name,cb)=>{events[name]=cb;},removeEventListener:(name)=>{delete events[name];}};
 sandbox.navigator={mediaDevices:sandbox.window};
 const effectCode=transformSync('const effect='+slice(deviceEffect)+';effect;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
 const mountDevices=()=>runInNewContext(effectCode,sandbox)();
 return {...functions,pending,writes,sandbox,events,mountDevices,disconnects:()=>disconnects,connections:()=>connections,wait:()=>{waiting=true;},emit:()=>callbacks.onTranscript({isFinal:true,providerEventId:'event',transcript:'call',capturedAt:'test'})};
}
test('disconnect prevents pending transcript runtime refresh from creating a late attempt',async()=>{
 const f=connectionFixture();await f.connect();f.wait();f.emit();await f.disconnect();
 const writes=f.writes.length;f.pending.resolve(f.sandbox.runtime);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.writes.length,writes);assert.equal(f.writes.some(([name])=>name==='setFinalAttempt'),false);
});
test('callbacks from the disconnected provider cannot publish a new transcript',async()=>{
 const f=connectionFixture();await f.connect();await f.disconnect();const writes=f.writes.length;
 f.emit();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.writes.length,writes);
});
test('disconnect during initial runtime lookup never starts microphone provider',async()=>{
 const f=connectionFixture();f.wait();const pending=f.connect();await f.disconnect();const writes=f.writes.length;
 f.pending.resolve(f.sandbox.runtime);await pending;assert.equal(f.connections(),0);assert.equal(f.writes.length,writes);
});
test('hand transition while transcript runtime is pending discards the old event',async()=>{
 const f=connectionFixture();await f.connect();f.wait();f.emit();const writes=f.writes.length;
 f.sandbox.runtimeScopeRef.current='next-hand';f.pending.resolve(f.sandbox.runtime);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.writes.length,writes);
 assert.equal(f.writes.some(([name])=>name==='setFinalAttempt'),false);
});
test('ongoing microphone uses latest runtime reader for the next hand without reconnecting',async()=>{
 const f=connectionFixture();await f.connect();f.sandbox.runtimeScopeRef.current='next-hand';
 const fresh={...f.sandbox.runtime,active_hand:{hand_id:'next-hand'}};
 let reads=0;f.sandbox.refreshRuntimeRef.current=async()=>{reads++;return fresh;};
 f.emit();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads,1);assert.equal(f.connections(),1);
 const attempt=f.writes.find(([name])=>name==='setFinalAttempt');assert.ok(attempt);assert.equal(attempt[1].runtimeSnapshot,fresh);
 await f.disconnect();
});
for(const event of ['offline','devicechange'])test(`${event} stops capture and invalidates pending transcript`,async()=>{
 const f=connectionFixture();let cancelled=0;f.sandbox.cancelPendingActionRef.current=()=>cancelled++;
 await f.connect();const cleanup=f.mountDevices();f.wait();f.emit();
 f.events[event]();assert.equal(f.disconnects(),1);const writes=f.writes.length;
 assert.equal(cancelled,1);assert.equal(f.connections(),1);
 f.pending.resolve(f.sandbox.runtime);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.writes.length,writes);
 f.emit();assert.equal(f.writes.length,writes);cleanup();assert.deepEqual(Object.keys(f.events),[]);
});
for(const event of ['offline','devicechange'])test(`${event} while idle does not start or stop a provider`,()=>{
 const f=connectionFixture();f.sandbox.statusRef.current='idle';const cleanup=f.mountDevices();
 f.events[event]();assert.equal(f.disconnects(),0);assert.equal(f.connections(),0);assert.deepEqual(f.writes,[]);cleanup();
});
test('offline during the initial context lookup cancels connection before microphone starts',async()=>{
 const f=connectionFixture();f.sandbox.statusRef.current='idle';f.wait();const cleanup=f.mountDevices();
 const pending=f.connect();f.events.offline();f.pending.resolve(f.sandbox.runtime);await pending;
 assert.equal(f.connections(),0);assert.equal(f.sandbox.statusRef.current,'offline');cleanup();
});
