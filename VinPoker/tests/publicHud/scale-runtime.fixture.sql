-- Synthetic source schema for genuine local HTTP/PostgreSQL/Realtime load.
-- No production users, financial rows, Telegram or payment integration exists.
ALTER TABLE public.tournaments ADD COLUMN current_level integer DEFAULT 1,ADD COLUMN current_level_id uuid,
 ADD COLUMN clock_started_at timestamptz,ADD COLUMN clock_paused_at timestamptz,ADD COLUMN pause_accumulated integer DEFAULT 0;
ALTER TABLE public.tournament_tables ADD COLUMN table_name text NOT NULL DEFAULT 'TEST table';
ALTER TABLE public.table_sessions ADD COLUMN tournament_id uuid;
ALTER TABLE public.tournament_hands ADD COLUMN pot_size bigint DEFAULT 150;
ALTER TABLE public.hand_players ADD COLUMN hole_cards jsonb DEFAULT '[]',ADD COLUMN ending_stack bigint,ADD COLUMN is_eliminated boolean DEFAULT false;
ALTER TABLE public.hand_actions ADD COLUMN entry_number integer DEFAULT 1;
CREATE TABLE public.tournament_levels(id uuid PRIMARY KEY,tournament_id uuid,small_blind bigint DEFAULT 50,big_blind bigint DEFAULT 100,
 ante bigint DEFAULT 0,level_number integer DEFAULT 1,UNIQUE(tournament_id,level_number));
CREATE TABLE public.tournament_entries(id uuid PRIMARY KEY,tournament_id uuid,player_id uuid,entry_no integer DEFAULT 1,
 finished_place integer,status text DEFAULT 'seated',UNIQUE(tournament_id,player_id,entry_no));
CREATE TABLE public.tournament_chip_counts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,player_id uuid,
 entry_number integer DEFAULT 1,chip_count bigint DEFAULT 1000,updated_at timestamptz DEFAULT clock_timestamp(),UNIQUE(tournament_id,player_id,entry_number));
CREATE TABLE public.tournament_seats(id uuid PRIMARY KEY,tournament_id uuid,player_id uuid,entry_number integer DEFAULT 1,
 entry_id uuid,player_name text,avatar_url text,is_active boolean DEFAULT true,created_at timestamptz DEFAULT clock_timestamp());
CREATE INDEX fixture_seats_identity ON public.tournament_seats(tournament_id,player_id,entry_number);
CREATE TABLE public.tournament_prizes(id uuid PRIMARY KEY,tournament_id uuid,position integer,amount bigint);
CREATE TABLE public.tournament_eliminations(id uuid PRIMARY KEY,tournament_id uuid);
-- Columns used by the unchanged canonical clock/participation readers. These
-- synthetic tables contain no copied accounts, payroll or financial entries.
ALTER TABLE public.tournaments ADD COLUMN name text DEFAULT 'SCALE TEST',ADD COLUMN club_id uuid DEFAULT '40000000-0000-4000-8000-000000000001',
 ADD COLUMN start_time timestamptz DEFAULT now(),ADD COLUMN guarantee_amount numeric DEFAULT 0,ADD COLUMN buy_in numeric DEFAULT 0;
ALTER TABLE public.tournament_levels ADD COLUMN duration_minutes integer DEFAULT 20,ADD COLUMN is_break boolean DEFAULT false;
CREATE TABLE public.game_tables(id uuid PRIMARY KEY,club_id uuid);
ALTER TABLE public.tournament_tables ADD COLUMN game_table_id uuid,ADD COLUMN status text DEFAULT 'active',ADD COLUMN max_seats integer DEFAULT 9;
ALTER TABLE public.table_sessions ADD COLUMN club_id uuid,ADD COLUMN game_table_id uuid;
ALTER TABLE public.tournament_entries ADD COLUMN current_stack bigint DEFAULT 1000,ADD COLUMN seat_number integer;
ALTER TABLE public.tournament_seats ADD COLUMN tournament_table_id uuid,ADD COLUMN table_id uuid,ADD COLUMN table_session_id uuid,
 ADD COLUMN seat_number integer,ADD COLUMN chip_count bigint DEFAULT 1000;
CREATE SCHEMA IF NOT EXISTS floor_private;
GRANT SELECT ON public.tournaments,public.tournament_levels TO anon;

CREATE OR REPLACE FUNCTION public.get_public_tournament_hand_v2(p_tournament_id uuid, p_hand_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT COALESCE((SELECT jsonb_build_object('id',h.id,'tournamentId',h.tournament_id,'tableId',h.tournament_table_id,
  'tableSessionId',h.table_session_id,'handNumber',h.hand_number,'buttonSeat',h.button_seat,'status',h.status,
  'bigBlind',h.tracker_big_blind,'smallBlind',h.tracker_small_blind,
  'levelNumber',h.tracker_level_number,'ante',h.tracker_bba,
  'board',COALESCE(h.community_cards,'[]'::jsonb),'pot',h.pot_size,'holeCardsPolicy','recorded',
  'players',COALESCE((SELECT jsonb_agg(jsonb_build_object('playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
    'name',COALESCE(NULLIF(hp.player_name,''),'Người chơi'),'avatarUrl',hp.avatar_url,
    'startingStack',hp.starting_stack,'endingStack',hp.ending_stack,'eliminated',hp.is_eliminated,
    'holeCards',COALESCE(hp.hole_cards,'[]'::jsonb)) ORDER BY hp.seat_number)
    FROM public.hand_players hp WHERE hp.hand_id=h.id),'[]'::jsonb),
  'actions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ha.id,'playerId',ha.player_id,'entryNumber',ha.entry_number,
    'street',ha.street,'actionType',ha.action_type,'amount',ha.action_amount,'order',ha.action_order) ORDER BY ha.action_order)
    FROM public.hand_actions ha WHERE ha.hand_id=h.id),'[]'::jsonb))
  FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
  WHERE h.id=p_hand_id AND h.tournament_id=p_tournament_id AND t.deleted_at IS NULL AND NOT COALESCE(h.is_voided,false)),'{}'::jsonb);
