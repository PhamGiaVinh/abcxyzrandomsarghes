import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,writeFileSync} from 'node:fs';
const malformed1244=process.env.VINPOKER_TV1244_LOCAL==='1';
assert.ok(process.env.VINPOKER_TV1242_LOCAL==='1'||malformed1244);
const origin='http://127.0.0.1:'+(malformed1244?'53044':'53042');
const output=`D:/Quy trình/output/reports/tv${malformed1244?1244:1242}-operator-browser-native-local-20261028.json`;
assert.equal(existsSync(output),false);
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580',display='ca1f1e29-0d57-4e59-b7e5-309f7928f3da';
const guard=`DO $$ BEGIN ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)'::regprocedure)='bf18eb8bb0c7d5a668351e4f26649ce5';END $$;`;
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const tables=['tv_displays','tournaments','tournament_entries','tournament_seats','chip_bag','tournament_hands','cashier_buyin_movements','tournament_prize_payments'];
const expression='md5(jsonb_build_array('+tables.map(t=>'(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.'+t+' x)').join(',')+')::text)';
const fingerprint=()=>sql('BEGIN READ ONLY;'+guard+'SELECT '+expression+';ROLLBACK;');
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const literal=v=>v===null?'NULL':"'"+v.replaceAll("'","''")+"'";
const state={kind:'ACTUAL_OPERATOR_DEV_HOST_BROWSER_SDK_NATIVE_MODELED_AUTH_ALL_WRITES_ROLLBACK',before:fingerprint(),reads:[],writes:[],faults:[],denied:[],errors:[]};
let failedRead=true,nullReceipt=false;
const save=()=>writeFileSync(output,JSON.stringify(state,null,2));
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,x-retry-count');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  assert.equal(req.headers.host,'127.0.0.1:54329');
  if(req.headers.origin)assert.equal(req.headers.origin,origin);
  const u=new URL(req.url,'http://127.0.0.1:54329');
  if(req.method==='GET'&&u.pathname==='/__local/manifest')return send(200,{actor,club,tour,email:'LOCAL_TEST_ONLY@example.invalid',runId:'1242'});
  if(req.method==='GET'&&u.pathname==='/rest/v1/tv_displays'){
   assert.equal(u.searchParams.get('club_id'),'eq.'+club);assert.equal(u.searchParams.get('status'),'neq.unpaired');
   if(failedRead){state.faults.push({kind:malformed1244?'malformed200NullRow':'initialRead503'});return malformed1244?send(200,[null]):send(503,{message:'LOCAL1242_READ_UNAVAILABLE'});}
   const rows=JSON.parse(sql('BEGIN READ ONLY;'+guard+claims+`SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM public.tv_displays d WHERE id='${display}' AND club_id='${club}';ROLLBACK;`));
   assert.equal(rows.length,1);state.reads.push({count:rows.length,assigned:rows[0].assigned_tournament_id});return send(200,rows);
  }
  if(req.method==='POST'&&u.pathname==='/rest/v1/rpc/save_tv_display_config_v1'){
   assert.equal(malformed1244,false,'Read-only1244 mode');
   let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<4096);}
   const p=JSON.parse(raw);assert.deepEqual(Object.keys(p).sort(),['p_announcement','p_assigned_tournament_id','p_display_id','p_layout','p_name','p_zone']);
   assert.equal(p.p_display_id,display);assert.ok(p.p_assigned_tournament_id===null||p.p_assigned_tournament_id===tour);
   for(const key of ['p_layout','p_announcement','p_name','p_zone'])assert.ok(p[key]===null||typeof p[key]==='string'&&p[key].length<=500);
   const row=JSON.parse(sql('BEGIN;'+guard+claims+`SELECT public.save_tv_display_config_v1(${literal(display)},${literal(p.p_assigned_tournament_id)},${literal(p.p_layout)},${literal(p.p_announcement)},${literal(p.p_name)},${literal(p.p_zone)});ROLLBACK;`));
   state.writes.push({assigned:row.assigned_tournament_id,layout:row.layout,rolledBack:true,nullReceipt});
   if(nullReceipt){nullReceipt=false;state.faults.push({kind:'nullCanonicalReceiptAfterRollback'});return send(200,null);}
   return send(200,row);
  }
  state.denied.push({method:req.method,path:u.pathname});send(403,{message:'LOCAL1242_OUT_OF_SCOPE'});
 }catch{state.errors.push('LOCAL1242_REQUEST_FAILED');send(500,{message:'LOCAL1242_REQUEST_FAILED'});}
 finally{save();}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});
 console.log('TV1242_OPERATOR_ROLLBACK_READY');
 await new Promise(resolve=>process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='recover'){failedRead=false;console.log('TV1242_READ_RECOVERED');}else if(command==='null'){nullReceipt=true;console.log('TV1242_NEXT_RECEIPT_NULL');}else{assert.equal(command,'stop');process.stdin.pause();resolve();}}));
}finally{
 await new Promise(resolve=>server.close(resolve));state.after=fingerprint();state.unchanged=state.before===state.after;save();assert.equal(state.unchanged,true);assert.equal(state.errors.length,0);console.log('TV1242_STOPPED_UNCHANGED');
}
