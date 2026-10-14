import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_next80_ci');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const fixture=readFileSync('tests/dealerSwing/massOpenSessions.pg17.sql','utf8'),marker='-- Canonical close with an announced replacement';
assert.equal(fixture.split(marker).length,2);
const suffix=readFileSync('tests/dealerSwing/operatorNextIntent.pg17.sql','utf8');
const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1'],{input:fixture.split(marker)[0]+suffix,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);console.log('NEXT80_ACTOR_REST_RECEIPT_CURRENT_SCHEMA_PASS');
