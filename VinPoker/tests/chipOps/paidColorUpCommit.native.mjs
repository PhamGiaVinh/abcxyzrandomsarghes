import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';

assert.equal(process.env.VINPOKER_NATIVE_CHIP_COMMIT,'1');
assert.ok(process.env.VINPOKER_CHIP_COMMIT_COUPLED===undefined||process.env.VINPOKER_CHIP_COMMIT_COUPLED==='1');
const coupled=process.env.VINPOKER_CHIP_COMMIT_COUPLED==='1';
assert.ok(process.env.VINPOKER_CHIP_COMMIT_CHAIN===undefined||process.env.VINPOKER_CHIP_COMMIT_CHAIN==='1');
const chain=process.env.VINPOKER_CHIP_COMMIT_CHAIN==='1';
const database='vinpoker_ops_cash115_qualified_c';
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe']}).trim();
// Fixture enforces PG17/exact datadir/loopback/no pg_net before any setup write.
const f=createPaidJourneyFixture(sql),set=randomUUID(),low=randomUUID(),high=randomUUID(),template=randomUUID(),key=randomUUID(),undoKey=randomUUID(),other=randomUUID();
const higher=randomUUID();
const auth=actor=>`SET request.jwt.claim.sub='${actor}';SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET ROLE authenticated;`;
const payload={tournament:f.tour,removed:low,target:high,added:20,level:1};
const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const read=(actor,operation,k,p)=>JSON.parse(sql(auth(actor)+`SELECT public.get_chip_color_up_receipt_v1('${f.tour}','${operation}','${k}',${quote(p)});`));
const operational=()=>sql(`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_seats r WHERE tournament_id='${f.tour}'),
 'tables',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_tables r WHERE tournament_id='${f.tour}'))::text);`);
const before=operational();
// Local setup metadata, not Setup UI proof. Only a fresh owned TEST club may
// opt in to coupled mode; restore OFF in finally even if qualification fails.
assert.equal(sql(`SELECT public.chip_ops_coupling_on('${f.club}');`),'f');
sql(`BEGIN;
INSERT INTO auth.users(id) VALUES('${other}');
INSERT INTO public.club_chip_masters(club_id,user_id) VALUES('${f.club}','${other}');
INSERT INTO public.chip_set(id,club_id,name) VALUES('${set}','${f.club}','Durable paid chip TEST');
INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('${low}','${set}','${f.club}',100),('${high}','${set}','${f.club}',1000);
INSERT INTO public.tournament_chip_set(tournament_id,chip_set_id,club_id) VALUES('${f.tour}','${set}','${f.club}');
INSERT INTO public.stack_template(id,tournament_id,club_id,chip_set_id,name,stack_value) VALUES('${template}','${f.tour}','${f.club}','${set}','Durable paid stack TEST',20000);
INSERT INTO public.stack_template_line(stack_template_id,denomination_id,count) VALUES('${template}','${low}',200);
INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) VALUES('${f.club}','${low}',1000),('${f.club}','${high}',100);
${chain?`INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('${higher}','${set}','${f.club}',10000);INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) VALUES('${f.club}','${higher}',100);`:''}
COMMIT;`);
let historicalResult;
try {
if(coupled)assert.equal(JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_set_bank_coupling('${f.club}',true);`)).status,'ok');
const issued=JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_set_issuance_v2('${template}',1,0,'${randomUUID()}','${f.actor}');`));
assert.equal(issued.status,'ok');
// Each sql() opens a NEW psql connection and this SELECT autocommits before
// returning. Retained result is oracle-only; recovery uses no writer retry.
const committed=JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_color_up('${f.tour}','${low}','${high}',20,1,'${key}');`));
historicalResult=committed;
assert.equal(committed.status,'ok');assert.equal(committed.rounding_delta,0);
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'operations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.color_up_operation r WHERE tournament_id='${f.tour}'),
 'ledger',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.chip_inventory_ledger r WHERE tournament_id='${f.tour}'),
 'bank',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.chip_bank_ledger r WHERE club_id='${f.club}'),
 'bank_counts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY denomination_id) FROM public.chip_bank r WHERE club_id='${f.club}'),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_key) FROM floor_private.chip_mutation_receipts r WHERE actor_id='${f.actor}'))::text);`);
