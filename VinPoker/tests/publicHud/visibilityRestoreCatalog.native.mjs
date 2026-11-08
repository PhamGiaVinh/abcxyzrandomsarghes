import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialize,sql,jsonSql} from './nativeDb.mjs';

if(process.argv.includes('--initialize'))initialize();
const migration=readFileSync('supabase/migrations/20261106010000_public_hud_visibility_restore_reclassification.sql','utf8');
const reverse=readFileSync('scripts/ops/tracker-hud-visibility-restore-reverse.sql','utf8');
const reverseBody=reverse.replace('BEGIN;','').replace(/COMMIT;\s*$/,'');
const catalog=()=>jsonSql(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
 'oid',p.oid,'owner',p.proowner,'acl',p.proacl,'securityDefiner',p.prosecdef,'config',p.proconfig,
 'body',md5(replace(pg_get_functiondef(p.oid),chr(13),''))) ORDER BY p.oid)
 FROM pg_proc p WHERE p.oid=ANY(ARRAY['tracker_analytics_v1.visibility_changed()'::regprocedure,
 'public.process_public_hud_metadata_v1(text,uuid,bigint,uuid)'::regprocedure,
 'public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure]);`);
const identity=rows=>rows.map(({body,...rest})=>rest);
const before=catalog();
assert.equal(before.length,3);
sql(migration);
const after=catalog();assert.deepEqual(identity(after),identity(before));
assert.ok(after.every((row,i)=>row.body!==before[i].body));
assert.equal(sql("SELECT count(*) FROM pg_index i WHERE i.indexrelid='tracker_analytics_v1.hand_contributions_hidden_policy_idx'::regclass AND i.indisvalid AND i.indisready;"),'1');
assert.equal(sql("SELECT count(*) FROM pg_attribute WHERE attrelid='tracker_analytics_v1.jobs'::regclass AND attname='refresh_hidden_only' AND attnotnull AND NOT attisdropped;"),'1');
assert.throws(()=>sql(migration,{captureFailure:true}),/Command failed/,'A duplicate apply must fail closed');
assert.deepEqual(catalog(),after);
assert.throws(()=>sql(`BEGIN;ALTER TABLE tracker_analytics_v1.jobs ALTER COLUMN refresh_hidden_only SET DEFAULT true;
 ${reverseBody}ROLLBACK;`,{captureFailure:true}),/Command failed/,'Reverse must reject changed column metadata');
assert.throws(()=>sql(`BEGIN;DROP INDEX tracker_analytics_v1.hand_contributions_hidden_policy_idx;
 CREATE INDEX hand_contributions_hidden_policy_idx ON tracker_analytics_v1.hand_contributions(hand_id);
 ${reverseBody}ROLLBACK;`,{captureFailure:true}),/Command failed/,'Reverse must reject changed index definition');
assert.deepEqual(catalog(),after);
sql('UPDATE tracker_analytics_v1.config SET enabled=true;');
assert.throws(()=>sql(reverse,{captureFailure:true}),/Command failed/,'Reverse must reject active prepared reads');
assert.deepEqual(catalog(),after);
sql('UPDATE tracker_analytics_v1.config SET enabled=false,worker_enabled=true;');
assert.throws(()=>sql(reverse,{captureFailure:true}),/Command failed/,'Reverse must reject active worker');
sql('UPDATE tracker_analytics_v1.config SET enabled=false,worker_enabled=false;');
sql("SELECT tracker_analytics_v1.enqueue('visibility','10000000-0000-4000-8000-000000000001');");
assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'),'1');
assert.throws(()=>sql(reverse,{captureFailure:true}),/Command failed/,'Reverse must reject pending source work');
// Only the synthetic visibility job created immediately above is retired.
sql("DELETE FROM tracker_analytics_v1.jobs WHERE kind='visibility' AND entity_id='10000000-0000-4000-8000-000000000001';");
sql(reverse);
assert.deepEqual(catalog(),before);
assert.equal(sql("SELECT to_regclass('tracker_analytics_v1.hand_contributions_hidden_policy_idx') IS NULL;"),'t');
assert.equal(sql("SELECT count(*) FROM pg_attribute WHERE attrelid='tracker_analytics_v1.jobs'::regclass AND attname='refresh_hidden_only' AND NOT attisdropped;"),'0');
sql(migration);assert.deepEqual(catalog(),after);
console.log(JSON.stringify({kind:'NATIVE_VISIBILITY_RESTORE_CATALOG_AND_GUARDED_REVERSE',passed:true,
 checks:['OID-owner-ACL-securityDefiner-searchPath-preserved','duplicate-apply-rejected','reverse-rejects-column-index-drift','reverse-rejects-active-reads-worker-pending-job','exact-preimages-restored','column-index-removed','forward-after-reverse'],
 limitations:'Isolated tiny schema;not a production apply,complete22-migration integration,backfill or load qualification'}));
