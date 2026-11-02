$ErrorActionPreference = 'Stop'
$test = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag627.receipt.rollback.sql') -Raw
$absent = "ASSERT to_regprocedure('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)') IS NULL;"
$installed = "ASSERT md5(replace(pg_get_functiondef('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)'::regprocedure),chr(13),''))='22bf8a1b1ee90c116d6ad2908e85cf09';"
if (($test.Split(@($absent), [System.StringSplitOptions]::None)).Count -ne 3) { throw 'two qualification guards drifted' }
if (($test.Split(@('-- CANDIDATE270'), [System.StringSplitOptions]::None)).Count -ne 2) { throw 'candidate anchor drifted' }
$test.Replace($absent,$installed).Replace('-- CANDIDATE270','-- Qualify the already-installed exact local270, not another candidate.').Replace('BAG627_DURABLE_INTENT_NATIVE_ROLLBACK_PASS','BAG629_INSTALLED_DURABLE_INTENT_NATIVE_ROLLBACK_PASS') | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'installed qualification failed' }
