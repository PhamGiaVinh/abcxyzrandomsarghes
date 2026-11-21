-- Local candidate. Order after the finalized economics candidate.
-- ROLLBACK: restore the preceding RPC definition via a forward migration.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $migration$
DECLARE
  count_start text := '  SELECT count(*)::bigint, count(DISTINCT tr.player_id)::bigint,';
  count_end text := ' AND tr.status = ''confirmed'';';
  count_offset integer;
  count_tail integer;
  target regprocedure := 'public.series_promote_native_event_actual_v1(uuid,text)'::regprocedure;
  definition text := pg_get_functiondef(target);
  payload_anchor text := '''confirmedRegistrations'', COALESCE((';
  fingerprint_anchor text := '  v_source_fingerprint := public._series_sha256_jsonb_v1(v_source_payload);';
BEGIN
  IF position('Series Final registration count comes from the payload' IN definition)>0 THEN RETURN; END IF;
  IF position('native-multiday-finalized-pool-v1' IN definition)=0
    OR length(definition)-length(replace(definition,payload_anchor,''))<>length(payload_anchor)
    OR length(definition)-length(replace(definition,fingerprint_anchor,''))<>length(fingerprint_anchor)
  THEN
    RAISE EXCEPTION 'series_multiday_registration_snapshot_drift';
  END IF;

  count_offset:=position(count_start IN definition);
  IF count_offset=0 OR length(definition)-length(replace(definition,count_start,''))<>length(count_start) THEN
    RAISE EXCEPTION 'series_multiday_registration_count_anchor_drift';
  END IF;
  count_tail:=position(count_end IN substring(definition FROM count_offset));
  IF count_tail=0 THEN
    RAISE EXCEPTION 'series_multiday_registration_count_tail_drift';
  END IF;
  count_tail:=count_offset+count_tail+length(count_end)-2;
  definition:=left(definition,count_offset-1)||$count$
  IF v_event.phase='final' AND v_event.event_id IS NOT NULL THEN
    -- Series Final registration count comes from the payload.
    v_entries:=0;
    v_unique_players:=0;
    v_prize_pool:=0;
  ELSE
$count$||substring(definition FROM count_offset FOR count_tail-count_offset+1)||chr(10)||'  END IF;'||
    substring(definition FROM count_tail+1);

  IF position('native_actual_multiday_flight_set_mismatch' IN definition)>0 THEN
    EXECUTE definition;
    RETURN;
  END IF;

  definition:=replace(definition,payload_anchor,$payload$
    'lockedFlightScope', CASE WHEN v_event.phase='final' AND v_event.event_id IS NOT NULL THEN (
      SELECT pg_catalog.jsonb_build_object(
        'sourceHash',q.source_hash,
        'flightIds',ARRAY(SELECT id FROM unnest(q.flight_ids) f(id) ORDER BY id),
        'matches',cardinality(q.flight_ids)>0 AND
          ARRAY(SELECT id FROM unnest(q.flight_ids) f(id) ORDER BY id)=ARRAY(
            SELECT child.id FROM public.tournaments child
            WHERE child.event_id=e.id AND child.club_id=e.club_id AND child.phase='flight'
              AND child.deleted_at IS NULL ORDER BY child.id
          )
      )
      FROM public.tournament_events e
      JOIN public.multi_day_qualification_locks_v1 q ON q.event_id=e.id
      WHERE e.id=v_event.event_id AND e.club_id=v_event.club_id AND e.final_tournament_id=v_event.id
    ) END,
$payload$||payload_anchor);
  definition:=replace(definition,fingerprint_anchor,$snapshot$
  IF v_event.phase='final' AND v_event.event_id IS NOT NULL THEN
    IF v_source_payload#>'{lockedFlightScope,matches}' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'native_actual_multiday_flight_set_mismatch' USING ERRCODE='55000';
    END IF;
    SELECT count(*),count(DISTINCT item.value->>'playerId'),
      pg_catalog.date_trunc('milliseconds',greatest(v_event.updated_at,max((item.value->>'updatedAt')::timestamptz)))
      INTO v_entries,v_unique_players,v_source_ts
    FROM pg_catalog.jsonb_array_elements(v_source_payload->'confirmedRegistrations') item(value);
    IF v_entries>9007199254740991 OR v_unique_players>9007199254740991 THEN
      RAISE EXCEPTION 'native_actual_source_count_or_money_invalid' USING ERRCODE='22023';
    END IF;
  ELSE
    v_source_payload:=v_source_payload-'lockedFlightScope';
  END IF;
$snapshot$||fingerprint_anchor);
  EXECUTE definition;
END $migration$;

COMMIT;
