DO $$DECLARE actor uuid:=gen_random_uuid();club uuid:=gen_random_uuid();tour uuid:=gen_random_uuid();
 member uuid:=gen_random_uuid();physical uuid;sess uuid:=gen_random_uuid();logical uuid:=gen_random_uuid();entry uuid:=gen_random_uuid();seat uuid:=gen_random_uuid();
 menu uuid:=gen_random_uuid();request text:=gen_random_uuid()::text;response jsonb;order_id uuid;r jsonb;before_winnings jsonb; BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO auth.users(id) VALUES(actor);
 INSERT INTO public.clubs(id,owner_id,name,region,bot_enabled) VALUES(club,actor,'LOCAL player FNB finance TEST','TEST',false);
 INSERT INTO public.club_members(id,club_id,member_card_id,full_name,player_user_id) VALUES(member,club,'LOCAL-'||member,'LOCAL FNB customer',actor);
 INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES(tour,club,'LOCAL FNB finance tour','active','playing');
 SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id=club AND table_number=7;
 UPDATE public.game_tables SET table_type='tournament',status='active' WHERE id=physical;
 INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,opened_by) VALUES(sess,club,physical,'tournament',tour,actor);
 INSERT INTO public.tournament_tables(id,tournament_id,table_name,game_table_id,table_session_id) VALUES(logical,tour,'LOCAL FNB 7',physical,sess);
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status,current_stack,table_id,seat_id,seat_number)
 VALUES(entry,tour,actor,1,'seated',20000,physical,seat,1);
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,table_id,tournament_table_id,table_session_id,entry_id,seat_number,chip_count,player_name)
 VALUES(seat,tour,actor,1,logical,logical,sess,entry,1,20000,'LOCAL FNB customer');
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(menu,club,'LOCAL FNB tea',5000,true,false);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 before_winnings:=public.get_public_player_paid_winnings_v1(actor)->'totalWinnings';
 PERFORM set_config('role','authenticated',true);
 response:=public.fnb_create_order(club,'counter',NULL,'LOCAL FNB customer',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',2)),request,physical,actor);
 ASSERT response->>'status'='ok',response::text;order_id:=(response->>'order_id')::uuid;
 r:=public.get_owner_player_financial_report_v1(club,member);
 ASSERT (r->'selected'->>'activeTournaments')::integer=1,'seated live entry must count as active tournament';
 ASSERT (r->'fnb'->>'pending')::numeric=10000 AND (r->'fnb'->>'paid')::numeric=0,r::text;
 response:=public.fnb_mark_paid(order_id,gen_random_uuid()::text);ASSERT response->>'status'='ok',response::text;
 response:=public.fnb_mark_paid(order_id,gen_random_uuid()::text);ASSERT response->>'idempotent'='true',response::text;
 r:=public.get_owner_player_financial_report_v1(club,member);
 ASSERT (r->'fnb'->>'paid')::numeric=10000 AND (r->'fnb'->>'net')::numeric=10000 AND (r->'fnb'->>'pending')::numeric=0,r::text;
 ASSERT (r->'selected'->>'fnbNet')::numeric=10000 AND r->'selected'->>'cost' IS NULL AND r->'selected'->>'profit' IS NULL AND r->'selected'->>'roi' IS NULL;
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'history') x WHERE x->>'kind'='unverified_entry' AND x->>'verified'='false');
 ASSERT jsonb_array_length(r->'fnb'->'orders')=1 AND r->'fnb'->'orders'->0->'items'->0->>'quantity'='2';
 -- Same free-text name without explicit player_ref stays outside this customer.
 response:=public.fnb_create_order(club,'counter',NULL,'LOCAL FNB customer',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;
 r:=public.get_owner_player_financial_report_v1(club,member);
 ASSERT (r->'fnb'->>'totalCount')::integer=1 AND (r->'fnb'->>'unlinkedOrderCount')::integer=1 AND (r->'fnb'->>'net')::numeric=10000;
 response:=public.fnb_cancel_order(order_id,'LOCAL FNB finance refund');ASSERT response->>'status'='ok',response::text;
 response:=public.fnb_cancel_order(order_id,'LOCAL FNB finance refund');ASSERT response->>'idempotent'='true',response::text;
 r:=public.get_owner_player_financial_report_v1(club,member);
 ASSERT (r->'fnb'->>'paid')::numeric=10000 AND (r->'fnb'->>'refunded')::numeric=10000 AND (r->'fnb'->>'net')::numeric=0,r::text;
 ASSERT public.get_public_player_paid_winnings_v1(actor)->'totalWinnings'=before_winnings,'FNB changed public poker winnings';
 -- The canonical comp writer freezes subtotal=0 but retains menu line prices.
 response:=public.fnb_create_comp_order(club,'counter',NULL,'LOCAL FNB customer',NULL,
  jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),'LOCAL owner complimentary',gen_random_uuid()::text);
 ASSERT response->>'status'='ok',response::text;
 PERFORM set_config('role','none',true);
 -- Comp RPC has no player_ref argument. Bind this NEW local fixture only to
 -- exercise the read projection; production history is never backfilled.
 UPDATE public.fnb_orders SET player_ref=actor WHERE id=(response->>'order_id')::uuid;
 PERFORM set_config('role','authenticated',true);
 r:=public.get_owner_player_financial_report_v1(club,member);
 ASSERT (r->'fnb'->>'unavailableCount')::integer=0 AND (r->'fnb'->>'comp')::numeric=5000,r::text;
 ASSERT (r->'fnb'->>'paid')::numeric=10000 AND (r->'fnb'->>'refunded')::numeric=10000 AND (r->'fnb'->>'net')::numeric=0;
 r:=public.get_owner_player_financial_report_v1(club,member,'',0,1,1);
 ASSERT jsonb_array_length(r->'fnb'->'orders')=1 AND (r->'fnb'->>'totalCount')::integer=2;
 ASSERT (r->'fnb'->>'comp')::numeric=5000,'pagination changed all-time FNB totals';
 ASSERT NOT has_function_privilege('authenticated','private.club_customer_fnb_facts_v1(uuid)','execute');
 PERFORM set_config('role','none',true);
END $$;
