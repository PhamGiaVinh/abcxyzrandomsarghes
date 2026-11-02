-- CLI candidate20261020031035 -> forward199 after qualified LOCAL catalog check.
-- Atomic mutable projections only. No backfill, receipt rewrite or activation.
-- Recovery: restore captured predecessor function in a reviewed forward patch;
-- retain corrections/audit. Existing drift requires separate evidenced repair.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target regprocedure:='public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 definition text;marker text;replacement text;before_meta jsonb;after_meta jsonb;
BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000199')
 OR NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.uq_tournament_entries_per_entry')
  AND i.indisunique AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX uq_tournament_entries_per_entry ON public.tournament_entries USING btree (tournament_id, player_id, entry_no)')
 OR NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.uq_tournament_seats_active_entry_v3')
  AND i.indisunique AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX uq_tournament_seats_active_entry_v3 ON public.tournament_seats USING btree (tournament_id, entry_id) WHERE ((is_active = true) AND (entry_id IS NOT NULL))')
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'9d871978a3f3b5ab816177d2ede98a97' THEN
  RAISE EXCEPTION 'correction_entry199_catalog_drift_or_collision';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,
  'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_meta FROM pg_proc WHERE oid=target;
 IF before_meta->>'owner'<>'postgres' OR before_meta->>'definer'<>'true'
 OR before_meta->'config' IS DISTINCT FROM '["search_path=public"]'::jsonb
 OR before_meta->>'acl'<>'{postgres=X/postgres}' THEN RAISE EXCEPTION 'correction_entry199_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 marker:=E'  v_result jsonb;\nBEGIN';
 replacement:=E'  v_result jsonb;\n  v_entry_id uuid;\n  v_seat_id uuid;\nBEGIN';
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'correction_entry199_declaration_anchor';END IF;
 definition:=replace(definition,marker,replacement);
 marker:=$old$  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_final_stacks, '[]'::jsonb)) LOOP
    v_expected := (v_item->>'expected_current')::numeric;
    v_next := (v_item->>'chip_count')::numeric;
    IF v_expected < 0 OR v_next < 0 THEN RAISE EXCEPTION 'negative_live_stack' USING ERRCODE = '22023'; END IF;
    UPDATE public.tournament_chip_counts
    SET chip_count = v_next, updated_at = now()
    WHERE tournament_id = v_hand.tournament_id
      AND player_id = (v_item->>'player_id')::uuid
      AND entry_number = COALESCE((v_item->>'entry_number')::integer, 1)
      AND chip_count = v_expected;
    IF NOT FOUND THEN RAISE EXCEPTION 'stale_live_stack' USING ERRCODE = '40001'; END IF;
    UPDATE public.tournament_seats SET chip_count = v_next
    WHERE tournament_id = v_hand.tournament_id
      AND player_id = (v_item->>'player_id')::uuid
      AND entry_number = COALESCE((v_item->>'entry_number')::integer, 1);
  END LOOP;$old$;
 replacement:=$new$  -- correction199: same seat -> entry -> count ordering as canonical Finish.
  -- Tournament/hand locks and receipt replay guard above remain unchanged.
  IF jsonb_typeof(p_final_stacks) IS DISTINCT FROM 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_final_stacks) x
    GROUP BY x->>'player_id',x->>'entry_number' HAVING count(*)<>1
  ) THEN RAISE EXCEPTION 'invalid_final_stack_identity' USING ERRCODE='22023';END IF;
  PERFORM s.id FROM public.tournament_seats s
  JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=s.tournament_id
  JOIN jsonb_to_recordset(p_final_stacks) f(player_id uuid,entry_number integer)
    ON f.player_id=e.player_id AND f.entry_number=e.entry_no
  WHERE e.tournament_id=v_hand.tournament_id AND s.is_active
  ORDER BY s.id FOR UPDATE OF s;
  PERFORM e.id FROM public.tournament_entries e
  JOIN jsonb_to_recordset(p_final_stacks) f(player_id uuid,entry_number integer)
    ON f.player_id=e.player_id AND f.entry_number=e.entry_no
  WHERE e.tournament_id=v_hand.tournament_id ORDER BY e.id FOR UPDATE OF e;
  PERFORM c.id FROM public.tournament_chip_counts c
  JOIN jsonb_to_recordset(p_final_stacks) f(player_id uuid,entry_number integer)
    ON f.player_id=c.player_id AND f.entry_number=c.entry_number
  WHERE c.tournament_id=v_hand.tournament_id ORDER BY c.player_id,c.entry_number FOR UPDATE OF c;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_final_stacks) LOOP
    v_expected:=(v_item->>'expected_current')::numeric;v_next:=(v_item->>'chip_count')::numeric;
    IF v_expected IS NULL OR v_next IS NULL OR v_expected<0 OR v_next<0
      OR v_expected<>trunc(v_expected) OR v_next<>trunc(v_next) OR v_next>2147483647
      OR v_item->>'player_id' IS NULL OR (v_item->>'entry_number')::integer IS NULL
      OR (v_item->>'entry_number')::integer<1 THEN
      RAISE EXCEPTION 'invalid_final_stack' USING ERRCODE='22023';END IF;
    IF (v_expected=0) IS DISTINCT FROM (v_next=0) THEN
      RAISE EXCEPTION 'bust_state_change_requires_void' USING ERRCODE='22023';END IF;
    SELECT e.id INTO v_entry_id FROM public.tournament_entries e
    WHERE e.tournament_id=v_hand.tournament_id AND e.player_id=(v_item->>'player_id')::uuid
      AND e.entry_no=(v_item->>'entry_number')::integer AND e.current_stack=v_expected
      AND (e.status='seated' OR (e.status='busted' AND v_expected=0 AND v_next=0));
    IF NOT FOUND THEN RAISE EXCEPTION 'stale_entry_stack' USING ERRCODE='40001';END IF;
    v_seat_id:=NULL;
    IF v_expected>0 THEN
      SELECT s.id INTO v_seat_id FROM public.tournament_seats s
      JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id AND tt.tournament_id=s.tournament_id
        AND tt.table_session_id=s.table_session_id AND tt.status='active'
      JOIN public.table_sessions ts ON ts.id=s.table_session_id AND ts.tournament_id=s.tournament_id
        AND ts.game_table_id=tt.game_table_id AND ts.closed_at IS NULL
      JOIN public.game_tables gt ON gt.id=tt.game_table_id AND gt.club_id=v_tournament.club_id
      WHERE s.entry_id=v_entry_id AND s.tournament_id=v_hand.tournament_id
        AND s.player_id=(v_item->>'player_id')::uuid AND s.entry_number=(v_item->>'entry_number')::integer
        AND s.is_active AND s.status='active' AND s.chip_count=v_expected;
      IF NOT FOUND THEN RAISE EXCEPTION 'stale_seat_stack' USING ERRCODE='40001';END IF;
    ELSIF EXISTS(SELECT 1 FROM public.tournament_seats WHERE entry_id=v_entry_id AND is_active) THEN
      RAISE EXCEPTION 'entry_projection_mismatch' USING ERRCODE='40001';
    END IF;
    UPDATE public.tournament_chip_counts SET chip_count=v_next,updated_at=now()
    WHERE tournament_id=v_hand.tournament_id AND player_id=(v_item->>'player_id')::uuid
      AND entry_number=(v_item->>'entry_number')::integer AND chip_count=v_expected;
    IF NOT FOUND THEN RAISE EXCEPTION 'stale_live_stack' USING ERRCODE='40001';END IF;
    UPDATE public.tournament_entries SET current_stack=v_next,updated_at=now()
    WHERE id=v_entry_id AND current_stack=v_expected;
    IF NOT FOUND THEN RAISE EXCEPTION 'stale_entry_stack' USING ERRCODE='40001';END IF;
    IF v_seat_id IS NOT NULL THEN
      UPDATE public.tournament_seats SET chip_count=v_next WHERE id=v_seat_id AND chip_count=v_expected;
      IF NOT FOUND THEN RAISE EXCEPTION 'stale_seat_stack' USING ERRCODE='40001';END IF;
    END IF;
  END LOOP;$new$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'correction_entry199_stack_anchor';END IF;
 definition:=replace(definition,marker,replacement);EXECUTE definition;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,
  'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_meta FROM pg_proc WHERE oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition THEN
  RAISE EXCEPTION 'correction_entry199_postcheck';END IF;
END $patch$;
COMMIT;
