import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseApprovalIntent,persistApprovalIntent,readApprovalIntent,clearApprovalIntent} from '../../src/ops/floor/multiDayApprovalIntent.ts';
export function verifyMultiDayApproval(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const event='b8ebfbc7-ff78-4515-8812-7d748b828d0b';
 const scope=JSON.parse(sql(`SELECT jsonb_build_object('actor',c.owner_id,'club',e.club_id,'person',p.id)
 FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id
 JOIN public.multi_day_final_participations_v1 p ON p.event_id=e.id
 WHERE e.id='${event}' AND e.name='Multi-day SELECT_LARGEST local TEST' ORDER BY p.id LIMIT 1;`)||'null');assert.ok(scope);
 const request=randomUUID(),approval=randomUUID();
 const intent=parseApprovalIntent({actorId:scope.actor,eventId:event,args:{p_request_id:request,p_approval_request_id:approval}},scope.actor,event);
 const rows=new Map(),storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 persistApprovalIntent(storage,intent);const recovered=readApprovalIntent(storage,scope.actor,event);assert.deepEqual(recovered,intent);
 const snapshot=()=>sql(`SELECT md5(jsonb_build_object('final',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${event}'),
 'gate',(SELECT jsonb_agg(to_jsonb(g)) FROM public.multi_day_package_release_v1 g),
 'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.request_id),'[]') FROM public.multi_day_payout_correction_requests_v1 r WHERE event_id='${event}'))::text);`);
 const before=snapshot();
 const raw=sql(`BEGIN;SET LOCAL statement_timeout='5s';
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${scope.club}'::uuid];
 SET LOCAL request.jwt.claim.sub='${scope.actor}';SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"sub":"${scope.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT public.multi_day_payout_postfinal_state_v1('${event}')->>'revision' AS revision \\gset
 SELECT public.multi_day_request_payout_correction_v1('${event}','OBLIGATION_DELTA','${scope.person}',NULL,-1,
 :'revision','Local recovery TEST only','local-rollback-evidence','${request}');
 SELECT public.multi_day_approve_payout_correction_v1('${recovered.args.p_request_id}','${recovered.args.p_approval_request_id}');
 SELECT public.multi_day_approve_payout_correction_v1('${recovered.args.p_request_id}','${recovered.args.p_approval_request_id}');
 SELECT public.multi_day_request_payout_correction_v1('${event}','OBLIGATION_DELTA','${scope.person}',NULL,-1,
 :'revision','Local recovery TEST only','local-rollback-evidence','${request}');
 ROLLBACK;`);
 const receipts=raw.split('\n').map(line=>JSON.parse(line));assert.equal(receipts.length,4);
 assert.equal(receipts[0].requestId,request);assert.equal(receipts[0].state,'PENDING_APPROVAL');
 assert.equal(receipts[1].ok,true);assert.equal(receipts[1].idempotent,false);
 assert.equal(receipts[2].ok,true);assert.equal(receipts[2].idempotent,true);
 assert.equal(receipts[1].correctionId,receipts[2].correctionId);assert.equal(receipts[1].revision,receipts[2].revision);
 assert.equal(receipts[3].requestId,request);assert.equal(receipts[3].idempotent,true);
 assert.equal(snapshot(),before);clearApprovalIntent(storage,recovered);assert.equal(rows.size,0);
 console.log('MULTIDAY_APPROVAL_NATIVE_RETAIN_REPLAY_SAME_CORRECTION_ROLLBACK_PASS');
}
