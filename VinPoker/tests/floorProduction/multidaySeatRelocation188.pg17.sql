-- Caller owns BEGIN / candidate migration / ROLLBACK. Never commits the journey.
SAVEPOINT before_break188;
DO $$ BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
  ASSERT inet_server_port()=55441;
  ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=15;
  ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='e16d00d3-8537-45e1-893c-fc1f574ea17c' AND is_active)=3;
  ASSERT (SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=300000;
END $$;
CREATE TEMP TABLE original188 AS SELECT
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY participation_id) FROM public.multi_day_final_seatings_v1 s
    WHERE final_tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580') initial_seatings,
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m) cash,
  (SELECT jsonb_agg(to_jsonb(i) ORDER BY stack_template_id) FROM public.stack_template_issuance i) issuance;
CREATE TEMP TABLE gates188 AS SELECT * FROM public.centerpoint_tournament_ops_release;
CREATE TEMP TABLE package188 AS SELECT * FROM public.multi_day_package_release_v1;
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TEMP TABLE calls188(name text PRIMARY KEY,result jsonb);
INSERT INTO calls188(name) VALUES('outsider'),('plan'),('break'),('replay'),('conflict'),('move');
GRANT SELECT,UPDATE ON calls188 TO authenticated;
SELECT revision AS source_revision FROM public.table_sessions WHERE id='ca3c62fa-b4c5-4739-b571-5560dce53036' \gset
SET LOCAL request.jwt.claims='{"sub":"b1880000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub='b1880000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
UPDATE calls188 SET result=public.floor_break_table_v5('e16d00d3-8537-45e1-893c-fc1f574ea17c',:source_revision,
  'b1880000-0000-4000-8000-000000000002','fill_lowest_table',repeat('0',32)) WHERE name='outsider';
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT result->>'error' FROM calls188 WHERE name='outsider')='actor_not_allowed'; END $$;
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL ROLE authenticated;
UPDATE calls188 SET result=public.floor_plan_break_table_v1('e16d00d3-8537-45e1-893c-fc1f574ea17c',:source_revision,'fill_lowest_table') WHERE name='plan';
UPDATE calls188 SET result=public.floor_break_table_v5('e16d00d3-8537-45e1-893c-fc1f574ea17c',:source_revision,
  'b1880000-0000-4000-8000-000000000003','fill_lowest_table',
  (SELECT result->>'plan_hash' FROM calls188 WHERE name='plan')) WHERE name='break';
UPDATE calls188 SET result=public.floor_break_table_v5('e16d00d3-8537-45e1-893c-fc1f574ea17c',:source_revision,
  'b1880000-0000-4000-8000-000000000003','fill_lowest_table',
  (SELECT result->>'plan_hash' FROM calls188 WHERE name='plan')) WHERE name='replay';
UPDATE calls188 SET result=public.floor_break_table_v5('e16d00d3-8537-45e1-893c-fc1f574ea17c',:source_revision,
  'b1880000-0000-4000-8000-000000000003','redraw_balanced',
  (SELECT result->>'plan_hash' FROM calls188 WHERE name='plan')) WHERE name='conflict';
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT (result->>'ok')::boolean AND (result->>'closed')::boolean AND (result->>'moved_count')::integer=3 FROM calls188 WHERE name='break');
  ASSERT (SELECT result FROM calls188 WHERE name='break')=(SELECT result FROM calls188 WHERE name='replay');
  ASSERT (SELECT result->>'error' FROM calls188 WHERE name='conflict')='IDEMPOTENCY_CONFLICT';
  ASSERT (SELECT count(*) FROM private.multi_day_final_seat_moves_v1)=3;
  ASSERT (SELECT count(*) FROM public.tournament_seats WHERE table_session_id='ca3c62fa-b4c5-4739-b571-5560dce53036' AND is_active)=0;
  ASSERT (SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='ca3c62fa-b4c5-4739-b571-5560dce53036');
  ASSERT (SELECT released_at IS NOT NULL FROM public.dealer_assignments WHERE id='b7200c24-2fe9-4be7-b0c2-4b151edc9b01');
  ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8508d715-cd7c-4f1f-bb0d-223d967e355c' AND is_active)=8;
  ASSERT (SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=300000;
  ASSERT NOT has_function_privilege('authenticated','private.multi_day_prepare_floor_seat_move_v1(uuid,uuid,uuid,uuid,integer,bigint,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','private.multi_day_prepare_floor_seat_move_v1(uuid,uuid,uuid,uuid,integer,bigint,uuid)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','private.multi_day_final_seat_moves_v1','SELECT');
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_final_write_intents_v1 WHERE transaction_id=txid_current());
END $$;
-- A subsequent same-table move must accept the authorized new seat, not only
-- the initial D2 seat_id. It also proves a second immutable provenance link.
SELECT revision AS destination_revision FROM public.table_sessions WHERE id='9e586a50-61a8-440f-81df-27839c7ba81a' \gset
SET LOCAL ROLE authenticated;
UPDATE calls188 SET result=public.move_player_seat_v2('af45b633-beba-472a-a3f7-79fca4cb5457',
  '8508d715-cd7c-4f1f-bb0d-223d967e355c',9,:destination_revision,:destination_revision,
  'b1880000-0000-4000-8000-000000000004') WHERE name='move';
