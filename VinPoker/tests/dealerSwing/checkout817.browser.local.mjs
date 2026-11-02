import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHmac,createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
import {mapWithConcurrency} from '../../supabase/functions/_shared/mapWithConcurrency.ts';
import {manualDealerIntentHeaders} from '../../supabase/functions/_shared/dealerMutationIntent.ts';
import {createSingle643Reads} from './single643.swing-read.local.mjs';
import {runClockBrowserEdge} from '../cashier/clockBrowserEdge.local.mjs';

// Reuses payoutBrowser's dev UI, Auth shape and643 native read bridge. Managed
// Auth/PostgREST are modeled; BOTH browser and Edge service calls use real SDK
// HTTP. Only canonical checkout RPCs execute business writes, in exact814clone.
export async function runCheckout817Browser(){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(process.env.VINPOKER_CHECKOUT817_BROWSER,'1');
 const api='http://127.0.0.1:54329';
 const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_checkout814_race_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000,maxBuffer:2e6}).trim();
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_checkout814_race_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.operator_checkout_dealer_attendance_v1(uuid,uuid)'::regprocedure;"),'67112d4602462f5dcca6d59e99613068');
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_dealer_checkout_receipt_v1(uuid,uuid)'::regprocedure;"),'3884d303dd6f80562ad5619a55a8bcbb');
 const root=JSON.parse(sql('SELECT manifest FROM private.checkout814_fixture;'));
 const actor=root.actor,club=root.club;
 assert.equal(actor,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');assert.equal(club,'d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 assert.equal(sql("SELECT proof?'revoke816' FROM private.checkout814_fixture;"),'t');
 const quote=v=>`'${String(v).replaceAll("'","''")}'`;
 const protect=['cashier_buyin_movements','tournament_entries','tournament_seats','tournament_hands','hand_actions','hand_players',
  'tournament_prize_payments','chip_inventory_ledger','chip_bank_ledger','chip_bag','day_close','dealer_payroll','payroll_periods',
  'dealer_rotation_schedule','club_settings','centerpoint_tournament_ops_release','table_sessions','tournament_tables'];
 const facts=()=>sql(`SELECT md5(jsonb_build_array(${protect.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);`);
 const before=facts();
 const swing831=process.env.VINPOKER_SWING831_BROWSER==='1';
 const swing831Context={p_actor_user_id:actor,p_club_id:club,p_table_id:'53637b3a-b553-472f-830d-6e7ede661f6f',p_table_session_id:'697d9aed-5faa-4a53-a193-2caa4a849e27',p_assignment_id:'e5991944-e849-4e32-8076-fc1e4432587f',p_expected_version:0};
 const swing831Facts=()=>sql(`SELECT md5(jsonb_build_array(${['dealer_assignments','dealer_attendance','dealer_breaks'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${t} x)`).join(',')})::text);`);
 const swing831Before=swing831?swing831Facts():null;
 let swing831Key=null;
 if(swing831){
  assert.equal(sql("SELECT md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure))=(SELECT installed_digest FROM private.swing831_install WHERE id);"),'t');
  const prior=JSON.parse(sql("SELECT coalesce(jsonb_agg(request_id),'[]') FROM public.dealer_swing_operator_requests WHERE response->>'detail'='SWING831_INJECTED_ACQUISITION_FAILURE';"));
  assert.ok(prior.length<=1,'831 error canary consumed with multiple keys');swing831Key=prior[0]??null;
 }
 const feature826=process.env.VINPOKER_FEATURE826_BROWSER==='1';
 const feature823=process.env.VINPOKER_FEATURE823_BROWSER==='1'||feature826;
 const profileTable823=feature826?sql(`SELECT id FROM public.game_tables WHERE club_id='${club}' AND table_number=97;`):'394ee596-d625-49a4-9899-2d167f110d24';
 const configFacts823=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.dealer_table_profiles x WHERE table_id<>'${profileTable823}'),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.dealer_table_pool_members x WHERE table_id<>'${profileTable823}'),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.audit_logs x WHERE entity_id::text IS DISTINCT FROM '${profileTable823}'))::text);`);
 let profileKey823=null,dropProfile823=false,configBefore823=null;
 if(feature823){
  assert.equal(sql("SELECT md5(pg_get_functiondef('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)'::regprocedure));"),'1447eca27159c475ff37a3480d836cb7');
  assert.equal(sql(`SELECT count(*) FROM public.game_tables WHERE id='${profileTable823}' AND club_id='${club}' AND table_number=${feature826?97:99};`),'1');
  if(feature826)assert.equal(sql("SELECT md5(pg_get_functiondef('public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)'::regprocedure));"),'a07285426eba0aa1e68a3ab056f024cc');
  assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE game_table_id='${profileTable823}' AND closed_at IS NULL;`),'0');
  const saved=JSON.parse(sql(`SELECT coalesce(jsonb_agg(request_id),'[]') FROM private.dealer_feature_config_receipts_v1 WHERE table_id='${profileTable823}' AND actor_id='${actor}';`));
  assert.ok(saved.length<=1,'823 constructor/canary already consumed with multiple requests');profileKey823=saved[0]??null;
  dropProfile823=profileKey823===null;configBefore823=configFacts823();
 }
 const present=sql("SELECT to_regclass('private.checkout817_fixture') IS NOT NULL;")==='t';
 if(process.argv.includes('--prepare-checkout817')){
  assert.equal(process.env.VINPOKER_CHECKOUT817_COMMIT,'1');assert.equal(present,false,'817 constructor consumed; use retained manifest, never reset');
  const dealer=randomUUID(),attendance=randomUUID();
  sql(`BEGIN;SET LOCAL statement_timeout='10s';
   CREATE TABLE private.checkout817_fixture(id boolean PRIMARY KEY DEFAULT true CHECK(id),manifest jsonb NOT NULL,proof jsonb);
   ALTER TABLE private.checkout817_fixture ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON private.checkout817_fixture FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO public.dealers(id,club_id,full_name) VALUES('${dealer}','${club}','LOCAL817 CHECKOUT BROWSER TEST');
   INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time)
    SELECT '${attendance}','${dealer}',shift_id,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'checked_in','available',now()-interval '9 hours'
    FROM public.dealer_attendance WHERE id=(SELECT (manifest->>'attendance')::uuid FROM private.checkout814_fixture);
   SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
   SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';
   DO $$DECLARE host public.dealer_assignments;transition jsonb;BEGIN
    SELECT * INTO STRICT host FROM public.dealer_assignments WHERE attendance_id='${root.close815.attendance}' AND status='assigned' AND released_at IS NULL FOR UPDATE;
    ASSERT host.pre_assigned_attendance_id IS NULL AND host.table_session_id='${root.session}';
    transition:=public.transition_dealer_state('${attendance}','pre_assigned','LOCAL817_TEST_FIXTURE');ASSERT transition->>'ok'='true',transition::text;
    UPDATE public.dealer_attendance SET pre_assigned_table_id=host.table_id,pre_assigned_at=now() WHERE id='${attendance}';
    UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${attendance}',pre_assigned_at=now() WHERE id=host.id;
    INSERT INTO private.checkout817_fixture(manifest) VALUES(jsonb_build_object('actor','${actor}','club','${club}','tour','${root.tournament}',
     'dealer','${dealer}','attendance','${attendance}','host_assignment',host.id,'host_before',to_jsonb(host),
     'physical',host.table_id,'session',host.table_session_id,'source_head','ef6a26948'));
   END $$;COMMIT;`);
  assert.equal(facts(),before,'817 metadata preparation changed protected tour/financial facts');
  console.log('CHECKOUT817_NEW_PREASSIGNED_BROWSER_CANARY_PREPARED_NO_CASH_CHIP_HAND_DELTA');return;
 }
 assert.ok(present,'prepare exact817 canary once before serving');
 const fixture=JSON.parse(sql('SELECT manifest FROM private.checkout817_fixture;'));
 assert.equal(fixture.actor,actor);assert.equal(fixture.club,club);assert.equal(fixture.session,root.session);
 const clock838=process.env.VINPOKER_SCHEDULE838_CLOCK==='1';
 const clockTour838='ba18ce1f-5993-44be-a6df-4772c4b96239';
 if(process.argv.includes('--prepare-clock838')){
  assert.ok(clock838);assert.equal(process.env.VINPOKER_SCHEDULE838_COMMIT,'1');
  assert.equal(sql("SELECT to_regclass('private.schedule838_fixture') IS NULL;"),'t','838 preparation consumed');
  sql(`BEGIN;DO $$ BEGIN ASSERT (SELECT result->'tournaments'->0->>'tournament_id'='${clockTour838}' FROM private.schedule835_fixture WHERE id);
   ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_levels WHERE tournament_id='${clockTour838}');
   ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${clockTour838}' AND club_id='${club}' AND live_status='registering' AND clock_started_at IS NULL);END $$;
   CREATE TABLE private.schedule838_fixture(id boolean PRIMARY KEY DEFAULT true CHECK(id),original_tour jsonb NOT NULL,other_tours_hash text NOT NULL);
   ALTER TABLE private.schedule838_fixture ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.schedule838_fixture FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO private.schedule838_fixture SELECT true,(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${clockTour838}'),
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'null')) FROM public.tournaments t WHERE id<>'${clockTour838}');COMMIT;`);
  assert.equal(facts(),before);console.log('SCHEDULE838_EXISTING_IMPORTED_TOUR_METADATA_SNAPSHOT_ONLY_PASS');return;
 }
 if(clock838){
  assert.equal(sql("SELECT count(*) FROM private.schedule838_fixture WHERE id;"),'1');
  assert.equal(process.env.VINPOKER_SCHEDULE835_BROWSER,'0');assert.equal(process.env.VINPOKER_SCHEDULE836_BROWSER,'0');
 }
 const otherLevels838=clock838?sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'null')) FROM public.tournament_levels x WHERE tournament_id<>'${clockTour838}';`):null;
 const schedule836=process.env.VINPOKER_SCHEDULE836_BROWSER==='1';
 const scheduleVariant836=process.env.VINPOKER_SCHEDULE836_VARIANT??'836';
 assert.ok(!schedule836||['836','837'].includes(scheduleVariant836),'bounded pending-layout canary variant');
 const schedule835=process.env.VINPOKER_SCHEDULE835_BROWSER==='1'||schedule836;
 assert.ok(!(schedule836&&process.env.VINPOKER_SCHEDULE835_BROWSER==='1'),'qualify one schedule canary at a time');
 const scheduleTable835=schedule836?`schedule${scheduleVariant836}_fixture`:'schedule835_fixture';
 if(process.argv.includes('--prepare-schedule835')||process.argv.includes('--prepare-schedule836')){
  assert.ok(schedule835);assert.equal(process.env.VINPOKER_SCHEDULE835_COMMIT,'1');
  assert.equal(process.argv.includes('--prepare-schedule836'),schedule836);
  assert.equal(sql(`SELECT to_regclass('private.${scheduleTable835}') IS NULL;`),'t','schedule constructor consumed');
  const rows=[1,2].map(i=>({club_id:club,name:`LOCAL${schedule836?scheduleVariant836:835} schedule TEST ${i}`,start_time:`2026-10-30T0${i+2}:00:00.000Z`,buy_in:100000,starting_stack:20000,game_type:'nlh',location:null}));
  sql(`BEGIN;CREATE TABLE private.${scheduleTable835}(id boolean PRIMARY KEY DEFAULT true CHECK(id),manifest jsonb NOT NULL,request_id uuid,result jsonb,tours_before text NOT NULL);
   ALTER TABLE private.${scheduleTable835} ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.${scheduleTable835} FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO private.${scheduleTable835}(manifest,tours_before) SELECT ${quote(JSON.stringify({actor,club,rows}))}::jsonb,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'null')) FROM public.tournaments t;COMMIT;`);
  assert.equal(facts(),before);console.log('SCHEDULE835_PRIVATE_METADATA_ONLY_PREPARED_NO_BUSINESS_DELTA');return;
 }
 const scheduleFixture835=schedule835?JSON.parse(sql(`SELECT to_jsonb(x) FROM private.${scheduleTable835} x WHERE id;`)):null;
 let scheduleKey835=scheduleFixture835?.request_id??null,holdScheduleRead835=false;
 const scheduleImage835=schedule835?readFileSync(new URL('../../public/favicon-32.png',import.meta.url)).toString('base64'):null;
 if(process.argv.includes('--record-checkout817')){
  assert.equal(process.env.VINPOKER_CHECKOUT817_COMMIT,'1');
  const artifactPath='D:/Quy trình/output/reports/checkout817-browser-before-readadapter-fix-20261025.json';
  const bytes=readFileSync(artifactPath),artifact=JSON.parse(bytes);
  assert.equal(artifact.fixture.attendance,fixture.attendance);
  const events=artifact.log.filter(x=>x.service_rpc||x.fault||x.edge);
  const writes=events.filter(x=>x.service_rpc==='operator_checkout_dealer_attendance_v1');
  assert.equal(writes.length,1);assert.equal(writes[0].result.success,true);assert.equal(writes[0].result.idempotent,false);
  assert.equal(events.filter(x=>x.fault==='CORE_SUCCESS_RESPONSE_LOST_AFTER_COMMIT').length,1);
  const response=events.find(x=>x.edge==='checkout-dealer');assert.equal(response.status,200);
  assert.equal(response.result.results.length,1);assert.equal(response.result.results[0].success,true);assert.equal(response.result.results[0].recovered,true);
  assert.equal(sql(`SELECT count(*) FROM private.dealer_checkout_receipts_v1 WHERE attendance_id='${fixture.attendance}' AND result=${quote(JSON.stringify(writes[0].result))}::jsonb;`),'1');
  const proof={model:'AUTH_POSTGREST_MODELED_REAL_SDK_HTTP_ACTUAL_EDGE_HANDLER_CANONICAL_PG_COMMIT',
   run_id:artifact.runId,events,artifact_path:artifactPath,artifact_sha256:createHash('sha256').update(bytes).digest('hex'),
   edge_sha256:createHash('sha256').update(readFileSync(new URL('../../supabase/functions/checkout-dealer/index.ts',import.meta.url))).digest('hex'),
   protected_fingerprint_at_record:before};
  assert.equal(sql(`WITH saved AS(UPDATE private.checkout817_fixture SET proof=${quote(JSON.stringify(proof))}::jsonb WHERE id AND proof IS NULL RETURNING id)SELECT count(*) FROM saved;`),'1','817 proof already recorded; do not overwrite');
  assert.equal(facts(),before);console.log('CHECKOUT817_HTTP_COMMIT_RESPONSE_LOSS_EVIDENCE_RECORDED_ONCE');return;
 }
 const authUsage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 const query=statement=>JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='8s';
  ${authUsage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
  SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  ${statement}RESET ROLE;${authUsage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
 const log=[],sessions=new Map(),signingKey=randomBytes(32),serviceKey=randomBytes(32).toString('hex'),runId=randomUUID();
 const email='native-owner@test.invalid',password='LOCAL_TEST_ONLY';
 const user={id:actor,aud:'authenticated',role:'authenticated',email,email_confirmed_at:new Date().toISOString(),
  created_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
 const session=()=>{
  const exp=Math.floor(Date.now()/1000)+3600;
  const unsigned=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,aud:'authenticated',role:'authenticated',exp,iat:exp-3600,iss:api+'/auth/v1'})).toString('base64url');
  const token=unsigned+'.'+createHmac('sha256',signingKey).update(unsigned).digest('base64url');
  const value={access_token:token,refresh_token:randomUUID(),token_type:'bearer',expires_in:3600,expires_at:exp,user};sessions.set(token,value);return value;
 };
 const reads=createSingle643Reads({sql,query,club,log,checkout814:true});
 let dropCore=false,handler,feature819Mode='normal';
 const heldFlags=new Set();
 const source=readFileSync(new URL('../../supabase/functions/checkout-dealer/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Deno:{serve:fn=>handler=fn,env:{get:name=>name==='SUPABASE_URL'?api:name==='SUPABASE_SERVICE_ROLE_KEY'?serviceKey:name==='TELEGRAM_BOT_TOKEN'?'':undefined}},
  createClient:(url,key,options)=>{assert.equal(url,api);assert.equal(key,serviceKey);return createClient(url,key,{...options,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});},
  authenticateUser:async req=>sessions.has(req.headers.get('authorization')?.replace(/^Bearer /i,''))?{uid:actor}:new Response(JSON.stringify({error:'LOCAL_AUTH_REQUIRED'}),{status:401}),
  manualDealerIntentHeaders,mapWithConcurrency,Response,console,
  corsHeaders:{'Access-Control-Allow-Origin':'http://127.0.0.1:5188'},
  jsonResponse:(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}}),
  mention:d=>d.full_name,pickNextDealer:async()=>{log.push({dependency:'replacement_pool_NOT_QUALIFIED',modeled:true});return null;},
  getClubTelegramChatId:async()=>null,sendTelegramNotification:async()=>{log.push({notification:'LOCAL_SINK_ONLY'});return false;},notifyDealerDM:async()=>false,
 });
 const rpcService=(name,body)=>{
  assert.ok(['operator_checkout_dealer_attendance_v1','get_dealer_checkout_receipt_v1','is_club_dealer_control'].includes(name));
  const control=name==='is_club_dealer_control';
  assert.equal(body[control?'_user_id':'p_actor_id'],actor);assert.equal(body[control?'_club_id':'p_attendance_id'],control?club:fixture.attendance);
  const value=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='8s';
   SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
   SET LOCAL request.headers='${JSON.stringify(manualDealerIntentHeaders(actor))}';SET LOCAL ROLE service_role;
   SELECT to_jsonb(public.${name}('${actor}','${control?club:fixture.attendance}'));COMMIT;`));
  log.push({service_rpc:name,attendance:control?null:fixture.attendance,result:value});return value;
 };
 const server=createServer(async(req,res)=>{
  if(req.headers.host!=='127.0.0.1:54329'||req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'){res.writeHead(403);res.end();return;}
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,x-retry-count,x-vinpoker-dealer-intent,x-vinpoker-dealer-actor,prefer,cache-control');
  res.setHeader('Access-Control-Allow-Methods','GET,HEAD,POST,PATCH,OPTIONS');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const send=(status,value)=>{res.writeHead(status);res.end(value===undefined?'':JSON.stringify(value));};
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try{
   const url=new URL(req.url,api);let raw='';for await(const b of req){raw+=b;assert.ok(raw.length<16384);}const body=raw?JSON.parse(raw):{};
   const token=String(req.headers.authorization??'').replace(/^Bearer /i,''),internal=token===serviceKey,authorized=sessions.has(token);
   if(url.pathname!=='/__local/evidence')log.push({transport:req.method,path:url.pathname,internal});
   if(req.method==='GET'&&url.pathname==='/__local/manifest'){send(200,clock838?{runId,actor,club,tour:clockTour838,email,singleTour:clockTour838,model:'LOCAL838_EXISTING_IMPORTED_TOUR_BLINDS_CLOCK_REAL_PG_AUTH_HTTP_MODELED'}:{runId,actor,club,tour:fixture.tour,email,dealerPhone:true,model:'LOCAL817_EXACT814_CLONE_AUTH_POSTGREST_MODELED_REAL_SDK_HTTP_HANDLER_RPC_NO_EXTERNAL_NOTIFY'});return;}
   if(req.method==='GET'&&url.pathname==='/__local/evidence'){send(200,{runId,fixture,swing831Key,scheduleKey835,log});return;}
   if(req.method==='POST'&&url.pathname==='/auth/v1/token'){
    if(url.searchParams.get('grant_type')==='password'&&body.email===email&&body.password===password){send(200,session());return;}
    if(url.searchParams.get('grant_type')==='refresh_token'&&[...sessions.values()].some(s=>s.refresh_token===body.refresh_token)){send(200,session());return;}
    send(400,{error:'invalid_grant',error_description:'LOCAL TEST account only'});return;
   }
   if(!internal&&!authorized){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
   if(!internal&&url.pathname==='/auth/v1/user'&&req.method==='GET'){send(200,user);return;}
   if(!internal&&url.pathname==='/auth/v1/logout'&&req.method==='POST'){sessions.delete(token);send(204);return;}
   if(!internal&&url.pathname==='/__local/drop-next'&&req.method==='POST'){dropCore=true;send(200,{armed:true,point:'core_response_after_SQL_COMMIT'});return;}
   if(!internal&&url.pathname==='/__local/feature819'&&req.method==='POST'){
    assert.deepEqual(Object.keys(body),['mode']);assert.ok(['normal','503','hold','malformed'].includes(body.mode));
    feature819Mode=body.mode;log.push({feature819_control:feature819Mode,database_mutation:false});
    if(feature819Mode==='normal')for(const held of [...heldFlags]){
     if(!held.res.destroyed){held.res.writeHead(200);held.res.end(JSON.stringify(held.value));}
     heldFlags.delete(held);
    }
    send(200,{mode:feature819Mode,database_mutation:false});return;
   }
   if(internal){
    assert.equal(req.headers['x-vinpoker-dealer-intent'],'manual');assert.equal(req.headers['x-vinpoker-dealer-actor'],actor);
    const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/)?.[1];
    if(req.method==='POST'&&rpc){
     const value=rpcService(rpc,body);
     if(rpc==='operator_checkout_dealer_attendance_v1'&&value.success===true&&dropCore){dropCore=false;log.push({fault:'CORE_SUCCESS_RESPONSE_LOST_AFTER_COMMIT',attendance:fixture.attendance});send(503,{message:'LOCAL817_CORE_RESPONSE_LOST_AFTER_COMMIT'});return;}
     send(200,value);return;
    }
    if(req.method==='GET'&&url.pathname==='/rest/v1/dealer_attendance'){
     let value;
     if(url.searchParams.get('select')?.replace(/\s/g,'')==='id,dealer_id,dealers!inner(club_id)'){
      assert.equal(url.searchParams.get('id'),`in.(${fixture.attendance})`);
      value=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',a.id,'dealer_id',a.dealer_id,'dealers',jsonb_build_object('club_id',d.club_id))) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id='${fixture.attendance}';`));
     }else{
      assert.equal(url.searchParams.get('id'),`eq.${fixture.attendance}`);assert.equal(url.searchParams.get('select')?.replace(/\s/g,''),'id,dealer_id');
      value=JSON.parse(sql(`SELECT jsonb_build_object('id',id,'dealer_id',dealer_id) FROM public.dealer_attendance WHERE id='${fixture.attendance}';`));
     }
     send(200,value);return;
    }
    if(req.method==='GET'&&url.pathname==='/rest/v1/dealers'){
     assert.equal(url.searchParams.get('id'),`eq.${fixture.dealer}`);
     send(200,JSON.parse(sql(`SELECT jsonb_build_object('id',id,'full_name',full_name,'club_id',club_id,'telegram_username',telegram_username,'telegram_user_id',telegram_user_id) FROM public.dealers WHERE id='${fixture.dealer}';`)));return;
    }
    if(req.method==='GET'&&url.pathname==='/rest/v1/club_settings'){
     assert.equal(url.searchParams.get('club_id'),`eq.${club}`);send(200,JSON.parse(sql(`SELECT jsonb_build_object('floor_manager_chat_id',floor_manager_chat_id) FROM public.club_settings WHERE club_id='${club}';`)||'null'));return;
    }
    send(403,{message:'LOCAL817_SERVICE_ENDPOINT_DENIED'});return;
   }
   if(req.method==='POST'&&url.pathname==='/functions/v1/checkout-dealer'){
    if(body.mode!==undefined||Object.keys(body).some(k=>k!=='attendance_id')||body.attendance_id!==fixture.attendance){send(403,{message:'LOCAL817_EXACT_ATTENDANCE_ONLY'});return;}
    const response=await handler(new Request(api+url.pathname,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}));
    const value=await response.json();log.push({edge:'checkout-dealer',status:response.status,result:value});send(response.status,value);return;
   }
   if(req.method==='GET'&&url.pathname==='/rest/v1/user_roles'){
    assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);assert.equal(url.searchParams.get('select'),'role');
    send(200,query(`SELECT coalesce(jsonb_agg(jsonb_build_object('role',role)),'[]') FROM public.user_roles WHERE user_id='${actor}';`));return;
   }
   if(req.method==='GET'&&url.pathname==='/rest/v1/clubs'){
    assert.equal(url.searchParams.get('owner_id'),`eq.${actor}`);assert.equal(url.searchParams.get('select'),'id');
    send(200,query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='${actor}' LIMIT 1)c;`));return;
   }
   if(req.method==='GET'&&url.pathname==='/rest/v1/dealers'&&url.searchParams.has('user_id')){
    assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);assert.equal(url.searchParams.get('select'),'id');
    send(200,query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM(SELECT id FROM public.dealers WHERE user_id='${actor}' AND deleted_at IS NULL LIMIT 1)d;`));return;
   }
   const membership833=url.pathname.match(/^\/rest\/v1\/(club_accountants|club_chip_masters|club_fnb_staff|club_marketers)$/)?.[1];
   if(req.method==='GET'&&membership833){
    assert.deepEqual([...url.searchParams.keys()].sort(),['limit','select','user_id']);
    assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);
    assert.equal(url.searchParams.get('select'),'club_id');assert.equal(url.searchParams.get('limit'),'1');
    const value=query(`SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(SELECT club_id FROM public.${membership833} WHERE user_id='${actor}' ORDER BY club_id LIMIT 1)x;`);
    log.push({auth833_membership:membership833,rows:value.length,native_authenticated_read:true});send(200,value);return;
   }
   if(req.method==='PATCH'&&url.pathname==='/rest/v1/profiles'){
    assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);assert.deepEqual(body,{onesignal_external_user_id:actor});
    log.push({auth833_side_effect:'NOTIFICATION_PROFILE_WRITE_HELD',database_mutation:false});
    send(403,{message:'LOCAL_NOTIFICATION_PROFILE_WRITE_HELD'});return;
   }
   if(req.method==='GET'&&url.pathname==='/rest/v1/app_settings'){
    assert.equal(url.searchParams.get('key'),'eq.dealer_feature_tables_enabled');assert.equal(url.searchParams.get('select'),'value');
    const value=query("SELECT coalesce((SELECT jsonb_build_object('value',value) FROM public.app_settings WHERE key='dealer_feature_tables_enabled'),'null'::jsonb);");
    log.push({feature819_read:feature819Mode,native_missing_row:value===null,database_mutation:false});
    if(feature819Mode==='503'){send(503,{message:'LOCAL819_READ_UNAVAILABLE'});return;}
    if(feature819Mode==='malformed'){send(200,{value:'true'});return;}
    if(feature819Mode==='hold'){
     const held={res,value};heldFlags.add(held);res.once('close',()=>{heldFlags.delete(held);log.push({feature819_held_closed:true,database_mutation:false});});return;
    }
    send(200,value);return;
   }
   if(feature826&&req.method==='POST'&&['/rest/v1/rpc/save_table_dealer_profile_v2','/rest/v1/rpc/cancel_table_dealer_profile_v2'].includes(url.pathname)){
    assert.deepEqual(Object.keys(body).sort(),['p_allow_override','p_club_id','p_expected_actor','p_is_final','p_members','p_request_id','p_table_id','p_table_mode']);
    assert.equal(body.p_expected_actor,actor);assert.equal(body.p_club_id,club);assert.equal(body.p_table_id,profileTable823);
    assert.equal(body.p_table_mode,'normal');assert.equal(body.p_is_final,false);assert.equal(body.p_allow_override,true);assert.deepEqual(body.p_members,[]);
    assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    if(profileKey823!==null)assert.equal(body.p_request_id,profileKey823,'826 pending canary key changed');
    profileKey823=body.p_request_id;
    const cancel=url.pathname.includes('/cancel_');
    if(!cancel&&dropProfile823){dropProfile823=false;log.push({feature826_not_forwarded:true,request_id:profileKey823,payload:body});send(503,{message:'LOCAL826_WRITE_NOT_FORWARDED_OUTCOME_UNKNOWN_TO_UI'});return;}
    const name=cancel?'cancel_table_dealer_profile_v2':'save_table_dealer_profile_v2';
    const value=query(`SELECT public.${name}('${club}','${profileTable823}','normal',false,true,'[]'::jsonb,${quote(profileKey823)}::uuid,'${actor}');`);
    log.push({feature826_rpc:name,request_id:profileKey823,result:value});send(200,value);return;
   }
   if(feature826&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_table_dealer_profile_receipt_v2'){
    assert.deepEqual(Object.keys(body).sort(),['p_club_id','p_expected_actor','p_request_id']);assert.equal(body.p_club_id,club);assert.equal(body.p_expected_actor,actor);
    assert.equal(body.p_request_id,profileKey823);
    const value=query(`SELECT public.get_table_dealer_profile_receipt_v2('${club}',${quote(body.p_request_id)}::uuid,'${actor}');`);
    log.push({feature826_read:true,request_id:profileKey823,result:value});send(200,value);return;
   }
   if(feature823&&!feature826&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/save_table_dealer_profile_v1'){
    assert.deepEqual(Object.keys(body).sort(),['p_allow_override','p_club_id','p_is_final','p_members','p_request_id','p_table_id','p_table_mode']);
    assert.equal(body.p_club_id,club);assert.equal(body.p_table_id,profileTable823);assert.equal(body.p_table_mode,'normal');
    assert.equal(body.p_is_final,false);assert.equal(body.p_allow_override,true);assert.deepEqual(body.p_members,[]);
    assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    if(profileKey823!==null)assert.equal(body.p_request_id,profileKey823,'no fresh request after consumed823 canary');
    const value=query(`SELECT public.save_table_dealer_profile_v1('${club}','${profileTable823}','normal',false,true,'[]'::jsonb,${quote(body.p_request_id)}::uuid);`);
    profileKey823=body.p_request_id;log.push({feature823_write:true,request_id:profileKey823,result:value});
    if(dropProfile823){dropProfile823=false;log.push({feature823_fault:'PROFILE_COMMIT_RESPONSE_LOST',request_id:profileKey823});send(503,{message:'LOCAL823_RESPONSE_LOST_AFTER_COMMIT'});return;}
    send(200,value);return;
   }
   if(feature823&&!feature826&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_table_dealer_profile_receipt_v1'){
    assert.deepEqual(Object.keys(body).sort(),['p_club_id','p_request_id']);assert.equal(body.p_club_id,club);assert.equal(body.p_request_id,profileKey823);
    const value=query(`SELECT public.get_table_dealer_profile_receipt_v1('${club}',${quote(body.p_request_id)}::uuid);`);
    log.push({feature823_read:true,request_id:profileKey823,result:value});send(200,value);return;
   }
   if(swing831&&req.method==='POST'&&['operator_perform_swing_v2','get_dealer_manual_swing_receipt_v1','cancel_dealer_manual_swing_v1'].some(name=>url.pathname==='/rest/v1/rpc/'+name)){
    assert.deepEqual(Object.keys(body).sort(),[...Object.keys(swing831Context),'p_request_id'].sort());
    for(const [key,value] of Object.entries(swing831Context))assert.equal(body[key],value);
    assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    if(swing831Key!==null)assert.equal(body.p_request_id,swing831Key,'831 no new key after consumed canary');
    const name=url.pathname.split('/').at(-1),args=[...Object.values(swing831Context),body.p_request_id].map(v=>typeof v==='number'?v:quote(v)+'::uuid').join(',');
    if(name==='operator_perform_swing_v2'&&swing831Key===null){
     const value=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='8s';
      CREATE FUNCTION pg_temp.swing831_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
       IF NEW.table_id='${swing831Context.p_table_id}' THEN RAISE EXCEPTION 'SWING831_INJECTED_ACQUISITION_FAILURE';END IF;RETURN NEW;END $$;
      CREATE TRIGGER swing831_fault BEFORE INSERT ON public.dealer_assignments FOR EACH ROW EXECUTE FUNCTION pg_temp.swing831_fault();
      ${authUsage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
      SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
      SELECT public.operator_perform_swing_v2(${args});RESET ROLE;
      DROP TRIGGER swing831_fault ON public.dealer_assignments;
      ${authUsage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
     assert.equal(value.outcome,'error');assert.equal(value.detail,'SWING831_INJECTED_ACQUISITION_FAILURE');
     assert.equal(swing831Facts(),swing831Before,'831 failed handoff changed business facts');
     swing831Key=body.p_request_id;log.push({swing831_rpc:name,request_id:swing831Key,result:value,response_lost_after_commit:true});
     send(503,{message:'LOCAL831_ERROR_RECEIPT_COMMIT_RESPONSE_LOST'});return;
    }
    assert.equal(body.p_request_id,swing831Key);
    const value=query(`SELECT public.${name}(${args});`);
    log.push({swing831_rpc:name,request_id:swing831Key,result:value});send(200,value);return;
   }
   if(clock838&&req.method==='GET'&&url.pathname==='/rest/v1/tournament_levels'){
    assert.equal(url.searchParams.get('tournament_id'),`eq.${clockTour838}`);
    assert.equal(url.searchParams.get('select')?.replaceAll(' ',''),'level_number,small_blind,big_blind,ante,duration_minutes,is_break');
    const value=query(`SELECT coalesce(jsonb_agg(x ORDER BY level_number),'[]'::jsonb) FROM(SELECT level_number,small_blind,big_blind,ante,duration_minutes,is_break FROM public.tournament_levels WHERE tournament_id='${clockTour838}')x;`);
    send(200,value);return;
   }
   if(clock838&&req.method==='GET'&&url.pathname==='/rest/v1/blind_structure_templates'){
    assert.equal(url.searchParams.get('club_id'),`eq.${club}`);assert.equal(url.searchParams.get('select')?.replaceAll(' ',''),'id,club_id,name,levels');
    send(200,query(`SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(SELECT id,club_id,name,levels FROM public.blind_structure_templates WHERE club_id='${club}' ORDER BY name)x;`));return;
   }
   if(clock838&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/update_blind_structure'){
    assert.deepEqual(Object.keys(body).sort(),['p_levels','p_tournament_id']);assert.equal(body.p_tournament_id,clockTour838);
    assert.deepEqual(body.p_levels,[{level_number:1,small_blind:100,big_blind:200,ante:0,duration_minutes:20,is_break:false}]);
    assert.equal(sql(`SELECT count(*) FROM public.tournament_levels WHERE tournament_id='${clockTour838}';`),'0','838 one approved initial structure write, no replay-as-reset');
    const value=query(`SELECT public.update_blind_structure('${clockTour838}',${quote(JSON.stringify(body.p_levels))}::jsonb);`);
    log.push({clock838_blinds:true,tour:clockTour838,result:value});send(200,value);return;
   }
   if(clock838&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_tournament_clock'){
    assert.deepEqual(body,{p_tournament_id:clockTour838});send(200,query(`SELECT public.get_tournament_clock('${clockTour838}');`));return;
   }
   if(clock838&&req.method==='POST'&&url.pathname==='/functions/v1/tournament-live-clock'){
    assert.equal(body.tournament_id,clockTour838);assert.ok(['start','pause','resume'].includes(body.action));
    const response=await runClockBrowserEdge({body,fixture:{tour:clockTour838,club},user,query,log});const value=await response.json();
    log.push({clock838_action:body.action,status:response.status,result:value});send(response.status,value);return;
   }
   if(schedule835&&req.method==='POST'&&url.pathname==='/functions/v1/parse-tournament-schedule'){
    assert.deepEqual(Object.keys(body).sort(),['image_base64','image_mime']);assert.equal(body.image_mime,'image/png');assert.equal(body.image_base64,scheduleImage835);
    log.push({schedule835_provider:'FIXED_TEST_ROWS_NO_EXTERNAL_OCR',rows:2});
    send(200,{tournaments:scheduleFixture835.manifest.rows.map(({club_id:_,location,...row})=>({...row,venue:location}))});return;
   }
   if(schedule835&&req.method==='POST'&&['create_tournament_schedule_batch_v1','get_tournament_schedule_batch_receipt_v1','cancel_tournament_schedule_batch_v1'].some(name=>url.pathname==='/rest/v1/rpc/'+name)){
    assert.deepEqual(Object.keys(body).sort(),['p_expected_actor_id','p_request_id','p_rows']);assert.equal(body.p_expected_actor_id,actor);
    assert.deepEqual(body.p_rows,scheduleFixture835.manifest.rows);assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    if(scheduleKey835!==null)assert.equal(body.p_request_id,scheduleKey835,'835 no new request after consumed batch');
    const name=url.pathname.split('/').at(-1),encoded=quote(JSON.stringify(body.p_rows))+'::jsonb';
    if(schedule836&&name==='create_tournament_schedule_batch_v1'){
     if(scheduleKey835===null){
      sql(`UPDATE private.${scheduleTable835} SET request_id=${quote(body.p_request_id)}::uuid WHERE id AND request_id IS NULL;`);
      scheduleKey835=body.p_request_id;holdScheduleRead835=true;
     }
     log.push({schedule836_not_forwarded:true,request_id:scheduleKey835});send(503,{message:'LOCAL836_BATCH_NOT_FORWARDED_OUTCOME_UNKNOWN_TO_UI'});return;
    }
    if(name==='create_tournament_schedule_batch_v1'&&scheduleKey835===null){
     const value=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';CREATE TEMP TABLE schedule835_result(value jsonb) ON COMMIT DROP;GRANT INSERT,SELECT ON schedule835_result TO authenticated;
      ${authUsage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
      SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
      INSERT INTO schedule835_result SELECT public.create_tournament_schedule_batch_v1(${encoded},${quote(body.p_request_id)}::uuid,'${actor}');RESET ROLE;
      DO $$ BEGIN ASSERT (SELECT value->>'ok'='true' AND value->>'count'='2' FROM schedule835_result);END $$;
      UPDATE private.schedule835_fixture SET request_id=${quote(body.p_request_id)}::uuid,result=(SELECT value FROM schedule835_result) WHERE id AND request_id IS NULL;
      SELECT value FROM schedule835_result;${authUsage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
     scheduleKey835=body.p_request_id;holdScheduleRead835=true;log.push({schedule835_rpc:name,request_id:scheduleKey835,result:value,response_lost_after_commit:true});
     send(503,{message:'LOCAL835_BATCH_RESPONSE_LOST_AFTER_COMMIT'});return;
    }
    assert.equal(body.p_request_id,scheduleKey835);
    if(holdScheduleRead835&&name==='get_tournament_schedule_batch_receipt_v1'){holdScheduleRead835=false;log.push({schedule835_rpc:name,request_id:scheduleKey835,read_outage_once:true});send(503,{message:'LOCAL835_FIRST_RECEIPT_READ_UNAVAILABLE'});return;}
    const value=query(`SELECT public.${name}(${encoded},${quote(body.p_request_id)}::uuid,'${actor}');`);
    if(schedule836&&name==='cancel_tournament_schedule_batch_v1'){
     assert.equal(value.outcome,'cancelled');
     sql(`UPDATE private.${scheduleTable835} SET result=${quote(JSON.stringify(value))}::jsonb WHERE id AND request_id=${quote(scheduleKey835)}::uuid AND result IS NULL;`);
    }
    log.push({schedule835_rpc:name,request_id:scheduleKey835,result:value});send(200,value);return;
   }
   const read=reads(req.method,url,body);
   if(read.matched){send(200,req.headers.accept?.includes('vnd.pgrst.object')&&Array.isArray(read.value)?read.value[0]??null:read.value);return;}
   log.push({unavailable: true,path:url.pathname});send(['GET','HEAD'].includes(req.method)?404:403,{message:'LOCAL817_ENDPOINT_NOT_CONNECTED'});
  }catch(error){log.push({rejected:true,name:error?.name??'unknown',detail:String(error?.message??'unknown').slice(0,250)});send(400,{message:'LOCAL817_REQUEST_REJECTED'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});
 try{
  const anonymous=createClient(api,'LOCAL_TEST_ANON',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const denied=await anonymous.functions.invoke('checkout-dealer',{body:{attendance_id:fixture.attendance}});assert.ok(denied.error);
  const owner=createClient(api,'LOCAL_TEST_ANON',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  assert.equal((await owner.auth.signInWithPassword({email,password})).error,null);
  assert.ok((await owner.rpc('operator_checkout_dealer_attendance_v1',{p_actor_id:actor,p_attendance_id:fixture.attendance})).error);
  assert.ok((await owner.functions.invoke('checkout-dealer',{body:{attendance_id:root.attendance}})).error);
  for(const table of ['club_accountants','club_chip_masters','club_fnb_staff','club_marketers']){
   const result=await owner.from(table).select('club_id').eq('user_id',actor).limit(1);
   assert.equal(result.error,null,`833 native membership read ${table}`);
   assert.deepEqual(result.data,query(`SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(SELECT club_id FROM public.${table} WHERE user_id='${actor}' ORDER BY club_id LIMIT 1)x;`));
  }
  assert.ok((await owner.from('club_accountants').select('club_id').eq('user_id',root.close815.dealer).limit(1)).error,'833 foreign actor filter must be denied');
  assert.equal(facts(),before);
  console.log('CHECKOUT817_BROWSER_READY_REAL_SDK_HTTP_DENIALS_NO_DELTA',JSON.stringify({runId,actor,club,attendance:fixture.attendance}));
  await new Promise(resolve=>process.stdin.once('data',()=>{process.stdin.pause();server.close(resolve);server.closeAllConnections();}));
 }finally{
  server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
  assert.equal(facts(),before,'browser changed protected chip/cash/hand/tour facts');
  if(clock838)assert.equal(sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'null')) FROM public.tournaments t WHERE id<>'${clockTour838}';`),sql('SELECT other_tours_hash FROM private.schedule838_fixture WHERE id;'),'838 changed another tournament');
  if(clock838)assert.equal(sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'null')) FROM public.tournament_levels x WHERE tournament_id<>'${clockTour838}';`),otherLevels838,'838 changed another tournament blind structure');
  if(schedule835){
   assert.equal(sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'null')) FROM public.tournaments t WHERE id NOT IN(SELECT (child->>'tournament_id')::uuid FROM private.${scheduleTable835} f CROSS JOIN jsonb_array_elements(coalesce(f.result->'tournaments','[]')) child);`),scheduleFixture835.tours_before,'schedule changed pre-existing tournaments');
  }
  if(swing831)assert.equal(swing831Facts(),swing831Before,'831 terminal error browser changed staffing facts');
  if(feature823)assert.equal(configFacts823(),configBefore823,'823 changed another table configuration/audit');
  console.log('CHECKOUT817_PROTECTED_FINANCIAL_HAND_TOUR_FACTS_UNCHANGED',JSON.stringify({runId,requests:log.length,
   coreCalls:log.filter(x=>x.service_rpc==='operator_checkout_dealer_attendance_v1').length,
   featureReads:log.filter(x=>x.feature819_read).length}));
 }
}
