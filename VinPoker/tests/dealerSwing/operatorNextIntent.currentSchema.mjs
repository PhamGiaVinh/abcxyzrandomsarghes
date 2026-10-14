import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_next80_ci');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const fixture=readFileSync('tests/dealerSwing/massOpenSessions.pg17.sql','utf8'),marker='-- Canonical close with an announced replacement';
assert.equal(fixture.split(marker).length,2);
const suffix=readFileSync('tests/dealerSwing/operatorNextIntent.pg17.sql','utf8');
const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1'],{input:fixture.split(marker)[0]+suffix,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);console.log('NEXT80_ACTOR_REST_RECEIPT_CURRENT_SCHEMA_PASS');
const catalog=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:`SELECT json_agg(row_to_json(f) ORDER BY signature) FROM (
 SELECT p.oid::regprocedure::text AS signature,md5(pg_get_functiondef(p.oid)) AS definition_md5,
 pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,p.proconfig AS config,p.proacl::text AS acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('operator_plan_next_dealer_v1','get_dealer_next_intent_receipt_v1')) f;`,encoding:'utf8'});
assert.equal(catalog.status,0,catalog.stderr);const objects=JSON.parse(catalog.stdout.trim());
assert.equal(objects.length,2);
for(const object of objects){assert.equal(object.owner,'postgres');assert.equal(object.security_definer,true);
 assert.deepEqual(object.config,['search_path=""']);assert.equal(object.acl,'{postgres=X/postgres,authenticated=X/postgres}');}
console.log('NEXT80_QUALIFIED_OBJECT_FINGERPRINTS='+JSON.stringify(objects));