const afterCommit=fingerprint();
const originalEntries=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.chip_inventory_ledger r WHERE tournament_id='${f.tour}';`));
const originalIds=originalEntries.map(row=>{assert.match(row.id,/^[a-f0-9-]{36}$/);return `'${row.id}'::uuid`;}).join(',');
const originalLedger=()=>JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.chip_inventory_ledger r WHERE id IN (${originalIds});`));
const originalBankEntries=coupled?JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.chip_bank_ledger r WHERE club_id='${f.club}';`)):[];
const originalBankIds=originalBankEntries.map(row=>{assert.match(row.id,/^[a-f0-9-]{36}$/);return `'${row.id}'::uuid`;}).join(',');
const recovered=read(f.actor,'color_up',key,payload);assert.equal(recovered.status,'committed');assert.deepEqual(recovered.result,committed);
assert.equal(read(f.actor,'color_up',key,{...payload,added:21}).error,'IDEMPOTENCY_CONFLICT');
assert.equal(read(f.actor,'color_up',randomUUID(),payload).status,'unknown');
assert.equal(read(f.player,'color_up',key,payload).error,'Forbidden');
const otherReceipt=read(other,'color_up',key,payload);assert.equal(otherReceipt.status,'unknown');assert.equal('result' in otherReceipt,false);
assert.equal(fingerprint(),afterCommit,'receipt recovery/denials cannot change ledger or operation');
assert.equal(sql(`SELECT count(*) FROM public.color_up_operation WHERE tournament_id='${f.tour}' AND idempotency_key='${key}';`),'1');
assert.equal(sql(`SELECT count(*) FROM public.chip_inventory_ledger WHERE tournament_id='${f.tour}';`),'2');
if(chain){
 const secondKey=randomUUID(),secondUndoKey=randomUUID();
 const second=JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_color_up('${f.tour}','${high}','${higher}',2,2,'${secondKey}');`));
 assert.equal(second.status,'ok');assert.equal(second.rounding_delta,0);
 assert.deepEqual(read(f.actor,'color_up',secondKey,{tournament:f.tour,removed:high,target:higher,added:2,level:2}).result,second);
 const beforeRejectedUndo=fingerprint();
 const rejected=JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_reverse_color_up('${committed.color_up_operation_id}','${undoKey}');`));
 assert.equal(rejected.error,'UNDO_DEPENDENCY');assert.equal(fingerprint(),beforeRejectedUndo);
 assert.equal(read(f.actor,'reverse_color_up',undoKey,{operation:committed.color_up_operation_id}).status,'unknown');
 const secondUndo=JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_reverse_color_up('${second.color_up_operation_id}','${secondUndoKey}');`));
 assert.equal(secondUndo.status,'ok');assert.equal(secondUndo.bank_reversed,coupled);
 assert.deepEqual(read(f.actor,'reverse_color_up',secondUndoKey,{operation:second.color_up_operation_id}).result,secondUndo);
}
const undone=JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_reverse_color_up('${committed.color_up_operation_id}','${undoKey}');`));
assert.equal(undone.status,'ok');assert.equal(undone.bank_reversed,coupled);
const afterUndo=fingerprint();const undoReceipt=read(f.actor,'reverse_color_up',undoKey,{operation:committed.color_up_operation_id});
assert.equal(undoReceipt.status,'committed');assert.deepEqual(undoReceipt.result,undone);assert.equal(fingerprint(),afterUndo);
assert.deepEqual(originalLedger(),originalEntries,'undo must append compensation, not rewrite original ledger');
if(coupled)assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.chip_bank_ledger r WHERE id IN (${originalBankIds});`)),originalBankEntries,'bank compensation must preserve original bank ledger rows');
assert.equal(sql(`SELECT count(*) FROM public.chip_inventory_ledger WHERE tournament_id='${f.tour}';`),chain?'8':'4');
assert.deepEqual(read(f.actor,'color_up',key,payload).result,committed,'original historical receipt remains exact after undo');
assert.equal(fingerprint(),afterUndo);
const counts=JSON.parse(sql(auth(f.actor)+`SELECT jsonb_object_agg(denomination_id,current_count) FROM public.chip_ops_current_denom_counts('${f.tour}');`));
assert.equal(counts[low],200);assert.equal(counts[high],0);
if(chain)assert.equal(counts[higher],0);
const bank=JSON.parse(sql(`SELECT jsonb_object_agg(denomination_id,on_hand_count) FROM public.chip_bank WHERE club_id='${f.club}';`));
assert.equal(bank[low],coupled?800:1000);assert.equal(bank[high],100);
if(chain)assert.equal(bank[higher],100);
assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),coupled?(chain?'9':'5'):'0');
assert.equal(operational(),before,'chip conversion/recovery/undo must preserve paid entry, cash and Floor seat');
} finally {
if(coupled)assert.equal(JSON.parse(sql(auth(f.actor)+`SELECT public.chip_ops_set_bank_coupling('${f.club}',false);`)).status,'ok');
assert.equal(sql(`SELECT public.chip_ops_coupling_on('${f.club}');`),'f');
}
assert.deepEqual(read(f.actor,'color_up',key,payload).result,historicalResult,'changing local coupling OFF must not change the historical receipt');
console.log(`PAID_COLORUP_REAL_COMMIT_FRESH_CONNECTION_RECEIPT_UNDO_${coupled?'COUPLED':'UNCOUPLED'}_${chain?'CHAIN':'SINGLE'}_AUDIT_RETAINED_PASS`);
