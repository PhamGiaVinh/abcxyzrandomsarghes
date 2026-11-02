import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
import {closeCanonicalFinishedField} from './officialCloseJourney.native.mjs';

assert.equal(process.env.VINPOKER_NATIVE_CROSS_FLOW,'1');
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'})) assert.equal(process.env[key],value);
const prefix=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql'];
const sql=query=>execFileSync('wsl',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000}).trim();
const f=createPaidJourneyFixture(sql,{playerHistoryEnabled:true});
if(process.argv.includes('--bank-only')) {
 console.log(sql(`SELECT set_config('test.cross_flow','${JSON.stringify(f)}',false);\n`+readFileSync('tests/cashier/bankBuyinCrossFlow.pg17.sql','utf8')));
 process.exit(0);
}
const actor=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
const call=query=>JSON.parse(sql(`BEGIN;${actor}${query}COMMIT;`));
const directFinalizer=sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`)==='t';
const assertUnfinished=()=>{
 if(directFinalizer)assert.equal(call(`SELECT public.finalize_tournament_results('${f.tour}');`).error,'tournament_not_finished');
 else assert.throws(()=>call(`SELECT public.finalize_tournament_results('${f.tour}');`),/permission denied for function finalize_tournament_results/);
};
const players=[f.player,randomUUID(),randomUUID(),randomUUID()];
for(const player of players.slice(1)) {
  sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${player}');
  DO $$ DECLARE registration uuid;r jsonb;BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  r:=public.cashier_create_app_registration_v1('${f.tour}','${player}');
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'cross_flow_registration_failed: %',r;END IF;
  registration:=(r->>'registration_id')::uuid;
  PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id','${f.actor}','club_id','${f.club}',
  'tournament_id','${f.tour}','registration_id',registration,'amount',100000,'request_id',gen_random_uuid()),'record');
  IF r->>'status'<>'recorded' OR r->'result'->>'seating_state'<>'seated' THEN RAISE EXCEPTION 'cross_flow_payment_failed: %',r;END IF;
  END $$;COMMIT;`);
}
sql(`INSERT INTO public.tournament_prizes(tournament_id,position,percentage,amount) VALUES('${f.tour}',1,50,200000),('${f.tour}',2,25,100000),('${f.tour}',3,25,100000);
UPDATE public.tournaments SET itm_places=3 WHERE id='${f.tour}';`);
const bust=player=>{
  const seat=JSON.parse(sql(`SELECT jsonb_build_object('entry',e.id,'revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count)
  FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
  JOIN public.table_sessions x ON x.id=s.table_session_id WHERE e.tournament_id='${f.tour}' AND e.player_id='${player}';`));
  const id=randomUUID(),query=`SELECT public.floor_bust_player_v3('${seat.entry}',${seat.revision},${seat.epoch},${seat.stack},'${id}','TEST sequential ITM out');`;
  const result=call(query);assert.equal(result.ok,true);assert.equal(result.payout_applied,false);
  assert.deepEqual(call(query),result,'out replay must not allocate a second rank');return seat.entry;
};
const first=bust(players[0]);
assertUnfinished();
assert.equal(call(`SELECT public.record_tournament_prize_payment('${f.tour}',2,'cash');`).error,'place_not_finalized');
assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}';`),'0');
const second=bust(players[1]);
// The first in-money elimination occurs while TWO players still remain.
assertUnfinished();
assert.equal(call(`SELECT public.record_tournament_prize_payment('${f.tour}',3,'cash');`).error,'place_not_finalized');
assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}';`),'0');
console.log('GAP_ITM_OUT_PRIZE_NOT_AVAILABLE_UNTIL_FINALIZATION');
const third=bust(players[2]);
if(directFinalizer)assert.equal(call(`SELECT public.finalize_tournament_results('${f.tour}');`).ok,true);
else closeCanonicalFinishedField(sql,f);
const ranks=JSON.parse(sql(`SELECT jsonb_object_agg(player_id,finished_place) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`));
assert.deepEqual(ranks,{[players[0]]:4,[players[1]]:3,[players[2]]:2,[players[3]]:1});
const hasRecipientRead=sql("SELECT to_regprocedure('public.get_tournament_payout_recipients(uuid)') IS NOT NULL;")==='t';
if(hasRecipientRead) {
  const recipients=call(`SELECT public.get_tournament_payout_recipients('${f.tour}');`);
  assert.deepEqual(recipients.places.map(row=>[row.finishedPlace,row.prizeAmount]),[[1,200000],[2,100000],[3,100000]]);
} else console.log('GAP_NATIVE_PAYOUT_RECIPIENT_READ_RPC_ABSENT_NOT_UI_PASS');
assert.equal(call(`SELECT public.record_tournament_prize_payment('${f.tour}',4,'cash');`).error,'place_not_in_money');
const paid=call(`SELECT public.record_tournament_prize_payment('${f.tour}',3,'cash');`);
assert.equal(paid.ok,true);assert.equal(paid.prize_amount,100000);
assert.equal(call(`SELECT public.record_tournament_prize_payment('${f.tour}',3,'cash');`).outcome,'already_paid');
assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}' AND finished_place=3 AND prize_amount=100000;`),'1');
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE id IN ('${first}','${second}','${third}') AND status='busted';`),'3');
assert.equal(sql(`SELECT recipient_ref='${players[1]}' FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}' AND finished_place=3;`),'t','paid person must be the exact first ITM-out player');
console.log('SEQUENTIAL_ITM_OUT_RANK_PAYOUT_AND_RETRY_LOCAL_PASS',JSON.stringify({tour:f.tour,club:f.club,ranks,paidPlace:3,amount:100000}));
console.log('NOT_SIMULTANEOUS_ELIMINATION_POLICY_OR_REAL_BANK_PAYMENT');