RESET ROLE;
DO $$ DECLARE v_seat public.tournament_seats%ROWTYPE; BEGIN
  ASSERT (SELECT (result->>'ok')::boolean FROM calls188 WHERE name='move');
  ASSERT (SELECT count(*) FROM private.multi_day_final_seat_moves_v1)=4;
  BEGIN
    DELETE FROM private.multi_day_final_seat_moves_v1;
    RAISE EXCEPTION 'move provenance deletion unexpectedly passed';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM='multi_day_qualification_immutable';
  END;
  SELECT s.* INTO STRICT v_seat FROM public.tournament_seats s
    WHERE entry_id='af45b633-beba-472a-a3f7-79fca4cb5457' AND is_active;
  ASSERT v_seat.seat_number=9 AND v_seat.chip_count=20000;
  UPDATE public.tournament_seats SET chip_count=chip_count WHERE id=v_seat.id;
  BEGIN
    UPDATE public.tournament_seats SET entry_id='476a95f1-369b-4211-8927-21ba735f099c' WHERE id=v_seat.id;
    RAISE EXCEPTION 'identity guard unexpectedly passed';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM='multi_day_final_identity_immutable';
  END;
  BEGIN
    INSERT INTO public.tournament_seats(tournament_id,player_id,entry_id,entry_number,table_id,tournament_table_id,
      table_session_id,seat_number,chip_count,is_active,status)
    VALUES(v_seat.tournament_id,v_seat.player_id,v_seat.entry_id,v_seat.entry_number,v_seat.table_id,
      v_seat.tournament_table_id,v_seat.table_session_id,6,v_seat.chip_count,true,'active');
    RAISE EXCEPTION 'unintended insert unexpectedly passed';
  EXCEPTION WHEN insufficient_privilege THEN
    ASSERT SQLERRM='multi_day_final_write_not_authorized';
  END;
  ASSERT (SELECT initial_seatings FROM original188)=(SELECT jsonb_agg(to_jsonb(s) ORDER BY participation_id)
    FROM public.multi_day_final_seatings_v1 s WHERE final_tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
  ASSERT (SELECT cash FROM original188)=(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m);
  ASSERT (SELECT issuance FROM original188)=(SELECT jsonb_agg(to_jsonb(i) ORDER BY stack_template_id) FROM public.stack_template_issuance i);
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_final_write_intents_v1 WHERE transaction_id=txid_current());
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
UPDATE public.centerpoint_tournament_ops_release g SET (enabled,allowed_club_ids,updated_at)=
  (SELECT enabled,allowed_club_ids,updated_at FROM gates188 x WHERE x.id=g.id);
UPDATE public.multi_day_package_release_v1 g SET (enabled,allowed_club_ids,updated_at)=
  (SELECT enabled,allowed_club_ids,updated_at FROM package188 x WHERE x.id=g.id);
SELECT 'MULTIDAY_CANONICAL_BREAK_REPLAY_CONFLICT_MOVE_LINEAGE_IDENTITY_CONSERVATION_PASS';
ROLLBACK TO SAVEPOINT before_break188;

