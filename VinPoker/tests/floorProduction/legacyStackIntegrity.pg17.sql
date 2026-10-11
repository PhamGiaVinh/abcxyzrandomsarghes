-- Included inside the existing roster fixture's rollback transaction.
-- The fixture has an active hand: no obsolete writer may bypass its stack fence.
CREATE TEMP TABLE legacy_stack_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e) entries,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s) seats,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c) chips,
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h) hands,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p) participants,
 q.player_id,q.entry_number
FROM public.tournament_seats q
WHERE q.tournament_id='f7280000-0000-4000-8000-000000000003'
 AND q.table_session_id=current_setting('test.roster_session')::uuid
 AND q.is_active AND q.seat_number=1;
DO $$ BEGIN
 IF (SELECT count(*) FROM legacy_stack_before)<>1 THEN RAISE EXCEPTION 'ambiguous_stack_fixture'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands h
 JOIN public.hand_players p ON p.hand_id=h.id
 JOIN legacy_stack_before s ON s.player_id=p.player_id AND s.entry_number=p.entry_number
 WHERE h.tournament_id='f7280000-0000-4000-8000-000000000003'
 AND h.table_session_id=current_setting('test.roster_session')::uuid
 AND h.status='in_progress' AND NOT COALESCE(h.is_voided,false))
 THEN RAISE EXCEPTION 'exact_stack_participant_active_hand_missing'; END IF;
END $$;
GRANT SELECT ON legacy_stack_before TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; s record; BEGIN
 SELECT * INTO STRICT s FROM legacy_stack_before;
 IF s.player_id IS NULL OR s.entry_number IS NULL THEN RAISE EXCEPTION 'stack_fixture_missing'; END IF;
 r:=public.update_stack('f7280000-0000-4000-8000-000000000003',s.player_id,s.entry_number,31000);
 IF r->>'status' IS DISTINCT FROM 'error' OR r->>'error' IS DISTINCT FROM 'LEGACY_STACK_WRITE_RETIRED' THEN
  RAISE EXCEPTION 'legacy_single_stack_bypassed_active_hand'; END IF;
 r:=public.bulk_update_stacks('f7280000-0000-4000-8000-000000000003',
  jsonb_build_array(jsonb_build_object('player_id',s.player_id,'entry_number',s.entry_number,'chip_count',32000)));
 IF r->>'status' IS DISTINCT FROM 'error' OR r->>'error' IS DISTINCT FROM 'LEGACY_STACK_WRITE_RETIRED' THEN
  RAISE EXCEPTION 'legacy_bulk_stack_bypassed_active_hand'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.update_stack(NULL,NULL,1,0);
 RAISE EXCEPTION 'anon_single_stack_allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.bulk_update_stacks(NULL,'[]'::jsonb);
 RAISE EXCEPTION 'anon_bulk_stack_allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.update_stack(NULL,NULL,1,0);
 RAISE EXCEPTION 'service_single_stack_allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.bulk_update_stacks(NULL,'[]'::jsonb);
 RAISE EXCEPTION 'service_bulk_stack_allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e) IS DISTINCT FROM (SELECT entries FROM legacy_stack_before)
 OR (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s) IS DISTINCT FROM (SELECT seats FROM legacy_stack_before)
 OR (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c) IS DISTINCT FROM (SELECT chips FROM legacy_stack_before)
 OR (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h) IS DISTINCT FROM (SELECT hands FROM legacy_stack_before)
 OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p) IS DISTINCT FROM (SELECT participants FROM legacy_stack_before)
 THEN RAISE EXCEPTION 'legacy_stack_denial_mutated_fixture'; END IF;
END $$;
\echo LEGACY_STACK_ACTIVE_HAND_INTEGRITY_PASS
