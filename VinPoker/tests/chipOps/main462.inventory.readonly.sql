BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb;b jsonb;final_inv jsonb;roster jsonb;carry bigint;BEGIN
 a:=public.get_current_chip_inventory('782a5196-5ea1-44ed-8a27-1b872d5f88d9');
 b:=public.get_current_chip_inventory('fdf91018-09f3-4cdc-b76a-f688eb216cee');
 final_inv:=public.get_current_chip_inventory('4cd3af4d-7e1d-4042-855f-04fb6777e580');
 roster:=public.multi_day_final_roster_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 ASSERT a->>'tournament_id'='782a5196-5ea1-44ed-8a27-1b872d5f88d9';
 ASSERT b->>'tournament_id'='fdf91018-09f3-4cdc-b76a-f688eb216cee';
 ASSERT final_inv->>'tournament_id'='4cd3af4d-7e1d-4042-855f-04fb6777e580';
 ASSERT (a->>'total_value')::bigint=160000 AND (b->>'total_value')::bigint=160000;
 ASSERT (final_inv->>'total_value')::bigint=0 AND jsonb_array_length(final_inv->'denominations')=0;
 ASSERT jsonb_array_length(roster#>'{initialDraws,0,assignments}')=15;
 SELECT sum((x->>'stack')::bigint) INTO carry FROM jsonb_array_elements(roster#>'{initialDraws,0,assignments}') x;
 ASSERT carry=300000;
 -- Deliberately different grains: historical flight issuance is not D2 carry.
 -- Never manufacture Final denomination issuance from aggregate stack/bags.
 ASSERT carry<>(a->>'total_value')::bigint+(b->>'total_value')::bigint;
 RAISE NOTICE 'MAIN462_SCOPED_FLIGHT_ISSUANCE_160K_160K_FINAL0_D2_CARRY300K15_DISTINCT_GRAINS_PASS';
END $$;
ROLLBACK;
