\set ON_ERROR_STOP on
CREATE TEMP TABLE bag627_before AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text) facts;
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regprocedure('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_bag WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c');
END $$;
-- CANDIDATE270
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
DO $$ DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';actor uuid:=auth.uid();
 key uuid:='e6270000-0000-4000-8000-000000000001';cancel_key uuid:='e6270000-0000-4000-8000-000000000002';
 close_key uuid:='e6270000-0000-4000-8000-000000000003';
 payload jsonb:=jsonb_build_object('player_id','5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','bag_code','BAG627-TEST','total_value',58900,'seal',true);
 r jsonb;first_result jsonb;bag uuid;close_payload jsonb;other_player uuid;unseal_key uuid:=gen_random_uuid();unseal_result jsonb;good_close_key uuid:=gen_random_uuid();good_close_result jsonb;BEGIN
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload,key,actor,'read')->>'status'='unknown';
 r:=public.chip_ops_bag_intent_v1(tour,1,'record',payload,key,actor);
 ASSERT r->>'status'='committed' AND r->'result'->>'status'='ok';first_result:=r;bag:=(r->'result'->>'chip_bag_id')::uuid;
 ASSERT r->>'actor_id'=actor::text AND r->>'request_id'=key::text;
 ASSERT r->'intent'=jsonb_build_object('tournament_id',tour,'day_number',1,'operation','record','payload',payload);
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload,key,actor)=first_result;
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload,key,actor,'read')=first_result;
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload||'{"total_value":58800}',key,actor)->>'error'='IDEMPOTENCY_CONFLICT';
 ASSERT public.chip_ops_bag_intent_v1(tour,2,'record',payload,key,actor)->>'error'='IDEMPOTENCY_CONFLICT';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload||'{"surplus":true}',key,actor)->>'error'='INVALID_INPUT';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload||'{"total_value":1.5}',key,actor)->>'error'='INVALID_INPUT';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload,key,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e')->>'error'='ACTOR_MISMATCH';
 r:=public.chip_ops_bag_intent_v1(tour,1,'unseal',jsonb_build_object('bag_id',bag),cancel_key,actor,'cancel');
 ASSERT r->'result'->>'error'='REQUEST_CANCELLED';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'unseal',jsonb_build_object('bag_id',bag),cancel_key,actor)=r;
 ASSERT (SELECT sealed FROM public.chip_bag WHERE id=bag);
 -- Terminal business rejection cannot later turn into a success on retry.
 close_payload:=jsonb_build_object('old_version',0,'force_signoff',false,'signoff_reason',NULL);
 r:=public.chip_ops_bag_intent_v1(tour,1,'close',close_payload,close_key,actor);
 ASSERT r->'result'->>'error'='VARIANCE_NONZERO';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'close',close_payload,close_key,actor)=r;
 ASSERT public.chip_ops_bag_intent_v1(tour,2,'unseal',jsonb_build_object('bag_id',bag),gen_random_uuid(),actor)->'result'->>'error'='BAG_NOT_IN_DAY';
 SELECT (x->>'player_id')::uuid INTO STRICT other_player FROM jsonb_array_elements(public.get_bag_tag_state(tour,1)->'players') x
 WHERE x->>'player_id'<>payload->>'player_id';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',jsonb_build_object('player_id',other_player,'bag_code','BAG627-SECOND','total_value',NULL,'seal',true),gen_random_uuid(),actor)->'result'->>'status'='ok';
 -- Earlier rejected request remains rejected even though the day can now close.
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'close',close_payload,close_key,actor)=r;
 good_close_result:=public.chip_ops_bag_intent_v1(tour,1,'close',close_payload,good_close_key,actor);
 ASSERT good_close_result->'result'->>'status'='ok';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'reopen','{"old_version":1}',gen_random_uuid(),actor)->'result'->>'status'='ok';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'close',close_payload,good_close_key,actor)=good_close_result;
 ASSERT (SELECT status='open' AND version=2 FROM public.day_close WHERE tournament_id=tour AND day_number=1);
 unseal_result:=public.chip_ops_bag_intent_v1(tour,1,'unseal',jsonb_build_object('bag_id',bag),unseal_key,actor);
 ASSERT unseal_result->'result'->>'status'='ok';
 -- Retry of the original seal must not reseal a deliberately reopened bag.
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload,key,actor)=first_result;
 ASSERT NOT (SELECT sealed FROM public.chip_bag WHERE id=bag);
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'record',payload,gen_random_uuid(),actor)->'result'->>'status'='ok';
 ASSERT public.chip_ops_bag_intent_v1(tour,1,'unseal',jsonb_build_object('bag_id',bag),unseal_key,actor)=unseal_result;
 ASSERT (SELECT sealed FROM public.chip_bag WHERE id=bag);
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
DO $$ BEGIN
 ASSERT public.chip_ops_bag_intent_v1('46cab483-91e7-4220-aacf-e17bdf05269c',1,'reopen','{"old_version":0}',gen_random_uuid(),auth.uid(),'read')->>'error'='Forbidden';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.chip_bag WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c')=2;
 ASSERT NOT has_function_privilege('anon','public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)','EXECUTE');
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT to_regprocedure('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)') IS NULL;
 ASSERT (SELECT facts FROM bag627_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);
END $$;
SELECT 'BAG627_DURABLE_INTENT_NATIVE_ROLLBACK_PASS';
