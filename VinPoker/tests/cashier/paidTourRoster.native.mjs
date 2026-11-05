import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
import {runPaidTourInitialAssignments} from '../dealerSwing/paidTourInitialAssign.native.mjs';
import {runPaidTourHand,runPaidTourShowdown} from '../trackerVoice/paidTourHand.native.mjs';
import {verifyPaidMemberHistory} from './paidMemberHistory.native.mjs';
import {measurePaidTourOperationReads} from './operationReadLatency.native.mjs';
assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}))assert.equal(process.env[k],v);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql']:[];
const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
assert.ok(process.env.VINPOKER_NATIVE_PAID_HISTORY===undefined||process.env.VINPOKER_NATIVE_PAID_HISTORY==='1');
const historyEnabled=process.env.VINPOKER_NATIVE_PAID_HISTORY==='1';
assert.ok(process.env.VINPOKER_NATIVE_DEFERRED_BREAK===undefined||process.env.VINPOKER_NATIVE_DEFERRED_BREAK==='1');
const deferredBreak=process.env.VINPOKER_NATIVE_DEFERRED_BREAK==='1';
assert.ok(process.env.VINPOKER_NATIVE_PAID_REENTRY===undefined||process.env.VINPOKER_NATIVE_PAID_REENTRY==='1');
const paidReentry=process.env.VINPOKER_NATIVE_PAID_REENTRY==='1';
if(paidReentry)assert.ok(historyEnabled&&deferredBreak,'paid re-entry integration requires member history and deferred lifecycle checks');
assert.ok(process.env.VINPOKER_NATIVE_MIXED_BREAK===undefined||process.env.VINPOKER_NATIVE_MIXED_BREAK==='1');
if(process.env.VINPOKER_NATIVE_MIXED_BREAK==='1')assert.ok(historyEnabled&&deferredBreak,'mixed break requires owned deferred/member journey');
const f=createPaidJourneyFixture(sql,{playerHistoryEnabled:historyEnabled});
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';
DO $$ DECLARE player uuid;reg uuid;dealer uuid;shift uuid:=gen_random_uuid();key uuid;r jsonb;first_receipt jsonb;BEGIN
 FOR n IN 2..8 LOOP
  player:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(player);
  ${historyEnabled?`INSERT INTO public.profiles(user_id,display_name) VALUES(player,'Paid TEST '||replace(player::text,'-','')) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name;`:''}
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  r:=public.cashier_create_app_registration_v1('${f.tour}',player);reg:=(r->>'registration_id')::uuid;
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_tour_registration: %',r;END IF;
  PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id','${f.actor}','club_id','${f.club}','tournament_id','${f.tour}',
   'registration_id',reg,'amount',100000,'request_id',gen_random_uuid()),'record');
  IF r->>'status' IS DISTINCT FROM 'recorded' OR r->'result'->>'seating_state' IS DISTINCT FROM 'seated' THEN RAISE EXCEPTION 'paid_tour_payment_seat: %',r;END IF;
  PERFORM set_config('role','none',true);
 END LOOP;
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,'${f.club}','Eight paid tour TEST','00:00','23:59');
 FOR n IN 1..4 LOOP
  dealer:=gen_random_uuid();key:=gen_random_uuid();
  INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(dealer,'${f.club}',NULL,'Paid tour TEST dealer '||n,'active');
  PERFORM set_config('role','authenticated',true);
  first_receipt:=public.operator_check_in_dealer_v1(dealer,'${f.club}',shift,key);
  IF first_receipt->>'outcome' IS DISTINCT FROM 'checked_in' OR first_receipt->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_tour_checkin: %',first_receipt;END IF;
  r:=public.operator_check_in_dealer_v1(dealer,'${f.club}',shift,key);
  IF r IS DISTINCT FROM first_receipt THEN RAISE EXCEPTION 'paid_tour_checkin_replay_changed';END IF;
  PERFORM set_config('role','none',true);
 END LOOP;
END $$;COMMIT;`);
if(process.env.VINPOKER_NATIVE_OPS_READ_LATENCY_REPORT)measurePaidTourOperationReads(sql,f,process.env.VINPOKER_NATIVE_OPS_READ_LATENCY_REPORT);
const roster=()=>JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM (SELECT t.id,t.table_session_id,s.revision,s.control_epoch,
 (SELECT count(*) FROM public.tournament_seats p WHERE p.tournament_table_id=t.id AND p.is_active) players
 FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.status='active' AND s.closed_at IS NULL) x;`));
