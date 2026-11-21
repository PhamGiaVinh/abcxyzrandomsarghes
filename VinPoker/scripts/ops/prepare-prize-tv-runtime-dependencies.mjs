import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const output = process.argv[2];
assert.ok(output && isAbsolute(output));
const read = file => readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const scope = read('20270128000031_tournament_participation_current_scope_v1.sql');
const tv = read('20270128000220_tournament_tv_pool_shared_projection_v1.sql');
const event = read('20270128000210_main_event_shared_create_config_v1.sql');
const guarantee = event.match(/ALTER TABLE public\.tournament_events ADD COLUMN guarantee_amount numeric;[^]*?COMMENT ON COLUMN public\.tournament_events\.guarantee_amount IS\s*'(?:''|[^'])*';/);
const counts = scope.match(/CREATE OR REPLACE FUNCTION public\.get_tournament_participation_counts_v1\([^]*?AS \$\$([^]*?)\$\$;/);
const pool = tv.match(/CREATE FUNCTION floor_private\.tournament_tv_pool_v1\([^]*?\$\$;/);
const patch = tv.match(/DO \$\$\nDECLARE target regprocedure:='public\.get_tournament_participation_counts_v1\(uuid\)'::regprocedure;[^]*?END \$\$;/);
assert.ok(counts && pool && patch && guarantee);
assert.equal(createHash('md5').update(counts[1]).digest('hex'), '2075e3e28f93fdb7c4396d38264aecc4');

writeFileSync(output, `BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres'
 OR current_setting('vinpoker.isolated_tv_dependency',true) IS DISTINCT FROM 'cashier-current-prize-tv'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR to_regprocedure('public.get_tournament_participation_counts_v1(uuid)') IS NOT NULL
 OR to_regprocedure('floor_private.tournament_tv_pool_v1(uuid)') IS NOT NULL
 OR to_regprocedure('public.get_tv_tournament_branding_v1(uuid)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.tournament_events'::regclass AND attname='guarantee_amount' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'isolated_tv_dependency_context_or_collision'; END IF;
END $$;
${guarantee[0]}
${counts[0]}
REVOKE ALL ON FUNCTION public.get_tournament_participation_counts_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_participation_counts_v1(uuid) TO authenticated;
${pool[0]}
REVOKE ALL ON FUNCTION floor_private.tournament_tv_pool_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
${patch[0]}
NOTIFY pgrst,'reload schema';
COMMIT;
`, { flag: 'wx' });
