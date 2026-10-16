import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';

// Executes actual panel callback, with modeled state/read seams, not React/Auth/HTTP.
const source=readFileSync(new URL('../../src/components/tracker/voice/TrackerVoicePanel.tsx',import.meta.url),'utf8');
const tree=parseSync(source,{syntax:'typescript',tsx:true});let callback,effect;
const slice=node=>Buffer.from(source).subarray(node.span.start-tree.span.start,node.span.end-tree.span.start).toString();
function visit(node){
 if(!node||typeof node!=='object')return;
 if(node.type==='VariableDeclarator'&&node.id.value==='refreshRuntime')callback=node.init.arguments[0].expression;
 if(node.type==='CallExpression'&&node.callee.value==='useEffect'){
  const candidate=node.arguments[0]?.expression;
  if(candidate&&slice(candidate).includes('void refreshRuntime();'))effect=candidate;
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
