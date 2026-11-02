-- LOCAL CANDIDATE218. CLI-created, catalog-reserved; NOT production-applied.
-- Canonical SePay API ingest leaves bank.club_id NULL. Bind only unambiguously
-- owned active bank evidence within the SAME audited overlay transaction.
-- No funding without verified incoming money; no backfill or historical edits.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $migration$
DECLARE definition text; anchor text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=
   'public.multi_day_record_overlay_v1(uuid,text,bigint,text,text,uuid,uuid,uuid,uuid)'::regprocedure)
   IS DISTINCT FROM '93d4b35187d0203f8ca95adb5764a6fe' THEN
   RAISE EXCEPTION 'multiday218_overlay_source_drift';
 END IF;
 definition:=pg_get_functiondef('public.multi_day_record_overlay_v1(uuid,text,bigint,text,text,uuid,uuid,uuid,uuid)'::regprocedure);
 anchor:=' IF p_kind IN(''RECORDED'',''ADJUSTMENT'') THEN';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'multiday218_mapping_anchor_missing'; END IF;
 definition:=replace(definition,anchor,$mapping$
 -- 218: NULL is unbound evidence, never an authorization shortcut. The
 -- account mapping is server-owned, active, exact and uniquely attributable.
 -- SHARE blocks account-map INSERT/UPDATE/DELETE phantoms until this short
 -- money transaction commits. Bank -> event -> account-map is the lock order.
 IF p_kind IN('RECORDED','ADJUSTMENT') AND v_bank.club_id IS NULL THEN
   LOCK TABLE public.platform_bank_accounts IN SHARE MODE;
   IF NOT coalesce((SELECT count(*)=1 AND
       bool_and(a.club_id IS NOT DISTINCT FROM v_event.club_id)
     FROM public.platform_bank_accounts a
     WHERE a.account_number=v_bank.account_number AND a.is_active),false) THEN
     RAISE EXCEPTION 'multi_day_overlay_bank_unverified_or_allocated' USING ERRCODE='23514';
   END IF;
   v_bank.club_id:=v_event.club_id;
 END IF;
$mapping$||anchor);
 anchor:=' IF p_kind=''RECORDED'' THEN';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'multiday218_binding_anchor_missing'; END IF;
 definition:=replace(definition,anchor,$binding$
 -- 218: All original proof/owner/release/unallocated checks above passed.
 -- Claim only this locked, previously unbound row; failure later rolls back
 -- the binding together with the overlay. Allocated bank evidence stays immutable.
 IF p_kind IN('RECORDED','ADJUSTMENT') THEN
   UPDATE public.bank_transactions SET club_id=v_event.club_id
   WHERE id=v_bank.id AND club_id IS NULL;
 END IF;
$binding$||anchor);
 EXECUTE definition;
END $migration$;
COMMIT;
