import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,buildAtomicMigrationQuery} from './ops-1359-release-gate.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
// This module prepares exact SQL only. It has no database or network transport.
export const MANIFEST_SHA256='99366a7165bbbb58df61c5ae5d355b289f487368ee4512e6abd3100b48bd70fb';
export function loadPackage(sourceRoot){
 const bytes=canonicalSqlText(readFileSync(resolve(root,'scripts/ops/spectator342344-manifest.json')));
 assert.equal(hash(bytes),MANIFEST_SHA256,'Reviewed manifest differs');
 const manifest=JSON.parse(bytes);
 assert.equal(manifest.projectRef,'orlesggcjamwuknxwcpk');
 assert.equal(manifest.kind,'SPECTATOR342344_EXACT_RELEASE');
 assert.deepEqual(manifest.migrations.map(x=>x.version),['20270128000342','20270128000343','20270128000344']);
 assert.equal(manifest.automaticRetry,false);
 assert.equal(hash(canonicalSqlText(readFileSync(resolve(root,'../',manifest.builder.path)))),manifest.builder.sha256,'Atomic builder drift');
 const entries=manifest.migrations.map(item=>{
  assert.equal(item.action,'APPLY');
  assert.match(item.name,/^[a-z0-9_]+$/);
  assert.equal(item.path,`supabase/migrations/${item.version}_${item.name}.sql`);
  const path=resolve(sourceRoot,item.path),stat=lstatSync(path);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Regular migration required');
  const source=canonicalSqlText(readFileSync(path));
  assert.equal(hash(source),item.sha256,'Migration drift');
  const atomic=buildAtomicMigrationQuery(item,source);
  assert.equal(hash(atomic),item.atomicSha256,'Atomic wrapper drift');
  return {...item,source,atomic};
 });
 assert.equal(manifest.edgeFiles.length,7,'Exact Edge closure required');
 for(const file of manifest.edgeFiles){
  assert.ok(!file.path.includes('..')&&!file.path.startsWith('/'),'Edge path escaped');
  const path=resolve(sourceRoot,file.path),stat=lstatSync(path);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Regular Edge source required');
  assert.equal(hash(canonicalSqlText(readFileSync(path))),file.sha256,'Edge closure drift');
 }
 return {manifest,entries};
}

export function preflightSql(){
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'database',current_database(),'actor',current_user,
 'pending',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20270128000342','20270128000343','20270128000344') OR name IN ('nonblocking_spectator_source_generation','spectator_pending_source_outcome','spectator_bounded_source_batch')),
 'floor345',(SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20270128000345' AND name='floor_operator_fast_bust_v1'),
 'marker',COALESCE((SELECT md5(replace(prosrc,chr(13),''))='76e70967db6247ba01fc6d1e9f8355e9' FROM pg_proc WHERE oid=to_regprocedure('spectator_projection_v2.mark_dirty(uuid,text,text,text)')),false),
 'source',COALESCE(md5(replace(pg_get_functiondef(to_regprocedure('public.get_public_spectator_projection_source_v2(uuid,text,uuid)')),chr(13),''))='0557076e4866159dc1095c5257ceb7c6',false),
 'targetsAbsent',to_regclass('spectator_projection_v2.source_nonblocking_original_v1') IS NULL AND to_regclass('spectator_projection_v2.source_pending_original_v1') IS NULL AND to_regprocedure('public.get_public_spectator_projection_sources_v2(jsonb)') IS NULL,
 'dispatcher',(SELECT count(*)=1 AND bool_and(jobid=52 AND active AND schedule='1 second') FROM cron.job WHERE jobname='public-spectator-v2-dispatch'))::text;COMMIT;`;
}
export function classifyPreflight(row){
 assert.ok(row?.database==='postgres'&&row.actor==='postgres'&&row.pending===0&&row.floor345===true&&row.marker===true&&row.source===true&&row.targetsAbsent===true&&row.dispatcher===true,'Source, ledger or dispatcher drift; stop');
}
