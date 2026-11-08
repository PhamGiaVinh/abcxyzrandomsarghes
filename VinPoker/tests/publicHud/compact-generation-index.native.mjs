import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const read=file=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const body=source=>source.replace('BEGIN;','').replace(/COMMIT;\s*$/,'');
const migration=body(read('supabase/migrations/20261105203358_spectator_compact_generation_lookup.sql'));
const reverse=body(read('tests/publicHud/compact-generation-index.rollback.sql'));
const index='spectator_projection_v2.idx_compact_generation_lookup_v1',hash='ab83ab3c2b71e3586fa6bc40e5b08514';
const original=jsonSql(`SELECT jsonb_build_object('present',to_regclass('${index}') IS NOT NULL,'hash',md5(pg_get_indexdef(to_regclass('${index}'))));`);
if(original.present)assert.equal(original.hash,hash,'Do not replace an unrelated or drifted index');
// Seed pipelines may already have applied the candidate. Remove only its exact
// known index inside the rolled-back probe; the caller's index/OID survives.
const baseline=original.present?`DROP INDEX ${index};`:'';
const metadata=`SELECT jsonb_build_object('tableOid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
 'writer',md5(replace(pg_get_functiondef('spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure),chr(13),'')),
 'writerMetadata',(SELECT jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef) FROM pg_proc p WHERE p.oid='spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure),
 'anonSelect',has_table_privilege('anon',c.oid,'SELECT'),'authenticatedSelect',has_table_privilege('authenticated',c.oid,'SELECT'))
 FROM pg_class c WHERE c.oid='spectator_projection_v2.entity_markers'::regclass`;
const before=jsonSql(metadata);
const plan=jsonSql(`BEGIN;${baseline}${migration}SET LOCAL plan_cache_mode=force_generic_plan;
 PREPARE compact_generation_probe(uuid,text) AS SELECT source_txid=pg_current_xact_id()
 FROM spectator_projection_v2.entity_markers WHERE tournament_id=$1 AND component=$2 AND entity_key='generation';
 EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE compact_generation_probe('10000000-0000-4000-8000-000000000001','tables');ROLLBACK;`)[0];
assert.equal(plan.Plan['Index Name'],'idx_compact_generation_lookup_v1');
assert.equal(plan.Plan['Actual Loops'],1);
const parity=jsonSql(`BEGIN;${baseline}CREATE TEMP TABLE generation_expected AS
 SELECT tournament_id,component,source_revision,source_txid FROM spectator_projection_v2.entity_markers WHERE entity_key='generation';
 ${migration} SELECT jsonb_build_object('metadataUnchanged',(${metadata})='${JSON.stringify(before)}'::jsonb,
 'rowsUnchanged',NOT EXISTS((SELECT * FROM generation_expected EXCEPT SELECT tournament_id,component,source_revision,source_txid FROM spectator_projection_v2.entity_markers WHERE entity_key='generation')
 UNION ALL (SELECT tournament_id,component,source_revision,source_txid FROM spectator_projection_v2.entity_markers WHERE entity_key='generation' EXCEPT SELECT * FROM generation_expected)),
 'valid',(SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid='${index}'::regclass),'hash',md5(pg_get_indexdef('${index}'::regclass)));ROLLBACK;`);
assert.deepEqual(parity,{metadataUnchanged:true,rowsUnchanged:true,valid:true,hash});
assert.throws(()=>sql(`BEGIN;${baseline}${migration}${migration}ROLLBACK;`),/catalog differs/);
assert.throws(()=>sql(`BEGIN;${baseline}${reverse}ROLLBACK;`),/reverse catalog differs/);
assert.throws(()=>sql(`BEGIN;${baseline}CREATE INDEX idx_compact_generation_lookup_v1 ON spectator_projection_v2.entity_markers(component);${reverse}ROLLBACK;`),/reverse catalog differs/);
assert.equal(sql(`BEGIN;${baseline}${migration}${reverse}SELECT to_regclass('${index}') IS NULL;ROLLBACK;`),'t');
assert.deepEqual(jsonSql(metadata),before);
assert.deepEqual(jsonSql(`SELECT jsonb_build_object('present',to_regclass('${index}') IS NOT NULL,'hash',md5(pg_get_indexdef(to_regclass('${index}'))));`),original);
const cardinality=jsonSql("SELECT jsonb_build_object('historicalMarkers',count(*),'compactMarkers',count(*) FILTER(WHERE entity_key='generation')) FROM spectator_projection_v2.entity_markers;");
const report={kind:'NATIVE_COMPACT_GENERATION_LOOKUP_INDEX_NOT_WRITER_QUALIFICATION',...cardinality,checks:['actual-generic-lookup-uses-partial-index','source-generations-unchanged','writer-OID-definition-and-table-owner-ACL-RLS-preserved','duplicate-apply-denied','reverse-absence-and-definition-drift-denied','exact-reverse-and-transactional-original-index-preservation'],plan:{node:plan.Plan['Node Type'],index:plan.Plan['Index Name'],executionMs:plan['Execution Time'],sharedHits:plan.Plan['Shared Hit Blocks']},productionChanged:false,qualification:false};
if(process.env.PUBLIC_HUD_GENERATION_INDEX_REPORT)writeFileSync(process.env.PUBLIC_HUD_GENERATION_INDEX_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
