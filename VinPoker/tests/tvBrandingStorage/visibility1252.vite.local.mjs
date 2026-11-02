import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {existsSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_TV1252_LOCAL,'1');
assert.equal(process.env.VITE_SUPABASE_URL,'http://127.0.0.1:54329');
const report='D:/Quy trình/output/reports/tv1252-visibility-vite-local-20261028.json';
assert.equal(existsSync(report),false);
const state={kind:'LOCAL_DEV_REAL_VISIBILITY_EVENT_DIAGNOSTIC_NOT_PERFORMANCE_PROOF',started:Date.now(),htmlProbeDocuments:0};
// Observe real browser events only. No dispatch, focus, visibility override or networking.
const probe=`(()=>{const rows=[];const record=event=>{rows.push({state:document.visibilityState,at:Date.now(),trusted:event?event.isTrusted:null});document.documentElement.setAttribute('data-tv-visibility-probe',JSON.stringify(rows.slice(-30)));};record(null);document.addEventListener('visibilitychange',record);})();`;
let server;
try{
 server=await createServer({root:process.cwd(),configFile:'vite.config.ts',mode:'development',server:{host:'127.0.0.1',port:53052,strictPort:true},plugins:[{name:'local-tv1252-real-visibility-observer',transformIndexHtml(html,context){if(context.originalUrl?.startsWith('/display/')){state.htmlProbeDocuments++;writeFileSync(report,JSON.stringify(state,null,2));return {html,tags:[{tag:'script',attrs:{type:'module'},children:probe,injectTo:'head'}]};}return html;}}]});
 await server.listen();console.log('TV1252_VISIBILITY_VITE_READY');
 await new Promise(resolve=>process.stdin.on('data',chunk=>{assert.equal(String(chunk).trim(),'stop');process.stdin.pause();resolve();}));
}finally{if(server)await server.close();state.stopped=Date.now();writeFileSync(report,JSON.stringify(state,null,2));}
