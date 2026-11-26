\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='tracker_bba350_full' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=56419;
 ASSERT position('tracker-bba349-pg17-' IN current_setting('data_directory'))>0;
END $$;
DO $test$
DECLARE
 sb text:='10000000-0000-4000-8000-000000000001';
 bb uuid:='10000000-0000-4000-8000-000000000002';
 other text:='10000000-0000-4000-8000-000000000003';
 actions jsonb;pots jsonb;players jsonb;
BEGIN
 actions:=jsonb_build_array(
  jsonb_build_object('player_id',sb,'action_type','post_sb','action_amount',100),
  jsonb_build_object('player_id',bb,'action_type','post_ante','action_amount',200),
  jsonb_build_object('player_id',bb,'action_type','post_bb','action_amount',200),
  jsonb_build_object('player_id',sb,'action_type','call','action_amount',100));
 pots:=jsonb_build_array(jsonb_build_object('amount',600,'eligible_player_ids',jsonb_build_array(sb,bb)));
 ASSERT floor_private.tracker_manual_pots_match350(actions,pots,600,bb);
 ASSERT NOT floor_private.tracker_manual_pots_match_v1(actions,pots,600),'legacy rule must remain unchanged';
 players:=jsonb_build_array(jsonb_build_object('player_id',sb,'starting_stack',1000,'ending_stack',1400),
  jsonb_build_object('player_id',bb,'starting_stack',1000,'ending_stack',600));
 ASSERT floor_private.tracker_manual_payouts_match350(actions,players,pots,bb);
 players:=jsonb_set(jsonb_set(players,'{0,ending_stack}','1100'),'{1,ending_stack}','900');
 ASSERT floor_private.tracker_manual_payouts_match350(actions,players,pots,bb),'split ante pot';
 ASSERT NOT floor_private.tracker_manual_pots_match350(actions,pots,400,bb),'ante cannot disappear';

 actions:=jsonb_build_array(
  jsonb_build_object('player_id',bb,'action_type','post_bb','action_amount',200),
  jsonb_build_object('player_id',bb,'action_type','post_ante','action_amount',100),
  jsonb_build_object('player_id',sb,'action_type','bet','action_amount',400),
  jsonb_build_object('player_id',other,'action_type','raise','action_amount',500));
 pots:=jsonb_build_array(jsonb_build_object('amount',700,'eligible_player_ids',jsonb_build_array(sb,bb,other)),
  jsonb_build_object('amount',400,'eligible_player_ids',jsonb_build_array(sb,other)));
 players:=jsonb_build_array(jsonb_build_object('player_id',sb,'starting_stack',1000,'ending_stack',1000),
  jsonb_build_object('player_id',bb,'starting_stack',300,'ending_stack',700),
  jsonb_build_object('player_id',other,'starting_stack',1000,'ending_stack',600));
 ASSERT floor_private.tracker_manual_pots_match350(actions,pots,1100,bb),'short ante plus side pot and live refund';
 ASSERT floor_private.tracker_manual_payouts_match350(actions,players,pots,bb);
 players:=jsonb_set(jsonb_set(players,'{0,ending_stack}','600'),'{1,ending_stack}','1100');
 ASSERT NOT floor_private.tracker_manual_payouts_match350(actions,players,pots,bb),'BB cannot win the ineligible side pot';
 ASSERT NOT has_function_privilege('authenticated','floor_private.tracker_manual_pots_match350(jsonb,jsonb,integer,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.tracker_manual_payouts_match350(jsonb,jsonb,jsonb,uuid)','EXECUTE');
 RAISE NOTICE 'BB_ANTE_SETTLEMENT_PASS: matched, split, short ante, side pot, refund and ineligible winner';
END $test$;
CREATE TEMP TABLE bba_finished_cases(hand_id uuid,bb_start integer,pot integer);
CREATE FUNCTION pg_temp.test_bba_finish351(bb_start integer) RETURNS void LANGUAGE plpgsql AS $finish$
DECLARE actor uuid:=gen_random_uuid();club uuid:=gen_random_uuid();tour uuid:=gen_random_uuid();
 game uuid:=gen_random_uuid();tbl uuid:=gen_random_uuid();session uuid:=gen_random_uuid();level uuid:=gen_random_uuid();
 sb uuid:=gen_random_uuid();bb uuid:=gen_random_uuid();sb_entry uuid:=gen_random_uuid();bb_entry uuid:=gen_random_uuid();
 hand uuid;answer jsonb;repeated jsonb;actions jsonb;players jsonb;intent jsonb;revision bigint;
 ante_paid integer:=least(200,greatest(bb_start-200,0));board jsonb:='[]';sb_cards jsonb:='[]';bb_cards jsonb:='[]';
