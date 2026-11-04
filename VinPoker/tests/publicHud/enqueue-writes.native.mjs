import assert from 'node:assert/strict';
import {jsonSql} from './nativeDb.mjs';
// Real trigger/row-version checks. Every source, queue and notification change
// rolls back; use the existing native disposable fixture only.
const result=jsonSql(`BEGIN;SET LOCAL request.jwt.claim.role='service_role';
 CREATE TEMP TABLE enqueue_observations(value jsonb);
 DO $$ DECLARE ids uuid[]; h uuid; moved uuid; t uuid; p uuid; other_player uuid; result_id uuid:=gen_random_uuid(); versions text[]; generation_before bigint; old_generation bigint; proof uuid:=gen_random_uuid(); old_revision bigint; report jsonb:='{}';BEGIN
 SELECT array_agg(id) INTO ids FROM (SELECT DISTINCT h.id FROM public.tournament_hands h JOIN tracker_analytics_v1.hand_contributions c ON c.hand_id=h.id JOIN public.hand_players hp ON hp.hand_id=h.id AND hp.player_id=c.player_id AND hp.tournament_id=h.tournament_id WHERE h.status='completed' AND NOT coalesce(h.is_voided,false) ORDER BY h.id LIMIT 2) candidates;
 IF cardinality(ids)<>2 THEN RAISE EXCEPTION 'Two projected source fixtures required';END IF;h:=ids[1];moved:=ids[2];
 SELECT tournament_id,source_revision INTO t,old_revision FROM public.tournament_hands WHERE id=h;
 SELECT player_id INTO p FROM public.hand_players WHERE hand_id=h ORDER BY player_id LIMIT 1;
 DELETE FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=ANY(ids);
 PERFORM tracker_analytics_v1.enqueue('hand',h);
 SELECT array_agg(ctid::text ORDER BY player_id) INTO versions FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id=h;
 SELECT generation INTO generation_before FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=h;
 UPDATE tracker_analytics_v1.jobs SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',attempts=2 WHERE kind='hand' AND entity_id=h;
 PERFORM tracker_analytics_v1.enqueue('hand',h);
 report:=report||jsonb_build_object('unchangedScopeAvoidsHeapUpdate',versions=(SELECT array_agg(ctid::text ORDER BY player_id) FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id=h),
 'generationAndLeaseFencingPreserved',(SELECT generation=generation_before+1 AND lease_token IS NULL AND lease_until IS NULL AND attempts=0 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=h));
 UPDATE public.tournament_hands SET is_voided=true WHERE id=h;
 report:=report||jsonb_build_object('sourceWithdrawalBlocksImmediately',(SELECT bool_and(hard_block) FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id=h),
 'publicReadWithholdsBlockedTotals',public.get_public_player_hud_summary_v1(t,p,NULL)->>'state'='unavailable');
 SELECT array_agg(ctid::text ORDER BY player_id) INTO versions FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id=h;
 PERFORM tracker_analytics_v1.enqueue('hand',h);
 report:=report||jsonb_build_object('stickyBlockAvoidsHeapUpdate',versions=(SELECT array_agg(ctid::text ORDER BY player_id) FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id=h));
 UPDATE public.tournament_hands SET is_voided=false WHERE id=h;
 report:=report||jsonb_build_object('restoringSourceCannotClearPendingBlock',(SELECT bool_and(hard_block) FROM tracker_analytics_v1.job_players WHERE kind='hand' AND entity_id=h));
 SELECT source_revision INTO old_revision FROM public.tournament_hands WHERE id=h;
 INSERT INTO public.tournament_settlement_outcomes(id,hand_id,source_revision,settlement_revision,status,public_outcome) VALUES(proof,h,old_revision,1,'verified','{}');
 SELECT generation INTO generation_before FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=h;
 UPDATE public.tournament_settlement_outcomes SET status='pending' WHERE id=proof;
 report:=report||jsonb_build_object('sameHandSettlementQueuesOnce',(SELECT generation=generation_before+1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=h),
 'settlementInvalidatesWithoutSourceRevision',(SELECT source_revision=old_revision FROM public.tournament_hands WHERE id=h));
 SELECT generation INTO old_generation FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=h;
 UPDATE public.tournament_settlement_outcomes SET hand_id=moved WHERE id=proof;
 report:=report||jsonb_build_object('settlementMoveQueuesBoth',(SELECT generation=old_generation+1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=h) AND EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=moved));
 SELECT generation INTO generation_before FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=moved;
 DELETE FROM public.tournament_settlement_outcomes WHERE id=proof;
 report:=report||jsonb_build_object('settlementDeleteStillQueues',(SELECT generation=generation_before+1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=moved));
 -- A controlled prior derived result fixture exercises both result UPSERT arms;
 -- this transaction never publishes totals or mutates a financial ledger.
 INSERT INTO public.player_results(id,player_id,prize,verified_by_admin) VALUES(result_id,p,10,true);
 INSERT INTO tracker_analytics_v1.result_contributions(result_id,player_id,prize,version) VALUES(result_id,p,10,'public-hud-projection-v1');
 SELECT array_agg(ctid::text ORDER BY player_id) INTO versions FROM tracker_analytics_v1.job_players WHERE kind='result' AND entity_id=result_id;
 PERFORM tracker_analytics_v1.enqueue('result',result_id);
 report:=report||jsonb_build_object('resultUnchangedScopeAvoidsHeapUpdate',versions=(SELECT array_agg(ctid::text ORDER BY player_id) FROM tracker_analytics_v1.job_players WHERE kind='result' AND entity_id=result_id));
 UPDATE public.player_results SET verified_by_admin=false WHERE id=result_id;
 report:=report||jsonb_build_object('resultRevocationRetainsImmediateBlock',(SELECT bool_and(hard_block) FROM tracker_analytics_v1.job_players WHERE kind='result' AND entity_id=result_id));
 SELECT array_agg(ctid::text ORDER BY player_id) INTO versions FROM tracker_analytics_v1.job_players WHERE kind='result' AND entity_id=result_id;
 PERFORM tracker_analytics_v1.enqueue('result',result_id);
 report:=report||jsonb_build_object('resultStickyBlockAvoidsHeapUpdate',versions=(SELECT array_agg(ctid::text ORDER BY player_id) FROM tracker_analytics_v1.job_players WHERE kind='result' AND entity_id=result_id));
 SELECT player_id INTO STRICT other_player FROM public.hand_players WHERE hand_id=h AND player_id<>p LIMIT 1;
 UPDATE public.player_results SET player_id=other_player,verified_by_admin=true WHERE id=result_id;
 report:=report||jsonb_build_object('resultMoveRetainsOldBlockAndAddsNewScope',
 EXISTS(SELECT 1 FROM tracker_analytics_v1.job_players WHERE kind='result' AND entity_id=result_id AND player_id=p AND hard_block)
 AND EXISTS(SELECT 1 FROM tracker_analytics_v1.job_players WHERE kind='result' AND entity_id=result_id AND player_id=other_player AND NOT hard_block));
 INSERT INTO enqueue_observations VALUES(report);
 END $$;SELECT value FROM enqueue_observations;ROLLBACK;`);
console.log(JSON.stringify({kind:'NATIVE_ROLLED_BACK_ENQUEUE_WRITE_CONTRACT',checks:result}));
for(const [name,passed] of Object.entries(result))assert.equal(passed,true,name);
