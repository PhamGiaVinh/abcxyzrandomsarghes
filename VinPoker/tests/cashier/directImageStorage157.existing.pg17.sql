-- Storage metadata/RLS only, not an object-byte upload/HTTP/privacy proof.
BEGIN;
SET LOCAL statement_timeout='10s';
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='chat-uploads'),'fixture bucket must be absent before rollback-only test';
 ASSERT EXISTS(SELECT 1 FROM auth.users WHERE id='675fe35e-60a8-4452-bb90-e79486d54da6');
END $$;
INSERT INTO storage.buckets(id,name,public) VALUES('chat-uploads','chat-uploads',true);
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE object_id uuid;
BEGIN
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('chat-uploads','dm/TEST_CHAT/675fe35e-60a8-4452-bb90-e79486d54da6/TEST157.png');
  RAISE EXCEPTION 'old_dm_prefix_was_unexpectedly_allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO storage.objects(bucket_id,name) VALUES('chat-uploads','675fe35e-60a8-4452-bb90-e79486d54da6/dm/TEST_CHAT/TEST157.png') RETURNING id INTO object_id;
 ASSERT object_id IS NOT NULL,'new actor-first prefix rejected';
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('chat-uploads','5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103/dm/TEST_CHAT/TEST157.png');
  RAISE EXCEPTION 'another_actor_prefix_was_unexpectedly_allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Characterize the legacy privacy gap with synthetic metadata, not real bytes.
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-uploads'
  AND name='675fe35e-60a8-4452-bb90-e79486d54da6/dm/TEST_CHAT/TEST157.png')=1,
  'legacy public-read baseline changed; review migration plan';
END $$;
ROLLBACK;
\echo DIRECT_IMAGE157_ACTUAL_STORAGE_POLICY_OLD_DENIED_OWNER_PREFIX_ALLOWED_CROSS_ACTOR_DENIED_ROLLBACK_PASS
\echo LEGACY_CHAT_PUBLIC_METADATA_EXPOSURE_CONFIRMED_NOT_PRIVATE_BYTE_UAT
