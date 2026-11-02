-- LOCAL retained browser-finished hand. No proof/input changes survive ROLLBACK.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE input_column text; trigger_columns text[]; child text; flags integer; hash_builder regprocedure;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_port()=55441;
 SELECT array_agg(a.attname::text) INTO trigger_columns
 FROM pg_trigger t CROSS JOIN LATERAL unnest(t.tgattr::smallint[]) x(attnum)
 JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=x.attnum
 WHERE t.tgrelid='public.tournament_hands'::regclass
   AND t.tgname='trg_tracker_hand_source_revision' AND t.tgenabled='O';
 ASSERT cardinality(trigger_columns)>0;
 -- Derive dependencies from the ACTUAL historical hash/snapshot SQL body,
 -- not a second manually maintained list of settlement fields. id is its
 -- immutable FK identity; explicit source_revision updates have a separate fence.
 FOREACH hash_builder IN ARRAY ARRAY[
   'public.get_tracker_historical_display_snapshot(uuid,uuid)'::regprocedure,
   'public.get_tournament_settlement_source_hash(uuid)'::regprocedure] LOOP
  FOR input_column IN SELECT DISTINCT m[1] FROM regexp_matches(
    (SELECT prosrc FROM pg_proc WHERE oid=hash_builder), '\mh\.([a-z_]+)','g') m
  LOOP
    IF input_column NOT IN('id','source_revision') THEN
      ASSERT input_column=ANY(trigger_columns),format('source column lacks revision trigger: %s / %s',hash_builder,input_column);
    END IF;
  END LOOP;
 END LOOP;
 FOREACH child IN ARRAY ARRAY['hand_actions','hand_players'] LOOP
   SELECT t.tgtype INTO STRICT flags FROM pg_trigger t
   WHERE t.tgrelid=('public.'||child)::regclass AND t.tgenabled='O'
     AND t.tgfoid='public.tracker_bump_hand_source_revision()'::regprocedure;
   ASSERT (flags & 31)=31,'child writer must fence BEFORE row INSERT/UPDATE/DELETE';
   ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid=('public.'||child)::regclass
       AND t.tgfoid='public.tracker_bump_hand_source_revision()'::regprocedure
       AND cardinality(t.tgattr::smallint[])>0),'child update must cover all source columns';
 END LOOP;
 ASSERT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass
   AND tgname='trg_tracker_enqueue_historical_display' AND tgenabled='O');
 ASSERT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass
   AND tgname='zz_tracker_source_revision_monotonic_v1' AND tgenabled='O');
 RAISE NOTICE 'HISTORICAL_HASH_ACTUAL_INPUT_COLUMNS_AND_ALL_CHILD_WRITERS_FENCED_PASS';
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE hand uuid:='83d02eb2-8f65-4172-a94f-fa34c322e271'; original bigint; col text; changed integer;
BEGIN
 SELECT source_revision INTO STRICT original FROM public.tournament_hands WHERE id=hand AND status='completed';
 -- Identity columns were absent from the older thirteen-field probe. Exercise
 -- their real actor path without inventing a new tournament/session/result.
 FOREACH col IN ARRAY ARRAY['tournament_id','table_id','tournament_table_id','table_session_id','hand_number'] LOOP
   BEGIN
     EXECUTE format('UPDATE public.tournament_hands SET %1$I=%1$I WHERE id=$1',col) USING hand;
     GET DIAGNOSTICS changed=ROW_COUNT;
     ASSERT changed=1;
     ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=hand)>original;
     PERFORM set_config('role','none',true);
     ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes
       WHERE hand_id=hand AND status='verified'),'identity write left a verified proof';
     ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q
       JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
       WHERE h.id=hand AND q.status='pending'),'identity writer did not enqueue current revision';
     RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback identity probe';
   EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
   ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=hand)=original;
 END LOOP;
 RAISE NOTICE 'HISTORY_IDENTITY_WRITER_ACTOR_REVISION_STALE_PROOF_CURRENT_QUEUE_PASS';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
   JOIN public.tournament_hands h ON h.id=o.hand_id AND h.source_revision=o.source_revision
   WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND o.status='verified'
     AND o.verification_scope='historical_display');
END $$;
ROLLBACK;
