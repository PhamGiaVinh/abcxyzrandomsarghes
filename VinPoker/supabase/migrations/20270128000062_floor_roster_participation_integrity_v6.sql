-- CLI-created candidate promoted to unused catalog62 after source/live check.
-- Read-only: canonical participation owns integrity; roster preserves occupancy.
-- ROLLBACK: revert v6 consumers before revoking/dropping only this new RPC.
-- Do not repair seats, entries, chips, audit or migration history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.get_floor_tournament_table_roster_v6(uuid)') IS NOT NULL
 OR md5(replace(pg_get_functiondef('public.get_floor_tournament_table_roster_v5(uuid)'::regprocedure),chr(13),''))
    IS DISTINCT FROM '4849ae19f6f74aadbde26ba4e86c2e8b'
 OR md5(replace(pg_get_functiondef('floor_private.tournament_participation_v1(uuid)'::regprocedure),chr(13),''))
    IS DISTINCT FROM '3ec6dd6e4db2e8f75602d2c62a925910' THEN
   RAISE EXCEPTION 'floor_roster_participation_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.get_floor_tournament_table_roster_v6(p_tournament_id uuid)
RETURNS TABLE(
 tournament_id uuid,tournament_table_id uuid,game_table_id uuid,
 table_number integer,table_name text,table_session_id uuid,
 session_revision bigint,control_mode text,control_epoch bigint,
 max_seats integer,tournament_table_status text,session_closed_at timestamptz,
 active_dealer_assignment_id uuid,seat_locks jsonb,seats jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH roster AS MATERIALIZED (
   SELECT * FROM public.get_floor_tournament_table_roster_v5(p_tournament_id)
 ), participation AS MATERIALIZED (
   SELECT public.get_tournament_participation_v1(p_tournament_id) value
 )
 SELECT r.tournament_id,r.tournament_table_id,r.game_table_id,r.table_number,
  r.table_name,r.table_session_id,r.session_revision,r.control_mode,r.control_epoch,
  r.max_seats,r.tournament_table_status,r.session_closed_at,r.active_dealer_assignment_id,
  r.seat_locks,COALESCE((
   SELECT jsonb_agg(s.value || jsonb_build_object('integrity_status',
    CASE WHEN s.value->>'integrity_status'='missing_entry' THEN 'missing_entry'
      WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p.value->'seats') c
       WHERE c->>'entry_id'=s.value->>'entry_id'
        AND c->>'seat_number'=s.value->>'seat_number'
        AND c->>'tournament_table_id'=r.tournament_table_id::text
        AND c->>'table_session_id'=r.table_session_id::text
        AND c->>'participation_status'='seated') THEN 'valid'
      ELSE 'invalid_participation' END) ORDER BY (s.value->>'seat_number')::integer)
   FROM jsonb_array_elements(r.seats) s(value)
  ),'[]'::jsonb)
 FROM roster r CROSS JOIN participation p;
$$;
ALTER FUNCTION public.get_floor_tournament_table_roster_v6(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_floor_tournament_table_roster_v6(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_roster_v6(uuid) TO authenticated;
COMMIT;
