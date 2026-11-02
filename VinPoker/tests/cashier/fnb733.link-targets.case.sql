DO $case$
DECLARE
 actor uuid := gen_random_uuid();
 club uuid := gen_random_uuid(); tour uuid := gen_random_uuid(); physical uuid := gen_random_uuid();
 sess uuid := gen_random_uuid(); logical uuid := gen_random_uuid(); entry uuid := gen_random_uuid(); seat uuid := gen_random_uuid();
 result jsonb; other_table uuid := gen_random_uuid(); cashier uuid := gen_random_uuid(); new_session uuid := gen_random_uuid();
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 INSERT INTO auth.users(id) VALUES(actor),(cashier);
 INSERT INTO public.clubs(id,owner_id,name,region,bot_enabled) VALUES(club,actor,'LOCAL733 canonical FNB reader rollback TEST','TEST',false);
 INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES(club,cashier,'cashier');
 INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES(tour,club,'LOCAL733 read fixture','active','playing');
 SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id=club AND table_number=7;
 UPDATE public.game_tables SET table_name='LOCAL733 Table 7',table_type='tournament',status='active' WHERE id=physical;
 INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,opened_by) VALUES(sess,club,physical,'tournament',tour,actor);
 INSERT INTO public.tournament_tables(id,tournament_id,table_name,game_table_id,table_session_id) VALUES(logical,tour,'LOCAL733 logical 7',physical,sess);
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status,current_stack,table_id,seat_id,seat_number)
 VALUES(entry,tour,actor,1,'seated',20000,physical,seat,1);
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,table_id,tournament_table_id,table_session_id,entry_id,seat_number,chip_count,player_name)
 VALUES(seat,tour,actor,1,logical,logical,sess,entry,1,20000,'LOCAL733 player');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('role','authenticated',true);
 result := public.fnb_list_link_targets(club);
 ASSERT result->'players'->0->>'table_id'=physical::text,
  'FNB733 canonical seat must project physical table, not tournament-table UUID';
 ASSERT result->'players'->0->>'seat_id'=seat::text AND result->'players'->0->>'entry_id'=entry::text;
 ASSERT result->'players'->0->>'table_session_id'=sess::text AND result->'players'->0->>'name'='LOCAL733 player';
 ASSERT jsonb_array_length(result->'players')=1 AND jsonb_array_length(result->'tables')=1;
 ASSERT NOT (result->'players'->0 ? 'chip_count') AND NOT (result->'players'->0 ? 'current_stack');
 PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 ASSERT public.fnb_list_link_targets(club)->'players'->0->>'table_id'=physical::text;
 ASSERT public.fnb_list_link_targets('349ecf35-50ba-4c71-a581-15dc45f1cd01')->>'error'='Forbidden';
 PERFORM set_config('role','postgres',true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 -- Missing entry remains an explicit unavailable count, never a silently valid person link.
 UPDATE public.tournament_seats SET entry_id=NULL WHERE id=seat;
 result := public.fnb_list_link_targets(club);
 ASSERT result->'players'='[]'::jsonb AND (result->>'unavailable_player_count')::int=1;
 UPDATE public.tournament_seats SET entry_id=entry WHERE id=seat;
 UPDATE public.tournament_entries SET player_id=cashier WHERE id=entry;
 result := public.fnb_list_link_targets(club);
 ASSERT result->'players'='[]'::jsonb AND (result->>'unavailable_player_count')::int=1;
 UPDATE public.tournament_entries SET player_id=actor WHERE id=entry;
 -- A legacy logical ID disagreement must not be resolved by selecting either row arbitrarily.
 INSERT INTO public.tournament_tables(id,tournament_id,table_name,status) VALUES(other_table,tour,'LOCAL733 legacy mismatch','closed');
 UPDATE public.tournament_seats SET table_id=other_table WHERE id=seat;
 result := public.fnb_list_link_targets(club);
 ASSERT result->'players'='[]'::jsonb AND (result->>'unavailable_player_count')::int=1;
 UPDATE public.tournament_seats SET table_id=logical WHERE id=seat;
 UPDATE public.tournament_tables SET status='closed' WHERE id=logical;
 result := public.fnb_list_link_targets(club);
 ASSERT result->'players'='[]'::jsonb AND result->'tables'='[]'::jsonb;
 ASSERT (result->>'unavailable_player_count')::int=1 AND (result->>'unavailable_table_count')::int=1;
 UPDATE public.tournament_tables SET status='active' WHERE id=logical;
 -- Closed old incarnation must not reappear even while legacy table status is still active.
 UPDATE public.table_sessions SET closed_at=clock_timestamp(),closed_by=actor WHERE id=sess;
 result := public.fnb_list_link_targets(club);
 ASSERT result->'players'='[]'::jsonb AND result->'tables'='[]'::jsonb;
 INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,opened_by)
 VALUES(new_session,club,physical,'tournament',tour,actor);
 result := public.fnb_list_link_targets(club);
 ASSERT result->'players'='[]'::jsonb AND result->'tables'='[]'::jsonb,
  'reopen must not adopt the old incarnation assignment/seat';
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 ASSERT public.fnb_list_link_targets(club)->>'error'='Forbidden';
 PERFORM set_config('request.jwt.claim.sub','',true);
 ASSERT public.fnb_list_link_targets(club)->>'error'='Unauthorized';
 ASSERT NOT has_function_privilege('anon','public.fnb_list_link_targets(uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.fnb_list_link_targets(uuid)','EXECUTE');
 RAISE NOTICE 'FNB733_CANONICAL_PHYSICAL_ENTRY_SESSION_CLOSED_LEGACY_BLOCKERS_AUTH_PRIVACY_PASS';
END $case$;
