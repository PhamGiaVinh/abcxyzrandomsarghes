-- Loaded INSIDE the candidate transaction by feature821.atomic.native.mjs.
CREATE TEMP TABLE feature821 AS
SELECT 'd4427834-5f5f-48ef-bde5-e2dc388ed00b'::uuid club,
 'e532db28-8841-48b0-8972-a9355f1dabe3'::uuid physical,
 '40fa819c-df95-45fd-b3d8-8fe3e3aa1d84'::uuid request,
 (SELECT jsonb_agg(jsonb_build_object('dealer_id',id,'priority',priority,'is_primary',priority=0) ORDER BY priority)
  FROM(SELECT id,(row_number()OVER(ORDER BY id)-1)::integer priority FROM public.dealers
   WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' ORDER BY id LIMIT 2)d) members,
 (SELECT id FROM public.dealers WHERE club_id<>'d4427834-5f5f-48ef-bde5-e2dc388ed00b' ORDER BY id LIMIT 1) foreign_dealer,
 (SELECT id FROM public.game_tables WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND table_number=99) other_table;
GRANT SELECT ON feature821 TO authenticated;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id=(SELECT physical FROM feature821));
 ASSERT jsonb_array_length((SELECT members FROM feature821))=2;
 ASSERT (SELECT foreign_dealer IS NOT NULL AND other_table IS NOT NULL FROM feature821);
 ASSERT NOT has_function_privilege('anon','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.set_table_dealer_mode(uuid,text,boolean,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.set_table_dealer_pool(uuid,jsonb)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','private.dealer_feature_config_receipts_v1','SELECT');
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='private.dealer_feature_config_receipts_v1'::regclass);
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO STRICT f FROM feature821;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'feature',false,false,'[]',f.request);
  RAISE EXCEPTION 'expected native pool minimum failure';
 EXCEPTION WHEN SQLSTATE 'DT007' THEN NULL; END;
 ASSERT public.get_table_dealer_profile_receipt_v1(f.club,f.request)->>'status'='receipt_not_found';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id=(SELECT physical FROM feature821));
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_pool_members WHERE table_id=(SELECT physical FROM feature821));
 ASSERT NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id::text=(SELECT physical::text FROM feature821));
 ASSERT NOT EXISTS(SELECT 1 FROM private.dealer_feature_config_receipts_v1);
END $$;
SELECT 'FEATURE821_SECOND_INTERNAL_RPC_FAILURE_NO_MODE_POOL_AUDIT_RECEIPT_DELTA';
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record;r jsonb;again jsonb; BEGIN
 SELECT * INTO STRICT f FROM feature821;
 r:=public.save_table_dealer_profile_v1(f.club,f.physical,'feature',false,false,f.members,f.request);
 ASSERT r->>'status'='saved' AND r->>'request_id'=f.request::text AND r->>'club_id'=f.club::text AND r->>'table_id'=f.physical::text;
 ASSERT r#>>'{profile,table_mode}'='feature' AND r#>'{profile,members}'=f.members;
 again:=public.save_table_dealer_profile_v1(f.club,f.physical,'feature',false,false,f.members,f.request);
 ASSERT r=again;
 ASSERT public.get_table_dealer_profile_receipt_v1(f.club,f.request)=jsonb_build_object('status','receipt_found','result',r);
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'normal',false,false,f.members,f.request);
  RAISE EXCEPTION 'expected payload conflict';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='DEALER_PROFILE_REQUEST_CONFLICT'; END;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.other_table,'feature',false,false,f.members,f.request);
  RAISE EXCEPTION 'expected cross-table key conflict';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='DEALER_PROFILE_REQUEST_CONFLICT'; END;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'normal',true,true,jsonb_build_array(f.members->0),gen_random_uuid());
  RAISE EXCEPTION 'expected existing profile rollback on pool failure';
 EXCEPTION WHEN SQLSTATE 'DT007' THEN NULL; END;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'feature',false,false,f.members||f.members,gen_random_uuid());
  RAISE EXCEPTION 'expected duplicate member rejection';
 EXCEPTION WHEN invalid_parameter_value THEN ASSERT SQLERRM='DEALER_PROFILE_DUPLICATE_MEMBER'; END;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'feature',false,false,'[{"dealer_id":"00000000-0000-0000-0000-000000000001","priority":0,"is_primary":true}]',gen_random_uuid());
  RAISE EXCEPTION 'expected unknown dealer rejection';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_MEMBER_SCOPE_MISMATCH'; END;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'feature',false,false,
   jsonb_build_array(f.members->0,jsonb_build_object('dealer_id',f.foreign_dealer,'priority',1,'is_primary',false)),gen_random_uuid());
  RAISE EXCEPTION 'expected actual foreign-club dealer rejection';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_MEMBER_SCOPE_MISMATCH'; END;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'feature',false,false,'[{}]',gen_random_uuid());
  RAISE EXCEPTION 'expected malformed member rejection';
 EXCEPTION WHEN invalid_parameter_value THEN ASSERT SQLERRM='DEALER_PROFILE_INVALID_MEMBERS'; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*)=2 FROM public.dealer_table_pool_members WHERE table_id=(SELECT physical FROM feature821));
 ASSERT (SELECT count(*)=2 FROM public.audit_logs WHERE entity_id::text=(SELECT physical::text FROM feature821));
 ASSERT (SELECT count(*)=1 FROM private.dealer_feature_config_receipts_v1);
 ASSERT (SELECT table_mode='feature' AND NOT is_final AND NOT allow_override FROM public.dealer_table_profiles WHERE table_id=(SELECT physical FROM feature821));
END $$;
SELECT 'FEATURE821_ATOMIC_SAVE_REPLAY_RECEIPT_CONFLICT_VALIDATION_ONE_WRITE';
-- Same actor/key cannot silently change table or tenant. A foreign actor cannot read it.
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO STRICT f FROM feature821;
 BEGIN
  PERFORM public.save_table_dealer_profile_v1(f.club,f.physical,'normal',false,false,'[]',gen_random_uuid());
  RAISE EXCEPTION 'expected foreign actor denial';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_FORBIDDEN'; END;
 BEGIN
  PERFORM public.get_table_dealer_profile_receipt_v1(f.club,f.request);
  RAISE EXCEPTION 'expected foreign receipt denial';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_FORBIDDEN'; END;
END $$;
RESET ROLE;
SELECT 'FEATURE821_FOREIGN_ACTOR_WRITE_AND_RECEIPT_DENIED';
