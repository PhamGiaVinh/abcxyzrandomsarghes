-- LOCAL blob-provider fixture. Product storage metadata/RLS/layout writers remain real.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_port()=55441 AND inet_server_addr()='127.0.0.1'::inet;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid());
 ASSERT to_regclass('floor_private.tv258_blob_fixture') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tv_tournament_layouts WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
END $$;
CREATE TABLE floor_private.tv258_blob_fixture(
 name text PRIMARY KEY, bytes bytea NOT NULL CHECK(octet_length(bytes)<=5242880),
 mimetype text NOT NULL CHECK(mimetype IN('image/png','image/jpeg')),
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now());
COMMENT ON TABLE floor_private.tv258_blob_fixture IS 'LOCAL_TV258_BLOB_PROVIDER_MODEL_NOT_HOSTED';
REVOKE ALL ON floor_private.tv258_blob_fixture FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
