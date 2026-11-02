\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT md5(pg_get_functiondef('public.cashier_tour_worklist_v1(uuid,uuid,text,text,integer,integer)'::regprocedure))='6ffe6a9e0fd924ee30f5ea92e7a213b1';
END $$;
CREATE TEMP TABLE cashier746_active_before(actor uuid,club uuid,tour uuid,response jsonb);
DO $$ DECLARE t record;response jsonb;BEGIN
 FOR t IN SELECT tour.id,c.id AS club,c.owner_id AS actor FROM public.tournaments tour JOIN public.clubs c ON c.id=tour.club_id
  WHERE c.owner_id IS NOT NULL AND tour.status NOT IN('completed','cancelled')
   AND EXISTS(SELECT 1 FROM public.tournament_registrations r WHERE r.tournament_id=tour.id AND r.status IN('pending','confirmed')) ORDER BY tour.id LIMIT 3 LOOP
  PERFORM set_config('request.jwt.claim.sub',t.actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',t.actor,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  response:=public.cashier_tour_worklist_v1(t.club,t.id,'','all',0,100);
  PERFORM set_config('role','none',true);
  ASSERT response->>'ok'='true';
  INSERT INTO cashier746_active_before VALUES(t.actor,t.club,t.id,jsonb_set(response-'updated_at','{rows}',
    (SELECT coalesce(jsonb_agg(r-'receipt_is_historical'),'[]'::jsonb) FROM jsonb_array_elements(response->'rows')r)));
 END LOOP;
 ASSERT (SELECT count(*)=3 FROM cashier746_active_before);
END $$;
-- CASHIER746_CANDIDATE
DO $$ DECLARE response jsonb;target jsonb;t record;rows jsonb;BEGIN
 PERFORM set_config('request.jwt.claim.sub','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',true);
 PERFORM set_config('request.jwt.claims','{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}',true);
 PERFORM set_config('role','authenticated',true);
 response:=public.cashier_tour_worklist_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','c367013a-3ed3-48af-ad48-3915acadc50e','','all',0,50);
 ASSERT response->>'ok'='true';
 SELECT r INTO STRICT target FROM jsonb_array_elements(response->'rows')r WHERE r->>'id'='df79ea5e-ef9f-4ef6-a27c-ed53d5486a67';
 ASSERT target->>'receipt_code' IS NOT NULL,'CASHIER746_CONFIRMED_TERMINAL_HISTORY_FALSE_MISSING_RECEIPT';
 ASSERT target->>'receipt_is_historical'='true' AND target->>'bucket'='completed';
 ASSERT (response->'counts'->>'total')::integer=9 AND (response->'counts'->>'completed')::integer=9 AND (response->'counts'->>'needs_review')::integer=0;
 ASSERT (SELECT sum((r->>'received')::numeric)=900000 FROM jsonb_array_elements(response->'rows')r);
 ASSERT (SELECT bool_and((r->>'receipt_is_historical')::boolean) FROM jsonb_array_elements(response->'rows')r);
 PERFORM set_config('role','none',true);
 -- Terminal archive read must not change any field/count of existing active worklists.
 FOR t IN SELECT * FROM cashier746_active_before LOOP
  PERFORM set_config('request.jwt.claim.sub',t.actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',t.actor,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  response:=public.cashier_tour_worklist_v1(t.club,t.tour,'','all',0,100);
  PERFORM set_config('role','none',true);
  SELECT coalesce(jsonb_agg(r-'receipt_is_historical'),'[]'::jsonb) INTO rows FROM jsonb_array_elements(response->'rows')r;
  ASSERT jsonb_set(response-'updated_at','{rows}',rows)=t.response,'active worklist changed';
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
 PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
 PERFORM set_config('role','authenticated',true);
 response:=public.cashier_tour_worklist_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','c367013a-3ed3-48af-ad48-3915acadc50e','','all',0,50);
 ASSERT response='{"ok":false,"error":"actor_not_allowed"}'::jsonb;
 PERFORM set_config('role','none',true);
END $$;
SELECT 'CASHIER746_DIGEST='||md5(pg_get_functiondef('public.cashier_tour_worklist_v1(uuid,uuid,text,text,integer,integer)'::regprocedure));
ROLLBACK;
SELECT 'CASHIER746_ORIGINAL_TERMINAL_HISTORY_NINE_PAID_REGISTRATIONS_THREE_ACTIVE_PARITY_CROSS_CLUB_DENIED_ROLLBACK_PASS';
