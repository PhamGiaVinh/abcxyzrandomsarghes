import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createComputePayoutsLocalHandler} from './computePayouts.handler.local.mjs';

// Actual Edge handler/engine + native authenticated apply. Auth verification and
// privileged snapshot transport are modeled, not hosted/service-role RLS proof.
assert.equal(process.env.VINPOKER_PAYOUT376_LOCAL,'1');
const single670=process.env.VINPOKER_SINGLE670_PAYOUT==='1';
const single696=process.env.VINPOKER_SINGLE696_READBACK==='1';
assert.ok(!(single670&&single696),'one retained journey checkpoint only');
const originalSingle=single670||single696;
const tour=originalSingle?'c367013a-3ed3-48af-ad48-3915acadc50e':'6a7fb4a3-8b46-44be-a71a-ca12a052ee08',club=originalSingle?'d4427834-5f5f-48ef-bde5-e2dc388ed00b':'7f3c6f90-3667-4c8c-9a00-6f00da680d84';
const owner=originalSingle?'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e':'40b8f243-bf3b-4aaa-962b-db788380207c',outsider='11111111-1111-4111-8111-111111111111';
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
 'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let output='',pending=null,ended=false,queue=Promise.resolve(),verifiedActor=owner,currentRun=null,authorityFault=null;
const events=[];let diagnostics='';
child.stderr.on('data',chunk=>{diagnostics+=chunk.toString().slice(0,1000);});
const closed=new Promise(resolve=>child.once('close',code=>{ended=true;pending?.reject(Error(`native session closed ${code}: ${diagnostics}`));resolve(code);}));
child.on('error',error=>{pending?.reject(error);});
child.stdout.on('data',chunk=>{
 output+=chunk.toString();if(!pending||!output.includes(pending.marker+'\n'))return;
 const index=output.indexOf(pending.marker+'\n'),lines=output.slice(0,index).trim().split('\n').filter(Boolean),job=pending;
 output=output.slice(index+job.marker.length+1);pending=null;clearTimeout(job.timer);
 try{assert.equal(lines.length,1);job.resolve(JSON.parse(lines[0]));}catch(error){job.reject(error);}
});
function execute(statement){
 const next=queue.then(()=>new Promise((resolve,reject)=>{
  assert.equal(ended,false);const marker=`PAYOUT376_${randomUUID()}`;
  const timer=setTimeout(()=>{reject(Error('native query deadline'));child.stdin.end('ROLLBACK;\n\\q\n');},15000);
  pending={marker,resolve,reject,timer};child.stdin.write(`${statement}\n\\echo ${marker}\n`);
 }));queue=next.catch(()=>{});return next;
}
const claims=actor=>`RESET ROLE;SET LOCAL request.jwt.claim.sub=${quote(actor)};SET LOCAL ROLE authenticated;`;
const fingerprint=()=>execute(`RESET ROLE;SELECT jsonb_build_object('hash',md5(jsonb_build_object(
 'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${tour}'),
 'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prizes p WHERE tournament_id='${tour}'),
 'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r WHERE tournament_id='${tour}'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${tour}'),
 'closeReport',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_close_report r WHERE tournament_id='${tour}'),
 'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id='${tour}'))::text));`);
