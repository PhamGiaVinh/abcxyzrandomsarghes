-- CLI candidate20261016110956; forward119 after118. LOCAL ONLY, not live approved.
-- Align historical outcome commit with correction's tournament->hand locks.
-- No change to lease/CAS/hash/public proof/queue atomicity or poker calculation.
-- Recovery: disable worker consumer first; restore exact reviewed prior function
-- from preflight receipt only after confirming this new body and preserved ACL.
-- Do not replay an old migration folder or alter outcomes/queue/history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target regprocedure:=to_regprocedure('public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid)');
 definition text; patched text; resolver regprocedure:=to_regprocedure('public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text)'); resolver_definition text;
 old_block text:=$old$  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_hand.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001'; END IF;$old$;
 new_block text:=$new$  -- history119 tournament-first lock: match the canonical correction writer.
  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_hand.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001'; END IF;
  -- Re-read after the lock; the non-locking lookup above was only routing.
  SELECT * INTO v_hand FROM public.tournament_hands
   WHERE id = p_hand_id AND tournament_id = v_tournament.id FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001';
  END IF;$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'history119_dependency_missing'; END IF;
 IF resolver IS NULL THEN RAISE EXCEPTION 'history119_resolver_dependency_missing'; END IF;
 resolver_definition:=replace(pg_get_functiondef(resolver),chr(13),'');
 IF md5(resolver_definition)<>'6195d2299ba44449e13179f0e0874415'
 OR strpos(resolver_definition,'SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id FOR SHARE;')=0 THEN
  RAISE EXCEPTION 'history119_resolver_dependency_drift';
 END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF md5(definition)<>'fcf8dac1239f25742e1c9566d523aa25' THEN RAISE EXCEPTION 'history119_dependency_drift';END IF;
 IF (length(definition)-length(replace(definition,old_block,'')))/length(old_block)<>1 THEN
  RAISE EXCEPTION 'history119_lock_boundary_mismatch';
 END IF;
 patched:=replace(definition,old_block,new_block);
 IF patched=definition THEN RAISE EXCEPTION 'history119_patch_missing';END IF;
 EXECUTE patched;
 -- The old History resolver holds hand first. Its authorization needs only a
 -- plain tournament read; retaining FOR SHARE would invert the new writer order.
 EXECUTE replace(resolver_definition,
  'SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id FOR SHARE;',
  'SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id; -- history119 plain authorization read');
END;
$patch$;
COMMIT;
