$ErrorActionPreference = 'Stop'
$candidate = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../supabase/migrations/20270128000271_legacy_bag_active_hand_guard_v1.sql') -Raw
$candidate = $candidate -replace '(?m)^BEGIN;\r?$', '' -replace '(?m)^COMMIT;\r?$', ''
$negative = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag632.active-hand.rollback.sql') -Raw
if (($negative.Split(@('-- CANDIDATE271'), [System.StringSplitOptions]::None)).Count -ne 2) { throw 'negative anchor drift' }
$negative = $negative.Replace('-- CANDIDATE271',$candidate + "`nSET LOCAL test.bag633_guard='on';")
$positive = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag626.positive.rollback.sql') -Raw
if (($positive.Split(@('BEGIN;'), [System.StringSplitOptions]::None)).Count -ne 2) { throw 'positive transaction anchor drift' }
$positive = $positive.Replace('BEGIN;',"BEGIN;`n"+$candidate)
$post = @'
DO $$ BEGIN
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean)'::regprocedure),chr(13),''))='e9902eafee8dd7e62d297a941424b90a';
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_close_day(uuid,integer,integer,boolean,text)'::regprocedure),chr(13),''))='25c71d3ae0de17f2521627e5fe62d45b';
END $$;
SELECT 'BAG633_CANDIDATE_ACTIVE_HAND_DENIAL_POSITIVE_CYCLE_EXACT_DEFINITION_ROLLBACK_PASS';
'@
($negative + "`n" + $positive + "`n" + $post) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'bag633 candidate failed; inspect before retry' }
