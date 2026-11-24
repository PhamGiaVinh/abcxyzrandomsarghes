import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseline, deployConsumers, validateConsumerReceipt, verifyDeployedConsumers } from './tracker-bb-ante-consumers.mjs';
import { releaseSha } from './tracker-bb-ante-release.mjs';

function harness() {
  const functions=structuredClone(baseline);const writes=[];const receipts=[];
  const deployment={id:'dpl_Test123',projectId:'prj_wLBZF7nG5O2bffM9Qu1v2rgMuMwk',readyState:'READY',target:'production',gitSource:{sha:releaseSha}};
  return {functions,writes,receipts,deployment,transport:{
    listEdges:async()=>structuredClone(functions),
    deployEdge:async slug=>{writes.push(slug);functions.find(f=>f.slug===slug).version++;},
    createFrontend:async()=>{writes.push('frontend');return {id:deployment.id};},
    getFrontend:async()=>structuredClone(deployment),
    verifyShells:async()=>{},recordComponent:async()=>{},frontendPreflight:async()=>{},
    wait:async()=>{},now:()=>0,
  },save:receipt=>receipts.push(structuredClone(receipt))};
}
test('deploys exactly six pinned consumers before the correct frontend and records verified versions',async()=>{
  const h=harness();const result=await deployConsumers(h.transport,h.save);
  assert.deepEqual(h.writes,[...baseline.map(f=>f.slug),'frontend']);
  assert.equal(result.sourceSha,releaseSha);validateConsumerReceipt(result);
  assert.ok(h.receipts.length>=7);
});
test('JWT drift or an unreviewed deployed version stops before any writer',async()=>{
  for(const field of ['verify_jwt','version']){const h=harness();h.functions[0][field]=field==='version'?999:false;
    await assert.rejects(deployConsumers(h.transport,h.save),/baseline/);assert.deepEqual(h.writes,[]);}
});
test('a lost Edge response is never retried and cannot deploy the frontend',async()=>{
  const h=harness();h.transport.deployEdge=async slug=>{h.writes.push(slug);throw Error('lost');};
  await assert.rejects(deployConsumers(h.transport,h.save),/lost/);assert.equal(h.writes.length,1);
});
test('post-deploy JWT drift and wrong frontend revision never create an activation receipt',async()=>{
  const h=harness();h.deployment.gitSource.sha='f'.repeat(40);
  await assert.rejects(deployConsumers(h.transport,h.save),/frontend/);
  assert.ok(h.receipts.every(r=>!r.edgeVerified));
  const j=harness();j.transport.deployEdge=async slug=>{const row=j.functions.find(f=>f.slug===slug);row.version++;row.verify_jwt=!row.verify_jwt;};
  await assert.rejects(deployConsumers(j.transport,j.save),/metadata/);
  assert.equal(j.writes.includes('frontend'),false);
});
test('activation rejects a boolean-only receipt or an incomplete version inventory',()=>{
  assert.throws(()=>validateConsumerReceipt({sourceSha:releaseSha,edgeVerified:true}),/receipt/);
  assert.throws(()=>validateConsumerReceipt({sourceSha:releaseSha,edgeVerified:true,edgeVersions:[]}),/receipt/);
});
test('frontend shell failure cannot produce a final receipt',async()=>{
  const h=harness();h.transport.verifyShells=async()=>{throw Error('shells failed');};
  await assert.rejects(deployConsumers(h.transport,h.save),/shells/);
  assert.ok(h.receipts.every(r=>!r.edgeVerified));
});
test('wrong frontend access or settings stops before any consumer write',async()=>{
  const h=harness();h.transport.frontendPreflight=async()=>{throw Error('frontend project denied');};
  await assert.rejects(deployConsumers(h.transport,h.save),/frontend project/);assert.deepEqual(h.writes,[]);
});

test('resumes only from a complete receipt and current exact versions without any deployment write',async()=>{
  const h=harness();const receipt=await deployConsumers(h.transport,h.save);h.writes.length=0;
  await verifyDeployedConsumers(h.transport,receipt);assert.deepEqual(h.writes,[]);
  h.functions[0].version++;
  await assert.rejects(verifyDeployedConsumers(h.transport,receipt),/Resumed Edge/);
  assert.deepEqual(h.writes,[]);
});

test('resume rejects alias drift, revision drift and incomplete evidence without writes',async()=>{
  for(const drift of ['alias','revision','receipt']){
    const h=harness();const receipt=await deployConsumers(h.transport,h.save);h.writes.length=0;
    if(drift==='alias')h.transport.getFrontend=async id=>({...h.deployment,id:id==='vinpoker.vercel.app'?'dpl_Other':h.deployment.id});
    if(drift==='revision')h.deployment.gitSource.sha='f'.repeat(40);
    if(drift==='receipt')receipt.edgeVerified=false;
    await assert.rejects(verifyDeployedConsumers(h.transport,receipt));assert.deepEqual(h.writes,[]);
  }
});
