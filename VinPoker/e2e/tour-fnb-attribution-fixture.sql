GRANT USAGE ON SCHEMA auth TO anon,authenticated;
INSERT INTO auth.users(id) VALUES(:'owner');
INSERT INTO public.profiles(user_id,display_name) VALUES(:'owner','TEST owner');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(:'club',:'owner','TEST club','TEST','approved');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES(:'tour',:'club','TEST tour','active','playing'),(:'other',:'club','TEST other','active','playing');
UPDATE public.game_tables SET table_name='TEST table',table_type='tournament',status='active',operational_status='available' WHERE club_id=:'club' AND table_number=1 RETURNING id AS fixture_table \gset
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,opened_by) VALUES(:'session',:'club',:'fixture_table','tournament',:'tour',:'owner');
INSERT INTO public.tournament_tables(id,tournament_id,game_table_id,table_session_id,table_name,table_number,status) VALUES(:'tracked',:'tour',:'fixture_table',:'session','TEST table',1,'active');
INSERT INTO public.fnb_settings(club_id,guest_order_enabled,fnb_in_club_net) VALUES(:'club',true,true);
INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES(:'ingredient',:'club','TEST stock','bottle',10,5000);
INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory) VALUES(:'menu',:'club','TEST item',20000,true);
INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES(:'club',:'menu',:'ingredient',1);
