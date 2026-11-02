-- CLI candidate20261019002235; local catalog reservation175. NOT LIVE.
-- Extend current accounting only. Never rewrite the frozen finalization snapshot.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.multi_day_payout_postfinal_state_v1(uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),''); acl aclitem[]; collision boolean;
 needle text:=$old$RETURN private.multi_day_payout_accounting_v1(p_event_id);$old$;
 addition text:=$new$RETURN private.multi_day_payout_accounting_v1(p_event_id)||pg_catalog.jsonb_build_object('reversiblePayments',(
   SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'id',m.id,'participationId',o.value->>'participationId',
     'playerId',m.recipient_ref,'amountVnd',m.prize_amount::bigint)
     ORDER BY m.paid_at,m.id),'[]'::jsonb)
   FROM public.multi_day_payout_finalizations_v1 v_final
   JOIN public.tournament_prize_payments m ON m.tournament_id=v_final.final_tournament_id
   JOIN LATERAL pg_catalog.jsonb_array_elements(v_final.obligations) o(value)
     ON m.recipient_ref=(o.value->>'playerId')::uuid
   WHERE v_final.event_id=p_event_id AND m.club_id=v_final.club_id
     AND m.status='paid' AND m.prize_amount=trunc(m.prize_amount)
     AND m.prize_amount BETWEEN 1 AND 9007199254740991
     AND (v_final.source_snapshot->'payments' @> pg_catalog.jsonb_build_array(
       pg_catalog.jsonb_build_object('id',m.id)) OR EXISTS(
       SELECT 1 FROM private.multi_day_payment_commits_v1 p
       WHERE p.payment_id=m.id AND p.event_id=p_event_id
         AND p.participation_id=(o.value->>'participationId')::uuid
         AND p.participation_id=m.multi_day_participation_id
         AND p.tournament_id=m.tournament_id AND p.club_id=m.club_id
         AND p.player_id=m.recipient_ref AND p.amount_vnd=m.prize_amount))
     AND NOT EXISTS(SELECT 1 FROM public.multi_day_payout_corrections_v1 c
       WHERE c.event_id=p_event_id AND c.kind='PAYMENT_REVERSAL' AND c.original_payment_id=m.id)));$new$;
BEGIN
 IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=''20270128000175'')' INTO collision;
   IF collision THEN RAISE EXCEPTION 'multiday175_migration_catalog_collision';END IF;
 END IF;
 SELECT proacl INTO acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target
   AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""'])
   OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'0516fcd100e777b02c354de3b195316c'
   OR length(definition)-length(replace(definition,needle,''))<>length(needle)
 THEN RAISE EXCEPTION 'multiday175_postfinal_dependency_drift';END IF;
 EXECUTE replace(definition,needle,addition);
 IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN
   RAISE EXCEPTION 'multiday175_acl_drift';END IF;
END $$;
COMMIT;
