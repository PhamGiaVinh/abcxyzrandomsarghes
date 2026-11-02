-- Loaded inside a full rollback by the existing821 native runner.
CREATE TEMP TABLE feature824 AS SELECT id physical,'d4427834-5f5f-48ef-bde5-e2dc388ed00b'::uuid club,
 'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'::uuid actor,
 gen_random_uuid() cancel_key,gen_random_uuid() save_key
 FROM public.game_tables WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND table_number=98;
GRANT SELECT ON feature824 TO authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=1 FROM feature824);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id=(SELECT physical FROM feature824));
 ASSERT NOT has_function_privilege('authenticated','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.get_table_dealer_profile_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record;r jsonb;again jsonb;bad_pool jsonb:='[{"dealer_id":"00000000-0000-0000-0000-000000000001","is_primary":true,"priority":0}]'; BEGIN
 SELECT * INTO STRICT f FROM feature824;
 BEGIN
  PERFORM public.save_table_dealer_profile_v2(f.club,f.physical,'normal',false,false,'[]',f.save_key,'675fe35e-60a8-4452-bb90-e79486d54da6');
  RAISE EXCEPTION 'expected actor mismatch';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_ACTOR_CHANGED'; END;
 BEGIN
  PERFORM public.cancel_table_dealer_profile_v2(f.club,f.physical,'normal',false,false,'[]',f.save_key,'675fe35e-60a8-4452-bb90-e79486d54da6');
  RAISE EXCEPTION 'expected cancel actor mismatch';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_ACTOR_CHANGED'; END;
 BEGIN
  PERFORM public.get_table_dealer_profile_receipt_v2(f.club,f.save_key,'675fe35e-60a8-4452-bb90-e79486d54da6');
  RAISE EXCEPTION 'expected receipt actor mismatch';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_ACTOR_CHANGED'; END;
 ASSERT public.get_table_dealer_profile_receipt_v2(f.club,f.save_key,f.actor)=jsonb_build_object('status','receipt_not_found','actor_id',f.actor);
 -- A rejected/stale pool is cancellable without applying it.
 r:=public.cancel_table_dealer_profile_v2(f.club,f.physical,'feature',false,false,bad_pool,f.cancel_key,f.actor);
 ASSERT r->>'status'='cancelled' AND r->>'actor_id'=f.actor::text AND r->>'request_id'=f.cancel_key::text;
 again:=public.cancel_table_dealer_profile_v2(f.club,f.physical,'feature',false,false,bad_pool,f.cancel_key,f.actor);
 ASSERT r=again;
 -- Delayed save sees tombstone BEFORE checking the now-invalid member pool.
 ASSERT public.save_table_dealer_profile_v2(f.club,f.physical,'feature',false,false,bad_pool,f.cancel_key,f.actor)=r;
 ASSERT public.get_table_dealer_profile_receipt_v2(f.club,f.cancel_key,f.actor)=jsonb_build_object('status','receipt_found','actor_id',f.actor,'result',r);
 BEGIN
  PERFORM public.save_table_dealer_profile_v2(f.club,f.physical,'normal',false,false,'[]',f.cancel_key,f.actor);
  RAISE EXCEPTION 'expected cancelled payload conflict';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='DEALER_PROFILE_REQUEST_CONFLICT'; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id=(SELECT physical FROM feature824));
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_pool_members WHERE table_id=(SELECT physical FROM feature824));
 ASSERT (SELECT count(*)=1 FROM public.audit_logs WHERE entity_id::text=(SELECT physical::text FROM feature824) AND action='cancel_table_dealer_profile');
 ASSERT NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id::text=(SELECT physical::text FROM feature824) AND action IN('set_table_dealer_mode','set_table_dealer_pool'));
END $$;
SELECT 'FEATURE824_ACTOR_WRITE_READ_CANCEL_FENCES_CANCEL_REPLAY_LATE_SAVE_NO_PROFILE_DELTA_PASS';
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record;r jsonb;already jsonb; BEGIN
 SELECT * INTO STRICT f FROM feature824;
 r:=public.save_table_dealer_profile_v2(f.club,f.physical,'normal',false,false,'[]',f.save_key,f.actor);
 ASSERT r->>'status'='saved' AND r->>'actor_id'=f.actor::text;
 already:=public.cancel_table_dealer_profile_v2(f.club,f.physical,'normal',false,false,'[]',f.save_key,f.actor);
 ASSERT already=r,'cancel after saved must not undo or claim cancelled';
 -- Read original823 immutable receipt through v2; actor annotation is projected only.
 ASSERT public.get_table_dealer_profile_receipt_v2(f.club,'8278a778-6950-4281-9988-7331c5274a72',f.actor)#>>'{result,status}'='saved';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*)=2 FROM private.dealer_feature_config_receipts_v1 WHERE table_id=(SELECT physical FROM feature824));
 ASSERT (SELECT count(*)=2 FROM public.audit_logs WHERE entity_id::text=(SELECT physical::text FROM feature824) AND action IN('set_table_dealer_mode','set_table_dealer_pool'));
 ASSERT NOT EXISTS(SELECT 1 FROM private.dealer_feature_config_receipts_v1 WHERE result?'actor_id');
END $$;
SELECT 'FEATURE824_SAVED_WINS_OVER_CANCEL_ORIGINAL_RECEIPTS_NOT_REWRITTEN_PASS';
