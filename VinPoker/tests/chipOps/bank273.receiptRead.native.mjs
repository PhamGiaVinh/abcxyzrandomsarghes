import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseChipBankAdjustmentReceipt,chipBankAdjustmentArgs} from '../../src/lib/chipBankAdjustmentReceipt.ts';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql(`SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();`),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
const f=JSON.parse(sql('SELECT fixture FROM floor_private.bank272_fixture;'));
assert.equal(f.club,'e2720000-0000-4000-8000-000000000010');
for(const [key,count,version,outcome] of [['bank272-same',12,0,'applied'],['bank272-cas-first',1,1,'applied'],['bank272-cas-second',2,1,'rejected']]){
 const intent={actorId:f.actor,clubId:f.club,tournamentId:f.tour,denominationId:f.denom,direction:'thu',count,oldVersion:version,requestId:key};
 const args=chipBankAdjustmentArgs(intent);assert.equal(args.p_expected_actor,f.actor);
 const actual=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT public.get_chip_bank_adjust_receipt_v2('${f.club}','${f.denom}','thu',${count},'${f.tour}',${version},'${key}','${f.actor}');ROLLBACK;`));
 assert.equal(parseChipBankAdjustmentReceipt(actual,intent).outcome,outcome);
 console.log(`BANK273_REAL_PG_RECEIPT_PRODUCT_PARSER_${key}_${outcome}_PASS`);
}
