-- CLI candidate20261020014756 -> forward198 after qualified local catalog check.
-- Pure recovery lookup. No writer replay, permission expansion, or session guess.
-- Rollback: revoke authenticated EXECUTE and drop this new function only.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $preflight$ BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000198')
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_tracker_undo_receipt_v1')
 OR md5(replace(pg_get_functiondef('public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),''))<>'273b34a53a9114af87d9d8bc940dce38'
 OR md5(replace(pg_get_functiondef('public.is_club_tracker(uuid,uuid)'::regprocedure),chr(13),''))<>'754a878cd17019d6cb0b27aad6a10e84'
 OR has_table_privilege('authenticated','public.tracker_correction_operations','SELECT') THEN
  RAISE EXCEPTION 'tracker_undo_receipt198_catalog_drift_or_collision';
 END IF;
END $preflight$;

-- Definer is necessary because the operation ledger is intentionally NOT
-- browser-readable. Both actor ownership and current exact-club read authority
-- are checked here before exposing any receipt. No client actor parameter.
CREATE FUNCTION public.get_tracker_undo_receipt_v1(
 p_tournament_id uuid,p_tournament_table_id uuid,p_hand_id uuid,
 p_expected_action_id uuid,p_expected_source_revision bigint,p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 actor uuid:=auth.uid();club uuid;payload_hash text;
 operation public.tracker_correction_operations%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','authentication_required');END IF;
 IF p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_hand_id IS NULL
 OR p_expected_action_id IS NULL OR p_expected_source_revision IS NULL
 OR p_expected_source_revision<1 OR p_idempotency_key IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');END IF;
 SELECT t.club_id INTO club FROM public.tournaments t
 JOIN public.tournament_tables tt ON tt.tournament_id=t.id AND tt.id=p_tournament_table_id
 JOIN public.tournament_hands h ON h.id=p_hand_id AND h.tournament_id=t.id AND h.tournament_table_id=tt.id
 WHERE t.id=p_tournament_id;
 IF NOT FOUND OR public.is_club_tracker(actor,club) IS NOT TRUE THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','tracker_scope_denied');END IF;
 -- Same canonical payload hash as the unchanged Undo writer.
 payload_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
  'tournament_id',p_tournament_id,'tournament_table_id',p_tournament_table_id,
  'hand_id',p_hand_id,'action_id',p_expected_action_id,'source_revision',p_expected_source_revision)::text);
 SELECT * INTO operation FROM public.tracker_correction_operations o
 WHERE o.actor_user_id=actor AND o.idempotency_key=p_idempotency_key;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',true,'outcome','not_found','actor_id',actor,'request_id',p_idempotency_key);
 END IF;
 IF operation.operation<>'undo_open_hand' OR operation.request_hash<>payload_hash
 OR operation.tournament_id<>p_tournament_id OR operation.tournament_table_id<>p_tournament_table_id
 OR operation.hand_id<>p_hand_id THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','request_key_conflict');END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'outcome','recorded','actor_id',actor,'request_id',p_idempotency_key,
  'receipt',operation.receipt||pg_catalog.jsonb_build_object('duplicate',true));
END $function$;
ALTER FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid) TO authenticated;
COMMIT;
