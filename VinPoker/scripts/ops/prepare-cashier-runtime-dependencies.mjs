import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

// Exact missing private dependencies, not a migration replay or permissive stub.
const output = process.argv[2];
assert.ok(output && isAbsolute(output), 'absolute disposable output required');
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
statements.push('SET check_function_bodies = true;');
writeFileSync(output, statements.join('\n') + '\n', { mode: 0o600 });
console.log('EXACT_CASHIER_PRIVATE_RUNTIME_DEPENDENCIES_PREPARED');