// Explicit Floor balance intent when Cashier's legitimate seating policy fills
// one table first. Never rewrite a seat/entry to manufacture a two-table oracle.
for(let n=0;n<4;n++){
 const tables=roster();assert.equal(tables.length,2);if(tables.every(t=>t.players===4))break;
 const source=tables.find(t=>t.players>4),target=tables.find(t=>t.players<4);assert.ok(source&&target);
 const entry=sql(`SELECT entry_id FROM public.tournament_seats WHERE tournament_table_id='${source.id}' AND is_active ORDER BY seat_number DESC LIMIT 1;`);
 const seat=sql(`SELECT n FROM generate_series(1,9) n WHERE NOT EXISTS(SELECT 1 FROM public.tournament_seats s WHERE s.tournament_table_id='${target.id}' AND s.is_active AND s.seat_number=n) ORDER BY n LIMIT 1;`);
 const moved=JSON.parse(sql(`BEGIN;${auth}SELECT public.move_player_seat_v4('${entry}','${source.id}','${source.table_session_id}','${target.id}','${target.table_session_id}',${seat},
 ${source.revision},${target.revision},${source.control_epoch},${target.control_epoch},'TEST balance eight paid players', '${crypto.randomUUID()}');COMMIT;`));
 assert.equal(moved.ok,true);
}
assert.ok(roster().every(t=>t.players===4));
assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count)||'|'||count(DISTINCT entry_id) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'8|160000|8');
assert.equal(sql(`SELECT count(*)||'|'||sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND status='seated';`),'8|160000');
assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'8');
if(historyEnabled){
 assert.equal(sql(`SELECT count(*)||'|'||count(DISTINCT e.member_id) FROM public.tournament_entries e JOIN public.club_members m ON m.id=e.member_id AND m.club_id='${f.club}' AND m.player_user_id=e.player_id WHERE e.tournament_id='${f.tour}';`),'8|8');
 assert.equal(sql(`SELECT count(*) FROM public.player_history_link_errors WHERE club_id='${f.club}';`),'0');
}
assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}' AND a.status='checked_in';`),'4');
assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${f.club}' AND auto_swing_enabled;`),'0');
assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${f.tour}';`),'0');
const operational=()=>sql(`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_seats r WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r WHERE tournament_id='${f.tour}'),
 'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}'))::text);`);
const beforeChip=operational(),set=crypto.randomUUID(),low=crypto.randomUUID(),high=crypto.randomUUID(),template=crypto.randomUUID(),issueKey=crypto.randomUUID();
assert.equal(sql(`SELECT public.chip_ops_coupling_on('${f.club}');`),'f');
// Setup metadata is an explicit local fixture, not Setup UI acceptance.
sql(`BEGIN;
 INSERT INTO public.chip_set(id,club_id,name) VALUES('${set}','${f.club}','Eight paid tour chip TEST');
 INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('${low}','${set}','${f.club}',100),('${high}','${set}','${f.club}',1000);
 INSERT INTO public.tournament_chip_set(tournament_id,chip_set_id,club_id) VALUES('${f.tour}','${set}','${f.club}');
 INSERT INTO public.stack_template(id,tournament_id,club_id,chip_set_id,name,stack_value) VALUES('${template}','${f.tour}','${f.club}','${set}','Eight paid stack TEST',20000);
 INSERT INTO public.stack_template_line(stack_template_id,denomination_id,count) VALUES('${template}','${low}',200);
 INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) VALUES('${f.club}','${low}',3000),('${f.club}','${high}',500);
 COMMIT;`);
