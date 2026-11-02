BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT to_regclass('private.notification_push_outbox_v1') IS NOT NULL,'push_outbox_not_installed';
END $$;
DO $$ DECLARE notice uuid:=gen_random_uuid();other_notice uuid:=gen_random_uuid();deleted_notice uuid:=gen_random_uuid();aged_notice uuid:=gen_random_uuid();
 first jsonb;second jsonb;job uuid;token uuid;new_token uuid;provider uuid:=gen_random_uuid();r boolean;
BEGIN
 INSERT INTO public.notifications(id,user_id,type,title,body,data) VALUES
 (notice,'675fe35e-60a8-4452-bb90-e79486d54da6','registration_confirmed','LOCAL push TEST','LOCAL queue only','{"url":"/tournaments"}'),
 (other_notice,'675fe35e-60a8-4452-bb90-e79486d54da6','registration_confirmed','LOCAL second TEST','LOCAL queue only','{}');
 ASSERT (SELECT count(*)=1 FROM private.notification_push_outbox_v1 WHERE notification_id=notice);
 ASSERT (SELECT payload->>'url'='/tournaments' AND state='pending' FROM private.notification_push_outbox_v1 WHERE notification_id=notice);
 ASSERT NOT has_table_privilege('authenticated','private.notification_push_outbox_v1','SELECT');
 ASSERT NOT has_table_privilege('service_role','private.notification_push_outbox_v1','UPDATE');
 ASSERT NOT has_function_privilege('anon','public.claim_notification_push_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.finish_notification_push_v1(uuid,uuid,text,uuid)','EXECUTE');
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='private.notification_push_outbox_v1'::regclass);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 PERFORM set_config('role','service_role',true);
 BEGIN
  PERFORM public.claim_notification_push_v1(notice);RAISE EXCEPTION 'spoofed_service_claim_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 first:=public.claim_notification_push_v1(notice);
 ASSERT first->>'ok'='true' AND first->'job'->>'state'='processing',first::text;
 job:=(first->'job'->>'id')::uuid;token:=(first->'job'->>'lease_token')::uuid;
 ASSERT public.claim_notification_push_v1(notice)->'job'='null'::jsonb,'live lease reclaimed';
 PERFORM set_config('role','none',true);
 UPDATE private.notification_push_outbox_v1 SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=job;
 PERFORM set_config('role','service_role',true);
 second:=public.claim_notification_push_v1(notice);new_token:=(second->'job'->>'lease_token')::uuid;
 ASSERT (second->'job'->>'id')::uuid=job,'provider idempotency identity changed';
 ASSERT new_token<>token,'lease token was reused';
 ASSERT NOT public.finish_notification_push_v1(job,token,'provider_accepted',provider),'stale worker finished';
 ASSERT public.finish_notification_push_v1(job,new_token,'provider_accepted',provider),'current finish failed';
 ASSERT public.finish_notification_push_v1(job,new_token,'provider_accepted',provider),'finish receipt replay failed';
 ASSERT NOT public.finish_notification_push_v1(job,new_token,'not_created',NULL),'changed terminal outcome accepted';
 BEGIN
  PERFORM public.finish_notification_push_v1(job,new_token,'provider_accepted',NULL);
  RAISE EXCEPTION 'missing_provider_ack_accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='invalid_push_outcome',SQLERRM;END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT state='provider_accepted' AND attempts=2 AND provider_id=provider FROM private.notification_push_outbox_v1 WHERE id=job);
 UPDATE public.notifications SET body='Changed TEST notification' WHERE id=other_notice;
 PERFORM set_config('role','service_role',true);
 second:=public.claim_notification_push_v1(other_notice);
 ASSERT second->>'attention'='notification_changed' AND second->'job'='null'::jsonb,second::text;
 PERFORM set_config('role','none',true);
 INSERT INTO public.notifications(id,user_id,type,title,body,data) VALUES
 (deleted_notice,'675fe35e-60a8-4452-bb90-e79486d54da6','registration_confirmed','LOCAL deletion TEST','LOCAL queue only','{}');
 ASSERT EXISTS(SELECT 1 FROM private.notification_push_outbox_v1 WHERE notification_id=deleted_notice);
 DELETE FROM public.notifications WHERE id=deleted_notice;
 ASSERT NOT EXISTS(SELECT 1 FROM private.notification_push_outbox_v1 WHERE notification_id=deleted_notice),'deleted notification remains queued';
 INSERT INTO public.notifications(id,user_id,type,title,body,data) VALUES
 (aged_notice,'675fe35e-60a8-4452-bb90-e79486d54da6','registration_confirmed','LOCAL aged TEST','LOCAL queue only','{}');
 UPDATE private.notification_push_outbox_v1 SET created_at=clock_timestamp()-interval '30 days' WHERE notification_id=aged_notice;
 PERFORM set_config('role','service_role',true);
 second:=public.claim_notification_push_v1(aged_notice);
 ASSERT second->>'attention'='idempotency_window_expired' AND second->'job'='null'::jsonb,second::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT attempts=0 AND state='needs_attention' FROM private.notification_push_outbox_v1 WHERE notification_id=aged_notice);
 RAISE NOTICE 'PUSH_OUTBOX_RLS_AUTH_LEASE_RECLAIM_STALE_FINISH_REPLAY_IMMUTABLE_PAYLOAD_DELETE_PASS';
END $$;
ROLLBACK;
SELECT 'PUSH_OUTBOX_NATIVE_ROLLBACK_PASS';
