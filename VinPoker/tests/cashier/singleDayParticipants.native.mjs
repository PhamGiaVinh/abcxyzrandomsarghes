import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runRegisterBrowserEdge} from './registerBrowserEdge.local.mjs';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {authorizeInternalTrigger,authorizeSwingWorkerRequest,getIdempotencyKey,parseDealerReadyPayload} from '../../supabase/functions/_shared/internal-trigger-auth.ts';

// Completes the SAME local browser tour through real registration Edge code
// and canonical paid intents. Auth/provider transport is modeled, not hosted.
export async function runSingleDayParticipantsNative(sql,configured=null) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const fixture=configured?{tour:configured.tour,club:configured.club}:{tour:'b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f',club:'9ef80c7a-cb97-4acc-b81c-5bf34d49317f'};
 const actor=configured?.actor??'065801a0-565e-4bd6-9c2d-ee252b7e6494';
 if(configured){
  assert.deepEqual(configured,{tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5'});
  assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id JOIN public.club_settings s ON s.club_id=c.id
    WHERE t.id='${fixture.tour}' AND c.owner_id='${actor}' AND s.player_history_enabled AND t.itm_places=3;`),'1');
 }
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port();"),'127.0.0.1|55441');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${fixture.tour}' AND club_id='${fixture.club}'
  AND name='Single-day browser local TEST' AND event_id IS NULL AND deleted_at IS NULL;`),'1');
 const key=(purpose,n)=>{
  const h=createHash('sha256').update(`${fixture.tour}:${purpose}:${n}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
 };
 const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const issuance=()=>sql(`SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY to_jsonb(i)::text)::text,'[]') FROM public.stack_template_issuance i
  JOIN public.stack_template t ON t.id=i.stack_template_id WHERE t.tournament_id='${fixture.tour}';`);
 const beforeIssuance=issuance(),log=[],participants=[];
 const priorEnv=process.env.VINPOKER_NATIVE_BROWSER;process.env.VINPOKER_NATIVE_BROWSER='1';
 try {
  for(let n=2;n<=8;n++) {
   const player=key('player',n),request=key('paid-intent',n),name=`Single-day ${fixture.tour.slice(0,8)} TEST ${n}`;
   // Explicit synthetic Auth/profile fixture only. No registration, paid marker,
   // entry, seat or stack is seeded here.
   sql(`BEGIN;DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM auth.users WHERE id='${player}') AND NOT EXISTS(
      SELECT 1 FROM public.profiles WHERE user_id='${player}' AND display_name='${name}') THEN
      RAISE EXCEPTION 'synthetic_player_identity_collision';END IF;
    INSERT INTO auth.users(id) VALUES('${player}') ON CONFLICT(id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id='${player}') THEN
     INSERT INTO public.profiles(user_id,display_name) VALUES('${player}','${name}');END IF;
   END $$;COMMIT;`);
   const response=await runRegisterBrowserEdge({body:{tournament_id:fixture.tour},fixture,user:{id:player},sql,log});
   const registration=await response.json();assert.equal(response.status,200,JSON.stringify(registration));
   assert.equal(registration.success,true);assert.match(registration.registration_id,/^[a-f0-9-]{36}$/);
   const intent={actor_id:actor,club_id:fixture.club,tournament_id:fixture.tour,
    registration_id:registration.registration_id,amount:100000,request_id:request};
   const result=JSON.parse(sql(`BEGIN;${claims}SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(intent)}'::jsonb,'record');COMMIT;`));
   assert.equal(result.status,'recorded',JSON.stringify(result));assert.equal(result.result.seating_state,'seated');
   const replay=JSON.parse(sql(`BEGIN;${claims}SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(intent)}'::jsonb,'record');COMMIT;`));
   assert.deepEqual(replay,result);
   participants.push({player,registration:registration.registration_id,request,entry:result.result.entry_id});
  }
 } finally {
  if(priorEnv===undefined)delete process.env.VINPOKER_NATIVE_BROWSER;else process.env.VINPOKER_NATIVE_BROWSER=priorEnv;
 }
 if(configured){
  // Cashier may legitimately fill one table first. Balance through Floor's
  // canonical move RPC, never by rewriting entry/seat projection rows.
  for(let n=0;n<4;n++){
   const tables=JSON.parse(sql(`SELECT jsonb_agg(x) FROM(SELECT t.id,t.table_session_id,s.revision,s.control_epoch,
    (SELECT count(*) FROM public.tournament_seats p WHERE p.tournament_table_id=t.id AND p.is_active) players
    FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
    WHERE t.tournament_id='${fixture.tour}' AND t.status='active' AND s.closed_at IS NULL)x;`));
   assert.equal(tables.length,2);if(tables.every(t=>t.players===4))break;
   const source=tables.find(t=>t.players>4),target=tables.find(t=>t.players<4);assert.ok(source&&target);
   const entry=sql(`SELECT entry_id FROM public.tournament_seats WHERE tournament_table_id='${source.id}' AND is_active ORDER BY seat_number DESC LIMIT 1;`);
   const seat=sql(`SELECT n FROM generate_series(1,9)n WHERE NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_table_id='${target.id}' AND is_active AND seat_number=n) ORDER BY n LIMIT 1;`);
   const moved=JSON.parse(sql(`BEGIN;${claims}SELECT public.move_player_seat_v4('${entry}','${source.id}','${source.table_session_id}',
    '${target.id}','${target.table_session_id}',${seat},${source.revision},${target.revision},${source.control_epoch},${target.control_epoch},'${key('balance',n)}');COMMIT;`));
   assert.equal(moved.ok,true,JSON.stringify(moved));
  }
 }
 const facts=JSON.parse(sql(`BEGIN;${claims}SELECT jsonb_build_object(
  'counts',public.get_tournament_participation_v1('${fixture.tour}')->'counts',
  'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${fixture.tour}'),
  'received',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${fixture.tour}'),
  'tables',(SELECT jsonb_agg(x) FROM(SELECT s.tournament_table_id,count(*) seats,sum(s.chip_count) stack FROM public.tournament_seats s
    WHERE s.tournament_id='${fixture.tour}' AND s.is_active GROUP BY s.tournament_table_id ORDER BY s.tournament_table_id)x));ROLLBACK;`));
 assert.equal(facts.counts.seated,8);assert.equal(facts.counts.total_entries,8);
 assert.equal(facts.counts.anomaly_seats,0);assert.equal(facts.counts.anomaly_entries,0);
 assert.equal(facts.counts.seated_stack,160000);assert.equal(facts.received,800000);assert.equal(facts.movements,8);
 assert.equal(facts.tables.length,2);assert.ok(facts.tables.every(t=>t.seats===4&&t.stack===80000));
 assert.equal(issuance(),beforeIssuance,'paid seating does not issue additional denomination inventory');
 console.log('SAME_SINGLE_DAY_CANONICAL_EIGHT_PAID_PARTICIPANTS_PASS',JSON.stringify({fixture,participants,facts,log}));
 return {fixture,participants,facts};
}

