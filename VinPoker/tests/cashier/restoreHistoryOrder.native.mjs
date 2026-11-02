import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
import {closeCanonicalFinishedField} from './officialCloseJourney.native.mjs';

assert.equal(process.env.VINPOKER_NATIVE_RESTORE_HISTORY,'1');
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}))assert.equal(process.env[k],v);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql']:[];
const sql=q=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const f=createPaidJourneyFixture(sql);
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
// A second paid entrant makes later explicit finalization a genuine
// one-survivor result, not a fabricated finished_place or payout fixture.
sql(`BEGIN;DO $$ DECLARE p uuid:=gen_random_uuid();r jsonb;reg uuid;BEGIN
 INSERT INTO auth.users(id) VALUES(p);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1('${f.tour}',p);IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'history_restore_registration_failed: %',r;END IF;reg:=(r->>'registration_id')::uuid;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id','${f.actor}','club_id','${f.club}','tournament_id','${f.tour}','registration_id',reg,'amount',100000,'request_id',gen_random_uuid()),'record');
 IF r->>'status' IS DISTINCT FROM 'recorded' OR r->'result'->>'seating_state' IS DISTINCT FROM 'seated' THEN RAISE EXCEPTION 'history_restore_second_payment_failed: %',r;END IF;
END $$;COMMIT;`);
const state=()=>JSON.parse(sql(`SELECT jsonb_build_object('entry',to_jsonb(e),'seat',to_jsonb(p),'session',to_jsonb(s)) FROM public.tournament_entries e
 JOIN public.tournament_seats p ON p.entry_id=e.id AND p.is_active JOIN public.table_sessions s ON s.id=p.table_session_id WHERE e.id='${f.entry}';`));
const cash=()=>sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}';`),cashBefore=cash();
const settings=sql(`SELECT player_history_enabled FROM public.club_settings WHERE club_id='${f.club}';`);assert.ok(['','t','f'].includes(settings));
sql(`INSERT INTO public.club_settings(club_id,player_history_enabled) VALUES('${f.club}',true) ON CONFLICT(club_id) DO UPDATE SET player_history_enabled=true;`);
try{
 const before=state(),bustKey=crypto.randomUUID();
 const bust=()=>call(`SELECT public.floor_bust_player_v3('${f.entry}',${before.session.revision},${before.session.control_epoch},20000,'${bustKey}','TEST mistaken bust history order');`);
 const busted=bust();assert.equal(busted.ok,true);assert.deepEqual(bust(),busted);
 const firstOrder=Number(sql(`SELECT bust_order FROM public.tournament_entries WHERE id='${f.entry}';`));assert.ok(firstOrder>0);
 const revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${before.session.id}';`),restoreKey=crypto.randomUUID();
 const bustedState=()=>sql(`SELECT md5(jsonb_build_object('entry',(SELECT to_jsonb(e) FROM public.tournament_entries e WHERE id='${f.entry}'),
  'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${before.session.id}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'))::text);`),beforeRejected=bustedState();
 const outsider=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.player}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.player}"}';SET LOCAL ROLE authenticated;
  SELECT public.floor_restore_busted_player_to_seat_v5('${f.entry}','${before.seat.tournament_table_id}',${before.seat.seat_number},${revision},${before.session.control_epoch},'${crypto.randomUUID()}','${before.session.id}');COMMIT;`));
 assert.equal(outsider.error,'actor_not_allowed');assert.equal(bustedState(),beforeRejected);
 const stale=call(`SELECT public.floor_restore_busted_player_to_seat_v5('${f.entry}','${before.seat.tournament_table_id}',${before.seat.seat_number},${Number(revision)+1},${before.session.control_epoch},'${crypto.randomUUID()}','${before.session.id}');`);
 assert.equal(stale.error,'STALE_STATE');assert.equal(bustedState(),beforeRejected);
 const restore=seat=>call(`SELECT public.floor_restore_busted_player_to_seat_v5('${f.entry}','${before.seat.tournament_table_id}',${seat},${revision},${before.session.control_epoch},'${restoreKey}','${before.session.id}');`);
 const restored=restore(before.seat.seat_number);assert.equal(restored.ok,true);assert.deepEqual(restore(before.seat.seat_number),restored);
 const after=state();assert.equal(after.entry.bust_order,null,'mistaken bust order must not survive canonical restore');
 assert.equal(after.entry.finished_place,null);assert.equal(after.entry.current_stack,20000);assert.equal(after.seat.chip_count,20000);
 assert.equal(restore(before.seat.seat_number===1?2:1).error,'IDEMPOTENCY_CONFLICT');
 const nextBust=call(`SELECT public.floor_bust_player_v3('${f.entry}',${after.session.revision},${after.session.control_epoch},20000,'${crypto.randomUUID()}','TEST later genuine bust after restore');`);
 assert.equal(nextBust.ok,true);
 const secondOrder=Number(sql(`SELECT bust_order FROM public.tournament_entries WHERE id='${f.entry}';`));assert.ok(secondOrder>firstOrder,'later bust needs a new monotonic order; never decrement tournament sequence');
 const legacyDirect=sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`)==='t';
 if(legacyDirect){
  const finalized=call(`SELECT public.finalize_tournament_results('${f.tour}');`);assert.equal(finalized.ok,true);assert.equal(finalized.survivors,1);
 }else closeCanonicalFinishedField(sql,f);
 assert.equal(sql(`SELECT finished_place FROM public.tournament_entries WHERE id='${f.entry}';`),'2');
 const finalState=()=>sql(`SELECT md5(jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
 'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE tournament_id='${f.tour}'))::text);`),beforeDenied=finalState();
 const lastRevision=sql(`SELECT revision FROM public.table_sessions WHERE id='${before.session.id}';`);
 const denied=call(`SELECT public.floor_restore_busted_player_to_seat_v5('${f.entry}','${before.seat.tournament_table_id}',${before.seat.seat_number},${lastRevision},${before.session.control_epoch},'${crypto.randomUUID()}','${before.session.id}');`);
 assert.equal(sql(`SELECT status FROM public.tournaments WHERE id='${f.tour}';`),legacyDirect?'active':'completed');
 assert.equal(denied.error,legacyDirect?'restore_result_dependency':'tournament_not_open');
 assert.equal(finalState(),beforeDenied,'official results cannot be silently cleared by restore');
 assert.equal(cash(),cashBefore);
 console.log('NATIVE_PAID_RESTORE_CLEARS_PROVISIONAL_BUST_ORDER_AND_REBUST_ADVANCES_PASS',JSON.stringify({club:f.club,tournament:f.tour,entry:f.entry,firstOrder,secondOrder}));
}finally{
 if(settings==='')sql(`DELETE FROM public.club_settings WHERE club_id='${f.club}';`);
 else sql(`UPDATE public.club_settings SET player_history_enabled=${settings==='t'?'true':'false'} WHERE club_id='${f.club}';`);
 assert.equal(sql(`SELECT player_history_enabled FROM public.club_settings WHERE club_id='${f.club}';`),settings);
}
