-- CLI candidate20261016113442; forward120, LOCAL ONLY/not live approved.
-- A nullable legacy session must not bypass revision/proof invalidation when
-- hand scope is changed. Reuse the existing revision, invalidation and queue
-- consumers; no source/backfill/identity inference or result recalculation.
-- Recovery: restore reviewed predecessor trigger in a forward transaction only
-- after stopping writers; this reopens the gap. Never decrement revisions or
-- delete queued generations/outcomes/audit to compensate.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $scope$
DECLARE predecessor text; replacement text;
 old_trigger text:=$old$CREATE TRIGGER trg_tracker_hand_source_revision BEFORE UPDATE OF tournament_id, hand_number, button_seat, community_cards, pot_size, side_pots, status, is_voided, tracker_level_id, tracker_level_number, tracker_small_blind, tracker_big_blind, tracker_bba, tracker_is_break, tracker_blind_evidence ON public.tournament_hands FOR EACH ROW EXECUTE FUNCTION floor_private.bump_hand_identity_revision_v1()$old$;
BEGIN
 IF md5(replace(pg_get_functiondef('floor_private.bump_hand_identity_revision_v1()'::regprocedure),chr(13),''))<>'14f9e44a3b7847753f36efc365b5b208'
 OR md5(replace(pg_get_functiondef('floor_private.invalidate_new_hand_identity_chain_v1()'::regprocedure),chr(13),''))<>'f63d928bf98c03e7315e0e468b15a085'
 OR md5(replace(pg_get_functiondef('public.tracker_enqueue_historical_display_trigger()'::regprocedure),chr(13),''))<>'a95824087a8bd05bf314bbedeed98413' THEN
  RAISE EXCEPTION 'hand_scope120_dependency_drift';
 END IF;
 SELECT pg_get_triggerdef(t.oid) INTO STRICT predecessor FROM pg_trigger t
  WHERE t.tgrelid='public.tournament_hands'::regclass AND t.tgname='trg_tracker_hand_source_revision'
   AND NOT t.tgisinternal AND t.tgenabled='O';
 IF predecessor<>old_trigger THEN RAISE EXCEPTION 'hand_scope120_trigger_drift';END IF;
 replacement:=replace(predecessor,'UPDATE OF tournament_id, hand_number,',
  'UPDATE OF tournament_id, table_id, tournament_table_id, table_session_id, hand_number,');
 IF replacement=predecessor THEN RAISE EXCEPTION 'hand_scope120_patch_missing';END IF;
 EXECUTE 'DROP TRIGGER trg_tracker_hand_source_revision ON public.tournament_hands';
 EXECUTE replacement;
END;
$scope$;
COMMIT;
