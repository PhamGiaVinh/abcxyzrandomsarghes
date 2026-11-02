$ErrorActionPreference = 'Stop'
$negative = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag632.active-hand.rollback.sql') -Raw
$positive = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag626.positive.rollback.sql') -Raw
$post = @'
DO $$ DECLARE v record;BEGIN
 ASSERT (SELECT count(*) FROM floor_private.bag_active_hand_backup271)=2;
 FOR v IN SELECT * FROM floor_private.bag_active_hand_backup271 LOOP
  ASSERT md5(replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),''))=v.after_digest;
 END LOOP;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000271');
END $$;
SELECT 'BAG634_INSTALLED_ACTIVE_HAND_DENIAL_AND_POSITIVE_CYCLE_ROLLBACK_PASS';
'@
("SET test.bag633_guard='on';`n"+$negative+"`n"+$positive+"`n"+$post) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'installed271 qualification failed' }
