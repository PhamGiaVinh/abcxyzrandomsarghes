\set ON_ERROR_STOP on
-- Isolated business-ranking regression. Metadata/participants are synthetic
-- seeds; the real entry-status triggers/finalizer run unchanged. NOT gameplay,
-- paid-registration, browser or canonical Finish end-to-end acceptance.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database() IN('vinpoker_ops_cash115_qualified_c','vinpoker_ranking860_local');
 IF current_database()='vinpoker_ranking860_local' THEN
  ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
   'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 END IF;
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='fa857000-0000-4000-8000-000000000001');
END $$;
INSERT INTO auth.users(id) VALUES
 ('fa857000-0000-4000-8000-000000000010'),
 ('fa857000-0000-4000-8000-000000000011'),
 ('fa857000-0000-4000-8000-000000000012'),
 ('fa857000-0000-4000-8000-000000000013'),
 ('fa857000-0000-4000-8000-000000000014');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('fa857000-0000-4000-8000-000000000001','fa857000-0000-4000-8000-000000000010','Manual ranking857 TEST','TEST','approved');
INSERT INTO public.club_settings(club_id,player_history_enabled,auto_swing_enabled) VALUES
 ('fa857000-0000-4000-8000-000000000001',true,false);
INSERT INTO public.tournaments(id,club_id,name,status,live_status,registration_closed_at) VALUES
 ('fa857000-0000-4000-8000-000000000002','fa857000-0000-4000-8000-000000000001','Manual ranking857 TEST','active','playing',NULL);
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,current_stack,status,source)
 SELECT ('fa857000-0000-4000-8000-0000000000'||n)::uuid,
 'fa857000-0000-4000-8000-000000000002',('fa857000-0000-4000-8000-0000000000'||(n-10))::uuid,
 1,20000,'registered','manual' FROM generate_series(21,23)n;
-- An earlier unrelated manual elimination must retain its rank slot.
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,current_stack,status,source,bust_order)
 VALUES('fa857000-0000-4000-8000-000000000024','fa857000-0000-4000-8000-000000000002',
 'fa857000-0000-4000-8000-000000000014',1,0,'busted','manual',1);
UPDATE public.tournaments SET bust_seq=1 WHERE id='fa857000-0000-4000-8000-000000000002';
UPDATE public.tournaments SET registration_closed_at=now() WHERE id='fa857000-0000-4000-8000-000000000002';
INSERT INTO public.tournament_hands(id,tournament_id,hand_number,status,created_by) VALUES
 ('fa857000-0000-4000-8000-000000000003','fa857000-0000-4000-8000-000000000002',1,'completed','fa857000-0000-4000-8000-000000000010');
-- Canonical record_hand marks the hand completed before its participant loop.
-- Each eliminated hand participant is written before entry/elim-row updates.
INSERT INTO public.hand_players(hand_id,tournament_id,player_id,entry_number,seat_number,starting_stack,ending_stack,is_eliminated)
 SELECT 'fa857000-0000-4000-8000-000000000003','fa857000-0000-4000-8000-000000000002',
 ('fa857000-0000-4000-8000-0000000000'||n)::uuid,1,n-10,20000,CASE WHEN n=13 THEN 60000 ELSE 0 END,n<>13
 FROM generate_series(11,13)n;
SELECT set_config('request.jwt.claim.sub','fa857000-0000-4000-8000-000000000010',true);
SELECT set_config('request.jwt.claims','{"sub":"fa857000-0000-4000-8000-000000000010","role":"authenticated"}',true);
SAVEPOINT untouched_group;
-- Same order as canonical record_hand: entry transition, then elimination row.
UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now()
 WHERE id='fa857000-0000-4000-8000-000000000021';
INSERT INTO public.tournament_eliminations(tournament_id,player_id,entry_number,hand_id,position,prize)
 VALUES('fa857000-0000-4000-8000-000000000002','fa857000-0000-4000-8000-000000000011',1,'fa857000-0000-4000-8000-000000000003',0,0);
UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now()
 WHERE id='fa857000-0000-4000-8000-000000000022';
INSERT INTO public.tournament_eliminations(tournament_id,player_id,entry_number,hand_id,position,prize)
 VALUES('fa857000-0000-4000-8000-000000000002','fa857000-0000-4000-8000-000000000012',1,'fa857000-0000-4000-8000-000000000003',0,0);
SELECT 'ORDER_AB_UNCONFIRMED:'||jsonb_object_agg(right(player_id::text,2),finished_place)::text
 FROM public.tournament_entries WHERE tournament_id='fa857000-0000-4000-8000-000000000002';
-- Retain diagnostic result across the savepoint without altering business rows.
SELECT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='fa857000-0000-4000-8000-000000000002' AND finished_place IS NOT NULL) AS rank857_ab_accepted
\gset
ROLLBACK TO untouched_group;
UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now()
 WHERE id='fa857000-0000-4000-8000-000000000022';
INSERT INTO public.tournament_eliminations(tournament_id,player_id,entry_number,hand_id,position,prize)
 VALUES('fa857000-0000-4000-8000-000000000002','fa857000-0000-4000-8000-000000000012',1,'fa857000-0000-4000-8000-000000000003',0,0);
UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now()
 WHERE id='fa857000-0000-4000-8000-000000000021';
INSERT INTO public.tournament_eliminations(tournament_id,player_id,entry_number,hand_id,position,prize)
 VALUES('fa857000-0000-4000-8000-000000000002','fa857000-0000-4000-8000-000000000011',1,'fa857000-0000-4000-8000-000000000003',0,0);
SELECT 'ORDER_BA_UNCONFIRMED:'||jsonb_object_agg(right(player_id::text,2),finished_place)::text
 FROM public.tournament_entries WHERE tournament_id='fa857000-0000-4000-8000-000000000002';
SELECT set_config('test.rank857_ab_accepted',:'rank857_ab_accepted',true);
DO $$ BEGIN
 ASSERT current_setting('test.rank857_ab_accepted')='t' AND NOT EXISTS(SELECT 1 FROM public.tournament_entries
 WHERE tournament_id='fa857000-0000-4000-8000-000000000002' AND finished_place IS NOT NULL),
 'RANK857_UNCONFIRMED_SAME_HAND_ORDER_BECAME_OFFICIAL';
END $$;
-- RANK857_CONFIRMATION_EXTENSION
ROLLBACK;
SELECT 'RANK857_UNCONFIRMED_SAME_HAND_REQUIRES_FLOOR_REVIEW_PASS';