$function$
;
-- The load writer is fixture-only, privileged and absent from release migrations.
-- It performs real source transactions/trigger writes; it is not Floor auth UAT.
CREATE FUNCTION public.fixture_complete_scale_hand_v1(p_tournament_id uuid,p_number integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE hand uuid:=gen_random_uuid(); t public.tournament_tables;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT t FROM public.tournament_tables WHERE tournament_id=p_tournament_id LIMIT 1;
 INSERT INTO public.tournament_hands(id,tournament_id,tournament_table_id,table_session_id,hand_number,hand_time,status,
   tracker_small_blind,tracker_big_blind,tracker_level_number,tracker_bba)
 VALUES(hand,p_tournament_id,t.id,t.table_session_id,p_number,clock_timestamp(),'in_progress',50,100,1,0);
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack,player_name) VALUES
  (hand,p_tournament_id,'30000000-0000-4000-8000-000000000001',1,1000,'SCALE TEST A'),
  (hand,p_tournament_id,'30000000-0000-4000-8000-000000000002',2,1000,'SCALE TEST B');
 INSERT INTO public.hand_actions(hand_id,player_id,street,action_type,action_amount,action_order) VALUES
  (hand,'30000000-0000-4000-8000-000000000001','preflop','post_sb',50,1),
  (hand,'30000000-0000-4000-8000-000000000002','preflop','post_bb',100,2),
  (hand,'30000000-0000-4000-8000-000000000001','preflop','raise',250,3),
  (hand,'30000000-0000-4000-8000-000000000002','preflop','fold',0,4);
 UPDATE public.tournament_hands SET status='completed',source_revision=source_revision+1 WHERE id=hand;
 RETURN jsonb_build_object('handId',hand,'sourceWrittenAt',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.fixture_complete_scale_hand_v1(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_complete_scale_hand_v1(uuid,integer) TO service_role;
CREATE FUNCTION public.fixture_scale_step_v1(p_tournament_id uuid,p_number integer,p_step integer,p_hand_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE hand uuid:=p_hand_id; t public.tournament_tables; who uuid; kind text; amount integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_step NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'invalid_step'; END IF;
 SELECT * INTO STRICT t FROM public.tournament_tables WHERE tournament_id=p_tournament_id LIMIT 1;
 IF p_step=0 THEN
  hand:=gen_random_uuid();
  INSERT INTO public.tournament_hands(id,tournament_id,tournament_table_id,table_session_id,hand_number,hand_time,status,tracker_small_blind,tracker_big_blind,tracker_level_number,tracker_bba)
  VALUES(hand,p_tournament_id,t.id,t.table_session_id,p_number,clock_timestamp(),'in_progress',50,100,1,0);
  INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack,player_name) VALUES
   (hand,p_tournament_id,'30000000-0000-4000-8000-000000000001',1,1000,'SCALE TEST A'),
   (hand,p_tournament_id,'30000000-0000-4000-8000-000000000002',2,1000,'SCALE TEST B');
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=hand AND tournament_id=p_tournament_id AND tournament_table_id=t.id AND table_session_id=t.table_session_id AND status='in_progress') THEN RAISE EXCEPTION 'fixture_scope_mismatch'; END IF;
  IF p_step=5 THEN UPDATE public.tournament_hands SET status='completed',source_revision=source_revision+1 WHERE id=hand;
  ELSE
   SELECT CASE WHEN p_step IN (1,3) THEN '30000000-0000-4000-8000-000000000001'::uuid ELSE '30000000-0000-4000-8000-000000000002'::uuid END,
    CASE p_step WHEN 1 THEN 'post_sb' WHEN 2 THEN 'post_bb' WHEN 3 THEN 'raise' ELSE 'fold' END,
    CASE p_step WHEN 1 THEN 50 WHEN 2 THEN 100 WHEN 3 THEN 250 ELSE 0 END INTO who,kind,amount;
   INSERT INTO public.hand_actions(hand_id,player_id,street,action_type,action_amount,action_order) VALUES(hand,who,'preflop',kind,amount,p_step);
  END IF;
 END IF;
 RETURN jsonb_build_object('handId',hand,'generation',(SELECT source_revision::text FROM spectator_projection_v2.entity_markers WHERE tournament_id=p_tournament_id AND component='tables' AND entity_key='generation'),'sourceWrittenAt',clock_timestamp());
END $$;
CREATE FUNCTION public.fixture_scale_visibility_v1(p_tournament_id uuid,p_hidden boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 UPDATE public.tournaments SET deleted_at=CASE WHEN p_hidden THEN clock_timestamp() ELSE NULL END WHERE id=p_tournament_id;RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.fixture_scale_step_v1(uuid,integer,integer,uuid),public.fixture_scale_visibility_v1(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_scale_step_v1(uuid,integer,integer,uuid),public.fixture_scale_visibility_v1(uuid,boolean) TO service_role;
CREATE FUNCTION public.fixture_scale_hand_ready_v1(p_hand_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.id=p_hand_id AND h.status='completed'
  AND (SELECT count(*) FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=h.id AND c.source_revision=h.source_revision)=2
  AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs j WHERE j.kind='hand' AND j.entity_id=h.id));
END $$;
REVOKE ALL ON FUNCTION public.fixture_scale_hand_ready_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_scale_hand_ready_v1(uuid) TO service_role;
