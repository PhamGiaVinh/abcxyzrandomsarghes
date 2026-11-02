import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {existsSync,writeFileSync} from 'node:fs';
const report='D:/Quy trình/output/reports/iq1130-native-browser-local-20261027.json';
assert.equal(process.cwd().replaceAll('\\','/'),'D:/wt/vinpoker-ops-local-integration/VinPoker');
assert.equal(process.env.VINPOKER_IQ1130_LOCAL,'1');assert.equal(existsSync(report),false);
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`,encoding:'utf8',timeout:20000}).trim();
const guard=JSON.parse(sql("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()));"));
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const fingerprint=()=>sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text)::text,'[]')) FROM public.app_settings s WHERE key='poker_iq_questions';");
let fault=true;const state={kind:'ACTUAL_IQ_EDITOR_SDK_NATIVE_READONLY_ERROR_MANUAL_RETRY_NOT_AUTH_OR_SAVE_ACCEPTANCE',guard,before:fingerprint(),reads:[],denied:[],errors:[],success:false};
const save=()=>writeFileSync(report,JSON.stringify(state,null,2)+'\n');save();
const server=createServer((req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'http://127.0.0.1:5189','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,OPTIONS'});res.end(JSON.stringify(value));};
 try{
  const url=new URL(req.url??'/','http://127.0.0.1:54329');if(req.method==='OPTIONS')return send(200,{});
  if(req.method!=='GET'||url.pathname!=='/rest/v1/app_settings'){state.denied.push({method:req.method,path:url.pathname});save();return send(403,{message:'LOCAL_READ_ONLY'});}
  assert.equal(url.searchParams.get('select'),'value');assert.equal(url.searchParams.get('key'),'eq.poker_iq_questions');
  const value=JSON.parse(sql("SELECT (SELECT jsonb_build_object('value',value) FROM public.app_settings WHERE key='poker_iq_questions');")||'null');
  state.reads.push({at:new Date().toISOString(),nativeRowPresent:value!==null,fault});save();return fault?send(503,{message:'LOCAL_TEST_READ_UNAVAILABLE'}):send(200,value);
 }catch(error){state.errors.push({message:error.message});save();send(500,{message:'LOCAL_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('IQ1130_READONLY_READY');
 await new Promise(resolve=>process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='restore'){fault=false;console.log('IQ1130_READ_RESTORED');}else if(command==='stop'){process.stdin.pause();resolve();}else throw Error('unknown command');}));
 assert.ok(state.reads.some(r=>r.fault));assert.ok(state.reads.some(r=>!r.fault));assert.equal(state.denied.length,0);assert.equal(state.errors.length,0);state.success=true;
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.after=fingerprint();state.unchanged=state.before===state.after;state.stopped=new Date().toISOString();save();assert.ok(state.unchanged);
}
console.log(JSON.stringify({success:state.success,unchanged:state.unchanged,reads:state.reads.length,denied:state.denied.length}));
