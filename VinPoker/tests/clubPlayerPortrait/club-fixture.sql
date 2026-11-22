CREATE TABLE public.clubs (id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.club_cashiers(club_id uuid,user_id uuid);
CREATE TABLE public.club_floors(club_id uuid,user_id uuid);
CREATE TABLE public.club_members(id uuid PRIMARY KEY,club_id uuid,full_name text,player_user_id uuid);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, club_id uuid);
CREATE TABLE public.tournament_entries(id uuid PRIMARY KEY,tournament_id uuid,member_id uuid,player_id uuid,entry_no integer);
CREATE TABLE public.tournament_seats(id uuid PRIMARY KEY,tournament_id uuid,tournament_table_id uuid,table_session_id uuid,
 seat_number integer,is_active boolean,entry_id uuid,player_id uuid,entry_number integer,avatar_url text);
CREATE TABLE public.booking_chats(id uuid PRIMARY KEY,tournament_id uuid,club_id uuid,player_id uuid);
CREATE TABLE public.tournament_hands(id uuid PRIMARY KEY,tournament_id uuid,tournament_table_id uuid,table_session_id uuid);
CREATE TABLE public.hand_players(hand_id uuid,tournament_id uuid,player_id uuid,seat_number integer,entry_number integer,avatar_url text);

-- Existing authorized reader is represented only in this disposable SQL fixture.
CREATE FUNCTION public.get_tracker_roster_snapshot_v2(p_tournament_id uuid,p_tournament_table_id uuid,p_table_session_id uuid,p_expected_epoch bigint)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN p_expected_epoch<>1 THEN '{"ok":false,"error":"actor_not_authorized"}'::jsonb
 ELSE jsonb_build_object('ok',true,'seats',coalesce(jsonb_agg(jsonb_build_object(
 'token','unchanged','seat',to_jsonb(s),'seat_number',s.seat_number) ORDER BY s.seat_number),'[]'::jsonb)) END
 FROM public.tournament_seats s WHERE s.tournament_id=p_tournament_id AND s.tournament_table_id=p_tournament_table_id AND s.table_session_id=p_table_session_id AND s.is_active
$$;
