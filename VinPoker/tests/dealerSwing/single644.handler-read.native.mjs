import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createPaidInitialAssignmentHandler} from './paidTourInitialAssign.native.mjs';
assert.equal(process.env.VINPOKER_SINGLE644_HANDLER_READ,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const probe=readFileSync(new URL('./single638.stale-attendance.rollback.sql',import.meta.url),'utf8');
const facts=probe.slice(probe.indexOf('CREATE FUNCTION pg_temp.single638_facts('),probe.indexOf('SELECT pg_temp.single638_facts() AS before'));
const fingerprint=()=>sql(facts+'SELECT pg_temp.single638_facts();');
const before=fingerprint(),actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',outsider='a11b1317-4885-4835-8d2e-fb435f7b24e2';
const native=createPaidInitialAssignmentHandler(sql,{actor});
const intent={expected_actor_id:actor,expected_club_id:'d4427834-5f5f-48ef-bde5-e2dc388ed00b',table_id:'991b1e8e-da4c-461a-9b39-ddebd7a5d044',table_session_id:'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',force_dealer_id:'e6420000-0000-4000-8000-000000000001',idempotency_key:'e6440000-0000-4000-8000-000000000001'};
try{
 const read=await native.invoke({mode:'receipt',assignment_intent:intent});
 assert.equal(read.status,200);assert.equal((await read.json()).status,'receipt_not_found');
 native.setActor(outsider);
 const denied=await native.invoke({mode:'receipt',assignment_intent:{...intent,expected_actor_id:outsider}});
 assert.equal(denied.status,403);assert.equal(native.writes,0);
}finally{native.cleanup();assert.equal(fingerprint(),before,'read/authorization changed operational facts');}
console.log('SINGLE644_ACTUAL_HANDLER_NATIVE_RECEIPT_AND_OUTSIDER_DENIAL_ZERO_WRITES_FOURTEEN_FACTS_PASS');