const issue=()=>JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_set_issuance_v2('${template}',8,0,'${issueKey}','${f.actor}');COMMIT;`));
const issued=issue();assert.equal(issued.status,'ok');
const issuedLedger=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM public.chip_inventory_ledger r WHERE tournament_id='${f.tour}';`);
const ledgerBeforeReplay=issuedLedger();assert.deepEqual(issue(),issued);assert.equal(issuedLedger(),ledgerBeforeReplay);
const counts=JSON.parse(sql(`BEGIN;${auth}SELECT jsonb_object_agg(denomination_id,current_count) FROM public.chip_ops_current_denom_counts('${f.tour}');COMMIT;`));
assert.equal(counts[low],1600);assert.equal(Object.hasOwn(counts,high),false,'unissued denomination has no floor ledger projection yet');assert.equal(counts[low]*100,160000);
assert.equal(sql(`SELECT count(*) FROM public.chip_inventory_ledger WHERE tournament_id='${f.tour}' AND denomination_id='${high}';`),'0');
assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${low}';`),'3000');
assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),'0');
assert.equal(operational(),beforeChip,'issuance cannot alter Cashier/entry/seat/dealer truth');
const tvToken='native-eight-paid-tv-'+crypto.randomUUID();
sql(`INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status) VALUES('${crypto.randomUUID()}','${f.club}','${tvToken}','${f.tour}','paired');`);
const tv=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${tvToken}',true);COMMIT;`));
assert.equal(tv.status,'paired');assert.equal(tv.tournament.id,f.tour);assert.equal(tv.participation_counts.remaining,8);assert.equal(tv.participation_counts.live_entry_stack,160000);
assert.equal(operational(),beforeChip);assert.equal(issuedLedger(),ledgerBeforeReplay);
console.log('NATIVE_EIGHT_PAID_CHIP_ISSUANCE_REPLAY_ANON_TV_PASS');
const financialRoster=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_seats r WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r WHERE tournament_id='${f.tour}'))::text);`);
const beforeAssignment=financialRoster();
await runPaidTourInitialAssignments(sql,f,roster());
assert.equal(operational()===beforeChip,false,'dealer assignment deliberately changes attendance, not chip/cash');
assert.equal(financialRoster(),beforeAssignment);
assert.equal(issuedLedger(),ledgerBeforeReplay);
assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'160000');
await runPaidTourHand(sql,f,roster());
assert.equal(issuedLedger(),ledgerBeforeReplay);
const tvAfterHand=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${tvToken}',true);COMMIT;`));
assert.equal(tvAfterHand.tournament.id,f.tour);assert.equal(tvAfterHand.participation_counts.remaining,8);assert.equal(tvAfterHand.participation_counts.live_entry_stack,160000);
// Mistaken bust/restore on this same paid tour. Pick a participant from the
// other table (no historical hand dependency), using only canonical writers.
const restoreTarget=JSON.parse(sql(`SELECT jsonb_build_object('entry',s.entry_id,'player',s.player_id,'table',s.tournament_table_id,'seat',s.seat_number,'stack',s.chip_count,
 'session',x.id,'revision',x.revision,'epoch',x.control_epoch) FROM public.tournament_seats s JOIN public.table_sessions x ON x.id=s.table_session_id
 WHERE s.tournament_id='${f.tour}' AND s.is_active AND NOT EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id WHERE h.tournament_id=s.tournament_id AND hp.player_id=s.player_id)
 ORDER BY s.id LIMIT 1;`));
assert.ok(restoreTarget.entry);assert.equal(restoreTarget.stack,20000);
const protectedState=()=>sql(`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'hands',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_hands r WHERE tournament_id='${f.tour}'),
 'outcomes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tournament_settlement_outcomes r JOIN public.tournament_hands h ON h.id=r.hand_id WHERE h.tournament_id='${f.tour}'),
 'assignments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.dealer_assignments r WHERE club_id='${f.club}'))::text);`);