export function runSingleDayDealerCheckinsNative(sql,configured=null) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port();"),'127.0.0.1|55441');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 if(configured)assert.deepEqual(configured,{tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5'});
 const tour=configured?.tour??'b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f',club=configured?.club??'9ef80c7a-cb97-4acc-b81c-5bf34d49317f',actor=configured?.actor??'065801a0-565e-4bd6-9c2d-ee252b7e6494';
 const label=`Single-day ${tour.slice(0,8)} TEST`;
 assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${tour}' AND club_id='${club}' AND name='Single-day browser local TEST';`),'1');
 const key=(kind,n)=>{const h=createHash('sha256').update(`${tour}:${kind}:${n}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
 const shift=key('dealer-shift',1),rows=[];
 const unchanged=()=>sql(`SELECT jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${club}'),
  'settings',(SELECT jsonb_agg(to_jsonb(s)) FROM public.club_settings s WHERE club_id='${club}'),
  'money',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${tour}'))::text;`);
 const before=unchanged();
 sql(`BEGIN;DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.dealer_shifts WHERE id='${shift}' AND (club_id<>'${club}' OR tour_name<>'${label}')) THEN RAISE EXCEPTION 'dealer_shift_fixture_collision';END IF;
  INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
   VALUES('${shift}','${club}','${label}','00:00','23:59') ON CONFLICT(id) DO NOTHING;
 END $$;COMMIT;`);
 const call=(dealer,request,user=actor)=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${user}';
  SET LOCAL request.jwt.claims='{"sub":"${user}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  SELECT public.operator_check_in_dealer_v1('${dealer}','${club}','${shift}','${request}');COMMIT;`));
 for(let n=1;n<=4;n++) {
  const dealer=key('dealer',n),request=key('dealer-checkin',n),name=`${label} dealer ${n}`;
  sql(`BEGIN;DO $$ BEGIN
   IF EXISTS(SELECT 1 FROM public.dealers WHERE id='${dealer}' AND (club_id<>'${club}' OR full_name<>'${name}' OR user_id IS NOT NULL)) THEN RAISE EXCEPTION 'dealer_fixture_collision';END IF;
   INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealer}','${club}','${name}','active') ON CONFLICT(id) DO NOTHING;
  END $$;COMMIT;`);
  const first=call(dealer,request);assert.equal(first.ok,true,JSON.stringify(first));
  assert.ok(['checked_in','already_checked_in'].includes(first.outcome));
  assert.deepEqual(call(dealer,request),first);
  const denied=call(dealer,key('dealer-denied',n),'50e5437a-9b82-4b60-8f70-dac066deecc9');
  assert.equal(denied.error,'actor_not_allowed');
  const attendance=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(a)) FROM public.dealer_attendance a
   WHERE dealer_id='${dealer}' AND status='checked_in';`));
  assert.equal(attendance.length,1);assert.equal(attendance[0].shift_id,shift);
  assert.equal(attendance[0].current_state,'available');
  rows.push({dealer,request,attendance:attendance[0].id,shiftDate:attendance[0].shift_date});
 }
 assert.equal(unchanged(),before,'check-in does not enable auto, assign tables or alter money');
 console.log('SAME_SINGLE_DAY_FOUR_DEALER_CANONICAL_CHECKIN_REPLAY_ACTOR_PASS',JSON.stringify({tour,club,shift,rows}));
 return rows;
}

export async function verifySingleDayReadyOffNative(sql) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port();"),'127.0.0.1|55441');
 const club='9ef80c7a-cb97-4acc-b81c-5bf34d49317f';
 const settings=JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('auto_swing_enabled',auto_swing_enabled)),'[]') FROM public.club_settings WHERE club_id='${club}';`));
 assert.ok(settings.length<=1);assert.notEqual(settings[0]?.auto_swing_enabled,true,'OFF test never disables a running club');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${club}'),
  'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${club}'))::text);`);
 const before=fingerprint();let reads=0,handler;
 const client={from:table=>{assert.equal(table,'club_settings');const b={select:cols=>{assert.equal(cols,'auto_swing_enabled');return b;},
  eq:(col,value)=>{assert.equal(col,'club_id');assert.equal(value,club);return b;},
  maybeSingle:async()=>{reads++;return {data:settings[0]??null,error:null};}};return b;},
  rpc:()=>{throw Error('OFF must not invoke assignment/ready RPC');}};
 const source=stripTypeScriptTypes(readFileSync('supabase/functions/process-swing-on-dealer-ready/index.ts','utf8')
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
 runInNewContext(source,{Request,Response,Date,console,getIdempotencyKey,parseDealerReadyPayload,
  authorizeInternalTrigger:req=>authorizeInternalTrigger(req,'LOCAL_READY_TEST'),
  authorizeSwingWorkerRequest:req=>authorizeSwingWorkerRequest(req,'LOCAL_WORKER_TEST','LOCAL_READY_TEST'),
  getDealerOperationalTables:()=>{throw Error('OFF must not read operational pool');},createClient:()=>client,
  Deno:{env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_WORKER_TEST'})[k]},serve:fn=>{handler=fn;}}});
 const invoke=token=>handler(new Request('https://test.invalid/ready',{method:'POST',
  headers:{authorization:`Bearer ${token}`,'x-idempotency-key':'single-day-ready-off-test','content-type':'application/json'},
  body:JSON.stringify({club_id:club,attendance_id:'0a68f61a-4b4a-4dcc-b321-ca15d9cb8962'})}));
 const denied=await invoke('INVALID');assert.equal(denied.status,401);assert.equal(reads,0);
 for(let n=0;n<2;n++){const response=await invoke('LOCAL_WORKER_TEST');assert.equal(response.status,200);assert.deepEqual(await response.json(),{skipped:'auto_swing_off'});}
 assert.equal(reads,2);assert.equal(fingerprint(),before);
 console.log('SAME_CLUB_ACTUAL_READY_HANDLER_OFF_REPLAY_NO_ASSIGNMENT_PASS');
}