const service={
 rpc:async(name,args)=>{
  assert.ok(['is_club_owner','is_club_admin','is_club_cashier'].includes(name));
  assert.equal(args._user_id,verifiedActor);assert.equal(args._club_id,club);
  if(authorityFault){
   events.push({roleRead:name,fault:authorityFault});
   if(authorityFault==='throw')throw Error('LOCAL377_ROLE_TRANSPORT_FAILURE');
   return authorityFault==='rpc_error'||authorityFault==='error_with_true'
    ?{data:authorityFault==='error_with_true'?true:null,error:{message:'LOCAL377_RPC_503'}}:{data:null,error:null};
  }
  const value=await execute(`RESET ROLE;SELECT to_jsonb(public.${name}(${quote(verifiedActor)}::uuid,'${club}'::uuid));`);
  events.push({roleRead:name,allowed:value===true});return {data:value,error:null};
 },
 from:table=>{
  assert.ok(['tournament_payout_runs','tournaments'].includes(table));let columns,identity;
  const builder={select:value=>{columns=value.replaceAll(/\s/g,'');return builder;},eq:(key,value)=>{assert.equal(key,'id');identity=value;return builder;},maybeSingle:async()=>{
   if(table==='tournaments'){assert.equal(identity,tour);assert.equal(columns,'club_id');}
   else {assert.equal(identity,currentRun);assert.ok(['id,tournament_id,status,entries_snapshot,prize_pool_snapshot,effective_floor,itm_percent,archetype,rounding_unit','custom_percents'].includes(columns));}
   const value=await execute(`RESET ROLE;SELECT (SELECT to_jsonb(r) FROM(SELECT ${columns} FROM public.${table} WHERE id=${quote(identity)}::uuid) r);`);
   events.push({snapshotRead:table,columns});return {data:value,error:null};
  }};return builder;
 },
};
const caller={auth:{getUser:async()=>({data:{user:{id:verifiedActor}},error:null})},from:table=>{
 assert.equal(table,'tournaments');let selected;
 const builder={select:value=>{selected=value.replaceAll(/\s/g,'');return builder;},eq:(key,value)=>{assert.equal(key,'id');assert.equal(value,tour);return builder;},maybeSingle:async()=>{
  assert.equal(selected,'id,club_id,buy_in,rake_amount,event_id');
  const data=await execute(`${claims(verifiedActor)}SELECT (SELECT to_jsonb(t) FROM(SELECT ${selected} FROM public.tournaments WHERE id='${tour}') t);`);
  return {data,error:null};
 }};return builder;
},rpc:async(name,args)=>{
 assert.equal(name,'apply_payout_run');assert.equal(args.p_run_id,currentRun);
 events.push({apply:name,actor:verifiedActor,rows:args.p_rows});
 const value=await execute(`${claims(verifiedActor)}SELECT public.apply_payout_run(
  p_run_id=>${quote(currentRun)}::uuid,p_rows=>${quote(JSON.stringify(args.p_rows))}::jsonb,
  p_prize_pool=>${args.p_prize_pool},p_itm_places=>${args.p_itm_places},p_effective_floor=>${args.p_effective_floor},
  p_warnings=>${quote(JSON.stringify(args.p_warnings))}::jsonb,p_engine_version=>${quote(args.p_engine_version)},p_alpha_version=>${quote(args.p_alpha_version)});`);
 return {data:value,error:null};
}};
const handler=createComputePayoutsLocalHandler({service,caller});
try{
 await execute(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='2min';
  DO $$ BEGIN IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441
   OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
   OR NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE t.id='${tour}' AND t.name='Cash identity local TEST' AND t.club_id='${club}' AND c.owner_id='${owner}' AND t.event_id IS NULL AND t.registration_closed_at IS NULL)
   OR ${originalSingle?'true':'false'} AND NOT(SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='${tour}')
   OR ${single670?'true':'false'} AND NOT(SELECT count(*)=8 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active)
   OR ${single696?'true':'false'} AND (EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active)
    OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${tour}' AND status='completed' AND prize_pool=0)
    OR NOT EXISTS(SELECT 1 FROM public.tournament_close_report WHERE id='95fc8d98-a056-45f2-9803-d505a58c686e' AND tournament_id='${tour}' AND detail->'official_results'->>'status'='finalized')
    OR NOT(SELECT count(*)=8 FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL))
   OR EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='${tour}') THEN RAISE EXCEPTION 'payout376_local_fixture_drift'; END IF; END $$;
  SELECT '{}'::jsonb;`);
 const before=await fingerprint();
 for(const archetype of originalSingle?['DAILY']:['DAILY','INTL','MULTI','TRITON','CUSTOM']){
  await execute(`SAVEPOINT preset;${claims(owner)}SELECT '{}'::jsonb;`);
  const custom=archetype==='CUSTOM';
  const snapshot=await execute(`SELECT public.prepare_payout_snapshot(p_tournament_id=>'${tour}',p_itm_percent=>${originalSingle?0.15:0.2},p_archetype=>${quote(archetype)},p_min_cash_x=>2,p_rounding_unit=>${custom?1000:100000},
   p_custom_percents=>${custom?quote(JSON.stringify([{position:1,percent_bp:5000},{position:2,percent_bp:3000},{position:3,percent_bp:2000}]))+'::jsonb':'NULL'});`);
  assert.equal(snapshot.status,'prepared');currentRun=snapshot.run_id;
  if(originalSingle){assert.equal(snapshot.entries_snapshot,9);assert.equal(snapshot.prize_pool_snapshot,900000);assert.equal(snapshot.buy_in_snapshot,100000);}
  const request=()=>new Request('http://127.0.0.1/compute-payouts',{method:'POST',headers:{Authorization:'Bearer LOCAL_AUTH_MODEL','Content-Type':'application/json'},body:JSON.stringify({mode:'official',run_id:currentRun})});
  if(archetype==='DAILY'){
   const preparedState=await fingerprint();
   for(const mode of ['official','preview'])for(const fault of ['rpc_error','malformed','throw','error_with_true']){
    authorityFault=fault;const beforeApply=events.filter(event=>event.apply).length;
    const faultRequest=mode==='official'?request():new Request('http://127.0.0.1/compute-payouts',{method:'POST',headers:{Authorization:'Bearer LOCAL_AUTH_MODEL','Content-Type':'application/json'},body:JSON.stringify({mode:'preview',tournament_id:tour,archetype:'DAILY',itm_percent:0.2,entries_override:3})});
    const unavailable=await handler(faultRequest);assert.equal(unavailable.status,503,`authority unavailable ${mode} ${fault}`);
    assert.equal((await unavailable.json()).error,'PAYOUT_AUTHORITY_UNVERIFIED');
    assert.equal(events.filter(event=>event.apply).length,beforeApply,'unknown authority must not reach apply');
    assert.deepEqual(await fingerprint(),preparedState);
    console.log(JSON.stringify({mode,authorityFault:fault,status:503,applyCalls:0}));
   }
   authorityFault=null;
   const previewRequest=()=>new Request('http://127.0.0.1/compute-payouts',{method:'POST',headers:{Authorization:'Bearer LOCAL_AUTH_MODEL','Content-Type':'application/json'},body:JSON.stringify({mode:'preview',tournament_id:tour,archetype:'DAILY',itm_percent:0.2,entries_override:3})});
   const preview=await handler(previewRequest());assert.equal(preview.status,200);
   assert.equal((await preview.json()).estimated,true);assert.deepEqual(await fingerprint(),preparedState);
   verifiedActor=outsider;const deniedPreview=await handler(previewRequest());assert.equal(deniedPreview.status,403);
   assert.equal((await deniedPreview.json()).error,'NOT_AUTHORIZED');assert.deepEqual(await fingerprint(),preparedState);
   verifiedActor=owner;console.log('PAYOUT377_PREVIEW_RECOVERY_READONLY_AND_OUTSIDER_DENIED_PASS');
  }
  verifiedActor=outsider;let response=await handler(request());assert.equal(response.status,403);assert.equal((await response.json()).error,'NOT_AUTHORIZED');
  verifiedActor=owner;response=await handler(request());const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));
  assert.equal(value.mode,'official');assert.equal(value.run_id,currentRun);assert.equal(value.result.rows.reduce((sum,row)=>sum+row.amount,0),snapshot.prize_pool_snapshot);
  const stored=await execute(`RESET ROLE;SELECT jsonb_build_object('rows',(SELECT jsonb_agg(jsonb_build_object('position',position,'amount',amount) ORDER BY position) FROM public.tournament_prizes WHERE tournament_id='${tour}'),
   'runs',(SELECT count(*) FROM public.tournament_payout_runs WHERE tournament_id='${tour}' AND status='applied'),
   'paid',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${tour}'),
   'pool',(SELECT prize_pool FROM public.tournaments WHERE id='${tour}'));`);
  assert.deepEqual(stored.rows,value.result.rows.map(({position,amount})=>({position,amount})));assert.equal(stored.runs,1);assert.equal(stored.pool,snapshot.prize_pool_snapshot);
  if(single696){
   const reconciled=await execute(`RESET ROLE;SELECT jsonb_build_object('run',(SELECT jsonb_build_object('id',id,'status',status,'entries',entries_snapshot,'pool',prize_pool_snapshot) FROM public.tournament_payout_runs WHERE id='${currentRun}' AND tournament_id='${tour}'),
    'closed',(SELECT to_jsonb(r) FROM public.tournament_close_report r WHERE id='95fc8d98-a056-45f2-9803-d505a58c686e'));`);
   assert.deepEqual(reconciled.run,{id:currentRun,status:'applied',entries:9,pool:900000});
   assert.deepEqual(stored.rows,[{position:1,amount:700000},{position:2,amount:200000}]);
   assert.equal(reconciled.closed.prize_total,0);assert.equal(reconciled.closed.reconcile_delta,900000);assert.equal(reconciled.closed.reconciled,false);
   assert.equal(stored.paid,0);
   console.log('SINGLE696_ACTUAL_HANDLER_NATIVE_MATCHING_APPLIED_RUN_700K200K_CLOSE_SNAPSHOT_IMMUTABLE_NO_PAYMENT_PASS');
  }
  if(custom)assert.deepEqual(stored.rows,[{position:1,amount:150000},{position:2,amount:90000},{position:3,amount:60000}]);
  const applyCount=events.filter(event=>event.apply).length;response=await handler(request());assert.equal(response.status,409);assert.equal((await response.json()).error,'RUN_NOT_DRAFT');assert.equal(events.filter(event=>event.apply).length,applyCount);
  console.log(JSON.stringify({preset:archetype,pool:stored.pool,places:value.result.itmPlaces,rows:stored.rows,repeat:'409_no_second_apply',outsider:'403_no_apply',layer:'ACTUAL_HANDLER_ENGINE_AUTHENTICATED_NATIVE_SQL_AUTH_READ_TRANSPORT_MODELED'}));
  await execute(`RESET ROLE;ROLLBACK TO preset;SELECT '{}'::jsonb;`);assert.deepEqual(await fingerprint(),before);
 }
 await execute(`ROLLBACK;SELECT '{}'::jsonb;`);assert.deepEqual(await fingerprint(),before);
 console.log(single696?'SINGLE696_CLOSED_ORIGINAL_NATIVE_READBACK_ALL_FINANCIAL_FACTS_ROLLBACK_PASS':single670?'SINGLE670_ORIGINAL9_ENTRIES900K_DAILY_DEFAULT_HANDLER_NATIVE_APPLY_REPLAY_DENIAL_ROLLBACK_PASS':'PAYOUT376_FOUR_PRESETS_AND_CUSTOM_NATIVE_APPLY_REPLAY_DENIAL_ROLLBACK_PASS');
}finally{
 if(!ended)child.stdin.end('ROLLBACK;\n\\q\n');
 const timeout=setTimeout(()=>child.kill(),10000);const code=await closed;clearTimeout(timeout);if(pending)clearTimeout(pending.timer);
 assert.equal(code,0,diagnostics);
}