const protectedBefore=protectedState();
let entryCount=sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`);
const bustKey=crypto.randomUUID();
const bust=()=>JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_bust_player_v3('${restoreTarget.entry}',${restoreTarget.revision},${restoreTarget.epoch},${restoreTarget.stack},'${bustKey}','eight_paid_mistaken_bust_TEST');COMMIT;`));
const busted=bust();assert.equal(busted.ok,true);assert.deepEqual(bust(),busted);
assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'7|140000');
const evidence=JSON.parse(sql(`BEGIN;${auth}SELECT to_jsonb(r) FROM public.get_floor_restorable_entries_v3('${f.tour}') r WHERE entry_id='${restoreTarget.entry}';COMMIT;`));
assert.equal(evidence.current_stack,restoreTarget.stack);
const restoreRevision=sql(`SELECT revision FROM public.table_sessions WHERE id='${restoreTarget.session}';`),restoreKey=crypto.randomUUID();
const restoreIntent=(seat=restoreTarget.seat)=>`SELECT public.floor_restore_busted_player_to_seat_v5('${restoreTarget.entry}','${restoreTarget.table}',${seat},${restoreRevision},${restoreTarget.epoch},'${restoreKey}','${restoreTarget.session}');`;
const reentryProbe=sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL ROLE service_role;
 SELECT public.cashier_create_app_reentry_v1('${f.tour}','${restoreTarget.player}');${auth}${restoreIntent()}ROLLBACK;`).split('\n').map(line=>JSON.parse(line));
assert.equal(reentryProbe.length,2);assert.equal(reentryProbe[0].ok,true,'canonical pending re-entry must exist before testing the restore fence');
assert.equal(reentryProbe[1].error,'restore_reentry_dependency');
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),entryCount);
const restore=seat=>JSON.parse(sql(`BEGIN;${auth}${restoreIntent(seat)}COMMIT;`));
const restored=restore();assert.equal(restored.ok,true);assert.deepEqual(restore(),restored);
const afterRestore=financialRoster();assert.equal(restore(restoreTarget.seat===1?2:1).error,'IDEMPOTENCY_CONFLICT');assert.equal(financialRoster(),afterRestore);
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),entryCount);
assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${restoreTarget.entry}' AND is_active AND chip_count=${restoreTarget.stack};`),'1');
assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'8|160000');
assert.equal(sql(`SELECT count(*)||'|'||sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND status='seated';`),'8|160000');
assert.equal(protectedState(),protectedBefore);assert.equal(issuedLedger(),ledgerBeforeReplay);
const tvRestored=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${tvToken}',true);COMMIT;`));
assert.equal(tvRestored.participation_counts.remaining,8);assert.equal(tvRestored.participation_counts.live_entry_stack,160000);
console.log('NATIVE_EIGHT_PAID_SAME_TOUR_BUST_REENTRY_FENCE_RESTORE_RECEIPT_TV_PASS');
if(paidReentry){
 const oldCash=sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}';`);
 const oldCashIds=JSON.parse(sql(`SELECT jsonb_agg(id ORDER BY id) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`));
 const current=JSON.parse(sql(`SELECT jsonb_build_object('revision',x.revision,'epoch',x.control_epoch) FROM public.table_sessions x WHERE id='${restoreTarget.session}';`));
 const realBust=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_bust_player_v3('${restoreTarget.entry}',${current.revision},${current.epoch},20000,'${crypto.randomUUID()}','eight_paid_reentry_TEST');COMMIT;`));assert.equal(realBust.ok,true);
 assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'7|140000');
 const register=()=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;SELECT public.cashier_create_app_reentry_v1('${f.tour}','${restoreTarget.player}');COMMIT;`));
 const registration=register();assert.equal(registration.ok,true);assert.equal(registration.total_pay,100000);assert.ok(registration.price_snapshot);
 const repeated=register();assert.equal(repeated.registration_id,registration.registration_id);assert.deepEqual(repeated.price_snapshot,registration.price_snapshot);
 const intent={actor_id:f.actor,club_id:f.club,tournament_id:f.tour,registration_id:registration.registration_id,amount:registration.total_pay,request_id:crypto.randomUUID()};
 const pay=payload=>JSON.parse(sql(`BEGIN;${auth}SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(payload)}'::jsonb,'record');COMMIT;`));
 const receipt=pay(intent);assert.equal(receipt.status,'recorded');assert.equal(receipt.result.seating_state,'seated');assert.equal(receipt.result.entry_no,2);
 assert.notEqual(receipt.result.entry_id,restoreTarget.entry);assert.deepEqual(pay(intent),receipt);
 const afterPayment=financialRoster();assert.equal(pay({...intent,amount:intent.amount+1}).error,'IDEMPOTENCY_CONFLICT');assert.equal(financialRoster(),afterPayment);
 assert.equal(sql(`SELECT count(*)||'|'||sum(amount) FROM public.cashier_buyin_movements WHERE registration_id='${registration.registration_id}';`),'1|100000');
 assert.equal(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE id IN (${oldCashIds.map(id=>`'${id}'::uuid`).join(',')});`),oldCash);
 const newEntry=JSON.parse(sql(`SELECT to_jsonb(e) FROM public.tournament_entries e WHERE id='${receipt.result.entry_id}';`));
 assert.equal(newEntry.player_id,restoreTarget.player);assert.equal(newEntry.entry_no,2);assert.equal(newEntry.current_stack,20000);
 assert.equal(sql(`SELECT source_entry_id FROM public.tournament_registrations WHERE id='${registration.registration_id}';`),restoreTarget.entry);
 assert.equal(sql(`SELECT status||'|'||current_stack FROM public.tournament_entries WHERE id='${restoreTarget.entry}';`),'busted|0');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${restoreTarget.entry}' AND is_active;`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${newEntry.id}' AND player_id='${restoreTarget.player}' AND entry_number=2 AND chip_count=20000 AND is_active;`),'1');
 const destination=JSON.parse(sql(`SELECT jsonb_build_object('table',s.tournament_table_id,'session',x.id,'revision',x.revision,'epoch',x.control_epoch,'seat',s.seat_number)
 FROM public.tournament_seats s JOIN public.table_sessions x ON x.id=s.table_session_id WHERE s.entry_id='${newEntry.id}' AND s.is_active;`));
 const denied=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_restore_busted_player_to_seat_v5('${restoreTarget.entry}','${destination.table}',${destination.seat},${destination.revision},${destination.epoch},'${crypto.randomUUID()}','${destination.session}');COMMIT;`));
 assert.equal(denied.error,'restore_reentry_dependency');assert.equal(financialRoster(),afterPayment);
 assert.deepEqual(restore(),restored,'old successful restore receipt replays without reversing the later re-entry');assert.equal(financialRoster(),afterPayment);
 entryCount=sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`);assert.equal(entryCount,'9');
 assert.ok(roster().every(t=>t.players===4));
 assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count)||'|'||count(DISTINCT player_id) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'8|160000|8');
 assert.equal(sql(`SELECT count(*)||'|'||sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'9|900000');
 assert.equal(issuedLedger(),ledgerBeforeReplay,'re-entry must not rewrite historical chip issuance/conversion rows');
 const tv=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${tvToken}',true);COMMIT;`));
 assert.equal(tv.participation_counts.remaining,8);assert.equal(tv.participation_counts.live_entry_stack,160000);assert.equal(tv.entries.total_confirmed,9);
 console.log('NATIVE_EIGHT_PLAYERS_NINE_PAID_ENTRIES_CANONICAL_REENTRY_REPLAY_RESTORE_FENCE_TV_PASS',JSON.stringify({old:restoreTarget.entry,current:newEntry.id,player:restoreTarget.player}));
}
const colorKey=crypto.randomUUID(),undoKey=crypto.randomUUID();
const rosterBeforeColor=operational(),proofBeforeColor=protectedState();
assert.equal(sql(`SELECT count(*) FROM public.chip_inventory_ledger WHERE tournament_id='${f.tour}';`),'0','issuance is tracked separately from conversion ledger');
const issuanceBeforeColor=sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY stack_template_id) FROM public.stack_template_issuance r WHERE stack_template_id='${template}';`);
const color=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_color_up('${f.tour}','${low}','${high}',160,1,'${colorKey}');COMMIT;`));
assert.equal(color.status,'ok');assert.equal(color.rounding_delta,0);
const originalLedgerRows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.chip_inventory_ledger r WHERE tournament_id='${f.tour}';`));
assert.equal(originalLedgerRows.length,2);
const colorPayload=JSON.stringify({tournament:f.tour,removed:low,target:high,added:160,level:1});
const colorReceipt=payload=>JSON.parse(sql(`BEGIN;${auth}SELECT public.get_chip_color_up_receipt_v1('${f.tour}','color_up','${colorKey}','${payload}'::jsonb);COMMIT;`));
assert.deepEqual(colorReceipt(colorPayload).result,color);
assert.equal(colorReceipt(JSON.stringify({...JSON.parse(colorPayload),added:161})).error,'IDEMPOTENCY_CONFLICT');
let floorCounts=JSON.parse(sql(`BEGIN;${auth}SELECT jsonb_object_agg(denomination_id,current_count) FROM public.chip_ops_current_denom_counts('${f.tour}');COMMIT;`));
assert.equal(floorCounts[low],0);assert.equal(floorCounts[high],160);
const undo=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_reverse_color_up('${color.color_up_operation_id}','${undoKey}');COMMIT;`));
assert.equal(undo.status,'ok');assert.equal(undo.bank_reversed,false);
const afterUndoLedger=issuedLedger();
const undoReceipt=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_chip_color_up_receipt_v1('${f.tour}','reverse_color_up','${undoKey}','{"operation":"${color.color_up_operation_id}"}'::jsonb);COMMIT;`));
assert.equal(undoReceipt.status,'committed');assert.deepEqual(undoReceipt.result,undo);assert.equal(issuedLedger(),afterUndoLedger);
assert.deepEqual(colorReceipt(colorPayload).result,color,'historical receipt remains original after undo');
floorCounts=JSON.parse(sql(`BEGIN;${auth}SELECT jsonb_object_agg(denomination_id,current_count) FROM public.chip_ops_current_denom_counts('${f.tour}');COMMIT;`));
assert.equal(floorCounts[low],1600);assert.equal(floorCounts[high],0);
const retainedLedger=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.chip_inventory_ledger r WHERE id IN (${originalLedgerRows.map(row=>`'${row.id}'::uuid`).join(',')});`));
assert.deepEqual(retainedLedger,originalLedgerRows,'undo must append compensation without changing original conversion ledger');
assert.equal(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY stack_template_id) FROM public.stack_template_issuance r WHERE stack_template_id='${template}';`),issuanceBeforeColor);
assert.equal(sql(`SELECT count(*) FROM public.color_up_operation WHERE tournament_id='${f.tour}' AND idempotency_key='${colorKey}';`),'1');
assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),'0');
assert.equal(operational(),rosterBeforeColor);assert.equal(protectedState(),proofBeforeColor);
console.log('NATIVE_EIGHT_PAID_SAME_TOUR_COLORUP_RECEIPT_UNDO_CONSERVATION_PASS');
const breakSource=JSON.parse(sql(`SELECT jsonb_build_object('table',t.id,'physical',t.game_table_id,'session',x.id,'revision',x.revision,'epoch',x.control_epoch)
 FROM public.tournament_tables t JOIN public.table_sessions x ON x.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.status='active'
 AND NOT EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.tournament_table_id=t.id) ORDER BY t.id LIMIT 1;`));
assert.ok(breakSource.table);
const cashProof=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'hands',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_hands r WHERE tournament_id='${f.tour}'),
 'outcomes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tournament_settlement_outcomes r JOIN public.tournament_hands h ON h.id=r.hand_id WHERE h.tournament_id='${f.tour}'))::text);`);
