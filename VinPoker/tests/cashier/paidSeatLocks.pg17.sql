\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('test.paid_registration',:'PAID_REGISTRATION',true);
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_setting('server_version_num')::int/10000<>17
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_paid_seat_locks_required';END IF;
END $$;
DO $$ DECLARE original public.tournament_registrations%ROWTYPE; actor uuid; player uuid:=gen_random_uuid();
 reg uuid; dest record; candidate integer; rev bigint; r jsonb; intent jsonb; unlocked record; money_before jsonb;
BEGIN
 SELECT * INTO STRICT original FROM public.tournament_registrations WHERE id=current_setting('test.paid_registration')::uuid;
 SELECT owner_id INTO STRICT actor FROM public.clubs WHERE id=original.club_id;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 -- Lock all FREE seats via the actual public writer; the occupied original
 -- paid seat remains visible and counts toward capacity.
 FOR dest IN SELECT t.id,t.table_session_id,t.max_seats FROM public.tournament_tables t
  WHERE t.tournament_id=original.tournament_id AND t.status='active' LOOP
  FOR candidate IN SELECT n FROM generate_series(1,dest.max_seats) n WHERE NOT EXISTS(
   SELECT 1 FROM public.tournament_seats s WHERE s.is_active AND s.tournament_table_id=dest.id AND s.seat_number=n) LOOP
   SELECT revision INTO STRICT rev FROM public.table_sessions WHERE id=dest.table_session_id;
   PERFORM set_config('role','authenticated',true);
   r:=public.floor_set_table_seat_lock_v1(dest.id,candidate,true,'cash_paid_lock_TEST',rev,gen_random_uuid());
   IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'public_seat_lock_failed: %',r;END IF;
   PERFORM set_config('role','none',true);
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(original.tournament_id,'random_balanced')) THEN
  RAISE EXCEPTION 'locked_seat_available_to_cashier';END IF;
 INSERT INTO auth.users(id) VALUES(player);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1(original.tournament_id,player);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'locked_case_registration_failed: %',r;END IF;
 reg:=(r->>'registration_id')::uuid;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 intent:=jsonb_build_object('actor_id',actor,'club_id',original.club_id,'tournament_id',original.tournament_id,
  'registration_id',reg,'amount',100000,'request_id',gen_random_uuid());
 r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
 IF r->>'status'<>'recorded' OR r->'result'->>'seating_state'<>'waiting' THEN RAISE EXCEPTION 'locked_cash_not_paid_waiting: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=reg) THEN RAISE EXCEPTION 'locked_cash_created_entry';END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO money_before FROM public.cashier_buyin_movements m WHERE registration_id=reg;
 SELECT * INTO STRICT unlocked FROM public.table_session_seat_locks WHERE tournament_id=original.tournament_id AND unlocked_at IS NULL ORDER BY id LIMIT 1;
 SELECT revision INTO STRICT rev FROM public.table_sessions WHERE id=unlocked.table_session_id;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_set_table_seat_lock_v1(unlocked.tournament_table_id,unlocked.seat_number,false,'cash_paid_unlock_TEST',rev,gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'public_unlock_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 -- Internal exact-target worker core, not an exposed browser write grant.
 r:=public.cashier_try_seat_paid_v1(reg,actor);
 IF r->>'seating_state'<>'seated' THEN RAISE EXCEPTION 'unlocked_cash_not_seated: %',r;END IF;
 IF (SELECT count(*) FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
  WHERE e.registration_id=reg AND s.table_session_id=unlocked.table_session_id AND s.seat_number=unlocked.seat_number AND s.chip_count=20000)<>1 THEN
  RAISE EXCEPTION 'cashier_used_a_different_locked_seat';END IF;
 IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE registration_id=reg) IS DISTINCT FROM money_before THEN
  RAISE EXCEPTION 'unlock_retry_changed_money';END IF;
END $$;
ROLLBACK;
SELECT 'PAID_SEAT_LOCK_WAIT_UNLOCK_EXACT_SESSION_NO_NEW_MONEY_PASS';
