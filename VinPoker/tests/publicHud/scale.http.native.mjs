import http from 'node:http';
import assert from 'node:assert/strict';
import {afterEach,beforeEach,it} from 'node:test';
import {createLocalHttpTransport} from './scale.http.mjs';
import {classifyEdgeFailure} from './scale.failures.mjs';
let server,origin,transport;
beforeEach(async()=>{
 transport=createLocalHttpTransport();
 server=http.createServer((req,res)=>{
  if(req.url==='/slow'){req.resume();setTimeout(()=>{if(!res.destroyed)res.end('{}');},100);return;}
  if(req.url==='/truncated'){req.resume();res.writeHead(200,{'Content-Length':'100'});res.write('{}');setImmediate(()=>res.destroy());return;}
  if(req.url==='/slow-body'){req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.write('{');setTimeout(()=>{if(!res.destroyed)res.end('}');},100);return;}
  const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
   res.writeHead(req.url==='/denied'?403:200,{'Content-Type':'application/json','x-fixture':'real-http'});
   res.end(JSON.stringify({body:JSON.parse(Buffer.concat(chunks).toString()),key:req.headers.apikey,encoding:req.headers['accept-encoding']}));
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin=`http://127.0.0.1:${server.address().port}`;
});
afterEach(async()=>{transport.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
const options=(key,signal)=>({headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({fixture:key}),signal});
it('classifies runtime failures without returning private response text',()=>{
 for(const [body,label] of [
  ['{"trace":"WorkerAlreadyRetired: private-path secret-value"}','worker_retired'],
  ['{"code":"WORKER_RESOURCE_LIMIT","message":"secret-value"}','worker_resource_limit'],
  ['{"code":"BOOT_ERROR","message":"secret-value"}','worker_boot'],
  ['{"error":"WorkerRequestCancelled secret-value"}','worker_cancelled'],
  ['{"error":"WorkerRequestIdleTimeout secret-value"}','worker_idle_timeout'],
  ['{"private":"secret-value bearer eyJ.private.signature"}','unknown']]){
  const result=classifyEdgeFailure(body);assert.equal(result,label);assert.ok(!result.includes('secret-value'));
 }
 assert.equal(classifyEdgeFailure(null),'unknown');
 assert.equal(classifyEdgeFailure('x'.repeat(8192)+'WorkerAlreadyRetired'),'unknown');
});
it('sends distinct requests with per-call headers, full JSON and real status',async()=>{
 const [a,b]=await Promise.all([transport.request(origin+'/echo',options('anon')),transport.request(origin+'/denied',options('service-fixture'))]);
 assert.equal(a.status,200);assert.equal(a.headers['x-fixture'],'real-http');assert.deepEqual(JSON.parse(a.text),{body:{fixture:'anon'},key:'anon',encoding:'identity'});
 assert.equal(b.status,403);assert.equal(b.ok,false);assert.equal(JSON.parse(b.text).key,'service-fixture');assert.equal(transport.metrics().queuedRequests,0);
});
it('isolates caller cancellation and enforces a deadline while receiving the body',async()=>{
 const caller=new AbortController();
 const abandoned=transport.request(origin+'/slow',options('anon',caller.signal));
 const other=transport.request(origin+'/echo',options('other'));
 caller.abort();await assert.rejects(abandoned,{name:'AbortError'});assert.equal((await other).ok,true);
 const timeout=AbortSignal.timeout(10);
 await assert.rejects(transport.request(origin+'/slow-body',options('anon',timeout)),{name:'TimeoutError'});assert.equal(timeout.aborted,true);
 const bodyCaller=new AbortController(),bodyRead=transport.request(origin+'/slow-body',options('anon',bodyCaller.signal));
 setTimeout(()=>bodyCaller.abort(),10);await assert.rejects(bodyRead,error=>error===bodyCaller.signal.reason);
});
it('fails incomplete responses and rejects non-loopback destinations',async()=>{
 await assert.rejects(transport.request(origin+'/truncated',options('anon')));
 assert.throws(()=>transport.request('https://example.com',options('anon')),/Isolated loopback HTTP required/);
});
