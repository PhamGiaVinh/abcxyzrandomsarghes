-- Existing exact native TEST; caller creates candidates216/217 and ROLLBACKs all.
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c';ASSERT inet_server_port()=55441;END $$;
CREATE TEMP TABLE config199_before AS SELECT md5(jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 'payments',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tournament_prize_payments m),
 'overlay',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.multi_day_overlay_funding_v1 m),
 'finalizations',(SELECT jsonb_agg(to_jsonb(m) ORDER BY event_id) FROM public.multi_day_payout_finalizations_v1 m))::text) hash;
UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE e uuid:='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';p jsonb;r jsonb;again jsonb;
 rows jsonb:='[{"position":1,"amount":110000},{"position":2,"amount":110000},{"position":3,"amount":110000},{"position":4,"amount":110000}]';
 request uuid:='19900000-0000-4000-8000-000000000001';
BEGIN
 p:=public.multi_day_payout_configuration_preview_v1(e,rows);
 r:=public.multi_day_save_prize_configuration_v1(e,rows,p->>'configurationRevision',p->>'rulesVersion',p->>'fundingRevision',p->>'qualificationRevision',p->>'payoutInputHash',request,'TEST candidate authoring only');
 ASSERT r->>'state'='CONFIGURED' AND r->>'idempotent'='false';
 ASSERT r->>'configurationRevision'<>p->>'configurationRevision';
 ASSERT r->>'fundingExecution'='NOT_PERFORMED' AND r->>'paymentExecution'='NOT_PERFORMED' AND r->>'obligationFinalization'='NOT_PERFORMED';
 ASSERT (r->>'requiredShortfallVnd')::bigint=160000;
 ASSERT r->'requestPayload'->>'reason'='TEST candidate authoring only';
 ASSERT r->'requestPayload'->'rows'=rows;
 ASSERT r->'requestPayload'->>'funding'=p->>'fundingRevision';
 again:=public.multi_day_save_prize_configuration_v1(e,rows,p->>'configurationRevision',p->>'rulesVersion',p->>'fundingRevision',p->>'qualificationRevision',p->>'payoutInputHash',request,'TEST candidate authoring only');
 ASSERT again=r||jsonb_build_object('idempotent',true);
 ASSERT public.multi_day_prize_configuration_receipt_v1(e,request)=r;
 ASSERT public.multi_day_payout_preview_v1(e)->>'state'='REQUIRED_SHORTFALL';
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1(e,rows,p->>'configurationRevision',p->>'rulesVersion',p->>'fundingRevision',p->>'qualificationRevision',p->>'payoutInputHash',gen_random_uuid(),'TEST stale request');
  RAISE EXCEPTION 'stale configuration accepted';
 EXCEPTION WHEN serialization_failure THEN ASSERT SQLERRM='multi_day_configuration_stale';END;
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1(e,jsonb_set(rows,'{0,amount}','120000'),p->>'configurationRevision',p->>'rulesVersion',p->>'fundingRevision',p->>'qualificationRevision',p->>'payoutInputHash',request,'TEST candidate authoring only');
  RAISE EXCEPTION 'different payload reused request';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_configuration_idempotency_conflict';END;
 p:=public.multi_day_payout_configuration_preview_v1(e,rows);
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1(e,rows,p->>'configurationRevision',p->>'rulesVersion',repeat('b',32),p->>'qualificationRevision',p->>'payoutInputHash',gen_random_uuid(),'TEST changed funding');
  RAISE EXCEPTION 'stale funding accepted';
 EXCEPTION WHEN serialization_failure THEN ASSERT SQLERRM='multi_day_configuration_source_changed';END;
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1(e,jsonb_set(rows,'{1,amount}','120000'),p->>'configurationRevision',p->>'rulesVersion',p->>'fundingRevision',p->>'qualificationRevision',p->>'payoutInputHash',gen_random_uuid(),'TEST non-monotone');
  RAISE EXCEPTION 'non-monotone rows accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_configuration_rows_invalid';END;
 RAISE NOTICE 'MULTIDAY199_ACTUAL_SAVE_REPLAY_RECEIPT_CONFLICT_STALE_NO_FUNDING_PASS';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM private.multi_day_prize_configurations_v1)=1;
 ASSERT (SELECT count(*) FROM private.multi_day_prize_write_intents_v1)=0;
 ASSERT (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=4;
 BEGIN
  DELETE FROM public.tournament_prizes WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580';
  RAISE EXCEPTION 'legacy direct prize delete accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_verified_payout_writer_required';END;
 ASSERT NOT has_table_privilege('authenticated','private.multi_day_prize_write_intents_v1','INSERT');
 ASSERT NOT has_table_privilege('authenticated','private.multi_day_prize_configurations_v1','SELECT');
 ASSERT NOT has_function_privilege('service_role','public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.multi_day_prize_configuration_receipt_v1(uuid,uuid)','EXECUTE');
 BEGIN
  UPDATE private.multi_day_prize_configurations_v1 SET receipt='{}';
  RAISE EXCEPTION 'immutable history updated';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_qualification_immutable';END;
END $$;
CREATE FUNCTION pg_temp.config199_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_CONFIG199_INSERT_FAULT';END $$;
CREATE TRIGGER config199_fault BEFORE INSERT ON public.tournament_prizes FOR EACH ROW WHEN(NEW.position=2) EXECUTE FUNCTION pg_temp.config199_fault();
SET LOCAL ROLE authenticated;
DO $$ DECLARE p jsonb;rows jsonb:='[{"position":1,"amount":120000},{"position":2,"amount":110000},{"position":3,"amount":110000},{"position":4,"amount":110000}]';BEGIN
 p:=public.multi_day_payout_configuration_preview_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',rows);
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',rows,p->>'configurationRevision',p->>'rulesVersion',p->>'fundingRevision',p->>'qualificationRevision',p->>'payoutInputHash',gen_random_uuid(),'TEST mid-insert rollback');
  RAISE EXCEPTION 'injected failure did not run';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='LOCAL_CONFIG199_INSERT_FAULT';END;
 ASSERT public.multi_day_payout_configuration_preview_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',rows)->>'configurationRevision'=p->>'configurationRevision';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM private.multi_day_prize_configurations_v1)=1;
 ASSERT (SELECT count(*) FROM private.multi_day_prize_write_intents_v1)=0;
 ASSERT (SELECT hash FROM config199_before)=md5(jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 'payments',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tournament_prize_payments m),
 'overlay',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.multi_day_overlay_funding_v1 m),
 'finalizations',(SELECT jsonb_agg(to_jsonb(m) ORDER BY event_id) FROM public.multi_day_payout_finalizations_v1 m))::text);
 RAISE NOTICE 'MULTIDAY199_INTENT_CONSUMPTION_LEGACY_HOLD_ATOMIC_FAILURE_NO_MONEY_ENTRY_DELTA_PASS';
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d','[]',repeat('a',32),repeat('a',32),repeat('a',32),repeat('a',32),repeat('a',32),gen_random_uuid(),'TEST outsider');
  RAISE EXCEPTION 'outsider save accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_configuration_actor_denied';END;
 BEGIN
  PERFORM public.multi_day_prize_configuration_receipt_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d','19900000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'outsider receipt exposed';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_configuration_actor_denied';END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='54d78bf7-528b-41a9-84ea-765fdd5826d6';
SET LOCAL request.jwt.claims='{"sub":"54d78bf7-528b-41a9-84ea-765fdd5826d6","role":"authenticated"}';
DO $$ DECLARE rows jsonb;BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id='30eb935c-8ba6-43ab-a6a6-0c0934f71570');
 SELECT jsonb_agg(jsonb_build_object('position',q.position,'amount',q.amount) ORDER BY q.position) INTO rows
 FROM public.tournament_prizes q WHERE q.tournament_id='6f0ebd0d-505b-4151-a8a9-bfe5b58ce34f';
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1('30eb935c-8ba6-43ab-a6a6-0c0934f71570',rows,repeat('a',32),repeat('a',32),repeat('a',32),repeat('a',32),repeat('a',32),gen_random_uuid(),'TEST finalized hold');
  RAISE EXCEPTION 'finalized table changed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_configuration_already_finalized_or_paid';END;
 RAISE NOTICE 'MULTIDAY199_TENANT_RECEIPT_IMMUTABILITY_FINALIZED_SNAPSHOT_HOLD_PASS';
END $$;
