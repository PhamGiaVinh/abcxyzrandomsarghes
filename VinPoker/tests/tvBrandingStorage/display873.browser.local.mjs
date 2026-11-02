// Existing original Main TV data through native anon RPC. HTTP fault controls
// and a loopback token alias are modeled; no pairing/credential is created.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_TV873_LOCAL,'1');
const clone='vinpoker_ranking860_local',primary='vinpoker_ops_cash115_qualified_c';
const display='ca1f1e29-0d57-4e59-b7e5-309f7928f3da',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580';
const alias='LOCAL873-FINAL',base='http://127.0.0.1:54329',origin='http://127.0.0.1:5188';
const report='D:/Quy trình/output/reports/tv873-native-browser-state-local-20261026.json';
const sql=(db,q)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:15000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,`SELECT count(*) FROM public.tv_displays WHERE id='${display}' AND name='Local166 final TEST' AND assigned_tournament_id='${tour}' AND status='paired' AND layout='clock';`),'1');
assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['tv_displays','tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','tournament_close_report','cashier_buyin_movements','tournament_prize_payments','multi_day_final_participations_v1','multi_day_payout_finalizations_v1'];
const proof=db=>sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')},md5(pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure)))::text);ROLLBACK;`);
if(process.argv[2]==='--verify'){
 const retained=JSON.parse(readFileSync(report,'utf8'));
 assert.equal(proof(primary),retained.baseline.primary);assert.equal(proof(clone),retained.baseline.clone);
 retained.final={primaryUnchanged:true,cloneUnchanged:true};writeFileSync(report,JSON.stringify(retained,null,2)+'\n');
 console.log('TV873_NATIVE_READS_ROLLBACK_FULL_DISPLAY_AND_BUSINESS_UNCHANGED');process.exit(0);
}
const state={alias,display,tour,mode:'native',counts:{native:0,malformed:0,unavailable:0,pairBegin:0},trace:[],baseline:{primary:proof(primary),clone:proof(clone)}};
const save=()=>writeFileSync(report,JSON.stringify(state,null,2)+'\n');
const native=branding=>{
 const payload=JSON.parse(sql(clone,`BEGIN;SET LOCAL statement_timeout='10s';DO $$ BEGIN
  PERFORM set_config('test.tv873.token',(SELECT display_token FROM public.tv_displays WHERE id='${display}'),true);
 END $$;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
 SELECT public.get_tv_display_state_v4(current_setting('test.tv873.token'),${branding});ROLLBACK;`));
 assert.equal(payload.status,'paired');assert.equal(payload.display.id,display);assert.equal(payload.tournament.id,tour);
 // This retained fixture has no remote asset URLs. Fail rather than changing a
 // branding payload or letting a newly configured external asset enter the test.
 assert.ok(!/https?:/.test(JSON.stringify(payload)),'873 retained display acquired external assets; review scope');
 state.counts.native++;state.trace.push({kind:'native',tournament:tour,status:payload.tournament.status,pool:payload.tournament.prize_pool});save();return payload;
};
native(true); // Qualify the exact fixture before starting browser transport.
const html=()=>`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>TV873 local controls</title></head><body><h1>TV873 local read fault controls</h1><p>Only local HTTP behavior changes. No pairing or DB configuration writes.</p><p>Mode: ${state.mode}</p><p>Native reads: ${state.counts.native}; malformed: ${state.counts.malformed}; unavailable: ${state.counts.unavailable}; pair begin: ${state.counts.pairBegin}</p>${['native','malformed','unavailable'].map(mode=>`<form method="POST" action="/__local/873/${mode}"><button>${mode==='native'?'Restore native reads':mode==='malformed'?'Return malformed read':'Return unavailable read'}</button></form>`).join('')}<a href="${origin}/display/${alias}">Open TEST display</a></body></html>`;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,base);
 state.trace.push({kind:'http',method:req.method,path:url.pathname,preflightHeaders:req.headers['access-control-request-headers']??null});save();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,x-retry-count');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&![origin,base].includes(req.headers.origin)))return send(403,{message:'LOCAL873_SCOPE'});
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.method==='GET'&&url.pathname==='/__local/873'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html());return;}
 if(req.method==='POST'&&url.pathname.startsWith('/__local/873/')){
  const mode=url.pathname.slice('/__local/873/'.length);if(!['native','malformed','unavailable'].includes(mode))return send(403,{message:'LOCAL873_MODE'});
  state.mode=mode;state.trace.push({kind:'mode',mode});save();res.writeHead(303,{Location:'/__local/873'});res.end();return;
 }
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/tv_pair_begin'){state.counts.pairBegin++;save();return send(403,{message:'LOCAL873_PAIRING_NOT_IN_SCOPE'});}
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_tv_display_state_v4'){
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   assert.equal(body.p_display_token,alias);assert.equal(typeof body.p_include_branding,'boolean');
   if(state.mode==='malformed'){state.counts.malformed++;state.trace.push({kind:'malformed'});save();return send(200,null);}
   if(state.mode==='unavailable'){state.counts.unavailable++;state.trace.push({kind:'unavailable'});save();return send(503,{message:'LOCAL873_READ_UNAVAILABLE'});}
   return send(200,native(body.p_include_branding));
  }catch{state.trace.push({kind:'read_failed'});save();return send(503,{message:'LOCAL873_NATIVE_READ_FAILED'});}
 }
 return send(401,{message:'LOCAL873_READ_ONLY'});
});
server.listen(54329,'127.0.0.1',()=>{save();console.log('TV873_EXISTING_DISPLAY_READ_ADAPTER_READY');});
