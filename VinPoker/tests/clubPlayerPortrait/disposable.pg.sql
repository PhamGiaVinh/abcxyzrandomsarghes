\set ON_ERROR_STOP 1
-- Run ONLY in a fresh disposable database called portrait_fixture.
DO $$ BEGIN IF current_database() !~ '^portrait_fixture(_[0-9]+)?$' THEN RAISE EXCEPTION 'wrong database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA floor_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
\ir club-fixture.sql
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(bucket_id text,name text,owner_id text,metadata jsonb,PRIMARY KEY(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth,storage TO authenticated;
GRANT INSERT,SELECT ON storage.objects TO authenticated;

\ir ../../supabase/pending-migrations/20261122122716_club_member_portraits_v1.sql

INSERT INTO floor_private.club_portrait_storage_origin(origin) VALUES ('http://127.0.0.1:54321');

CREATE FUNCTION public.fixture_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT lpad(n::text,32,'0')::uuid
$$;
CREATE FUNCTION public.assert_portrait(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED %',label; END IF; END $$;
INSERT INTO clubs VALUES(fixture_id(1),fixture_id(31)),(fixture_id(2),fixture_id(32));
INSERT INTO club_floors VALUES(fixture_id(1),fixture_id(33));
INSERT INTO club_cashiers VALUES(fixture_id(1),fixture_id(34));
INSERT INTO club_members VALUES(fixture_id(11),fixture_id(1),'Alex',fixture_id(21)),(fixture_id(12),fixture_id(2),'Alex',fixture_id(21));
INSERT INTO tournaments VALUES(fixture_id(41),fixture_id(1)),(fixture_id(42),fixture_id(1)),(fixture_id(43),fixture_id(2));
INSERT INTO tournament_entries SELECT fixture_id(i+10),fixture_id(i),CASE WHEN i=42 THEN NULL WHEN i=43 THEN fixture_id(12) ELSE fixture_id(11) END,fixture_id(21),1 FROM generate_series(41,43) i;
INSERT INTO tournament_seats SELECT fixture_id(i+20),fixture_id(i),fixture_id(71),fixture_id(i+40),1,true,fixture_id(i+10),fixture_id(21),1 FROM generate_series(41,43) i;
INSERT INTO booking_chats VALUES (fixture_id(90),fixture_id(41),fixture_id(1),fixture_id(21));
CREATE FUNCTION public.member_ctx() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('kind','member','club',fixture_id(1),'member',fixture_id(11),'expected_member',fixture_id(11))
$$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',fixture_id(33)::text,false);
SELECT assert_portrait(club_player_portrait_v1(jsonb_build_object('kind','seat','tour',fixture_id(41),'seat',fixture_id(61),'player',fixture_id(21)))->>'member'=fixture_id(11)::text,'Floor resolves exact seat');
SELECT assert_portrait(club_player_portrait_v1(jsonb_build_object('kind','booking','tour',fixture_id(41),'chat',fixture_id(90),'player',fixture_id(21)))->>'member'=fixture_id(11)::text,'Reception resolves booking');
SELECT set_config('request.jwt.claim.sub',fixture_id(34)::text,false);
DO $$ BEGIN
 BEGIN PERFORM club_player_portrait_v1(member_ctx()||jsonb_build_object('club',fixture_id(2)));
  RAISE EXCEPTION 'cross-club read succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM club_player_portrait_v1(member_ctx()||jsonb_build_object('member',fixture_id(12)));
  RAISE EXCEPTION 'wrong member accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'portrait_member_unavailable' THEN RAISE; END IF; END;
 BEGIN INSERT INTO storage.objects VALUES('club-player-portraits',fixture_id(99)||'.jpg',auth.uid(),'{}');
  RAISE EXCEPTION 'unreserved upload'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT club_player_portrait_v1(member_ctx(),'prepare',NULL,fixture_id(101));
INSERT INTO storage.objects VALUES('club-player-portraits',fixture_id(101)||'.jpg',auth.uid(),'{"mimetype":"image/jpeg","size":450}');
SELECT assert_portrait(club_player_portrait_v1(member_ctx(),'publish',NULL,fixture_id(101))->>'version'=fixture_id(101)::text,'publish receipt');
SELECT assert_portrait(club_player_portrait_v1(member_ctx(),'publish',NULL,fixture_id(101))->>'version'=fixture_id(101)::text,'retry lost response');
RESET ROLE;
SELECT assert_portrait(count(*) FILTER (WHERE avatar_url LIKE '%'||fixture_id(101)||'.jpg')=2
 AND count(*) FILTER (WHERE avatar_url IS NULL AND tournament_id=fixture_id(43))=1,'current dealer roster correct by club') FROM tournament_seats;
INSERT INTO tournament_hands SELECT fixture_id(i+70),fixture_id(i),fixture_id(71),fixture_id(i+40) FROM generate_series(41,43) i;
INSERT INTO hand_players SELECT fixture_id(i+70),fixture_id(i),fixture_id(21),1,1,NULL FROM generate_series(41,43) i;
SELECT assert_portrait(count(*) FILTER (WHERE avatar_url LIKE '%'||fixture_id(101)||'.jpg')=2 AND count(*) FILTER (WHERE tournament_id=fixture_id(43) AND avatar_url IS NULL)=1,'two tours reuse, other club isolated') FROM hand_players;
SET ROLE authenticated;
SELECT club_player_portrait_v1(member_ctx(),'prepare',fixture_id(101),fixture_id(102));
SELECT club_player_portrait_v1(member_ctx(),'prepare',fixture_id(101),fixture_id(103));
INSERT INTO storage.objects SELECT 'club-player-portraits',fixture_id(i)||'.jpg',auth.uid(),'{"mimetype":"image/jpeg","size":450}'::jsonb FROM generate_series(102,103) i;
SELECT club_player_portrait_v1(member_ctx(),'publish',fixture_id(101),fixture_id(103));
DO $$ BEGIN
 BEGIN PERFORM club_player_portrait_v1(member_ctx(),'publish',fixture_id(101),fixture_id(102)); RAISE EXCEPTION 'stale overwrite';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'portrait_changed' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
INSERT INTO tournament_hands VALUES(fixture_id(115),fixture_id(42),fixture_id(71),fixture_id(82));
INSERT INTO hand_players VALUES(fixture_id(115),fixture_id(42),fixture_id(21),1,1,NULL);
SELECT assert_portrait((SELECT avatar_url FROM hand_players WHERE hand_id=fixture_id(115)) LIKE '%'||fixture_id(103)||'.jpg','new hand takes new photo');
SELECT assert_portrait((SELECT avatar_url FROM hand_players WHERE hand_id=fixture_id(112)) LIKE '%'||fixture_id(101)||'.jpg','replay keeps first photo');
INSERT INTO tournaments VALUES(fixture_id(44),fixture_id(1));
INSERT INTO tournament_entries VALUES(fixture_id(54),fixture_id(44),fixture_id(11),fixture_id(23),1),
 (fixture_id(55),fixture_id(44),NULL,fixture_id(24),1);
INSERT INTO tournament_seats VALUES(fixture_id(64),fixture_id(44),fixture_id(71),fixture_id(84),1,true,fixture_id(54),fixture_id(23),1,NULL),
 (fixture_id(65),fixture_id(44),fixture_id(71),fixture_id(84),2,true,fixture_id(55),fixture_id(24),1,NULL);
SELECT assert_portrait(avatar_url LIKE '%'||fixture_id(103)||'.jpg','returning player seated in new tour') FROM tournament_seats WHERE id=fixture_id(64);
UPDATE tournament_entries SET member_id=fixture_id(11) WHERE id=fixture_id(55);
SELECT assert_portrait(avatar_url LIKE '%'||fixture_id(103)||'.jpg','member linked after seating') FROM tournament_seats WHERE id=fixture_id(65);
UPDATE tournament_entries SET member_id=fixture_id(12) WHERE id=fixture_id(55);
SELECT assert_portrait(avatar_url IS NULL,'mismatched member link clears inherited portrait') FROM tournament_seats WHERE id=fixture_id(65);
UPDATE club_cashiers SET user_id=fixture_id(39) WHERE user_id=fixture_id(34);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM club_player_portrait_v1(member_ctx()); RAISE EXCEPTION 'revoked desk retained access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo 'Club portrait acceptance passed.'