let cashProofBefore=cashProof();
if(deferredBreak){
 const existingHandIds=JSON.parse(sql(`SELECT jsonb_agg(id ORDER BY id) FROM public.tournament_hands WHERE tournament_id='${f.tour}';`));
 const existingProof=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'hands',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_hands r WHERE id IN (${existingHandIds.map(id=>`'${id}'::uuid`).join(',')})),
 'outcomes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_settlement_outcomes r WHERE verification_scope='historical_display' AND hand_id IN (${existingHandIds.map(id=>`'${id}'::uuid`).join(',')})))::text);`);
 const priorChain=JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.tournament_settlement_outcomes r WHERE verification_scope='chain' AND hand_id IN (${existingHandIds.map(id=>`'${id}'::uuid`).join(',')});`));
 const preserved=existingProof();
 await runPaidTourHand(sql,f,roster(),{breakSource});
 assert.equal(existingProof(),preserved,'deferred hand must preserve prior historical-display proofs and cash');
 // Chain proofs intentionally depend on later hands; unlike target-only
 // historical_display they become stale when this later hand is recorded.
 for(const old of priorChain){const current=JSON.parse(sql(`SELECT to_jsonb(r) FROM public.tournament_settlement_outcomes r WHERE id='${old.id}';`));
  assert.equal(current.status,old.status==='verified'?'stale':old.status);
  for(const key of ['status','updated_at']){delete old[key];delete current[key];}assert.deepEqual(current,old);
 }
 cashProofBefore=cashProof();
}else{
const plan=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_plan_break_table_v1('${breakSource.table}',${breakSource.revision},'fill_lowest_table');COMMIT;`));
assert.equal(plan.ok,true);assert.equal(plan.complete,true);assert.equal(plan.moves.length,4);assert.ok(plan.plan_hash);
const breakKey=crypto.randomUUID();
const breakCall=hash=>JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_break_table_v5('${breakSource.table}',${breakSource.revision},'${breakKey}','fill_lowest_table','${hash}');COMMIT;`));
const broken=breakCall(plan.plan_hash);assert.equal(broken.ok,true);assert.equal(broken.closed,true);assert.equal(broken.moved_count,4);
const afterBreak=operational(),assignmentAfterBreak=protectedState();
assert.deepEqual(breakCall(plan.plan_hash),broken);assert.equal(breakCall('different-plan').error,'IDEMPOTENCY_CONFLICT');
assert.equal(operational(),afterBreak);assert.equal(protectedState(),assignmentAfterBreak);
}
assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE table_session_id='${breakSource.session}' AND is_active;`),'0');
assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${breakSource.session}';`),'t');
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${breakSource.session}' AND released_at IS NULL;`),'0');
assert.equal(sql(`SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='${f.tour}' AND status='pending';`),'0');
assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count)||'|'||count(DISTINCT tournament_table_id) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'8|160000|1');
const reopened=JSON.parse(sql(`BEGIN;${auth}SELECT public.floor_open_tournament_table_v3('${f.tour}','${breakSource.physical}','manual','${crypto.randomUUID()}');COMMIT;`));
assert.equal(reopened.ok,true);assert.notEqual(reopened.table_session_id,breakSource.session);
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${reopened.table_session_id}' AND released_at IS NULL;`),'0','reopened session cannot inherit old dealer');
const oldContext=JSON.parse(sql(`BEGIN;${auth}SELECT public.validate_tracker_table_writer_context_v3('${f.tour}','${breakSource.table}','${breakSource.session}',${breakSource.epoch});COMMIT;`));
assert.equal(oldContext.ok,false);assert.equal(oldContext.error,'STALE_TRACKER_CONTEXT');
const reopenedRevision=sql(`SELECT revision FROM public.table_sessions WHERE id='${reopened.table_session_id}';`);
const closeKey=crypto.randomUUID();
const closeEmpty=()=>JSON.parse(sql(`BEGIN;${auth}SELECT public.close_tournament_table_v4('${reopened.tournament_table_id}',${reopenedRevision},'${closeKey}');COMMIT;`));
const closed=closeEmpty();assert.equal(closed.ok,true);assert.deepEqual(closeEmpty(),closed);
assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${reopened.table_session_id}';`),'t');
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),entryCount);
assert.equal(cashProof(),cashProofBefore);assert.equal(issuedLedger(),afterUndoLedger);
const tvAfterBreak=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${tvToken}',true);COMMIT;`));
assert.equal(tvAfterBreak.participation_counts.remaining,8);assert.equal(tvAfterBreak.participation_counts.live_entry_stack,160000);
console.log('NATIVE_EIGHT_PAID_SAME_TOUR_BREAK_CLOSE_REOPEN_SESSION_FENCE_PASS');
await runPaidTourShowdown(sql,f,roster()[0]);
assert.deepEqual(roster(),[],'completed tour has no active table sessions');
const tvClosed=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${tvToken}',true);COMMIT;`));
assert.equal(tvClosed.status,'paired');assert.equal(tvClosed.tournament.id,f.tour);assert.equal(tvClosed.tournament.status,'completed');
assert.equal(tvClosed.participation_counts.remaining,1);assert.equal(tvClosed.participation_counts.live_entry_stack,160000);
console.log('NATIVE_PAID_TOUR_POST_CLOSE_ANONYMOUS_TV_COUNTS_PASS');
if(historyEnabled){
 // Separate owned paid/member fixture supplies an actual cross-club negative.
 createPaidJourneyFixture(sql,{playerHistoryEnabled:true});
 verifyPaidMemberHistory(sql,f.tour);
}
console.log('NATIVE_PAID_TOUR_INTEGRATED_LIFECYCLE_CURRENT_ROSTER_PASS',JSON.stringify({club:f.club,tournament:f.tour,tables:roster()}));
// Durable owned TEST metadata/audit retained. Not a full-tour/Auto/rotation/UI proof.