-- Independent rollback-only branch: actual start/queue RPCs and terminal-row
-- trigger. Direct void here qualifies the consumer, NOT full browser finish.
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TEMP TABLE deferred188(name text PRIMARY KEY,result jsonb);
INSERT INTO deferred188(name) VALUES('start'),('queue');
GRANT SELECT,UPDATE ON deferred188 TO authenticated;
SELECT entry_id AS moving_entry FROM public.tournament_seats
  WHERE tournament_table_id='8508d715-cd7c-4f1f-bb0d-223d967e355c' AND seat_number=1 AND is_active \gset
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
UPDATE deferred188 SET result=public.start_tracker_hand_v3('4cd3af4d-7e1d-4042-855f-04fb6777e580',
  'e16d00d3-8537-45e1-893c-fc1f574ea17c','ca3c62fa-b4c5-4739-b571-5560dce53036',2,3,
  pg_catalog.now(),'675fe35e-60a8-4452-bb90-e79486d54da6',3) WHERE name='start';
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT result->>'status' FROM deferred188 WHERE name='start')='success'; END $$;
SELECT revision AS source_revision FROM public.table_sessions WHERE id='9e586a50-61a8-440f-81df-27839c7ba81a' \gset
SELECT revision AS destination_revision FROM public.table_sessions WHERE id='ca3c62fa-b4c5-4739-b571-5560dce53036' \gset
SET LOCAL ROLE authenticated;
UPDATE deferred188 SET result=public.floor_queue_tracker_move_v1(:'moving_entry','e16d00d3-8537-45e1-893c-fc1f574ea17c',6,
  :source_revision,:destination_revision,'b1880000-0000-4000-8000-000000000005') WHERE name='queue';
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT (result->>'ok')::boolean FROM deferred188 WHERE name='queue');
  ASSERT (SELECT count(*) FROM private.multi_day_final_seat_moves_v1)=0;
END $$;
UPDATE public.tournament_hands SET status='voided',is_voided=true
  WHERE id=(SELECT (result->>'hand_id')::uuid FROM deferred188 WHERE name='start');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM private.multi_day_final_seat_moves_v1)=1;
  ASSERT EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves q JOIN private.multi_day_final_seat_moves_v1 m
    ON m.entry_id=q.entry_id WHERE q.request_id='b1880000-0000-4000-8000-000000000005' AND q.status='applied');
  ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND is_active)=13;
  ASSERT (SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=300000;
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_final_write_intents_v1 WHERE transaction_id=txid_current());
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'MULTIDAY_CANONICAL_QUEUED_MOVE_TERMINAL_TRIGGER_LINEAGE_PASS';
ROLLBACK TO SAVEPOINT before_break188;

-- Exercise the internal trust boundary with an otherwise valid deactivated
-- source. These are rollback-only attacks, not application-authorized writes.
DO $$ DECLARE s public.tournament_seats%ROWTYPE; BEGIN
  SELECT * INTO STRICT s FROM public.tournament_seats
    WHERE tournament_table_id='e16d00d3-8537-45e1-893c-fc1f574ea17c' AND seat_number=1 AND is_active;
  UPDATE public.tournament_seats SET is_active=false,status='moved' WHERE id=s.id;
  BEGIN
    PERFORM private.multi_day_prepare_floor_seat_move_v1(s.id,gen_random_uuid(),
      '8508d715-cd7c-4f1f-bb0d-223d967e355c','9e586a50-61a8-440f-81df-27839c7ba81a',6,s.chip_count+1,
      '675fe35e-60a8-4452-bb90-e79486d54da6');
    RAISE EXCEPTION 'wrong stack unexpectedly authorized';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_move_source_identity_changed'; END;
  BEGIN
    PERFORM private.multi_day_prepare_floor_seat_move_v1(s.id,gen_random_uuid(),
      '8508d715-cd7c-4f1f-bb0d-223d967e355c','4bfd849b-8706-4799-9bea-f30fd1e08d8c',6,s.chip_count,
      '675fe35e-60a8-4452-bb90-e79486d54da6');
    RAISE EXCEPTION 'wrong session unexpectedly authorized';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_move_destination_changed'; END;
  BEGIN
    PERFORM private.multi_day_prepare_floor_seat_move_v1(s.id,gen_random_uuid(),
      '8508d715-cd7c-4f1f-bb0d-223d967e355c','9e586a50-61a8-440f-81df-27839c7ba81a',1,s.chip_count,
      '675fe35e-60a8-4452-bb90-e79486d54da6');
    RAISE EXCEPTION 'occupied seat unexpectedly authorized';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_move_destination_changed'; END;
  BEGIN
    PERFORM private.multi_day_prepare_floor_seat_move_v1(s.id,gen_random_uuid(),
      '8508d715-cd7c-4f1f-bb0d-223d967e355c','9e586a50-61a8-440f-81df-27839c7ba81a',6,s.chip_count,
      'b1880000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'wrong actor unexpectedly authorized';
  EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_move_actor_not_allowed'; END;
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_final_seat_moves_v1);
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_final_write_intents_v1 WHERE transaction_id=txid_current());
END $$;
SELECT 'MULTIDAY_MOVE_ACTOR_STACK_SESSION_OCCUPANCY_NEGATIVE_PASS';
ROLLBACK TO SAVEPOINT before_break188;
