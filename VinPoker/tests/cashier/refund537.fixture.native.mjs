import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const output=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
 'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{
 input:readFileSync('tests/cashier/refund537.fixture.rollback.sql','utf8'),encoding:'utf8',timeout:30000});
const rows=output.trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows.length,3);
assert.deepEqual(rows[0],rows[2]);assert.equal(rows[1].success,true);assert.equal(rows[1].refunded_backers,2);assert.equal(rows[1].ledger_failures,0);
console.log('REFUND537_ISOLATED_SAME_CLUB_NATIVE_AUTHORITY_FIXTURE_FULL_ROLLBACK_NO_PERSISTENT_GRANT_PASS');
