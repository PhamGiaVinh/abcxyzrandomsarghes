import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';

// Shared by paid ITM, restore-history and manual-recipient regressions: qualify
// through real Floor/close writers, never privileged direct ranking or fake places.
export function closeCanonicalFinishedField(sql,{tour,actor}) {
 const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const call=q=>JSON.parse(sql(`BEGIN;${claims}${q}COMMIT;`));
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}' AND status<>'busted';`),'1');
 const seats=JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('entry',e.id,'revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count)),'[]'::jsonb)
  FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
  JOIN public.table_sessions x ON x.id=s.table_session_id WHERE e.tournament_id='${tour}' AND e.status<>'busted';`));
 assert.ok(seats.length<=1,'one survivor cannot have duplicate active seats');
 for(const winner of seats) assert.equal(call(`SELECT public.floor_free_sit_player_v1('${winner.entry}',${winner.revision},${winner.epoch},${winner.stack},'${randomUUID()}','TEST winner leaves seat');`).ok,true);
 const tables=JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'revision',s.revision)),'[]'::jsonb)
  FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${tour}' AND t.status='active';`));
 for(const t of tables){const result=call(`SELECT public.close_tournament_table_v4('${t.id}',${t.revision},'${randomUUID()}');`);assert.equal(result.ok,true,JSON.stringify(result));}
 const result=call(`SELECT public.close_tournament('${tour}','TEST canonical official close');`);
 assert.equal(result.ok,true,JSON.stringify(result));return result;
}

// Focused canonical manual-Floor -> official close -> payout integration.
// Not the all-module browser journey, not real money, no simultaneous busts.
export async function runOfficialCloseJourney(sql) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const f=createPaidJourneyFixture(sql,{playerHistoryEnabled:true});
 const claims=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const call=q=>JSON.parse(sql(`BEGIN;${claims}${q}COMMIT;`));
 const players=[f.player,...Array.from({length:3},()=>randomUUID())];
 for(const player of players.slice(1)) {
  sql(`INSERT INTO auth.users(id) VALUES('${player}');`);
  const reg=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
   SELECT public.cashier_create_app_registration_v1('${f.tour}','${player}');COMMIT;`));
  assert.equal(reg.ok,true,JSON.stringify(reg));
  const intent={actor_id:f.actor,club_id:f.club,tournament_id:f.tour,registration_id:reg.registration_id,amount:100000,request_id:randomUUID()};
  const paid=call(`SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(intent)}'::jsonb,'record');`);
  assert.equal(paid.status,'recorded');assert.equal(paid.result.seating_state,'seated');
 }
 // Explicit synthetic fixture prizes, same 50/25/25 distribution as existing
 // crossFlowItm. Set BEFORE outs; no change to historical/frozen policy.
 sql(`INSERT INTO public.tournament_prizes(tournament_id,position,percentage,amount)
  VALUES('${f.tour}',1,50,200000),('${f.tour}',2,25,100000),('${f.tour}',3,25,100000);
  UPDATE public.tournaments SET itm_places=3 WHERE id='${f.tour}';`);
 const unfinishedBefore=sql(`SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM public.tournament_entries e WHERE tournament_id='${f.tour}';`);
 if(sql(`SELECT has_function_privilege('authenticated','public.finalize_tournament_results(uuid)','EXECUTE');`)==='t'){
  const unfinished=call(`SELECT public.finalize_tournament_results('${f.tour}');`);
  assert.deepEqual(unfinished,{ok:false,error:'tournament_not_finished',survivors:4});
 }else assert.throws(()=>call(`SELECT public.finalize_tournament_results('${f.tour}');`),/permission denied for function finalize_tournament_results/);
 assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM public.tournament_entries e WHERE tournament_id='${f.tour}';`),unfinishedBefore,
  'attempting finalization with four survivors must not change any entry');
 const seat=player=>JSON.parse(sql(`SELECT jsonb_build_object('entry',e.id,'revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count)
  FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
  JOIN public.table_sessions x ON x.id=s.table_session_id WHERE e.tournament_id='${f.tour}' AND e.player_id='${player}';`));
 for(const player of players.slice(0,3)) {
  const s=seat(player),request=randomUUID();
  const q=`SELECT public.floor_bust_player_v3('${s.entry}',${s.revision},${s.epoch},${s.stack},'${request}','TEST sequential official close');`;
  const out=call(q);assert.equal(out.ok,true,JSON.stringify(out));assert.deepEqual(call(q),out);
 }
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND finished_place IS NOT NULL;`),'0');
 const closed=closeCanonicalFinishedField(sql,f);
 assert.equal(closed.ok,true,JSON.stringify(closed));
 const ranks=JSON.parse(sql(`SELECT jsonb_object_agg(player_id,finished_place) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`));
 assert.deepEqual(ranks,Object.fromEntries(players.map((player,i)=>[player,4-i])));
 const report=JSON.parse(sql(`SELECT to_jsonb(r) FROM public.tournament_close_report r WHERE tournament_id='${f.tour}';`));
 console.log('OFFICIAL_CLOSE_REPORT_OBSERVED',JSON.stringify({fixture:f,closed,report,ranks}));
 assert.equal(report.detail.official_results.status,'finalized');
 assert.equal(report.entry_count,4);assert.equal(report.cash_in_total,400000);
 const recipients=call(`SELECT public.get_tournament_payout_recipients('${f.tour}');`);
 assert.deepEqual(recipients.places.map(r=>[r.finishedPlace,r.prizeAmount]),[[1,200000],[2,100000],[3,100000]]);
 for(const recipient of recipients.places) {
  const request=randomUUID();
  const q=`SELECT public.record_tournament_prize_payment_v2('${f.tour}',${recipient.finishedPlace},'cash','${recipient.confirmationToken}','${request}');`;
  const paid=call(q);assert.equal(paid.ok,true,JSON.stringify(paid));assert.equal(call(q).payment_id,paid.payment_id);
 }
 const paymentFacts=JSON.parse(sql(`SELECT jsonb_build_object('count',count(*),'amount',sum(prize_amount))
  FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}';`));
 assert.deepEqual(paymentFacts,{count:3,amount:400000});
 assert.equal(call(`SELECT public.close_tournament('${f.tour}','retry');`).report_id,closed.report_id);
 // Immutable close snapshot predates payment. Do not rewrite it or pretend it
 // is today's paid ledger. Capture this distinction for the browser review.
 assert.equal(sql(`SELECT prize_total FROM public.tournament_close_report WHERE id='${closed.report_id}';`),'0');
 console.log('CLOSE_SNAPSHOT_PRE_PAYOUT_NOT_CURRENT_PAID_LEDGER',JSON.stringify({snapshotPrize:report.prize_total,paymentFacts}));
 console.log('CANONICAL_MANUAL_OUT_OFFICIAL_CLOSE_PAYOUT_REPLAY_LOCAL_PASS',JSON.stringify({fixture:f,ranks,report:report.id}));
 return f;
}
