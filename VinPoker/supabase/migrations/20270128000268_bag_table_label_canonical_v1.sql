-- Labels only. No identity backfill or seating/bag/variance policy change.
CREATE FUNCTION floor_private.chip_bag_table_label_v1(p_tournament_id uuid,p_tournament_table_id uuid,p_table_id uuid,p_session_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_club uuid;v_logical uuid:=p_tournament_table_id;v_physical uuid;v_name text;v_tt record;
BEGIN
 SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF v_club IS NULL THEN RETURN NULL;END IF;
 IF v_logical IS NULL AND p_table_id IS NOT NULL THEN
  SELECT tt.id INTO v_logical FROM public.tournament_tables tt WHERE tt.id=p_table_id;
 END IF;
 IF v_logical IS NOT NULL THEN
  SELECT tt.game_table_id,tt.table_id,tt.table_session_id INTO v_tt FROM public.tournament_tables tt
  WHERE tt.id=v_logical AND tt.tournament_id=p_tournament_id;
  IF NOT FOUND THEN RETURN NULL;END IF;
  IF v_tt.game_table_id IS NOT NULL AND v_tt.table_id IS NOT NULL AND v_tt.game_table_id<>v_tt.table_id THEN RETURN NULL;END IF;
  v_physical:=COALESCE(v_tt.game_table_id,v_tt.table_id);
  IF p_table_id IS NOT NULL AND p_table_id<>v_logical AND p_table_id IS DISTINCT FROM v_physical THEN RETURN NULL;END IF;
  IF p_session_id IS NOT NULL AND p_session_id IS DISTINCT FROM v_tt.table_session_id THEN RETURN NULL;END IF;
 ELSE
  v_physical:=p_table_id;
 END IF;
 IF v_physical IS NULL THEN RETURN NULL;END IF;
 IF p_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id=p_session_id
  AND s.tournament_id=p_tournament_id AND s.club_id=v_club AND s.game_table_id=v_physical) THEN RETURN NULL;END IF;
 SELECT g.table_name INTO v_name FROM public.game_tables g WHERE g.id=v_physical AND g.club_id=v_club;
 RETURN v_name;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.chip_ops_day_reconcile(p_tournament_id uuid,p_day_number integer)
