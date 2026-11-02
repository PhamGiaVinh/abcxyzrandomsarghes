import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const malformed961=process.env.VINPOKER_MOVE961_LOCAL==='1',runId=malformed961?'961':'960';
assert.ok(malformed961||process.env.VINPOKER_MOVE960_LOCAL==='1');
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ranking860_local|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const f={tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6'};
const entry=sql(`BEGIN READ ONLY;SELECT entry_id FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active AND tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' ORDER BY seat_number LIMIT 1;ROLLBACK;`);assert.match(entry,/^[a-f0-9-]{36}$/);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','cashier_buyin_movements','tournament_prize_payments','table_sessions','table_operation_receipts'];
const facts=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);ROLLBACK;`);
const before=facts();
const state={fixture:f,entry,trace:[],heldAborted:false,writerDenied:0,before};let heldOnce=false;
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${JSON.stringify({sub:f.actor,role:'authenticated'})}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 const reply=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const url=new URL(req.url,'http://127.0.0.1:54329');
  if(req.method==='GET'&&url.pathname==='/__local/manifest')return reply(200,{...f,moveEntry:entry,runId:'move960',model:'READ_ONLY_NATIVE_ROSTER_MODELED_HTTP_METADATA_HOLD'});
  if(url.pathname.startsWith('/auth/'))return reply(401,{message:'LOCAL960_MODELED_AUTH_UNAVAILABLE'});
  if(req.method==='GET'&&url.pathname==='/rest/v1/tournaments'){
   assert.equal(url.searchParams.get('id'),`eq.${f.tour}`);assert.equal(url.searchParams.get('select'),'name,start_time');
   const value=native(`SELECT jsonb_build_object('name',name,'start_time',start_time) FROM public.tournaments WHERE id='${f.tour}';`);
   if(!heldOnce){heldOnce=true;if(malformed961){state.trace.push({read:'metadata',malformedNull:true});return reply(200,null);}state.trace.push({read:'metadata',held:true});res.on('close',()=>{if(!res.writableEnded){state.heldAborted=true;state.trace.push({read:'metadata',aborted:true});}});return;}
   state.trace.push({read:'metadata',recovered:true});return reply(200,value);
  }
  const name=url.pathname.split('/').at(-1);
  if(req.method==='POST'&&['get_floor_tournament_table_roster_v3','get_floor_tournament_table_roster_v6','get_floor_pending_tracker_moves_v1'].includes(name)){
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=JSON.parse(raw);assert.deepEqual(body,{p_tournament_id:f.tour});
   const value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.${name}('${f.tour}') x;`);state.trace.push({read:name,rows:value.length});return reply(200,value);
  }
  if(req.method!=='GET')state.writerDenied++;
  return reply(403,{message:'LOCAL960_READ_ONLY_ENDPOINT_NOT_ALLOWED'});
 }catch(error){state.trace.push({error:error.name,message:error.message});return reply(400,{message:'LOCAL960_INVALID_READ'});}
});
try{
 await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));console.log('MOVE960_READ_ONLY_NATIVE_READY',JSON.stringify({entry}));
 await new Promise(resolve=>process.stdin.once('data',resolve));process.stdin.pause();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 if(malformed961)assert.ok(state.trace.some(x=>x.malformedNull));else assert.equal(state.heldAborted,true);assert.ok(state.trace.some(x=>x.read==='metadata'&&x.recovered));assert.equal(state.writerDenied,0);assert.ok(!state.trace.some(x=>x.error));
}finally{
 if(server.listening){server.closeAllConnections();server.close();}
 state.after=facts();state.unchanged=state.after===before;writeFileSync(`D:/Quy trình/output/reports/move${runId}-native-read-timeout-local-20261027.json`,JSON.stringify(state,null,2)+'\n');
}
assert.equal(state.unchanged,true);console.log('MOVE960_ABORT_RECOVERY_NO_BUSINESS_WRITES_PASS');
