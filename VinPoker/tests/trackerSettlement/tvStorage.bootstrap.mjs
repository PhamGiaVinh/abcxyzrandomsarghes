// Restore the original TV Storage consumer after its base gate in the owned
// schema-only fixture. Never accept an unknown helper/policy definition.
import './tvReleaseGate.bootstrap.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const database='vinpoker_ops_cash115_qualified_c';
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe']}).trim();
const signature='centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)';
const metadata=()=>JSON.parse(sql(`SELECT jsonb_build_object('body',replace(p.prosrc,chr(13),''),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl) FROM pg_proc p WHERE p.oid='${signature}'::regprocedure;`));
const source=readFileSync('supabase/pending-migrations/20260924065041_tv_layout_editor_v1.sql','utf8').replaceAll('\r','');
const start=source.indexOf('CREATE OR REPLACE FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(');
const end=source.indexOf('DROP POLICY IF EXISTS "TV branding v1 release gate on insert"');
assert.ok(start>=0&&end>start);const fragment=source.slice(start,end);
const expected=/AS \$\$([\s\S]*?)\$\$;/.exec(fragment)?.[1].trim();assert.ok(expected);
const before=metadata();assert.equal(before.owner,'postgres');
if(before.body.trim()!==expected){
 assert.deepEqual(before,{body:'SELECT false',owner:'postgres',definer:false,volatility:'s',config:null,acl:null},'unknown_storage_gate_fixture_drift');
 sql('BEGIN;'+fragment+'COMMIT;');
}
const actual=metadata();assert.equal(actual.body.trim(),expected);assert.equal(actual.definer,true);assert.equal(actual.owner,'postgres');assert.equal(actual.volatility,'s');
assert.deepEqual(actual.config,['search_path=""']);assert.deepEqual(actual.acl.sort(),['authenticated=X/postgres','postgres=X/postgres']);
assert.equal(sql("SELECT has_schema_privilege('authenticated','centerpoint_private','USAGE') AND NOT has_schema_privilege('anon','centerpoint_private','USAGE');"),'t');
assert.equal(sql("SELECT md5(replace(pg_get_functiondef('private.is_tv_branding_asset_immutable_v1(text,text)'::regprocedure),chr(13),''));"),'475c6827d7557a871c0ce035f53cc727');
assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass;"),'t');
assert.equal(sql(`SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND permissive='RESTRICTIVE' AND roles=ARRAY['authenticated']::name[] AND
 ((policyname='TV branding v1 release gate on insert' AND cmd='INSERT' AND with_check='centerpoint_private.tv_branding_storage_insert_allowed_v1(bucket_id, name)')
 OR (policyname='TV branding v3 assets immutable on delete' AND cmd='DELETE' AND qual='(NOT private.is_tv_branding_asset_immutable_v1(bucket_id, name))')
 OR (policyname='TV branding v3 assets immutable on update' AND cmd='UPDATE' AND qual='(NOT private.is_tv_branding_asset_immutable_v1(bucket_id, name))' AND with_check=qual));`),'3');
console.log('LOCAL_TV_ORIGINAL_STORAGE_CONSUMER_QUALIFIED_PASS');
