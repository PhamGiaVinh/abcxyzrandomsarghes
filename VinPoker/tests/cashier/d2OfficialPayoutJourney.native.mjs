import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function runD2OfficialPayoutJourney(sql,f){
 assert.equal(process.env.VINPOKER_NATIVE_CROSS_FLOW,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql(`SELECT itm_percent FROM public.multi_day_qualification_rules_v1 WHERE event_id='${f.event}';`),'25');
 const call=q=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;${q}COMMIT;`));
 const tableState=()=>JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('table',t.id,'session',s.id,'epoch',s.control_epoch,'revision',s.revision))
  FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND s.closed_at IS NULL;`));
 // Prizes were configured before the first registration and flight end.
 // SELECT_LARGEST includes eight nonselected-bag100k obligations; SUM does not.
 assert.equal(sql(`SELECT count(*) FROM public.tournament_prizes WHERE tournament_id='${f.tour}'
  AND amount=${f.policy==='SELECT_LARGEST'?100000:300000};`),'4');
 for(const t of tableState()){
  const changed=call(`SELECT public.floor_request_table_control_mode_v4('${t.table}','${t.session}','manual',${t.revision},${t.epoch},'${randomUUID()}');`);
  assert.equal(changed.ok,true,JSON.stringify(changed));
 }
 const seat=player=>JSON.parse(sql(`SELECT jsonb_build_object('entry',e.id,'revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count)
  FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
  JOIN public.table_sessions x ON x.id=s.table_session_id WHERE e.tournament_id='${f.tour}' AND e.player_id='${player}';`));
 for(const player of f.players.slice(0,-1)){
  const s=seat(player);
  const out=call(`SELECT public.floor_bust_player_v3('${s.entry}',${s.revision},${s.epoch},${s.stack},'${randomUUID()}','TEST sequential D2 out');`);
  assert.equal(out.ok,true,JSON.stringify(out));
 }
 const winner=seat(f.players.at(-1));
 assert.equal(call(`SELECT public.floor_free_sit_player_v1('${winner.entry}',${winner.revision},${winner.epoch},${winner.stack},'${randomUUID()}','TEST D2 winner leaves seat');`).ok,true);
 for(const t of tableState())assert.equal(call(`SELECT public.close_tournament_table_v4('${t.table}',${t.revision},'${randomUUID()}');`).ok,true);
 const closed=call(`SELECT public.close_tournament('${f.tour}','TEST D2 official close');`);
 assert.equal(closed.ok,true,JSON.stringify(closed));
 const ranks=JSON.parse(sql(`SELECT jsonb_object_agg(player_id,finished_place) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`));
 assert.deepEqual(ranks,Object.fromEntries(f.players.map((player,i)=>[player,8-i])));
 const preview=call(`SELECT public.multi_day_payout_preview_v1('${f.event}');`);
 console.log('D2_VIABLE_PAYOUT_PREVIEW_OBSERVED',JSON.stringify({fixture:f,preview:{...preview,
  sourceSnapshot:{registrationCount:preview.sourceSnapshot.registrations.length,
    prizePositions:preview.sourceSnapshot.prizePositions}},closed}));
 assert.equal(preview.state,'READY');assert.equal(preview.directPoolVnd,1600000);
 assert.equal(preview.requiredShortfallVnd,0);assert.equal(preview.unallocatedPoolVnd,0);
 assert.equal(preview.obligations.length,8);assert.equal(preview.obligations.reduce((n,p)=>n+p.totalVnd,0),1600000);
 const request=randomUUID();
 const q=`SELECT public.multi_day_finalize_payout_v1('${f.event}','${preview.rulesVersion}','${preview.fundingRevision}',
  '${preview.qualificationRevision}','${preview.payoutInputHash}','${request}');`;
 const finalized=call(q);assert.equal(finalized.state,'FINALIZED_OBLIGATIONS');assert.equal(call(q).idempotent,true);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}';`),'0');
 console.log('D2_FLIGHTS_DRAW_OFFICIAL_CLOSE_FINALIZED_OBLIGATIONS_NOT_PAYMENT_LOCAL_PASS',JSON.stringify({event:f.event,tour:f.tour,policy:f.policy,finalized}));
}