BEGIN
 INSERT INTO auth.users(id) VALUES(actor),(sb),(bb);
 INSERT INTO public.clubs(id,name,region,owner_id) VALUES(club,'BB ante full TEST','VN',actor);
 INSERT INTO public.game_tables(id,club_id,table_name,status) VALUES(game,club,'BB ante TEST','active');
 INSERT INTO public.tournaments(id,club_id,name,current_level,live_status) VALUES(tour,club,'BB ante full TEST',1,'playing');
 INSERT INTO public.tournament_levels(id,tournament_id,level_number,small_blind,big_blind,ante,is_break)
 VALUES(level,tour,1,100,200,0,false);
 UPDATE public.tournaments SET current_level_id=level WHERE id=tour;
 INSERT INTO public.table_sessions(id,club_id,game_table_id,tournament_id,session_type,control_mode)
 VALUES(session,club,game,tour,'tournament','tracker');
 INSERT INTO public.tournament_tables(id,tournament_id,table_id,game_table_id,table_session_id,status,floor_control_mode)
 VALUES(tbl,tour,game,game,session,'active','tracker');
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status,current_stack,table_id,seat_number)
 VALUES(sb_entry,tour,sb,1,'seated',1000,game,1),(bb_entry,tour,bb,1,'seated',bb_start,game,2);
 INSERT INTO public.tournament_seats(tournament_id,player_id,entry_number,entry_id,tournament_table_id,table_session_id,seat_number,chip_count)
 VALUES(tour,sb,1,sb_entry,tbl,session,1,1000),(tour,bb,1,bb_entry,tbl,session,2,bb_start);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 INSERT INTO public.tournament_hands(tournament_id,table_id,tournament_table_id,table_session_id,hand_number,
  status,button_seat,created_by,locked_by_user_id,locked_at)
 VALUES(tour,tbl,tbl,session,1,'in_progress',1,actor,actor,now()) RETURNING id INTO hand;
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,entry_number,seat_number,starting_stack)
 VALUES(hand,tour,sb,1,1,1000),(hand,tour,bb,1,2,bb_start);
 answer:=public.post_tracker_blinds_v1(hand,gen_random_uuid(),tour);
 ASSERT answer->>'status'='success',answer::text;
 ASSERT (answer->>'bb_paid')::integer=200 AND (answer->>'ante_paid')::integer=ante_paid,answer::text;
 answer:=public.record_action(hand,sb,'call',4,1,'preflop',100);
 ASSERT answer->>'status'='success',answer::text;
 IF bb_start>400 THEN
  answer:=public.record_action(hand,bb,'fold',5,1,'preflop',0);
  ASSERT answer->>'status'='success',answer::text;
 ELSE
  board:='["2c","3d","7s","8h","9c"]';sb_cards:='["Jh","Jd"]';bb_cards:='["As","Qd"]';
  answer:=public.update_community_cards(hand,board,actor);
  ASSERT answer->>'status'='success',answer::text;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('player_id',a.player_id,'entry_number',a.entry_number,'street',a.street,
  'action_type',a.action_type,'action_amount',a.action_amount,'action_order',a.action_order) ORDER BY a.action_order)
 INTO actions FROM public.hand_actions a WHERE a.hand_id=hand;
 SELECT source_revision INTO revision FROM public.tournament_hands WHERE id=hand;
 players:=jsonb_build_array(jsonb_build_object('player_id',sb,'entry_number',1,'seat_number',1,'starting_stack',1000,'ending_stack',1200+ante_paid,
  'is_eliminated',false,'hole_cards',sb_cards),jsonb_build_object('player_id',bb,'entry_number',1,'seat_number',2,
  'starting_stack',bb_start,'ending_stack',bb_start-200-ante_paid,'is_eliminated',bb_start=200+ante_paid,'hole_cards',bb_cards));
 intent:=jsonb_build_object('actor_id',actor,'request_id',gen_random_uuid(),'tournament_id',tour,'tournament_table_id',tbl,
  'hand_id',hand,'table_session_id',session,'control_epoch',1,'source_revision',revision,
  'payload',jsonb_build_object('hand_time',now(),'players',players,'actions',actions,'side_pots',
   jsonb_build_array(jsonb_build_object('amount',400+ante_paid,'eligible_player_ids',CASE WHEN bb_start>400 THEN jsonb_build_array(sb) ELSE jsonb_build_array(sb,bb) END)),
   'community_cards',board,'pot_size',400+ante_paid));
 answer:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{payload,pot_size}','400'));
 ASSERT answer->>'error'='SIDE_POTS_TAMPERED',answer::text;
 ASSERT (SELECT status='in_progress' FROM public.tournament_hands WHERE id=hand),'rejected Finish must not complete the hand';
 answer:=public.record_tracker_manual_hand_v1(intent);
 ASSERT answer->>'ok'='true',answer::text;
 ASSERT (SELECT status='completed' AND pot_size=400+ante_paid FROM public.tournament_hands WHERE id=hand);
 ASSERT (SELECT sum(ending_stack)=1000+bb_start FROM public.hand_players WHERE hand_id=hand);
 ASSERT (SELECT chip_count=1200+ante_paid FROM public.tournament_seats WHERE tournament_id=tour AND player_id=sb);
 ASSERT (SELECT chip_count=bb_start-200-ante_paid FROM public.tournament_seats WHERE tournament_id=tour AND player_id=bb);
 ASSERT public.get_public_tournament_hand_v2(tour,hand)->>'bigBlindAnteOnly'='true';
 repeated:=public.record_tracker_manual_hand_v1(intent);
 ASSERT repeated->>'ok'='true',repeated::text;
 ASSERT (SELECT chip_count=1200+ante_paid FROM public.tournament_seats WHERE tournament_id=tour AND player_id=sb),'duplicate Finish must not award twice';
 ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=hand)=(answer->>'committed_source_revision')::bigint;
 INSERT INTO bba_finished_cases VALUES(hand,bb_start,400+ante_paid);
 RAISE NOTICE 'BB_ANTE_FULL_MANUAL_FINISH_PASS: BB starting %, ante %, pot %, conserved %',bb_start,ante_paid,400+ante_paid,1000+bb_start;
END $finish$;
DO $$ BEGIN PERFORM pg_temp.test_bba_finish351(1000);PERFORM pg_temp.test_bba_finish351(300);END $$;
ROLLBACK;