RETURNS TABLE(player_id uuid,player_name text,table_name text,seat_number integer,
 expected bigint,counted bigint,variance bigint,sealed boolean,bag_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_uid uuid:=auth.uid();v_club uuid;
BEGIN
 SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF v_uid IS NULL OR v_club IS NULL OR NOT(public.is_club_owner(v_uid,v_club) OR public.is_club_chip_master(v_uid,v_club)) THEN
  RAISE insufficient_privilege USING MESSAGE='Forbidden';
 END IF;
 RETURN QUERY WITH active_players AS (
  SELECT DISTINCT ON(s.player_id) s.player_id,s.player_name,s.table_id,s.tournament_table_id,s.table_session_id,s.seat_number,s.chip_count
  FROM public.tournament_seats s WHERE s.tournament_id=p_tournament_id AND s.is_active=true
  ORDER BY s.player_id,s.entry_number DESC NULLS LAST
 ),sealed_bags AS (
  SELECT b.player_id,b.player_name,b.table_id,b.seat_number,b.total_value,b.bag_code,b.sealed
  FROM public.chip_bag b WHERE b.tournament_id=p_tournament_id AND b.day_number=p_day_number AND b.sealed=true
 ),projected AS (
  SELECT COALESCE(ap.player_id,sb.player_id) player_id,COALESCE(ap.player_name,sb.player_name) player_name,
   floor_private.chip_bag_table_label_v1(p_tournament_id,ap.tournament_table_id,
    CASE WHEN ap.player_id IS NOT NULL THEN ap.table_id ELSE sb.table_id END,ap.table_session_id) table_name,
   COALESCE(ap.seat_number,sb.seat_number) seat_number,COALESCE(ap.chip_count,0)::bigint expected,
   COALESCE(sb.total_value,0)::bigint counted,(COALESCE(sb.total_value,0)-COALESCE(ap.chip_count,0))::bigint variance,
   COALESCE(sb.sealed,false) sealed,sb.bag_code
  FROM active_players ap FULL OUTER JOIN sealed_bags sb ON sb.player_id=ap.player_id
 ) SELECT p.player_id,p.player_name,p.table_name,p.seat_number,p.expected,p.counted,p.variance,p.sealed,p.bag_code
 FROM projected p ORDER BY p.table_name NULLS LAST,p.seat_number NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bag_tag_state(p_tournament_id uuid,p_day_number integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_uid uuid:=auth.uid();v_club uuid;v_recon jsonb;v_texp bigint;v_tcnt bigint;v_allzero boolean;
 v_day jsonb;v_bags jsonb;v_players jsonb;v_days jsonb;
BEGIN
 SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND');END IF;
 IF v_uid IS NULL OR NOT(public.is_club_owner(v_uid,v_club) OR public.is_club_chip_master(v_uid,v_club)) THEN
  RETURN jsonb_build_object('error','Forbidden');END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id',r.player_id,'player_name',r.player_name,'table_name',r.table_name,
  'seat_number',r.seat_number,'expected',r.expected,'counted',r.counted,'variance',r.variance,'sealed',r.sealed,'bag_code',r.bag_code)
  ORDER BY r.table_name NULLS LAST,r.seat_number NULLS LAST),'[]'::jsonb),
  COALESCE(SUM(r.expected),0)::bigint,COALESCE(SUM(r.counted),0)::bigint,COALESCE(bool_and(r.variance=0),true)
 INTO v_recon,v_texp,v_tcnt,v_allzero FROM public.chip_ops_day_reconcile(p_tournament_id,p_day_number) r;
 SELECT jsonb_build_object('status',COALESCE(d.status,'open'),'version',COALESCE(d.version,0),
  'signed_off',COALESCE(d.signed_off,false),'signoff_reason',d.signoff_reason,'locked_at',d.locked_at)
 INTO v_day FROM public.day_close d WHERE d.tournament_id=p_tournament_id AND d.day_number=p_day_number;
 IF v_day IS NULL THEN v_day:=jsonb_build_object('status','open','version',0,'signed_off',false);END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'player_id',b.player_id,'player_name',b.player_name,'table_id',b.table_id,
  'seat_number',b.seat_number,'bag_code',b.bag_code,'stack_value',b.stack_value,'total_value',b.total_value,'sealed',b.sealed)
  ORDER BY b.seat_number NULLS LAST),'[]'::jsonb)
 INTO v_bags FROM public.chip_bag b WHERE b.tournament_id=p_tournament_id AND b.day_number=p_day_number;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id',s.player_id,'player_name',s.player_name,'table_id',s.table_id,
  'table_name',floor_private.chip_bag_table_label_v1(p_tournament_id,s.tournament_table_id,s.table_id,s.table_session_id),
  'seat_number',s.seat_number,'chip_count',s.chip_count)
  ORDER BY floor_private.chip_bag_table_label_v1(p_tournament_id,s.tournament_table_id,s.table_id,s.table_session_id) NULLS LAST,
  s.seat_number NULLS LAST),'[]'::jsonb)
 INTO v_players FROM public.tournament_seats s WHERE s.tournament_id=p_tournament_id AND s.is_active=true;
 SELECT COALESCE(jsonb_agg(q.d ORDER BY q.d),'[]'::jsonb) INTO v_days FROM (
  SELECT DISTINCT u.day_number d FROM(SELECT d.day_number FROM public.day_close d WHERE d.tournament_id=p_tournament_id
   UNION SELECT b.day_number FROM public.chip_bag b WHERE b.tournament_id=p_tournament_id) u) q;
 RETURN jsonb_build_object('tournament_id',p_tournament_id,'day_number',p_day_number,'day',v_day,
  'reconciliation',jsonb_build_object('players',v_recon,'total_expected_value',v_texp,'total_counted_value',v_tcnt,
   'total_variance_value',v_tcnt-v_texp,'all_zero',v_allzero),'bags',v_bags,'players',v_players,'days',v_days);
END;
$$;
-- Public signatures/ACLs retained. Install/recovery must capture all three definitions and the private helper ACL.
