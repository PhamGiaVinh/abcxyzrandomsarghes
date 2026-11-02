-- CLI candidate20261018120706, local forward146 NOT LIVE.
-- Frozen obligations remain immutable. Live paid amounts come from canonical
-- payment rows less approved append-only reversals, never a stale snapshot.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.multi_day_payout_postfinal_state_v1(uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),''); acl aclitem[];
 old_revision text:=$old$ SELECT c.resulting_revision INTO v_revision
 FROM public.multi_day_payout_corrections_v1 c WHERE c.event_id=p_event_id
 ORDER BY c.approval_seq DESC LIMIT 1;$old$;
 anchor text:=$old$ FROM pg_catalog.jsonb_array_elements(v_final.obligations) o(value)$old$;
BEGIN
 SELECT proacl INTO acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'c4d4dc9c12a329aa9e6584ca8e027274'
  OR length(definition)-length(replace(definition,old_revision,''))<>length(old_revision)
  OR length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'multiday146_postfinal_dependency_drift';END IF;
 definition:=replace(definition,old_revision,$new$ SELECT history.resulting_revision INTO v_revision FROM (
  SELECT c.resulting_revision,c.approval_seq AS action_seq FROM public.multi_day_payout_corrections_v1 c WHERE c.event_id=p_event_id
  UNION ALL SELECT p.resulting_revision,p.action_seq FROM private.multi_day_payment_commits_v1 p WHERE p.event_id=p_event_id
 ) history ORDER BY history.action_seq DESC LIMIT 1;$new$);
 definition:=replace(definition,anchor,anchor||$new$
 LEFT JOIN LATERAL (SELECT coalesce(sum(m.prize_amount),0) AS amount
  FROM public.tournament_prize_payments m WHERE m.tournament_id=v_final.final_tournament_id
   AND m.recipient_ref=(o.value->>'playerId')::uuid AND m.status='paid') pay ON true$new$);
 definition:=replace(definition,$old$(o.value->>'paidVnd')::numeric$old$,'coalesce(pay.amount,0)');
 definition:=replace(definition,$old$'originalPaidVnd',coalesce(pay.amount,0)::bigint$old$,
  $new$'originalPaidVnd',(o.value->>'paidVnd')::numeric::bigint$new$);
 definition:=replace(definition,$old$(o.value->>'unpaidVnd')::numeric$old$,
  $new$((o.value->>'totalVnd')::numeric-coalesce(pay.amount,0))$new$);
 IF position('OR public.is_club_floor(v_actor,v_final.club_id)) THEN' IN definition)=0 THEN RAISE EXCEPTION 'multiday146_actor_anchor_drift';END IF;
 definition:=replace(definition,'OR public.is_club_floor(v_actor,v_final.club_id)) THEN',
  'OR public.is_club_floor(v_actor,v_final.club_id) OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=v_final.club_id AND cc.user_id=v_actor)) THEN');
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'multiday146_acl_drift';END IF;
END $$;
DO $$
DECLARE target regprocedure:='public.multi_day_request_payout_correction_v1(uuid,text,uuid,uuid,bigint,text,text,text,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),''); acl aclitem[];
 needle text:=$old$NOT (v_final.source_snapshot->'payments' @> pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id',p_original_payment_id)))$old$;
 replacement text:=$new$NOT ((v_final.source_snapshot->'payments' @> pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id',p_original_payment_id))) OR EXISTS(
        SELECT 1 FROM private.multi_day_payment_commits_v1 c
        WHERE c.payment_id=p_original_payment_id AND c.event_id=p_event_id
          AND c.participation_id=p_participation_id AND c.tournament_id=v_final.final_tournament_id))$new$;
BEGIN
 SELECT proacl INTO acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'2b0902b95640a5fbbb09af245dcf973a'
  OR length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'multiday146_reversal_dependency_drift';END IF;
 EXECUTE replace(definition,needle,replacement);
 IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'multiday146_reversal_acl_drift';END IF;
END $$;
COMMIT;
