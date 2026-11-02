import assert from 'node:assert/strict';
import {verifyMultiDayFloorRead} from '../../src/ops/floor/multiDayFloorRead.ts';
import {parseFinalizationIntent,persistFinalizationIntent,readFinalizationIntent,clearFinalizationIntent} from '../../src/ops/floor/multiDayFinalizationIntent.ts';
import {parseQualificationIntent,persistQualificationIntent,readQualificationIntent,clearQualificationIntent} from '../../src/ops/floor/multiDayQualificationIntent.ts';
import {parseRulesIntent,persistRulesIntent,readRulesIntent,clearRulesIntent} from '../../src/ops/floor/multiDayRulesIntent.ts';

export function verifyMultiDayNativeRead(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const event='b8ebfbc7-ff78-4515-8812-7d748b828d0b';
 const scope=JSON.parse(sql(`SELECT jsonb_build_object('actor',c.owner_id,'club',e.club_id) FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id
 WHERE e.id='${event}' AND e.name='Multi-day SELECT_LARGEST local TEST' AND e.final_tournament_id='d66cce0e-4225-4765-8b8c-9462e69153e1';`)||'null');assert.ok(scope);
 const before=sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.multi_day_package_release_v1 g;");
 const result=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';
 INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids) VALUES(true,true,ARRAY['${scope.club}'::uuid])
 ON CONFLICT(id) DO UPDATE SET enabled=true,allowed_club_ids=excluded.allowed_club_ids;
 SET LOCAL request.jwt.claim.sub='${scope.actor}';SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"sub":"${scope.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT jsonb_build_object('multi_day_floor_read_v1',public.multi_day_floor_read_v1('${event}'),
 'multi_day_qualification_preview_v1',public.multi_day_qualification_preview_v1('${event}'),
 'multi_day_payout_preview_v1',public.multi_day_payout_preview_v1('${event}'),
 'multi_day_payout_postfinal_state_v1',public.multi_day_payout_postfinal_state_v1('${event}'));
 ROLLBACK;`));
 for(const [name,data] of Object.entries(result)){
  try{verifyMultiDayFloorRead(name,data,event);}catch(cause){throw new Error(`${name}: returned eventId=${data?.eventId??'absent'}`,{cause});}
 }
 assert.equal(result.multi_day_floor_read_v1.finalization.state,'FINALIZED_OBLIGATIONS');
 assert.equal(sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.multi_day_package_release_v1 g;"),before);
 console.log('MULTIDAY_FOUR_ACTUAL_READ_CONTRACTS_FINALIZED_ROLLBACK_PASS');
 const final=result.multi_day_floor_read_v1.finalization;
 const intent=parseFinalizationIntent({actorId:scope.actor,eventId:event,args:{p_event_id:event,p_expected_rules_version:final.rulesVersion,
  p_expected_funding_revision:final.fundingRevision,p_expected_qualification_revision:final.qualificationRevision,
  p_expected_payout_input_hash:final.payoutInputHash,p_request_id:final.requestId}},scope.actor,event);
 const rows=new Map(),storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};
 persistFinalizationIntent(storage,intent);
 const recovered=readFinalizationIntent(storage,scope.actor,event);assert.deepEqual(recovered,intent);
 const snapshot=()=>sql(`SELECT jsonb_build_object('final',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${event}'),
  'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM public.tournament_prize_payments p WHERE tournament_id='d66cce0e-4225-4765-8b8c-9462e69153e1'));`);
 const prior=snapshot();
 const args=recovered.args,call=`public.multi_day_finalize_payout_v1('${args.p_event_id}','${args.p_expected_rules_version}','${args.p_expected_funding_revision}','${args.p_expected_qualification_revision}','${args.p_expected_payout_input_hash}','${args.p_request_id}')`;
 const receipts=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';
  SET LOCAL request.jwt.claim.sub='${scope.actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${scope.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  SELECT jsonb_build_array(${call},${call});ROLLBACK;`));
 assert.deepEqual(receipts[0],receipts[1]);assert.equal(receipts[0].idempotent,true);
 assert.equal(receipts[0].payoutInputHash,args.p_expected_payout_input_hash);assert.equal(receipts[0].paymentExecution,'NOT_PERFORMED');
 assert.equal(snapshot(),prior);clearFinalizationIntent(storage,recovered);assert.equal(rows.size,0);
 console.log('MULTIDAY_RETAINED_ORIGINAL_FINALIZATION_NATIVE_RECEIPT_REPLAY_NO_DELTA_PASS');
 const original=JSON.parse(sql(`SELECT jsonb_build_object('actorId',l.actor_id,'eventId',l.event_id,'policy',r.policy,'args',jsonb_build_object(
   'p_event_id',l.event_id,'p_request_id',l.request_id,'p_expected_source_hash',l.source_hash,
   'p_bag_ids',(SELECT jsonb_agg(ids.bag ORDER BY ids.bag) FROM(SELECT DISTINCT b->>'bagId' bag FROM public.multi_day_final_participations_v1 p,
    LATERAL jsonb_array_elements(p.source_bags) b WHERE p.event_id=l.event_id) ids)))
  FROM public.multi_day_qualification_locks_v1 l JOIN public.multi_day_qualification_rules_v1 r ON r.event_id=l.event_id
  WHERE l.event_id='${event}' AND l.actor_id='${scope.actor}';`)||'null');assert.ok(original);
 const qualification=parseQualificationIntent(original,scope.actor,event);
 persistQualificationIntent(storage,qualification);assert.deepEqual(readQualificationIntent(storage,scope.actor,event),qualification);
 const q=qualification.args;
 assert.equal(sql(`SELECT selection_hash=md5('${q.p_bag_ids.join(',')}') FROM public.multi_day_qualification_locks_v1 WHERE event_id='${event}';`),'t');
 const qSnapshot=()=>sql(`SELECT jsonb_build_object('lock',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='${event}'),
  'participations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.multi_day_final_participations_v1 p WHERE p.event_id='${event}'));`);
 const qBefore=qSnapshot(),qCall=`public.multi_day_lock_qualification_v1('${event}',ARRAY[${q.p_bag_ids.map(id=>`'${id}'::uuid`).join(',')}],'${q.p_expected_source_hash}','${q.p_request_id}')`;
 const qReceipts=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';
  SET LOCAL request.jwt.claim.sub='${scope.actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${scope.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  SELECT jsonb_build_array(${qCall},${qCall});ROLLBACK;`));
 assert.deepEqual(qReceipts[0],qReceipts[1]);assert.equal(qReceipts[0].idempotent,true);
 assert.equal(qReceipts[0].sourceHash,q.p_expected_source_hash);assert.equal(qReceipts[0].policy,qualification.policy);
 assert.equal(qSnapshot(),qBefore);assert.equal(snapshot(),prior);clearQualificationIntent(storage,qualification);assert.equal(rows.size,0);
 console.log('MULTIDAY_RETAINED_QUALIFICATION_NATIVE_SAME_SELECTION_RECEIPT_NO_DELTA_PASS');
 const frozen=result.multi_day_floor_read_v1.rules;
 const rules=parseRulesIntent({actorId:scope.actor,eventId:event,itmPercent:frozen.itmPercent,args:{p_event_id:event,
  p_policy:frozen.policy,p_min_cash_x:frozen.minCashX,p_day2_percent:frozen.day2Percent}},scope.actor,event);
 persistRulesIntent(storage,rules);assert.deepEqual(readRulesIntent(storage,scope.actor,event),rules);
 const rulesBefore=sql(`SELECT to_jsonb(r) FROM public.multi_day_qualification_rules_v1 r WHERE event_id='${event}';`);
 const ruleCall=`public.multi_day_set_qualification_rules_v2('${event}','${rules.args.p_policy}',${rules.args.p_min_cash_x},${rules.args.p_day2_percent})`;
 const ruleReceipts=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${scope.club}'::uuid];
 SET LOCAL request.jwt.claim.sub='${scope.actor}';SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"sub":"${scope.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT jsonb_build_array(${ruleCall},${ruleCall});ROLLBACK;`));
 assert.deepEqual(ruleReceipts[0],ruleReceipts[1]);assert.equal(ruleReceipts[0].idempotent,true);
 assert.equal(ruleReceipts[0].itmPercent,rules.itmPercent);assert.equal(ruleReceipts[0].day2Percent,rules.args.p_day2_percent);
 assert.equal(sql(`SELECT to_jsonb(r) FROM public.multi_day_qualification_rules_v1 r WHERE event_id='${event}';`),rulesBefore);
 assert.equal(snapshot(),prior);assert.equal(qSnapshot(),qBefore);clearRulesIntent(storage,rules);assert.equal(rows.size,0);
 console.log('MULTIDAY_RETAINED_RULES_AFTER_SOURCE_NATIVE_IDEMPOTENT_ROLLBACK_PASS');
}
