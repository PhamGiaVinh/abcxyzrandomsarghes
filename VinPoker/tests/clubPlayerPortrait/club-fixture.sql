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
