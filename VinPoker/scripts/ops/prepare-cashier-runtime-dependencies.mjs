import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

// Exact missing private dependencies, not a migration replay or permissive stub.
const output = process.argv[2];
assert.ok(output && isAbsolute(output), 'absolute disposable output required');
const restoreClockPre32 = process.argv[3] === '--restore-clock-pre32';
assert.ok(process.argv.length === 3 || (process.argv.length === 4 && restoreClockPre32), 'unsupported dependency mode');
const sources = [
  readFileSync(new URL('../../supabase/pending-migrations/20260924165219_centerpoint_tournament_ops_release_v1.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../supabase/pending-migrations/20260924065041_tv_layout_editor_v1.sql', import.meta.url), 'utf8'),
].map(text => text.replaceAll('\r\n', '\n'));
const contracts = [
  ['tournament_ops_release_allowed_v1', '0160d75ddd9d249efeea34d803a49517', 'uuid', 'service_role', 'p_club_id uuid', 'boolean', 'sql'],
  ['assert_tournament_ops_release_v1', 'd7c06019f0d68d56025f9879d1a43c73', 'uuid', 'service_role', 'p_club_id uuid', 'void', 'plpgsql'],
  ['tv_branding_storage_insert_allowed_v1', 'f35405660d81a073a754deb1fb2e837d', 'text,text', 'authenticated', 'p_bucket_id text, p_name text', 'boolean', 'sql'],
];
const statements = ['CREATE SCHEMA IF NOT EXISTS centerpoint_private;', 'REVOKE ALL ON SCHEMA centerpoint_private FROM PUBLIC, anon, authenticated;', 'GRANT USAGE ON SCHEMA centerpoint_private TO service_role, authenticated;', 'SET check_function_bodies = false;'];
for (const [name, hash, args, role, parameters, returns, language] of contracts) {
  const matches = sources.flatMap(source => [...source.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION centerpoint_private\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'g'))]);
  assert.equal(matches.length, 1, `exact source definition required: ${name}`);
  assert.equal(createHash('md5').update(matches[0][1]).digest('hex'), hash, `reviewed live body mismatch: ${name}`);
  const header = matches[0][0].split('AS $$')[0].replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  assert.equal(header, `CREATE OR REPLACE FUNCTION centerpoint_private.${name}(${parameters}) RETURNS ${returns} LANGUAGE ${language} STABLE SECURITY DEFINER SET search_path = ''`, `reviewed signature/security metadata mismatch: ${name}`);
  statements.push(matches[0][0], `ALTER FUNCTION centerpoint_private.${name}(${args}) OWNER TO postgres;`, `REVOKE ALL ON FUNCTION centerpoint_private.${name}(${args}) FROM PUBLIC, anon, authenticated, service_role;`, `GRANT EXECUTE ON FUNCTION centerpoint_private.${name}(${args}) TO ${role};`);
}
// The captured public-only schema also omits the two private readers required
// by the existing public clock contract. Reconstruct their exact reviewed
// source bodies, without replaying seat-display triggers or writers.
const participationSource = readFileSync(new URL('../../supabase/migrations/20270128000031_tournament_participation_current_scope_v1.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const displaySource = readFileSync(new URL('../../supabase/migrations/20270128000032_tournament_seat_display_preservation_v1.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const participation = participationSource.match(/CREATE OR REPLACE FUNCTION floor_private\.tournament_participation_v1\(p_tournament_id uuid\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/);
const display = displaySource.match(/CREATE FUNCTION floor_private\.tournament_entry_display_v1\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/);
assert.ok(participation && display, 'exact private clock dependency sources required');
const md5 = value => createHash('md5').update(value).digest('hex');
assert.equal(md5(participation[1]), '995b184cdb355082b73af4a75521c7ae');
assert.equal(md5(display[1]), '1fa4fcae06f56774b40913b83a6b239a');
for (const [definition, expectedHeader] of [
  [participation[0], "CREATE OR REPLACE FUNCTION floor_private.tournament_participation_v1(p_tournament_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''"],
  [display[0], "CREATE FUNCTION floor_private.tournament_entry_display_v1(p_entry_id uuid,p_player_id uuid,p_tournament_id uuid,p_entry_no integer) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''"],
]) {
  const header = definition.split('AS $$')[0].replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  assert.equal(header, expectedHeader, 'exact clock dependency signature/security metadata');
}
const clockPatch = displaySource.slice(displaySource.indexOf("('floor_private.tournament_participation_v1(uuid)',"));
const replacements = [...clockPatch.slice(0, clockPatch.indexOf("('public.get_tracker_roster_snapshot_v1")).matchAll(/\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$/g)];
assert.equal(replacements.length, 2, 'exact two display-reader replacements');
let clockBody = participation[1];
for (const [, before, after] of replacements) {
  assert.equal(clockBody.split(before).length, 2, 'unique clock dependency replacement');
  clockBody = clockBody.replace(before, after);
}
assert.equal(md5(clockBody), 'b9624adaa8d7bb35713917486c40fe67');
statements.push('CREATE SCHEMA IF NOT EXISTS floor_private;',
  "DO $$ BEGIN IF to_regprocedure('floor_private.tournament_participation_v1(uuid)') IS NOT NULL OR to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)') IS NOT NULL THEN RAISE EXCEPTION 'isolated_clock_dependency_collision'; END IF; END $$;",
  display[0], participation[0].replace(participation[1], clockBody));
for (const signature of ['tournament_entry_display_v1(uuid,uuid,uuid,integer)', 'tournament_participation_v1(uuid)']) {
  statements.push(`ALTER FUNCTION floor_private.${signature} OWNER TO postgres;`, `REVOKE ALL ON FUNCTION floor_private.${signature} FROM PUBLIC, anon, authenticated, service_role;`);
}
statements.push('SET check_function_bodies = true;');
if (restoreClockPre32) {
  // The startup fixture restores only two private readers from31/32. Before
  // replaying complete32, reverse that exact fixture-only partial restoration.
  // No public writer/source rows, grants or original migration guard change.
  const restore = ["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';",
    `DO $$ DECLARE e record;p pg_proc%ROWTYPE;BEGIN
      FOR e IN SELECT * FROM (VALUES
       ('floor_private.tournament_participation_v1(uuid)','b9624adaa8d7bb35713917486c40fe67'),
       ('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)','1fa4fcae06f56774b40913b83a6b239a')
      ) v(signature,digest) LOOP
       SELECT * INTO STRICT p FROM pg_proc WHERE oid=e.signature::regprocedure;
       IF md5(replace(p.prosrc,chr(13),''))<>e.digest OR p.proowner<>'postgres'::regrole
        OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
        OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR has_function_privilege('service_role',p.oid,'EXECUTE')
       THEN RAISE EXCEPTION 'isolated_partial_clock_restoration_drift: %',e.signature;END IF;
      END LOOP;
      IF to_regprocedure('floor_private.preserve_tournament_seat_display_v1()') IS NOT NULL
       OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_seats'::regclass AND tgname='trg_tournament_seat_display_preserve_v1')
      THEN RAISE EXCEPTION 'isolated_complete_display_migration_already_present';END IF;
     END $$;`,
    participation[0],
    'DROP FUNCTION floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer) RESTRICT;',
    `DO $$ BEGIN IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure),chr(13),''))<>'995b184cdb355082b73af4a75521c7ae'
      THEN RAISE EXCEPTION 'isolated_pre32_participation_restore_failed';END IF;END $$;`,
    'COMMIT;'];
  writeFileSync(output, restore.join('\n') + '\n', { mode: 0o600 });
  console.log('EXACT_PARTIAL_CLOCK_FIXTURE_REVERSAL_PREPARED');
} else {
writeFileSync(output, statements.join('\n') + '\n', { mode: 0o600 });
console.log('EXACT_CASHIER_PRIVATE_RUNTIME_DEPENDENCIES_PREPARED');
}
