-- Owner decision 2026-10-29: rake/service fee belong to the event day.
-- CLI scaffold20261029090402; pending local candidate, not active ledger.
-- Preserve the existing finance UTC+7 calendar wrapper and exact timestamp
-- interval API. F&B keeps its own sale/refund event recognition unchanged.
-- Rollback: forward restore saved function definition; no data undo needed.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $patch$
DECLARE b record; a record; definition text; patched text;
 old_ym text:=$old$select t.id as tour_id, t.club_id, to_char(t.created_at, 'YYYY-MM') as ym,$old$;
 new_ym text:=$new$select t.id as tour_id, t.club_id, to_char(t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') as ym,$new$;
 old_filter text:='and t.created_at between p_from and p_to';
 new_filter text:='and t.start_time between p_from and p_to';
 report_anchor text:=E'  with\n  acc_clubs as (';
 event_guard text:=$guard$  -- Event-day recognition cannot invent a date for confirmed registrations.
  if exists (select 1 from public.tournament_registrations tr
    join public.tournaments t on t.id=tr.tournament_id
    where tr.status='confirmed' and t.club_id=any(v_club_ids) and t.start_time is null
      and (coalesce(t.rake_amount,0)<>0 or coalesce(t.service_fee_amount,0)<>0
        or greatest(0,coalesce(tr.total_pay,0)-coalesce(tr.buy_in,0)-coalesce(t.service_fee_amount,0))<>0)) then
    raise exception 'finance_report_event_start_unavailable' using errcode='22023';
  end if;

$guard$;
BEGIN
 SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') AS definition INTO STRICT b
 FROM pg_proc p WHERE oid='public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure;
 IF current_user<>'postgres' OR md5(b.prosrc)<>'c8a6b9d7bc5778a771b42a3c60454270'
 OR pg_get_userbyid(b.proowner)<>'postgres'
 OR to_regclass('floor_private.finance_event_day_definition_backup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'finance_event_day_dependency_drift_or_collision';
 END IF;
 definition:=b.definition;
 IF cardinality(string_to_array(definition,old_ym))<>2 OR cardinality(string_to_array(definition,old_filter))<>2
 OR cardinality(string_to_array(definition,report_anchor))<>2 THEN
  RAISE EXCEPTION 'finance_event_day_patch_anchor_drift';
 END IF;
 CREATE TABLE floor_private.finance_event_day_definition_backup_v1(
  signature text PRIMARY KEY,definition text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 REVOKE ALL ON floor_private.finance_event_day_definition_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.finance_event_day_definition_backup_v1(signature,definition)
 VALUES('public.get_club_finance_summary(timestamptz,timestamptz,uuid)',pg_get_functiondef(b.oid));
 patched:=replace(replace(replace(definition,old_ym,new_ym),old_filter,new_filter),report_anchor,event_guard||report_anchor);
 EXECUTE patched;
 SELECT * INTO STRICT a FROM pg_proc WHERE oid=b.oid;
 IF a.prosrc IS NOT DISTINCT FROM b.prosrc OR a.proacl IS DISTINCT FROM b.proacl OR a.proowner<>b.proowner
 OR a.prosecdef IS DISTINCT FROM b.prosecdef OR a.proconfig IS DISTINCT FROM b.proconfig
 OR a.provolatile IS DISTINCT FROM b.provolatile THEN RAISE EXCEPTION 'finance_event_day_metadata_changed';END IF;
END;
$patch$;
COMMIT;
