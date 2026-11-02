$ErrorActionPreference = 'Stop'
$candidate = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../supabase/migrations/20270128000270_bag_tag_durable_intent_v1.sql') -Raw
# Only the migration's top-level transaction is removed; test owns BEGIN/ROLLBACK.
$candidate = $candidate -replace '(?m)^BEGIN;\r?$', '' -replace '(?m)^COMMIT;\r?$', ''
$test = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag627.receipt.rollback.sql') -Raw
if (($test.Split(@('-- CANDIDATE270'), [System.StringSplitOptions]::None)).Count -ne 2) { throw 'candidate anchor drift' }
$test.Replace('-- CANDIDATE270', $candidate) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'bag627 native candidate failed; transaction rolled back on disconnect' }
