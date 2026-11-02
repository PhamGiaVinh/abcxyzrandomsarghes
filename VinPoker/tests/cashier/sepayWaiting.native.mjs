import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export function prepareSePayWaitingNative(sql,f,{session,until}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');assert.equal(typeof session,'function');
 const foreign=()=>sql(`SELECT md5(jsonb_build_object(
  'registrations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x WHERE tournament_id IS DISTINCT FROM '${f.tour}'::uuid),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id IS DISTINCT FROM '${f.tour}'::uuid),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id IS DISTINCT FROM '${f.tour}'::uuid),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id IS DISTINCT FROM '${f.tour}'::uuid),
  'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.seat_draw_receipts x WHERE tournament_id IS DISTINCT FROM '${f.tour}'::uuid))::text);`);
 const before=foreign();
 let source=readFileSync('tests/cashier/paidActiveHand.pg17.sql','utf8');
 const marker=' -- Third player pays during the actual in-progress hand.';
 assert.equal(source.split(marker).length,2);
 // Canonical preparation only: close empty table, second cash registration,
 // occupied Tracker switch and Start. Do not run/claim the remaining journey.
 source=source.replace(marker,' RETURN;\n'+marker).replace(/ROLLBACK;(\s*SELECT 'ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS';)/,'COMMIT;$1');
 sql(`\\set PAID_REGISTRATION ${f.registration}\n\\set PAID_MOVE_CASE false\n\\set PAID_CORRECTION_CASE false\n`+source);
 const state=JSON.parse(sql(`SELECT jsonb_build_object('closedPhysical',(SELECT game_table_id FROM public.tournament_tables WHERE tournament_id='${f.tour}' AND status<>'active'),
  'hand',(SELECT id FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND status='in_progress'),
  'players',(SELECT count(*) FROM public.hand_players WHERE hand_id=(SELECT id FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND status='in_progress'))) ;`));
 assert.ok(state.closedPhysical&&state.hand);assert.equal(state.players,2);
 const handProof=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${state.hand}'),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${state.hand}'))::text);`);
 const originalHand=handProof();
 const retries=[];
 return {retries,
  async retry(service,args){
   assert.equal(args.p_auto_confirm,true);assert.equal(args.p_limit,500);
   // Real SKIP LOCKED isolation: prevent the global production API touching
   // pre-existing paid cash waiters in unrelated local tours. No row rewriting.
   const holder=session('sepay_foreign_'+randomUUID().replaceAll('-',''));
   try{
    holder.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL idle_in_transaction_session_timeout='8s';
     SELECT count(*) FROM(SELECT id FROM public.tournament_registrations WHERE tournament_id IS DISTINCT FROM '${f.tour}'::uuid FOR UPDATE)t;
     SELECT 'SEPAY_FOREIGN_ROWS_LOCKED';\n`);
    await until(()=>holder.output().includes('SEPAY_FOREIGN_ROWS_LOCKED'));
    const result=service('SELECT public.cashier_retry_paid_seating_v1(true,500);');
    assert.equal(result.ok,true);assert.ok(result.attempted<=1,'only this scoped waiter may be processed');retries.push(result);return result;
   }finally{if(!holder.child.stdin.writableEnded&&!holder.child.stdin.destroyed)holder.child.stdin.end('ROLLBACK;\n');await holder.closed;}
  },open(){
   const result=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';
    SET LOCAL ROLE authenticated;SELECT public.floor_open_tournament_table_v3('${f.tour}','${state.closedPhysical}','manual','${randomUUID()}');COMMIT;`));
   assert.equal(result.ok,true,JSON.stringify(result));assert.equal(handProof(),originalHand);return result;
  },check(){assert.equal(foreign(),before,'global retry changed another tour');assert.equal(handProof(),originalHand,'retry changed in-progress hand roster');}
 };
}
