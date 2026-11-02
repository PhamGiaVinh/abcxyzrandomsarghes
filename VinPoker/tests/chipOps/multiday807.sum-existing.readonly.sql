\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ DECLARE p record;source record;total bigint;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 WHERE event_id='1cb64e29-c5d8-43e3-b8d9-7815905749b1' AND policy='SUM_STACKS');
 ASSERT (SELECT count(*)=8 AND count(DISTINCT player_id)=8 AND sum(carried_stack)=320000 FROM public.multi_day_final_participations_v1 WHERE event_id='1cb64e29-c5d8-43e3-b8d9-7815905749b1');
 FOR p IN SELECT * FROM public.multi_day_final_participations_v1 WHERE event_id='1cb64e29-c5d8-43e3-b8d9-7815905749b1' LOOP
  ASSERT jsonb_array_length(p.source_bags)=2 AND p.selected_bag_id IS NULL AND p.carried_stack=40000;
  total:=0;
  FOR source IN SELECT value b FROM jsonb_array_elements(p.source_bags) LOOP
   ASSERT EXISTS(SELECT 1 FROM public.chip_bag b JOIN public.tournament_entries e ON e.id=(source.b->>'sourceEntryId')::uuid
    WHERE b.id=(source.b->>'bagId')::uuid AND b.player_id=p.player_id AND b.tournament_id=(source.b->>'flightId')::uuid
    AND b.sealed AND b.multi_day_revision=(source.b->>'bagVersion')::int
    AND coalesce(b.total_value,b.stack_value)=(source.b->>'stack')::bigint
    AND e.player_id=p.player_id AND e.tournament_id=b.tournament_id);
   total:=total+(source.b->>'stack')::bigint;
  END LOOP;
  ASSERT total=p.carried_stack;
  ASSERT (SELECT count(*)=1 AND bool_and(s.chip_count=p.carried_stack) FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
   WHERE s.tournament_id=p.final_tournament_id AND e.player_id=p.player_id AND e.tournament_id=p.final_tournament_id AND s.is_active);
 END LOOP;
 ASSERT (SELECT count(*)=16 AND sum(amount)=1600000 FROM public.cashier_buyin_movements WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE event_id='1cb64e29-c5d8-43e3-b8d9-7815905749b1'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id='a8a56692-2752-4f9d-b57c-f78d9b354d34');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='a8a56692-2752-4f9d-b57c-f78d9b354d34');
END $$;
SET LOCAL request.jwt.claim.sub='495e96be-c00b-4e68-b227-593300f3e2bc';SET LOCAL request.jwt.claims='{"sub":"495e96be-c00b-4e68-b227-593300f3e2bc","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.multi_day_final_roster_v1('1cb64e29-c5d8-43e3-b8d9-7815905749b1');
 ASSERT jsonb_array_length(r->'players')=8 AND jsonb_array_length(r->'tables')=3;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'players')p WHERE p->>'state'<>'SEATED' OR (p->>'stack')::bigint<>40000 OR jsonb_array_length(p->'sourceBags')<>2);
 ASSERT jsonb_array_length(r->'initialDraws')=1 AND jsonb_array_length(r->'initialDraws'->0->'assignments')=8;
 ASSERT (SELECT array_agg(DISTINCT (p->>'tableNumber')::int ORDER BY (p->>'tableNumber')::int)=ARRAY[20,21,22] FROM jsonb_array_elements(r->'initialDraws'->0->'assignments')p);
 ASSERT (r->>'releaseEnabled')::boolean=false,'readonly acceptance must not enable the package';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.multi_day_final_roster_v1('1cb64e29-c5d8-43e3-b8d9-7815905749b1');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied,'owner of original Main cannot read another TEST club private D2 roster';
END $$;
RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.multi_day_final_roster_v1('1cb64e29-c5d8-43e3-b8d9-7815905749b1');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied,'anonymous must use public projections, not private D2 roster';
END $$;
RESET ROLE;ROLLBACK;
SELECT 'MULTIDAY807_EXISTING_SUM_STACKS_EIGHT_PLAYERS_TWO_BAGS_EACH_320K_THREE_SAVED_TABLES_NO_FINAL_CASH_PASS';
