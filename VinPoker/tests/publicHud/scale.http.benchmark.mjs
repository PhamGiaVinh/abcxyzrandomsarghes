// Transport-generator comparison only: no application/database/capacity claim.
import http from 'node:http';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {createLocalHttpTransport} from './scale.http.mjs';
const payload=JSON.stringify({fixture:'local-generator',padding:'x'.repeat(2000)});
const server=http.createServer((req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/fixture`,transport=createLocalHttpTransport();
const headers={'Content-Type':'application/json','Accept-Encoding':'identity'},body='{}';
const clients={
 fetch:async()=>{const r=await fetch(url,{method:'POST',headers,body,signal:AbortSignal.timeout(10000)});return JSON.parse(await r.text());},
 native:async()=>JSON.parse((await transport.request(url,{headers,body,signal:AbortSignal.timeout(10000)})).text),
};
const samples=[];
try{
 for(const client of Object.values(clients))await Promise.all(Array.from({length:100},()=>client()));
 for(const name of ['fetch','native','native','fetch']){
  const loop=monitorEventLoopDelay({resolution:10});loop.enable();const cpu=process.cpuUsage(),start=performance.now();
  for(let i=0;i<10;i++)await Promise.all(Array.from({length:100},()=>clients[name]()));
  await new Promise(resolve=>setTimeout(resolve,20));loop.disable();
  const used=process.cpuUsage(cpu);samples.push({name,requests:1000,elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,eventLoopP95Ms:loop.percentile(95)/1e6,eventLoopMaxMs:loop.max/1e6,memory:process.memoryUsage()});
 }
 const report={kind:'LOCAL_HTTP_GENERATOR_COMPARISON_NOT_APPLICATION_CAPACITY',acceptEncoding:'identity',concurrency:100,samples,transport:transport.metrics()};
 if(process.env.PUBLIC_HUD_HTTP_GENERATOR_REPORT)writeFileSync(process.env.PUBLIC_HUD_HTTP_GENERATOR_REPORT,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{transport.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
