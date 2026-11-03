-- Recovery template only. Apply as a NEW reviewed versioned migration if needed.
-- Restores the exact pre-release reader; keeps every payment and audit row.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $rollback$
DECLARE definition text; replacement text;
BEGIN
 definition:=replace(pg_get_functiondef('public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)'::regprocedure),chr(13),'');
 definition:=replace(definition,'v_unchanged boolean; v_public_revision text; BEGIN','v_unchanged boolean; BEGIN');
 replacement:=$old$    v_public_revision:=coalesce(v_pub.publication_revision::text,'0');
    IF v_component='payout' THEN
      v_payload:=floor_private.payout_public_rows_after_payment_v1(p_tournament_id,v_payload);
      v_public_revision:=md5(v_public_revision||':'||v_payload::text);
    END IF;
    v_unchanged:=COALESCE(p_known_revisions->>v_component,'')=v_public_revision$old$;
 definition:=replace(definition,replacement,'    v_unchanged:=COALESCE(p_known_revisions->>v_component,'''')=COALESCE(v_pub.publication_revision::text,''0'')');
 definition:=replace(definition,'''revision'',v_public_revision','''revision'',COALESCE(v_pub.publication_revision::text,''0'')');
 IF md5(definition)<>'c23a5810b1307994c1b3428958bd92e0' THEN
   RAISE EXCEPTION 'payout_rollback_reader_drift';
 END IF;
 EXECUTE definition;
END $rollback$;
DROP FUNCTION public.get_floor_tournament_prize_results_v1(uuid);
DROP FUNCTION floor_private.payout_public_rows_after_payment_v1(uuid,jsonb);
DROP FUNCTION floor_private.tournament_prize_result_contexts_v1(uuid);
COMMIT;
