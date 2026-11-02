-- Regression for the proposed canonical resource handoff after locked bagging.
-- Intentionally RED until that operation exists. Never clear/bust source seats.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f JOIN public.day_close d
  ON d.tournament_id=f.flight_tournament_id AND d.day_number=f.day_number
  WHERE f.flight_tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee' AND f.status='locked'
   AND d.status='locked' AND d.expected_total_value=160000 AND d.counted_total_value=160000);
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND is_active)=8;
 ASSERT to_regprocedure('public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid)') IS NOT NULL,
  'MISSING_CANONICAL_LOCKED_BAG_TABLE_HANDOFF';
END $$;
ROLLBACK;
