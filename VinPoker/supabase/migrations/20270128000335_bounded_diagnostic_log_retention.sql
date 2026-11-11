-- Owner-gated forward migration. Keep the original created_at >7d retention;
-- the existing cleanup_diagnostic_logs(int) uses timestamp and is NOT equivalent.
-- No financial/audit/hand/dispatch tables, managed extension objects or roles change.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'diagnostic_retention_wrong_actor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cleanup_old_diagnostic_logs()')
   AND proowner='postgres'::regrole AND NOT prosecdef AND proconfig IS NULL
   AND md5(replace(prosrc,chr(13),''))='270e91b946d67a6be9cfece5b06f1ac3') THEN
   RAISE EXCEPTION 'diagnostic_retention_predecessor_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='retention_private' AND nspowner='postgres'::regrole)
   OR to_regclass('retention_private.diagnostic_checkpoint') IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.diagnostic_logs'::regclass
     AND relowner='postgres'::regrole AND relrowsecurity AND NOT relforcerowsecurity)
   OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.diagnostic_logs'::regclass
     AND indisprimary AND indisvalid AND indisready AND indnkeyatts=1
     AND pg_get_indexdef(indexrelid,1,true)='id')
   OR EXISTS(SELECT 1 FROM pg_constraint WHERE confrelid='public.diagnostic_logs'::regclass)
   OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.diagnostic_logs'::regclass
     AND NOT tgisinternal AND tgenabled<>'D' AND(tgtype::int&8)=8) THEN
   RAISE EXCEPTION 'diagnostic_retention_catalog_drift'; END IF;
END $guard$;
CREATE TABLE retention_private.diagnostic_checkpoint(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 scan_after uuid,sweep_ceiling uuid,
 completed_sweeps bigint NOT NULL DEFAULT 0,
 total_inspected bigint NOT NULL DEFAULT 0,total_deleted bigint NOT NULL DEFAULT 0,
 last_inspected integer NOT NULL DEFAULT 0,last_deleted integer NOT NULL DEFAULT 0,
 last_work_ms numeric NOT NULL DEFAULT 0,last_started_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE retention_private.diagnostic_checkpoint ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON retention_private.diagnostic_checkpoint FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO retention_private.diagnostic_checkpoint(singleton) VALUES(true);

CREATE OR REPLACE FUNCTION public.cleanup_old_diagnostic_logs()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE
 v_after uuid;v_ceiling uuid;v_id uuid;v_rows integer;
 v_inspected integer:=0;v_deleted integer:=0;v_complete boolean:=false;
 v_started timestamptz:=clock_timestamp();v_cursor refcursor;
BEGIN
 IF current_user<>'postgres' THEN RAISE insufficient_privilege USING MESSAGE='diagnostic_retention_scheduler_only'; END IF;
 IF NOT pg_try_advisory_xact_lock(70335,1) THEN RETURN; END IF;
 SELECT scan_after,sweep_ceiling INTO STRICT v_after,v_ceiling
 FROM retention_private.diagnostic_checkpoint WHERE singleton FOR UPDATE;
 IF v_ceiling IS NULL THEN
   SELECT id INTO v_ceiling FROM public.diagnostic_logs ORDER BY id DESC LIMIT 1;
 END IF;
 IF v_after IS NULL THEN
   OPEN v_cursor NO SCROLL FOR SELECT id FROM public.diagnostic_logs
   WHERE id<=v_ceiling ORDER BY id LIMIT 5000;
 ELSE
   OPEN v_cursor NO SCROLL FOR SELECT id FROM public.diagnostic_logs
   WHERE id>v_after AND id<=v_ceiling ORDER BY id LIMIT 5000;
 END IF;
 LOOP
   EXIT WHEN v_inspected>=5000 OR clock_timestamp()-v_started>=interval '2 seconds';
   FETCH v_cursor INTO v_id;
   IF NOT FOUND THEN v_complete:=true; EXIT; END IF;
   v_inspected:=v_inspected+1;v_after:=v_id;
   -- Recheck created_at under a row lock. timestamp is deliberately irrelevant.
   WITH locked AS MATERIALIZED(
     SELECT id FROM public.diagnostic_logs
     WHERE id=v_id AND created_at<now()-interval '7 days' FOR UPDATE SKIP LOCKED
   )
   DELETE FROM public.diagnostic_logs d USING locked l
   WHERE d.id=l.id AND d.created_at<now()-interval '7 days';
   GET DIAGNOSTICS v_rows=ROW_COUNT;v_deleted:=v_deleted+v_rows;
 END LOOP;
 CLOSE v_cursor;
 v_complete:=v_complete OR v_ceiling IS NULL OR coalesce(v_after>=v_ceiling,false);
 UPDATE retention_private.diagnostic_checkpoint SET
   scan_after=CASE WHEN v_complete THEN NULL ELSE v_after END,
   sweep_ceiling=CASE WHEN v_complete THEN NULL ELSE v_ceiling END,
   completed_sweeps=completed_sweeps+CASE WHEN v_complete THEN 1 ELSE 0 END,
   total_inspected=total_inspected+v_inspected,total_deleted=total_deleted+v_deleted,
   last_inspected=v_inspected,last_deleted=v_deleted,
   last_work_ms=extract(epoch FROM(clock_timestamp()-v_started))*1000,
   last_started_at=v_started,updated_at=clock_timestamp() WHERE singleton;
END $function$;
-- This is a scheduler entrypoint, not an exposed definer RPC. Preserve INVOKER.
REVOKE ALL ON FUNCTION public.cleanup_old_diagnostic_logs() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
