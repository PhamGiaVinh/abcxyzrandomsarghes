// Disposable localhost clone. Real Floor/paid-marker RPCs, modeled Auth/HTTP, no external transfer.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const normalRead=process.env.VINPOKER_EARLYITM1182_LOCAL==='1';
const sameHand=normalRead||process.env.VINPOKER_EARLYITM1181_LOCAL==='1';
assert.equal(process.env[normalRead?'VINPOKER_EARLYITM1182_LOCAL':sameHand?'VINPOKER_EARLYITM1181_LOCAL':'VINPOKER_EARLYITM1176_LOCAL'],'1');
const runId=normalRead?'1182':sameHand?'1181':'1176';
const origin=normalRead?'http://127.0.0.1:5199':'http://127.0.0.1:5188';
const path=`D:/Quy trình/output/reports/earlyitm${runId}-floor-browser-state-local-20261028.json`;
const verifyOnly=process.argv.includes('--verify-recorded');assert.equal(existsSync(path),verifyOnly);
const fixtureRecord=JSON.parse(readFileSync(`D:/Quy trình/output/reports/${sameHand?'earlyitm1181-browser-fixture-1':'earlyitm1176-floor-fixture-1'}-local-20261028.json`,'utf8'));
const fixture=sameHand?fixtureRecord.observations.find(row=>row.fixture&&row.sameHandBusts).fixture:fixtureRecord.observations[0].fixture;
const {event,final:tour,actor,club,participation,entry}=fixture;
const entries=sameHand?fixture.entries:[{entry,participation,expectedRank:8}];
const expectedOrder=sameHand?fixture.expectedOrder:[entry];
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_earlyitm1172_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const guard=String.raw`DO $$ BEGIN ASSERT current_database()='vinpoker_earlyitm1172_local';ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_EARLYITM1172_OWNED_LOCAL_SOURCE_ranking860_HEAD_ef6a26948';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));END $$;`;
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6,stdio:['pipe','pipe','pipe']}).trim();
const read=q=>JSON.parse(sql('BEGIN READ ONLY;'+guard+"SET LOCAL statement_timeout='10s';"+q+';ROLLBACK;'));
const native=q=>read(auth+q),literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const uuid=v=>assert.match(v??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
const hash=v=>assert.match(v??'',/^[a-f0-9]{32}$/);
for(const id of [event,tour,actor,club,...entries.flatMap(row=>[row.participation,row.entry])])uuid(id);
const tables=['tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','hand_players','hand_actions','tournament_prizes','tournament_close_report','cashier_buyin_movements','chip_bag','tournament_chip_counts','chip_inventory_ledger','chip_bank_ledger','dealer_attendance','dealer_assignments','notifications','multi_day_final_participations_v1','multi_day_payout_finalizations_v1','multi_day_package_release_v1','user_roles','club_cashiers','clubs'];
const proof=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text))`);
const rowProof=(table,where)=>read(`SELECT to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),''))) FROM ${table} x WHERE ${where}`);
const priorRank=normalRead?JSON.parse(readFileSync('D:/Quy trình/output/reports/earlyitm1181-floor-browser-state-local-20261028.json','utf8')):null;
const state=verifyOnly?JSON.parse(readFileSync(path,'utf8')):{fixture,kind:normalRead?'NORMAL_OPS_FLOOR_PAYOUT_ROUTE_NATIVE_READ_ONLY':sameHand?'ACTUAL_FLOOR_SAME_HAND_MANUAL_RANK_NATIVE_BROWSER':'ACTUAL_FLOOR_INDIVIDUAL_RANK_OBLIGATION_NATIVE_BROWSER',before:proof(),requests:priorRank?.requests??{},results:priorRank?.results??{},trace:[],errors:[],expectedReadErrors:[],denied:[]};
const protectedRows={rank:['private.multi_day_individual_results_v1',`event_id<>'${event}'`],rankReceipt:['private.multi_day_individual_rank_requests_v1',`event_id<>'${event}'`],
 obligation:['private.multi_day_individual_obligations_v1',`event_id<>'${event}'`],obligationReceipt:['private.multi_day_individual_obligation_requests_v1',`event_id<>'${event}'`],
 payment:['public.tournament_prize_payments',`tournament_id<>'${tour}'`],paymentProof:['private.multi_day_individual_payment_commits_v1',`event_id<>'${event}'`]};
if(!verifyOnly){state.otherRows=Object.fromEntries(Object.entries(protectedRows).map(([key,[table,where]])=>[key,rowProof(table,where)]));state.otherPaymentReceipts=rowProof('floor_private.payout_payment_receipts_v1','true');}
const save=()=>writeFileSync(path,JSON.stringify(state,null,2));
function verify(){
 assert.equal(proof(),state.before);
 for(const [key,[table,where]] of Object.entries(protectedRows))assert.equal(rowProof(table,where),state.otherRows[key],key+' other rows changed');
 const paymentRequest=state.requests.payment?.p_request_id;
 assert.equal(rowProof('floor_private.payout_payment_receipts_v1',paymentRequest?`NOT(actor_id='${actor}' AND request_id='${paymentRequest}')`:'true'),state.otherPaymentReceipts);
 const counts=read(`SELECT jsonb_build_object('ranks',(SELECT count(*) FROM private.multi_day_individual_results_v1 WHERE event_id='${event}'),'rankReceipts',(SELECT count(*) FROM private.multi_day_individual_rank_requests_v1 WHERE event_id='${event}'),'obligations',(SELECT count(*) FROM private.multi_day_individual_obligations_v1 WHERE event_id='${event}'),'obligationReceipts',(SELECT count(*) FROM private.multi_day_individual_obligation_requests_v1 WHERE event_id='${event}'),'payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${tour}'),'paymentProofs',(SELECT count(*) FROM private.multi_day_individual_payment_commits_v1 WHERE event_id='${event}'),'globalFinalizations',(SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}'),'survivors',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}' AND status<>'busted'),'officialRanks',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL))`);
 for(const [field,kind] of [['ranks','rank'],['rankReceipts','rank'],['obligations','obligation'],['obligationReceipts','obligation'],['payments','payment'],['paymentProofs','payment']])assert.equal(counts[field],state.results[kind]?(sameHand&&field==='ranks'?2:1):0,field);
 assert.equal(counts.globalFinalizations,0);assert.equal(counts.survivors,sameHand?6:7);assert.equal(counts.officialRanks,0);
 if(state.results.rank){const r=native(`SELECT public.get_multi_day_individual_rank_receipt_v1('${event}','${state.requests.rank.p_request_id}')`);assert.deepEqual(r.receipt,state.results.rank);}
 if(state.results.obligation){const r=native(`SELECT public.get_multi_day_individual_obligation_receipt_v1('${event}','${state.requests.obligation.p_request_id}')`);assert.deepEqual(r.receipt,state.results.obligation);}
 if(state.results.payment){const r=native(`SELECT public.get_tournament_prize_payment_receipt_v2('${paymentRequest}')`);assert.deepEqual(r.result,state.results.payment);}
 return counts;
}
if(verifyOnly){state.final=verify();state.finalProtectedUnchanged=true;save();console.log(`EARLYITM${runId}_READONLY_FINAL_STATE_VERIFIED`,JSON.stringify(state.final));process.exit(0);}
state.initial=verify();save();
const user={id:actor,email:`earlyitm${runId}@example.invalid`,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-28T00:00:00Z'},sessions=new Set(),key=randomUUID();
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer,x-retry-count');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.headers.host!=='127.0.0.1:54329'||req.headers.origin&&req.headers.origin!==origin)return send(403,{message:'LOCAL1176_SCOPE'});
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{tour,actor,club,d2Event:event,email:user.email,runId,model:'new unconfirmed-rank fixture / native COMMIT / modeled session / no transfer'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600;
   const payload=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');
   const token=payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');sessions.add(token);
   return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL1176_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  if(normalRead&&req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   const name=u.pathname.slice('/rest/v1/'.length),select=u.searchParams.get('select')?.replaceAll(/\s/g,'');
   let statement;
   if(name==='clubs'&&select==='id,name'){
    const filter=u.searchParams.get('id');assert.match(filter??'',/^in\.\([a-f0-9,-]+\)$/);const ids=filter.slice(4,-1).split(',');ids.forEach(uuid);
    statement=`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id IN(${ids.map(literal).join(',')})`;
   }else if(name==='tournaments'){
    assert.equal(u.searchParams.get('id'),'eq.'+tour);
    const columns={
     'id,club_id,name,status':'id,club_id,name,status',
     'event_id,phase':'event_id,phase',
     'satellite_payout':'satellite_payout',
     'name,status,players_remaining,average_stack,prize_pool,starting_stack,guarantee_amount,buy_in,rake_amount,main_event:tournament_events(guarantee_amount),club:clubs(name,cover_url,tv_logo_url,tv_brand_name,tv_bg_url)':
      `name,status,players_remaining,average_stack,prize_pool,starting_stack,guarantee_amount,buy_in,rake_amount,
       (SELECT jsonb_build_object('guarantee_amount',e.guarantee_amount) FROM public.tournament_events e WHERE e.id=t.event_id) main_event,
       (SELECT jsonb_build_object('name',c.name,'cover_url',c.cover_url,'tv_logo_url',c.tv_logo_url,'tv_brand_name',c.tv_brand_name,'tv_bg_url',c.tv_bg_url) FROM public.clubs c WHERE c.id=t.club_id) club`,
    }[select];assert.ok(columns,'1182 tournament projection not inventoried: '+select);
    if(u.searchParams.has('club_id'))assert.equal(u.searchParams.get('club_id'),'eq.'+club);
    statement=`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.tournaments t WHERE t.id='${tour}' AND t.club_id='${club}')x`;
   }else if(['tournament_levels','tournament_prizes','tournament_registrations'].includes(name)){
    assert.equal(u.searchParams.get('tournament_id'),'eq.'+tour);
    const columns={tournament_levels:'level_number,small_blind,big_blind,ante,duration_minutes,is_break',tournament_prizes:'position,amount',tournament_registrations:'buy_in'}[name];assert.equal(select,columns);
    if(name==='tournament_registrations')assert.equal(u.searchParams.get('status'),'eq.confirmed');
    statement=`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.${name} WHERE tournament_id='${tour}'${name==='tournament_registrations'?" AND status='confirmed'":''}${name==='tournament_levels'?' ORDER BY level_number':name==='tournament_prizes'?' ORDER BY position':''})x`;
   }
   if(statement){const result=native(statement);state.trace.push({table:name,select,readOnly:true});save();return send(200,req.headers.accept==='application/vnd.pgrst.object+json'?result[0]??null:result);}
  }
  if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   const name=u.pathname.slice('/rest/v1/'.length),columns={user_roles:'role',dealers:'id',clubs:'id',club_chip_masters:'club_id',club_marketers:'club_id',club_fnb_staff:'club_id',club_accountants:'club_id'}[name];
   if(columns){const where=name==='clubs'?`owner_id='${actor}'`:`user_id='${actor}'${name==='dealers'?' AND deleted_at IS NULL':''}`;return send(200,native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.${name} WHERE ${where}${name==='user_roles'?'':' LIMIT 1'})x`));}
  }
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.slice('/rest/v1/rpc/'.length);let statement,kind;
   if(normalRead&&['get_my_ops_capability_scope','get_my_ops_global_capability'].includes(name)){
    assert.deepEqual(body,{});statement=name==='get_my_ops_capability_scope'?"SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_ops_capability_scope()x":"SELECT jsonb_agg(jsonb_build_object('is_super_admin',is_super_admin)) FROM public.get_my_ops_global_capability()";
   }else if(normalRead&&['get_tournament_clock','get_tournament_participation_counts_v1','get_tv_tournament_branding_v1'].includes(name)){
    assert.deepEqual(body,{p_tournament_id:tour});statement=`SELECT public.${name}('${tour}')`;
   }else if(normalRead&&name==='list_tracker_floor_alerts'){
    assert.deepEqual(body,{p_tournament_id:tour,p_status:null});statement=`SELECT public.${name}('${tour}',NULL)`;
   }else if(['multi_day_floor_read_v1','multi_day_qualification_preview_v1','multi_day_payout_preview_v1','multi_day_final_roster_v1','get_multi_day_individual_rank_review_v1'].includes(name)){
    assert.deepEqual(body,{p_event_id:event});statement=`SELECT public.${name}('${event}')`;
   }else if(name==='get_multi_day_individual_obligation_preview_v1'){
    assert.equal(body.p_event_id,event);assert.ok(entries.some(row=>row.participation===body.p_participation_id));assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_participation_id']);statement=`SELECT public.${name}('${event}',${literal(body.p_participation_id)})`;
   }else if(['get_multi_day_individual_rank_receipt_v1','get_multi_day_individual_obligation_receipt_v1'].includes(name)){
    const target=name.includes('_rank_')?'rank':'obligation';assert.deepEqual(body,{p_event_id:event,p_request_id:state.requests[target]?.p_request_id});statement=`SELECT public.${name}('${event}',${literal(body.p_request_id)})`;
   }else if(name==='get_tournament_payout_recipients'){
    assert.deepEqual(body,{p_tournament_id:tour});statement=`SELECT public.${name}('${tour}')`;
   }else if(name==='get_tournament_prize_payment_receipt_v2'){
    assert.deepEqual(body,{p_request_id:state.requests.payment?.p_request_id});statement=`SELECT public.${name}(${literal(body.p_request_id)})`;
   }else if(name==='confirm_multi_day_individual_ranks_v1'){
    assert.equal(normalRead,false,'1182 normal route read-only scope');
    assert.equal(body.p_event_id,event);assert.deepEqual(body.p_ordered_busted_entry_ids,expectedOrder);hash(body.p_expected_source_hash);uuid(body.p_request_id);kind='rank';
    statement=`SELECT public.${name}('${event}',${literal(body.p_expected_source_hash)},ARRAY[${expectedOrder.map(id=>literal(id)+'::uuid').join(',')}],${literal(body.p_request_id)})`;
   }else if(name==='confirm_multi_day_individual_obligation_v1'){
    assert.equal(sameHand,false,'1181 rank-only browser scope');assert.equal(body.p_event_id,event);assert.equal(body.p_participation_id,participation);uuid(body.p_request_id);for(const k of ['p_expected_quote_hash','p_expected_source_hash','p_expected_budget_hash'])hash(body[k]);kind='obligation';
    statement=`SELECT public.${name}('${event}','${participation}',${['p_expected_quote_hash','p_expected_source_hash','p_expected_budget_hash','p_request_id'].map(k=>literal(body[k])).join(',')})`;
   }else if(name==='record_multi_day_prize_payment_v1'){
    assert.equal(sameHand,false,'1181 rank-only browser scope');assert.equal(body.p_event_id,event);assert.equal(body.p_participation_id,participation);assert.equal(body.p_method,'cash');hash(body.p_expected_token);uuid(body.p_request_id);kind='payment';
    statement=`SELECT public.${name}('${event}','${participation}','cash',${literal(body.p_expected_token)},${literal(body.p_request_id)})`;
   }
   if(statement){
    if(kind){if(state.requests[kind])assert.deepEqual(body,state.requests[kind]);else state.requests[kind]=body;save();
     const result=JSON.parse(sql('BEGIN;'+guard+"SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';"+auth+statement+';COMMIT;'));
     assert.equal(result.ok,true);assert.equal(result.outcome,'recorded');
     if(kind==='rank'){assert.equal(result.individualResults.length,entries.length);for(const row of entries){assert.equal(result.individualResults.find(item=>item.entry_id===row.entry)?.finished_place,row.expectedRank);}}
     if(kind==='obligation'){assert.equal(result.obligation.participation_id,participation);assert.equal(result.obligation.amount_vnd,100000);}
     if(kind==='payment'){assert.equal(result.entry_id,entry);assert.equal(result.prize_amount,100000);}
     if(state.results[kind])assert.deepEqual(result,state.results[kind]);state.results[kind]=result;state.latestCounts=verify();state.trace.push({rpc:name,request:body.p_request_id,kind,committed:true,responseLoss:true});save();
     return send(503,{message:'LOCAL1176_COMMITTED_RESPONSE_LOSS'});
    }
    try{const result=native(statement);state.trace.push({rpc:name,request:body.p_request_id??null});save();return send(200,result);}
    catch(error){const detail=String(error.stderr??'').match(/ERROR:\s+([^\n]+)/)?.[1];
     if(detail==='multi_day_payout_results_not_ready'){state.expectedReadErrors.push({rpc:name,message:detail});save();return send(400,{code:'P0001',message:detail});}throw error;
    }
   }
  }
  state.denied.push({method:req.method,path:u.pathname});save();return send(403,{message:'LOCAL1176_NOT_IN_SCOPE'});
 }catch(error){state.errors.push({message:error.message});save();return send(500,{message:'LOCAL1176_UNCONFIRMED_RESULT'});}
});
let stopping=false;
const finish=()=>{if(stopping)return;stopping=true;process.stdin.pause();server.close(()=>{state.final=verify();state.finalProtectedUnchanged=true;save();console.log(`EARLYITM${runId}_FINAL_NATIVE_VERIFIED`,JSON.stringify(state.final));process.exit(0);});server.closeAllConnections();};
process.stdin.once('data',finish);process.once('SIGINT',finish);
save();server.listen(54329,'127.0.0.1',()=>console.log(`EARLYITM${runId}_FLOOR_ADAPTER_READY`,JSON.stringify({tour,event,initial:state.initial})));
