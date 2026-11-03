-- Forward replacement for197: its old pin describes a sanitized credential literal.
-- This candidate pins the exact actual predecessor without copying its literal.
-- Execute INSTEAD OF197; retain historical source, never create a synthetic197 receipt.
-- Worker activation remains separate; preserve outbox records on recovery.
-- CLI candidate20261019235954 -> catalog-reserved forward197; LOCAL qualification only.
-- No HTTP or scheduler activation. Recovery: suspend the worker, preserve jobs,
-- and restore only a reviewed trigger function; never restore embedded credentials.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000197')
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261103040730')
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.fn_dispatch_push()'::regprocedure) IS DISTINCT FROM 'postgres'
 OR to_regclass('private.notification_push_outbox_v1') IS NOT NULL
 OR to_regprocedure('public.claim_notification_push_v1(uuid)') IS NOT NULL
 OR to_regprocedure('public.finish_notification_push_v1(uuid,uuid,text,uuid)') IS NOT NULL
 OR to_regprocedure('private.notification_push_payload_v1(public.notifications)') IS NOT NULL
 OR md5(replace(pg_get_functiondef('public.fn_dispatch_push()'::regprocedure),chr(13),''))<>'3d6655a64b964932cf267890d64ebb40'
 THEN RAISE EXCEPTION 'notification_push197_catalog_drift_or_collision';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.notifications'::regclass
  AND tgfoid='public.fn_dispatch_push()'::regprocedure AND tgenabled='O' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'notification_push197_trigger_dependency';END IF;
END $$;

CREATE TABLE private.notification_push_outbox_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 notification_id uuid NOT NULL UNIQUE REFERENCES public.notifications(id) ON DELETE CASCADE,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','provider_accepted','not_created','needs_attention')),
 lease_token uuid,lease_expires_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),provider_id uuid,error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
 CHECK(state<>'processing' OR lease_token IS NOT NULL AND lease_expires_at IS NOT NULL),
 CHECK(state<>'provider_accepted' OR provider_id IS NOT NULL)
);
ALTER TABLE private.notification_push_outbox_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.notification_push_outbox_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX notification_push_claim_v1 ON private.notification_push_outbox_v1(created_at,id)
 WHERE state IN('pending','processing');

CREATE FUNCTION private.notification_push_payload_v1(n public.notifications) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('user_id',n.user_id::text,'heading',n.title,'message',n.body,'url',
  CASE n.type::text WHEN 'schedule_updated' THEN '/tournaments'
   WHEN 'registration_confirmed' THEN '/tournaments'
   WHEN 'chat_message' THEN '/chat/groups/'||coalesce(n.data->>'group_id','')
   ELSE coalesce(n.data->>'url','/') END);
$$;
REVOKE ALL ON FUNCTION private.notification_push_payload_v1(public.notifications) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_dispatch_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.notification_push_outbox_v1(notification_id,payload)
 VALUES(NEW.id,private.notification_push_payload_v1(NEW)) ON CONFLICT(notification_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_dispatch_push() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_notification_push_v1(p_notification_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job private.notification_push_outbox_v1%ROWTYPE;source_payload jsonb;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO job FROM private.notification_push_outbox_v1
 WHERE (p_notification_id IS NULL OR notification_id=p_notification_id)
 AND (state='pending' OR state='processing' AND lease_expires_at<clock_timestamp())
 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'job',NULL);END IF;
 -- Never retry past the provider's 30-day idempotency window; leave for review.
 IF job.created_at<clock_timestamp()-interval '29 days' THEN
  UPDATE private.notification_push_outbox_v1 SET state='needs_attention',error_code='idempotency_window_expired',finished_at=clock_timestamp() WHERE id=job.id;
  RETURN jsonb_build_object('ok',true,'job',NULL,'attention','idempotency_window_expired');
 END IF;
 SELECT private.notification_push_payload_v1(n) INTO source_payload FROM public.notifications n WHERE n.id=job.notification_id;
 IF source_payload IS DISTINCT FROM job.payload THEN
  UPDATE private.notification_push_outbox_v1 SET state='needs_attention',error_code='notification_changed',finished_at=clock_timestamp() WHERE id=job.id;
  RETURN jsonb_build_object('ok',true,'job',NULL,'attention','notification_changed');
 END IF;
 UPDATE private.notification_push_outbox_v1 SET state='processing',lease_token=gen_random_uuid(),
  lease_expires_at=clock_timestamp()+interval '2 minutes',attempts=attempts+1
 WHERE id=job.id RETURNING * INTO job;
 RETURN jsonb_build_object('ok',true,'job',to_jsonb(job));
END $$;

CREATE FUNCTION public.finish_notification_push_v1(p_id uuid,p_token uuid,p_outcome text,p_provider_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job private.notification_push_outbox_v1%ROWTYPE;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 IF p_outcome NOT IN('provider_accepted','not_created','needs_attention') OR p_outcome IS NULL
 OR (p_outcome='provider_accepted') IS DISTINCT FROM (p_provider_id IS NOT NULL)
 THEN RAISE EXCEPTION 'invalid_push_outcome';END IF;
 SELECT * INTO job FROM private.notification_push_outbox_v1 WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.lease_token IS DISTINCT FROM p_token OR p_token IS NULL THEN RETURN false;END IF;
 IF job.state IN('provider_accepted','not_created','needs_attention') THEN
  RETURN job.state=p_outcome AND job.provider_id IS NOT DISTINCT FROM p_provider_id;
 END IF;
 IF job.state<>'processing' OR job.lease_expires_at<clock_timestamp() THEN RETURN false;END IF;
 UPDATE private.notification_push_outbox_v1 SET state=p_outcome,provider_id=p_provider_id,
  error_code=CASE WHEN p_outcome='needs_attention' THEN 'delivery_unverified' ELSE NULL END,finished_at=clock_timestamp()
 WHERE id=job.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_notification_push_v1(uuid),public.finish_notification_push_v1(uuid,uuid,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_push_v1(uuid),public.finish_notification_push_v1(uuid,uuid,text,uuid) TO service_role;
COMMIT;
