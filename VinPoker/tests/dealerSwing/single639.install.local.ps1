# Prepared only; qualify committed-close/automatic acquisition before executing.
$ErrorActionPreference='Stop'
$sourcePath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000272_dealer_acquisition_operating_day_v1.sql'
if((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne '22AAB1AE3881ED8AC7BA2F5A00893BC9E646C0C22959B7A610D5727ECC3F6E32'){throw 'source272 drift'}
$candidate=(Get-Content -LiteralPath $sourcePath -Raw) -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$test=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'single638.stale-attendance.rollback.sql') -Raw
$anchor='SELECT pg_temp.single638_facts() AS before \gset'
$at=$test.IndexOf($anchor)
if($at -lt 0){throw 'snapshot anchor drift'}
$snapshot=$test.Substring(0,$at+$anchor.Length)
$prefix=@'
BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.dealer_operating_day_backup272') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000272');
END $$;
CREATE TABLE floor_private.dealer_operating_day_backup272 AS
 SELECT 'floor_private.guard_dealer_assignment_acquisition()'::text signature,
 replace(pg_get_functiondef(p.oid),chr(13),'') definition,p.proacl::text acl,
 md5(replace(pg_get_functiondef(p.oid),chr(13),'')) before_digest,
 '59d94669c91e5a686543c1f7ece4ef2c'::text after_digest
 FROM pg_proc p WHERE p.oid='floor_private.guard_dealer_assignment_acquisition()'::regprocedure;
ALTER TABLE floor_private.dealer_operating_day_backup272 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.dealer_operating_day_backup272 FROM PUBLIC,anon,authenticated,service_role;
'@
$post=@'
DO $$ DECLARE b record; BEGIN
 SELECT * INTO STRICT b FROM floor_private.dealer_operating_day_backup272;
 ASSERT b.before_digest='b4fd007d3f601a72e21717096939497b';
 ASSERT md5(replace(pg_get_functiondef(to_regprocedure(b.signature)),chr(13),''))=b.after_digest;
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(b.signature)) IS NOT DISTINCT FROM b.acl;
 ASSERT NOT has_table_privilege('anon','floor_private.dealer_operating_day_backup272','SELECT');
 ASSERT NOT has_table_privilege('authenticated','floor_private.dealer_operating_day_backup272','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.dealer_operating_day_backup272','SELECT');
END $$;
SAVEPOINT recovery_rehearsal;
'@
$recovery=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'single639.recover.local.sql') -Raw) -replace '(?m)^\s*\set ON_ERROR_STOP on\r?$','' -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$verify=@'
ROLLBACK TO recovery_rehearsal;
DO $$ DECLARE b record; BEGIN
 SELECT * INTO STRICT b FROM floor_private.dealer_operating_day_backup272;
 ASSERT md5(replace(pg_get_functiondef(to_regprocedure(b.signature)),chr(13),''))=b.after_digest;
END $$;
SELECT pg_temp.single638_facts()=:'before' AS unchanged \gset
\if :unchanged
\else
DO $$ BEGIN RAISE EXCEPTION 'single639_install_operational_delta'; END $$;
\endif
COMMIT;
SELECT 'SINGLE639_LOCAL272_INSTALL_RECOVERY_REHEARSAL_FOURTEEN_FACTS_UNCHANGED_PASS';
'@
($snapshot+"`n"+$prefix+"`n"+$candidate+"`n"+$post+"`n"+$recovery+"`n"+$verify) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'local272 install failed; inspect before retry'}
