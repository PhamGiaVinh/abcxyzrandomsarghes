// Owned localhost clone only. Actual component/SDK/RPC/PG paid marker; no bank transfer.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
assert.equal(process.env.VINPOKER_EARLYITM1174_LOCAL,'1');
const path='D:/Quy trình/output/reports/earlyitm1174-payment-browser-state-local-20261028.json';
const verifyOnly=process.argv.includes('--verify-recorded');
assert.equal(existsSync(path),verifyOnly);
const fixture=JSON.parse(readFileSync('D:/Quy trình/output/reports/earlyitm1174-browser-fixture-1-local-20261028.json','utf8')).observations[0].fixture;
const {event,final:tour,actor,club,participation}=fixture;
const db='vinpoker_earlyitm1172_local';
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE='+db,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const guard=String.raw`DO $$ BEGIN ASSERT current_database()='vinpoker_earlyitm1172_local';ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_EARLYITM1172_OWNED_LOCAL_SOURCE_ranking860_HEAD_ef6a26948';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));END $$;`;
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql('BEGIN READ ONLY;'+guard+"SET LOCAL statement_timeout='10s';"+q+';ROLLBACK;'));
const native=q=>read(auth+q);
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const uuid=v=>assert.match(v??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
for(const id of [event,tour,actor,club,participation])uuid(id);
const tables=['tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','hand_players','hand_actions','tournament_prizes','tournament_close_report','cashier_buyin_movements','chip_bag','tournament_chip_counts','chip_inventory_ledger','chip_bank_ledger','dealer_attendance','dealer_assignments','notifications','multi_day_final_participations_v1','multi_day_payout_finalizations_v1','multi_day_package_release_v1','user_roles','club_cashiers','clubs'];
const proof=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')},(SELECT jsonb_agg(to_jsonb(x) ORDER BY participation_id) FROM private.multi_day_individual_obligations_v1 x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY participation_id) FROM private.multi_day_individual_results_v1 x))::text))`);
const rowProof=(table,where)=>read(`SELECT to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),''))) FROM ${table} x WHERE ${where}`);
const recipients=()=>native(`SELECT public.get_tournament_payout_recipients('${tour}')`);
const stored=verifyOnly?JSON.parse(readFileSync(path,'utf8')):null;
const source=stored?.source??recipients();assert.equal(source.isPartial,true);assert.equal(source.totalCount,1);assert.equal(source.paidTotal,0);assert.equal(source.owedTotal,100000);
const target=source.places[0];assert.equal(target.multiDayParticipationId,participation);assert.equal(target.finishedPlace,8);assert.equal(target.prizeAmount,100000);
const state=stored??{kind:'ACTUAL_PAYMENT_COMPONENT_NATIVE_CLONE_COMMIT_MODELED_AUTH_NOT_FULL_JOURNEY',fixture,source,before:proof(),otherPayments:rowProof('public.tournament_prize_payments',`tournament_id<>'${tour}'`),otherProofs:rowProof('private.multi_day_individual_payment_commits_v1',`event_id<>'${event}'`),otherReceipts:rowProof('floor_private.payout_payment_receipts_v1','true'),trace:[],errors:[],denied:[],recorded:false};
const save=()=>writeFileSync(path,JSON.stringify(state,null,2));
function verify(){
 assert.equal(proof(),state.before);assert.equal(rowProof('public.tournament_prize_payments',`tournament_id<>'${tour}'`),state.otherPayments);
 assert.equal(rowProof('private.multi_day_individual_payment_commits_v1',`event_id<>'${event}'`),state.otherProofs);
 assert.equal(rowProof('floor_private.payout_payment_receipts_v1',state.request?`NOT(actor_id='${actor}' AND request_id='${state.request}')`:'true'),state.otherReceipts);
 const value=recipients();assert.equal(value.isPartial,true);assert.equal(value.totalCount,1);assert.equal(value.owedTotal,100000);assert.equal(value.paidTotal,state.recorded?100000:0);
 const counts=read(`SELECT jsonb_build_object('payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${tour}'),'proofs',(SELECT count(*) FROM private.multi_day_individual_payment_commits_v1 WHERE event_id='${event}'),'globalFinalizations',(SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}'),'survivors',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}' AND status<>'busted'),'officialRanks',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL))`);
 assert.equal(counts.payments,state.recorded?1:0);assert.equal(counts.proofs,state.recorded?1:0);assert.equal(counts.globalFinalizations,0);assert.equal(counts.survivors,7);assert.equal(counts.officialRanks,0);
 if(state.recorded){const receipt=native(`SELECT public.get_tournament_prize_payment_receipt_v2('${state.request}')`);assert.equal(receipt.found,true);assert.deepEqual(receipt.result,state.result);assert.equal(receipt.payload.tournament_id,tour);assert.equal(receipt.payload.participation_id,participation);}
 return {counts,recipients:value};
}
if(verifyOnly){state.final=verify();state.finalProtectedUnchanged=true;state.verificationAfterServerStopped=true;save();console.log('EARLYITM1174_RECORDED_PAYMENT_RECEIPT_AND_PROTECTED_FACTS_READONLY_VERIFIED');process.exit(0);}
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'earlyitm1174@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-28T00:00:00Z'};
let armed=false,faultKey=null;
const server=createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer,x-retry-count');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.headers.host!=='127.0.0.1:54329'||req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188')return send(403,{message:'LOCAL1174_SCOPE'});
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{tour,actor,club,email:user.email,runId:'1174',model:'native PG paid marker COMMIT; modeled Auth/HTTP; no bank transfer'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600;
   const payload=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');
   const token=payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');sessions.add(token);
   return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL1174_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  if(u.pathname==='/__local/drop-next'&&req.method==='POST'){armed=true;state.trace.push({kind:'response_loss_armed'});save();return send(200,{ok:true});}
  if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   const name=u.pathname.slice('/rest/v1/'.length);const columns={user_roles:'role',dealers:'id',clubs:'id',club_chip_masters:'club_id',club_marketers:'club_id',club_fnb_staff:'club_id',club_accountants:'club_id'}[name];
   if(columns){const where=name==='clubs'?`owner_id='${actor}'`:`user_id='${actor}'${name==='dealers'?' AND deleted_at IS NULL':''}`;const value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.${name} WHERE ${where}${name==='user_roles'?'':' LIMIT 1'})x`);state.trace.push({read:name,rows:value.length});save();return send(200,value);}
  }
  if(req.method==='POST'&&u.pathname==='/rest/v1/rpc/get_tournament_payout_recipients'){
   assert.equal(body.p_tournament_id,tour);const value=recipients();state.trace.push({rpc:'recipients',paid:value.paidTotal,isPartial:value.isPartial});save();return send(200,value);
  }
  if(req.method==='POST'&&u.pathname==='/rest/v1/rpc/get_tournament_prize_payment_receipt_v2'){
   uuid(body.p_request_id);assert.equal(body.p_request_id,state.request);const value=native(`SELECT public.get_tournament_prize_payment_receipt_v2('${body.p_request_id}')`);verify();state.trace.push({rpc:'receipt',request:body.p_request_id,found:value.found});save();return send(200,value);
  }
  if(req.method==='POST'&&u.pathname==='/rest/v1/rpc/record_multi_day_prize_payment_v1'){
   assert.equal(body.p_event_id,event);assert.equal(body.p_participation_id,participation);assert.equal(body.p_method,'cash');assert.equal(body.p_expected_token,target.confirmationToken);uuid(body.p_request_id);
   if(state.request)assert.equal(body.p_request_id,state.request);else state.request=body.p_request_id;
   save();const result=JSON.parse(sql('BEGIN;'+guard+"SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';"+auth+`SELECT public.record_multi_day_prize_payment_v1('${event}','${participation}','cash',${literal(body.p_expected_token)},'${body.p_request_id}');COMMIT;`));
   assert.equal(result.ok,true);assert.equal(result.outcome,'recorded');assert.equal(result.prize_amount,100000);assert.equal(result.entry_id,target.entryId);assert.equal(result.recipient_ref,target.recipientRef);
   if(state.recorded)assert.deepEqual(result,state.result);state.recorded=true;state.result=result;verify();
   if(armed&&!faultKey){faultKey=state.request;armed=false;}const loss=faultKey===state.request;state.trace.push({rpc:'record',request:state.request,payment:result.payment_id,responseLoss:loss});save();
   return loss?send(503,{message:'LOCAL1174_COMMITTED_RESPONSE_LOSS'}):send(200,result);
  }
  state.denied.push({method:req.method,path:u.pathname});save();return send(403,{message:'LOCAL1174_NOT_IN_SCOPE'});
 }catch(error){state.errors.push({message:error.message});save();return send(500,{message:'LOCAL1174_UNCONFIRMED_RESULT'});}
});
save();server.listen(54329,'127.0.0.1',()=>console.log('EARLYITM1174_BROWSER_ADAPTER_READY',JSON.stringify({tour,event,amount:100000})));
process.stdin.once('data',()=>{process.stdin.pause();server.close(()=>{state.final=verify();state.finalProtectedUnchanged=true;save();console.log('EARLYITM1174_FINAL_NATIVE_VERIFIED',JSON.stringify({recorded:state.recorded,errors:state.errors.length,denied:state.denied.length}));process.exit(0);});server.closeAllConnections();});
