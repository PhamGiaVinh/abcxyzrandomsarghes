// Exact existing card APIs for the owned HTTP fixture only. No connection/apply.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
const output=process.argv[2];
assert.equal(process.argv.length,3);
assert.ok(output&&isAbsolute(output)&&output.endsWith('/manual-cards-dependencies.sql'));
const source=readFileSync(new URL('../../supabase/migrations/20270128000075_tracker_manual_cards_receipts_v1.sql',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
assert.equal(createHash('sha256').update(source).digest('hex'),'4f52194e0c0721552519660abb844e3ccb5e6dba307f45203de08a2a6b6f9a4a');
const start=source.indexOf('CREATE TABLE floor_private.tracker_manual_card_receipts_v1 (');
assert.ok(start>0);
const payload=source.slice(start,source.lastIndexOf('COMMIT;'));
assert.equal((payload.match(/CREATE FUNCTION /g)||[]).length,4);
assert.ok(!/CREATE OR REPLACE|schema_migrations/.test(payload));
// Reuse the original exact function/table postchecks, without replaying the
// historical migration guard or ledger. Pin current direct dependencies instead.
const sql=`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('vinpoker.isolated_manual_cards',true) IS DISTINCT FROM 'current-http-showdown-only'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
 THEN RAISE EXCEPTION 'manual_cards_owned_fixture_required';END IF;
 IF to_regclass('floor_private.tracker_manual_card_receipts_v1') IS NOT NULL
 OR to_regprocedure('floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)') IS NOT NULL
 OR to_regprocedure('public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)') IS NOT NULL
 OR to_regprocedure('floor_private.tracker_manual_card_receipt_v1(text,jsonb)') IS NOT NULL
 OR to_regprocedure('public.get_tracker_manual_card_receipt_v1(text,jsonb)') IS NOT NULL
 OR to_regprocedure('floor_private.tracker_manual_card_receipt_v1(text)') IS NOT NULL
 OR to_regprocedure('public.get_tracker_manual_card_receipt_v1(text)') IS NOT NULL
 THEN RAISE EXCEPTION 'manual_cards_fixture_catalog_collision';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.is_club_tracker(uuid,uuid)')
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='754a878cd17019d6cb0b27aad6a10e84'
  AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='s')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)')
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='53374e21fe6d323affa8a074402f4b85'
  AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='v'
  AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres,authenticated=X/postgres}')
 THEN RAISE EXCEPTION 'manual_cards_fixture_dependency_drift';END IF;
END $$;
${payload}
NOTIFY pgrst,'reload schema';COMMIT;
`;
writeFileSync(output,sql,{flag:'wx'});
console.log(JSON.stringify({kind:'OWNED_CURRENT_MANUAL_CARD_DEPENDENCIES_NOT_RUNTIME_PROOF',functions:4,emptyPrivateReceiptTables:1,productionChanged:false}));
