-- Local candidate, ordered after the multi-day scope migration.
-- ROLLBACK: restore prior RPC via a forward migration. Retain provenance rows
-- and the expanded constraint for previously written finalization-backed rows.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $migration$
DECLARE
 target regprocedure := 'public.series_promote_native_event_actual_v1(uuid,text)'::regprocedure;
 definition text := pg_get_functiondef(target);
 marker text := '  SELECT pg_catalog.jsonb_build_object(';
 source_marker text := '  v_source_fingerprint := public._series_sha256_jsonb_v1(v_source_payload);';
 old_label text := '''native-confirmed-prize-contribution-v1'',v_source_fingerprint';
 new_label text := 'CASE WHEN v_event.phase=''final'' AND v_event.event_id IS NOT NULL THEN ''native-multiday-finalized-pool-v1'' ELSE ''native-confirmed-prize-contribution-v1'' END,v_source_fingerprint';
 economics text := $body$
  IF v_event.phase='final' AND v_event.event_id IS NOT NULL THEN
    SELECT * INTO STRICT v_funding
    FROM public.multi_day_payout_finalizations_v1 p
    WHERE p.event_id=v_event.event_id AND p.club_id=v_event.club_id AND p.final_tournament_id=v_event.id;
    v_prize_pool := v_funding.direct_pool_vnd::numeric + v_funding.transfer_pool_vnd::numeric + v_funding.recorded_overlay_vnd::numeric;
    v_overlay_amount := v_funding.recorded_overlay_vnd;
    v_overlay_availability := CASE WHEN v_overlay_amount=0 THEN 'explicit_zero' ELSE 'present' END;
  END IF;
$body$;
BEGIN
 IF position(new_label IN definition)>0 THEN RETURN; END IF;
 IF position('native_actual_multiday_parent_not_final' IN definition)=0
   OR length(definition)-length(replace(definition, marker, ''))<>length(marker)
   OR length(definition)-length(replace(definition, source_marker, ''))<>length(source_marker)
   OR length(definition)-length(replace(definition, old_label, ''))<>length(old_label)
   OR position('  v_source_payload jsonb;' IN definition)=0 THEN
   RAISE EXCEPTION 'series_multiday_finalized_economics_drift';
 END IF;
 ALTER TABLE public.series_event_actual_native_sources_v1 DROP CONSTRAINT seas_v1_economics_contract_chk;
 ALTER TABLE public.series_event_actual_native_sources_v1 ADD CONSTRAINT seas_v1_economics_contract_chk
   CHECK (economics_contract_version IN ('native-confirmed-prize-contribution-v1','native-multiday-finalized-pool-v1'));
 definition:=replace(definition,'  v_source_payload jsonb;','  v_source_payload jsonb;'||chr(10)||'  v_funding public.multi_day_payout_finalizations_v1%ROWTYPE;');
 definition:=replace(definition,marker,economics||marker);
 definition:=replace(definition,source_marker,$source$
  IF v_event.phase='final' AND v_event.event_id IS NOT NULL THEN
    v_source_payload:=v_source_payload||pg_catalog.jsonb_build_object(
      'fundingRevision',v_funding.funding_revision,'payoutInputHash',v_funding.payout_input_hash,
      'qualificationRevision',v_funding.qualification_revision,'directPoolVnd',v_funding.direct_pool_vnd,
      'transferPoolVnd',v_funding.transfer_pool_vnd,
      'recordedOverlayVnd',v_funding.recorded_overlay_vnd);
  END IF;
$source$||source_marker);
 EXECUTE replace(definition,old_label,new_label);
END $migration$;

COMMIT;
