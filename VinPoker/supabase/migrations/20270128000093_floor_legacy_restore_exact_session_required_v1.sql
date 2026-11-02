-- CLI-created candidate20261015203628; forward93 reserved in this local source.
-- NOT production-approved/applied. Recheck live catalog before release.
-- Old bare intent cannot safely recover an exact session or request receipt.
-- Deploy canonical cockpit/dialog consumer before retiring this endpoint.
-- Recovery: reviewed forward change from captured pre-apply definition/ACL;
-- never restore operational rows or delete audit/receipts to undo this DDL.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE fn regprocedure:=to_regprocedure('public.restore_busted_player_to_seat(uuid,uuid,integer,uuid,text)');
BEGIN
 IF fn IS NULL OR md5(replace(pg_get_functiondef(fn),chr(13),''))<>'77d5d7871bccb4a9469b6816ff77333e'
  OR (SELECT proowner FROM pg_proc WHERE oid=fn)<>'postgres'::regrole
  OR to_regprocedure('public.floor_restore_busted_player_to_seat_v5(uuid,uuid,integer,bigint,bigint,uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'legacy_restore93_baseline_drift';
 END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.restore_busted_player_to_seat(
 p_entry_id uuid,p_to_tournament_table_id uuid,p_to_seat_number integer,
 p_actor_user_id uuid DEFAULT NULL,p_reason text DEFAULT 'floor_restore'
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$
 SELECT jsonb_build_object('ok',false,'error','exact_session_required');
$function$;
REVOKE ALL ON FUNCTION public.restore_busted_player_to_seat(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.restore_busted_player_to_seat(uuid,uuid,integer,uuid,text) TO authenticated;
COMMIT;
