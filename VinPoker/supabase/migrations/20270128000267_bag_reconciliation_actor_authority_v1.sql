-- Public reconciliation helper is also a direct RPC boundary, not only an internal caller.
-- Mirror get_bag_tag_state's Owner/Chip Master authority. No totals/selection/write policy change.
CREATE OR REPLACE FUNCTION public.chip_ops_day_reconcile(p_tournament_id uuid, p_day_number integer)
RETURNS TABLE(player_id uuid, player_name text, table_name text, seat_number integer,
 expected bigint, counted bigint, variance bigint, sealed boolean, bag_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_uid uuid:=auth.uid();
 v_club uuid;
BEGIN
 SELECT t.club_id INTO v_club FROM public.tournaments t
 WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF v_uid IS NULL OR v_club IS NULL OR NOT
  (public.is_club_owner(v_uid,v_club) OR public.is_club_chip_master(v_uid,v_club)) THEN
  RAISE insufficient_privilege USING MESSAGE='Forbidden';
 END IF;
 RETURN QUERY
 WITH active_players AS (
  SELECT DISTINCT ON (s.player_id)
   s.player_id,s.player_name,s.table_id,s.seat_number,s.chip_count
  FROM public.tournament_seats s
  WHERE s.tournament_id=p_tournament_id AND s.is_active=true
  ORDER BY s.player_id,s.entry_number DESC NULLS LAST
 ),sealed_bags AS (
  SELECT b.player_id,b.player_name,b.table_id,b.seat_number,b.total_value,b.bag_code,b.sealed
  FROM public.chip_bag b
  WHERE b.tournament_id=p_tournament_id AND b.day_number=p_day_number AND b.sealed=true
 )
 SELECT COALESCE(ap.player_id,sb.player_id),COALESCE(ap.player_name,sb.player_name),gt.table_name,
  COALESCE(ap.seat_number,sb.seat_number),COALESCE(ap.chip_count,0)::bigint,
  COALESCE(sb.total_value,0)::bigint,(COALESCE(sb.total_value,0)-COALESCE(ap.chip_count,0))::bigint,
  COALESCE(sb.sealed,false),sb.bag_code
 FROM active_players ap FULL OUTER JOIN sealed_bags sb ON sb.player_id=ap.player_id
 LEFT JOIN public.game_tables gt ON gt.id=COALESCE(ap.table_id,sb.table_id)
 ORDER BY gt.table_name NULLS LAST,COALESCE(ap.seat_number,sb.seat_number) NULLS LAST;
END;
$function$;

-- CREATE OR REPLACE retains existing owner/ACL/signature. No new public grant.
-- Recovery: restore the exact pre-apply pg_get_functiondef and ACL from the reviewed local/live backup.
-- Do not use this source change as authorization to apply to production.
