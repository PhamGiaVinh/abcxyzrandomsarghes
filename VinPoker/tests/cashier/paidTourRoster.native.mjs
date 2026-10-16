import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}))assert.equal(process.env[k],v);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql']:[];
const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const f=createPaidJourneyFixture(sql);
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';
DO $$ DECLARE player uuid;reg uuid;dealer uuid;shift uuid:=gen_random_uuid();key uuid;r jsonb;first_receipt jsonb;BEGIN
 FOR n IN 2..8 LOOP
  player:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(player);
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
const roster=()=>JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT t.id,t.table_session_id,s.revision,s.control_epoch,
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
assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}' AND a.status='checked_in';`),'4');
assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${f.club}' AND auto_swing_enabled;`),'0');
assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${f.tour}';`),'0');
console.log('NATIVE_TWO_TABLE_EIGHT_PAID_FOUR_CHECKIN_ROSTER_PASS',JSON.stringify({club:f.club,tournament:f.tour,tables:roster()}));
// Durable owned TEST metadata/audit retained. Not a full-tour/Auto/rotation/UI proof.
