import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Qualify candidate DDL and every business case entirely inside ROLLBACK.
// No production URL/CLI/link/history writes and no mutation fixture reset.
assert.equal(process.env.VINPOKER_PAYOUT701_LOCAL,'1');
const run=(input,scenario)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env',
 'PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
 'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1',...(scenario?['-v',`scenario=${scenario}`]:[])],
 {input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
const removeTransaction=(source,end)=>{
 assert.equal([...source.matchAll(/^BEGIN;\r?$/gm)].length,1);
 const closing=new RegExp(`^${end};\\r?$`,'gm');assert.equal([...source.matchAll(closing)].length,1);
 return source.replace(/^BEGIN;\r?$/gm,'').replace(closing,'');
};
const candidate=removeTransaction(readFileSync('supabase/migrations/20270128000277_payout_manual_edit_intent_v1.sql','utf8'),'COMMIT');
const intent=removeTransaction(readFileSync('tests/cashier/payout701.manual-intent.rollback.sql','utf8'),'ROLLBACK');
const security=removeTransaction(readFileSync('tests/cashier/payout701.manual-security.rollback.sql','utf8'),'ROLLBACK');
const identity=`DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';END $$;`;
for(const scenario of ['replay','conflict','stale']){
 const output=run(`BEGIN;${identity}\n${candidate}\n${intent}\nROLLBACK;`,scenario);
 assert.ok(output.includes('PAYOUT701_MANUAL_REPLAY_CONFLICT_STALE_SCENARIO_ROLLBACK_PASS'));
 console.log(`PAYOUT701_${scenario.toUpperCase()}_CANDIDATE_DDL_AND_BUSINESS_ROLLBACK_PASS`);
}
const authority=run(`BEGIN;${identity}\n${candidate}\n${security}\nROLLBACK;`);
assert.ok(authority.includes('PAYOUT701_OWNER_CASHIER_OUTSIDER_PRIVATE_ACL_CANCEL_LATE_SAVE_PAID_GUARD_ALL_ROLLBACK_PASS'));
console.log('PAYOUT701_AUTHORITY_CANCEL_PAID_DEPENDENCY_RECEIPT_FAULT_ALL_ROLLBACK_PASS');
assert.equal(run(`BEGIN READ ONLY;${identity} SELECT to_regprocedure('public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid)') IS NULL
 AND to_regclass('floor_private.payout_manual_edit_receipts_v1') IS NULL
 AND md5(replace(pg_get_functiondef('public.save_tournament_prizes_v2(uuid,jsonb,text)'::regprocedure),chr(13),''))='d00da78c8b4e3fd1e6f3431bac98ef5c';ROLLBACK;`),'t');
for(const file of ['single699.applied-payout.readonly.sql','payout700.recovery.readonly.sql'])console.log(run(readFileSync(`tests/cashier/${file}`,'utf8')));
console.log('PAYOUT701_NO_DURABLE_SCHEMA_LEDGER_ROLE_OR_BUSINESS_DELTA_PASS');
