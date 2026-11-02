import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_DEALER989_LOCAL,'1');
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:8e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['game_tables','dealers','dealer_assignments','dealer_attendance','table_sessions','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const result={kind:'NATIVE_READONLY_DATA_BACKED_ADAPTER_PARSER_TEST_NOT_BROWSER_OR_SDK_E2E',guard,before:fingerprint()};
try{
 const prefix=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const tableSet=`(SELECT id FROM public.game_tables WHERE club_id='${club}' ORDER BY table_name LIMIT 200)`;
 const dealerSet=`(SELECT id FROM public.dealers WHERE club_id='${club}' AND deleted_at IS NULL ORDER BY full_name LIMIT 500)`;
 result.snapshot=read(`${prefix}SELECT jsonb_build_object('inventory',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_club_table_inventory('${club}') x),'rows',jsonb_build_object(
 'game_tables',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY table_name),'[]') FROM(SELECT id,table_name,table_type,status FROM public.game_tables WHERE id IN${tableSet})x),
 'dealers',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY full_name),'[]') FROM(SELECT id,full_name,tier FROM public.dealers WHERE id IN${dealerSet})x),
 'dealer_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY assigned_at DESC),'[]') FROM(SELECT id,table_id,table_session_id,dealer_id,swing_due_at,status,needs_replacement,assigned_at FROM public.dealer_assignments WHERE club_id='${club}' AND status='assigned' AND table_id IN${tableSet})x),
 'dealer_attendance',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY check_in_time DESC),'[]') FROM(SELECT dealer_id,current_state,check_in_time FROM public.dealer_attendance WHERE status='checked_in' AND dealer_id IN${dealerSet})x)));`);
 assert.ok(result.snapshot.inventory.length>0);
 const encoded=gzipSync(Buffer.from(JSON.stringify(result.snapshot))).toString('base64');
 result.tests=execFileSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/ops/dealer-control/dealerControlReadAdapter.test.ts','src/ops/dealer-control/OpsDealerControlWorkspace.test.tsx','--maxWorkers=1','--no-file-parallelism'],{env:{...process.env,VINPOKER_DEALER_INVENTORY_GZIP:encoded},encoding:'utf8',timeout:60000,maxBuffer:3e6});
 writeFileSync('D:/Quy trình/output/reports/dealer989-native-backed-tests-local-20261027.txt',result.tests);
 console.log(result.tests.slice(-700));
}finally{
 result.after=fingerprint();result.unchanged=result.before===result.after;writeFileSync('D:/Quy trình/output/reports/dealer989-native-snapshot-local-20261027.json',JSON.stringify(result,null,2)+'\n');assert.equal(result.unchanged,true);
}
console.log('DEALER989_NATIVE_READONLY_SNAPSHOT_AND_PARSER_TESTS_UNCHANGED_PASS');
