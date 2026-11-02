BEGIN;
SET LOCAL statement_timeout='15s';
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$
DECLARE a uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';b uuid:='62ead6ed-2bef-45ca-92ee-ed963baa1018';
 g uuid:=gen_random_uuid();token_a text:=gen_random_uuid()::text;v uuid;n integer;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_invite_required';END IF;
 INSERT INTO public.chat_groups(id,name,created_by,is_public) VALUES(g,'LOCAL rollback legacy invite',a,false);
 INSERT INTO public.chat_group_invites(group_id,token,created_by,max_uses) VALUES(g,token_a,a,2);
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
 PERFORM set_config('role','authenticated',true);
 v:=public.accept_group_invite(token_a);v:=public.accept_group_invite(token_a);
 PERFORM set_config('role','postgres',true);
 SELECT uses INTO n FROM public.chat_group_invites WHERE token=token_a;
 IF n<>1 THEN RAISE EXCEPTION 'legacy_duplicate_accept_consumed_more_than_one_use: %',n;END IF;
END $$;
CREATE FUNCTION pg_temp.fail_group_invite_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF current_setting('vinpoker.test_invite_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL_INVITE_RECEIPT_FAULT';END IF;RETURN NEW;
END $$;
-- Qualified candidate required below; first block is the actual pre-fix regression.
CREATE TRIGGER local_invite_receipt_fault BEFORE INSERT ON public.chat_group_invite_accept_receipts_v2
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_group_invite_receipt();
DO $$
DECLARE a uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';b uuid:='62ead6ed-2bef-45ca-92ee-ed963baa1018';c uuid:=gen_random_uuid();
 g uuid:=gen_random_uuid();token_a text:=gen_random_uuid()::text;token_b text:=gen_random_uuid()::text;token_c text:=gen_random_uuid()::text;
 r uuid:=gen_random_uuid();r2 uuid:=gen_random_uuid();answer jsonb;denied boolean;n integer;
BEGIN
 PERFORM set_config('role','postgres',true);
 INSERT INTO public.chat_groups(id,name,created_by,is_public) VALUES(g,'LOCAL rollback v2 invite',a,false);
 INSERT INTO public.chat_group_invites(group_id,token,created_by,max_uses) VALUES(g,token_a,a,1),(g,token_b,a,1),(g,token_c,a,2);
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.accept_group_invite_v2(token_a,r);
 IF answer->>'outcome'<>'joined' OR answer->>'group_id'<>g::text THEN RAISE EXCEPTION 'v2_join_failed';END IF;
 answer:=public.accept_group_invite_v2(token_a,r);
 IF answer->>'outcome'<>'replayed' THEN RAISE EXCEPTION 'v2_replay_failed';END IF;
 answer:=public.accept_group_invite_v2(token_a,gen_random_uuid());
 IF answer->>'outcome'<>'already_member' THEN RAISE EXCEPTION 'existing_member_consumes_exhausted_invite';END IF;
 denied:=false;BEGIN PERFORM public.accept_group_invite_v2(token_b,r);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_invite_request_conflict' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'request_key_payload_conflict_allowed';END IF;
 DELETE FROM public.chat_group_members WHERE group_id=g AND user_id=b;
 answer:=public.accept_group_invite_v2(token_a,r);
 IF answer->>'outcome'<>'no_longer_member' OR answer->'ok'<>'false'::jsonb THEN RAISE EXCEPTION 'old_receipt_rejoined_left_member';END IF;
 answer:=public.accept_group_invite_v2(token_b,r2);
 IF answer->>'outcome'<>'joined' THEN RAISE EXCEPTION 'explicit_new_invite_rejoin_failed';END IF;
 answer:=public.accept_group_invite_v2(token_a,r);
 IF answer->>'outcome'<>'no_longer_member' THEN RAISE EXCEPTION 'old_membership_generation_adopted';END IF;
 PERFORM set_config('role','postgres',true);
 IF (SELECT uses FROM public.chat_group_invites WHERE token=token_a)<>1 OR (SELECT uses FROM public.chat_group_invites WHERE token=token_b)<>1
 THEN RAISE EXCEPTION 'replay_modified_counter';END IF;
 UPDATE public.chat_group_invites SET revoked_at=clock_timestamp() WHERE token=token_a;
 PERFORM set_config('request.jwt.claim.sub',c::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',c)::text,true);
 PERFORM set_config('role','authenticated',true);
 denied:=false;BEGIN PERFORM public.accept_group_invite_v2(token_a,gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_invite_revoked' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'revoked_invite_granted';END IF;
 denied:=false;BEGIN PERFORM public.accept_group_invite_v2(token_b,gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_invite_exhausted' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'exhausted_invite_granted';END IF;
 PERFORM set_config('vinpoker.test_invite_fault','on',true);
 denied:=false;BEGIN PERFORM public.accept_group_invite_v2(token_c,gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LOCAL_INVITE_RECEIPT_FAULT' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'receipt_fault_not_exercised';END IF;
 PERFORM set_config('role','postgres',true);
 IF EXISTS(SELECT 1 FROM public.chat_group_members WHERE group_id=g AND user_id=c)
 OR (SELECT uses FROM public.chat_group_invites WHERE token=token_c)<>0
 THEN RAISE EXCEPTION 'partial_membership_counter_after_receipt_fault';END IF;
 PERFORM set_config('vinpoker.test_invite_fault','off',true);
 UPDATE public.chat_group_invites SET expires_at=clock_timestamp()-interval '1 second' WHERE token=token_c;
 PERFORM set_config('role','authenticated',true);
 denied:=false;BEGIN PERFORM public.accept_group_invite_v2(token_c,gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_invite_expired' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'expired_invite_granted';END IF;
 -- Same request UUID from another actor cannot read/adopt B's receipt.
 denied:=false;BEGIN PERFORM public.accept_group_invite_v2(token_a,r);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_invite_revoked' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'other_actor_adopted_prior_receipt';END IF;
 PERFORM set_config('role','anon',true);
 denied:=false;BEGIN PERFORM public.accept_group_invite_v2(token_b,r2);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'anonymous_invite_writer_allowed';END IF;
 PERFORM set_config('role','postgres',true);
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',a)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.soft_delete_chat_group_v1(g);
 IF answer->'ok'<>'true'::jsonb THEN RAISE EXCEPTION 'owner_delete_fixture_failed';END IF;
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
 answer:=public.accept_group_invite_v2(token_b,r2);
 IF answer->'ok'<>'false'::jsonb OR answer->>'outcome'<>'no_longer_member' THEN RAISE EXCEPTION 'deleted_group_receipt_resurrected_access';END IF;
 PERFORM set_config('role','postgres',true);
 IF (SELECT uses FROM public.chat_group_invites WHERE token=token_c)<>0
 OR EXISTS(SELECT 1 FROM public.chat_group_members WHERE group_id=g AND user_id=c)
 THEN RAISE EXCEPTION 'negative_cases_changed_counter_or_membership';END IF;
 IF has_table_privilege('authenticated','public.chat_group_invite_accept_receipts_v2','SELECT')
 OR has_function_privilege('anon','public.accept_group_invite_v2(text,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public._accept_group_invite_v2(text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'invite_private_boundary_exposed';END IF;
 RAISE NOTICE 'GROUP_INVITE_NATIVE_COUNTER_RECEIPT_GENERATION_TENANT_FAULT_ROLLBACK_PASS';
END $$;
ROLLBACK;
