import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';

// Diagnostic-only normal Vite server. No proxy, response alteration, cache reset,
// production build, auth shortcut or request headers/body/query logging.
assert.equal(process.env.VINPOKER_LOCAL_VITE_TRACE,'1');
assert.equal(process.env.VITE_SUPABASE_URL,'http://127.0.0.1:54329');
assert.equal(process.env.VITE_SUPABASE_PUBLISHABLE_KEY,'LOCAL_TEST_ONLY');
assert.equal(path.resolve('.').toLowerCase(),'d:\\wt\\vinpoker-ops-local-integration\\vinpoker');
const tracked=new Set(['/src/main.tsx','/src/PlayerApp.tsx','/src/dev/PayoutNativePreview.tsx',
 '/src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx']);
let inflight=0,maxInflight=0,total=0,aborted=0,errors=0,source200=false;
const server=await createServer({configFile:path.resolve('vite.config.ts'),mode:'development',
 server:{host:'127.0.0.1',port:5188,strictPort:true},
 plugins:[{name:'local-module-transport-observation',configureServer(vite){
  vite.middlewares.use((req,res,next)=>{
   const pathname=new URL(req.url??'/','http://127.0.0.1').pathname;
   if(req.method!=='GET'||!/^\/(src|node_modules)\//.test(pathname)){next();return;}
   // Explicit diagnostic A/B only, never enabled in the ordinary dev/release config.
   if(source200&&pathname==='/src/dev/PayoutNativePreview.tsx'){
    delete req.headers['if-none-match'];delete req.headers['if-modified-since'];
   }
   const id=++total,start=Date.now();inflight++;maxInflight=Math.max(maxInflight,inflight);let finished=false;
   res.once('finish',()=>{
    finished=true;inflight--;if(res.statusCode>=400)errors++;
    if(tracked.has(pathname)||res.statusCode>=400)console.log('LOCAL_MODULE_FINISH',JSON.stringify({id,path:pathname,status:res.statusCode,ms:Date.now()-start,time:new Date().toISOString()}));
   });
   res.once('close',()=>{if(!finished){inflight--;aborted++;console.log('LOCAL_MODULE_ABORT',JSON.stringify({id,path:pathname,ms:Date.now()-start,time:new Date().toISOString()}));}});
   next();
  });
 }}],
});
try{
 await server.listen();
 console.log('LOCAL_VITE_TRACE_READY',JSON.stringify({port:5188,keepAliveTimeout:server.httpServer.keepAliveTimeout,
  requestTimeout:server.httpServer.requestTimeout,maxRequestsPerSocket:server.httpServer.maxRequestsPerSocket}));
 process.stdin.setEncoding('utf8');let pending='';
 await new Promise(resolve=>{process.stdin.on('data',chunk=>{pending+=chunk;let end;
  while((end=pending.search(/[\r\n]/))>=0){const line=pending.slice(0,end).trim();pending=pending.slice(end+1);
   if(line==='source200-on'||line==='source200-off'){
    source200=line==='source200-on';console.log('LOCAL_VITE_DIAGNOSTIC_SOURCE200',source200);
   }
   if(line==='status')console.log('LOCAL_VITE_TRACE_STATUS',JSON.stringify({total,inflight,maxInflight,aborted,errors,source200}));
   if(line==='stop')resolve();}
 });process.stdin.once('end',resolve);});
}finally{
 process.stdin.pause();
 await server.close();
 console.log('LOCAL_VITE_TRACE_STOPPED',JSON.stringify({total,inflight,maxInflight,aborted,errors}));
}
