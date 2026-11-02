-- CLI candidate20261018224558, local catalog reservation172 (after171).
-- LOCAL ONLY; production digest/caller/release review remains required.
-- Same projection/rotation/rest semantics. Repair both API names, not history.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
DECLARE expected record;p record;
BEGIN
 IF current_user<>'postgres' OR to_regprocedure('floor_private.floor_table_v3_actor_is_dealer_operator(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'prediction172_dependency_or_owner_drift';END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('public.get_table_assignments_with_next(uuid)','d8ea853277ea4edc3ae4d45e88f0b2c9'),
  ('public.predict_next_dealers(uuid)','848455f7d0746cd9f5d7297403c09682')) v(signature,hash) LOOP
  SELECT prosrc,proowner,prosecdef,proconfig INTO p FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM expected.hash OR pg_get_userbyid(p.proowner)<>'postgres'
   OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
   RAISE EXCEPTION 'prediction172_definition_drift: %',expected.signature;END IF;
 END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_table_assignments_with_next(p_club_id uuid)
RETURNS TABLE(table_id uuid,table_name text,current_dealer text,next_dealer text,next_dealer_tier text,
 minutes_until_swing integer,overtime_started_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF p_club_id IS NULL THEN RAISE EXCEPTION 'prediction_club_required' USING ERRCODE='22023';END IF;
 -- The enclosing definer is postgres; inspect the actual invoking role,
 -- never an editable JWT role claim, for the internal service path.
 IF pg_catalog.current_setting('role',true) IS DISTINCT FROM 'service_role'
  AND NOT floor_private.floor_table_v3_actor_is_dealer_operator(auth.uid(),p_club_id) THEN
  RAISE EXCEPTION 'prediction_club_actor_denied' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT gt.id,gt.table_name,d_current.full_name,d_next.full_name,d_next.tier,
  EXTRACT(EPOCH FROM (da.swing_due_at-NOW()))::integer/60,da.overtime_started_at
 FROM public.dealer_assignments da
 JOIN public.game_tables gt ON gt.id=da.table_id
 JOIN public.dealer_attendance att ON att.id=da.attendance_id
 JOIN public.dealers d_current ON d_current.id=att.dealer_id
 LEFT JOIN public.dealer_attendance att_next ON att_next.id=da.pre_assigned_attendance_id
 LEFT JOIN public.dealers d_next ON d_next.id=att_next.dealer_id
 WHERE da.status='assigned' AND da.swing_processed_at IS NULL AND gt.club_id=p_club_id
 ORDER BY da.overtime_started_at ASC NULLS LAST,da.swing_due_at ASC;
END;
$function$;
CREATE OR REPLACE FUNCTION public.predict_next_dealers(p_club_id uuid)
RETURNS TABLE(table_id uuid,table_name text,current_dealer text,next_dealer text,next_dealer_tier text,
 minutes_until_swing integer,overtime_started_at timestamptz)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=''
AS $function$ SELECT * FROM public.get_table_assignments_with_next(p_club_id); $function$;
ALTER FUNCTION public.get_table_assignments_with_next(uuid) OWNER TO postgres;
ALTER FUNCTION public.predict_next_dealers(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_table_assignments_with_next(uuid),public.predict_next_dealers(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_table_assignments_with_next(uuid),public.predict_next_dealers(uuid) TO authenticated,service_role;
COMMIT;
