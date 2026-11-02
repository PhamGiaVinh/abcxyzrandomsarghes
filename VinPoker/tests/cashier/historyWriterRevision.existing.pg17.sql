-- Retained browser-finished hand; each probe and all grants roll back.
BEGIN;
SET LOCAL statement_timeout='10s';
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$ BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
  ASSERT inet_server_addr()='127.0.0.1'::inet;
  ASSERT EXISTS(SELECT 1 FROM public.tournament_hands h
    JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id AND o.source_revision=h.source_revision
    WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND h.status='completed'
      AND o.status='verified' AND o.verification_scope='historical_display'),'verified browser fixture required';
END $$;
SELECT set_config('request.jwt.claim.sub','a364de8e-06b1-4428-a20d-ac614ec406e5',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE original bigint; col text; tbl text; changed int; saved jsonb; after_delete bigint;
BEGIN
  SELECT source_revision INTO STRICT original FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271';
  BEGIN
    UPDATE public.tournament_hands SET tracker_big_blind=COALESCE(tracker_big_blind,0)+1
      WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271';
    RAISE EXCEPTION 'DIRECT_BLIND_SNAPSHOT_REWRITE_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'tracker_blind_snapshot_server_owned' THEN RAISE; END IF;
  END;
  ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271')=original,'denied blind rewrite changed revision';
  -- Same-value UPDATE deliberately tests column-trigger dispatch without inventing
  -- another poker result. The contract conservatively invalidates even no-ops.
  FOREACH col IN ARRAY ARRAY['community_cards','button_seat','pot_size','side_pots','status','is_voided',
    'tracker_level_id','tracker_level_number','tracker_small_blind','tracker_big_blind','tracker_bba','tracker_is_break','tracker_blind_evidence'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.tournament_hands SET %1$I=%1$I WHERE id=$1',col)
        USING '83d02eb2-8f65-4172-a94f-fa34c322e271'::uuid;
      GET DIAGNOSTICS changed=ROW_COUNT;
      ASSERT changed=1,'probe did not reach the actor write path';
      ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271')>original, 'source update did not advance revision';
      PERFORM set_config('role','none',true);
      ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND status='verified'),'parent write retained verified proof';
      ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
        WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND q.status='pending'),'parent write missing current queue';
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='probe rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
    ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271')=original;
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['hand_actions','hand_players'] LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%1$I WHERE ctid=(SELECT ctid FROM public.%1$I WHERE hand_id=$1 LIMIT 1) RETURNING to_jsonb(%1$I)',tbl)
        INTO STRICT saved USING '83d02eb2-8f65-4172-a94f-fa34c322e271'::uuid;
      SELECT source_revision INTO STRICT after_delete FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271';
      ASSERT after_delete>original,'child DELETE did not advance revision';
      EXECUTE format('INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,$1)).*',tbl) USING saved;
      ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271')>after_delete,'child INSERT did not advance revision';
      PERFORM set_config('role','none',true);
      ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND status='verified'),'child delete/insert retained verified proof';
      ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
        WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND q.status='pending'),'child delete/insert missing current queue';
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='probe rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['hand_actions','hand_players'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.%1$I SET hand_id=hand_id WHERE ctid=(SELECT ctid FROM public.%1$I WHERE hand_id=$1 LIMIT 1)',tbl)
        USING '83d02eb2-8f65-4172-a94f-fa34c322e271'::uuid;
      GET DIAGNOSTICS changed=ROW_COUNT;
      ASSERT changed=1,'child fixture/actor update missing';
      ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271')>original,'child update did not advance revision';
      PERFORM set_config('role','none',true);
      ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND status='verified'),'child write retained verified proof';
      ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
        WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND q.status='pending'),'child write missing current queue';
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='probe rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id AND h.source_revision=o.source_revision
    WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND o.status='verified'),'probe did not restore original proof';
END $$;
ROLLBACK;
\echo HISTORY_THIRTEEN_PARENT_CHILD_UPDATE_INSERT_DELETE_REVISION_ROLLBACK_PASS
