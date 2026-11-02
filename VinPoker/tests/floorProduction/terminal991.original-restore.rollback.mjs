import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

assert.equal(process.env.VINPOKER_TERMINAL991_LOCAL,'1');
// Diagnostic runner: currently BLOCKED before restore dispatch because the
// application actor cannot SELECT table_sessions. Do not grant access to run it.
const folder='D:/Quy trình/output/reports/';
const targets=[
 {tour:'c367013a-3ed3-48af-ad48-3915acadc50e',actor:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',entries:9,busted:8,paid:900000},
 {tour:'4cd3af4d-7e1d-4042-855f-04fb6777e580',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',entries:15,busted:14,paid:2500000},
];
const tables=['tournaments','tournament_entries','tournament_seats','tournament_tables','table_sessions','tournament_registrations','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes'];
const fingerprint=`md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text)`;
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:60000,maxBuffer:5e6});
const result={kind:'ORIGINAL_TERMINAL_NATIVE_RESTORE_DENIAL_NOT_BROWSER_OR_FULL_JOURNEY',protectedTables:tables,targets:[]};
for(const target of targets){
 const q=`BEGIN;
 SET LOCAL statement_timeout='10s';
 DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT (SELECT status FROM public.tournaments WHERE id='${target.tour}')='completed';
 END $$;
 SELECT jsonb_build_object('phase','before','hash',${fingerprint},'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${target.tour}'),'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${target.tour}' AND is_active),'paid',(SELECT sum(prize_amount) FROM public.tournament_prize_payments WHERE tournament_id='${target.tour}'));
 SET LOCAL request.jwt.claim.sub='${target.actor}';
 SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"sub":"${target.actor}","role":"authenticated"}';
 SET LOCAL ROLE authenticated;
 WITH destination AS MATERIALIZED (
 SELECT tt.id,s.id AS session,s.revision,s.control_epoch FROM public.tournament_tables tt
 JOIN public.table_sessions s ON s.id=tt.table_session_id WHERE tt.tournament_id='${target.tour}' ORDER BY tt.table_number,tt.id LIMIT 1
 ), candidates AS MATERIALIZED (
 SELECT e.id AS entry_id,d.*,gen_random_uuid() AS request_id FROM public.tournament_entries e CROSS JOIN destination d
 WHERE e.tournament_id='${target.tour}' AND e.status='busted'
 ), first_call AS MATERIALIZED (
 SELECT c.*,public.floor_restore_busted_player_to_seat_v5(entry_id,id,1,revision,control_epoch,request_id,session) AS outcome FROM candidates c
 ) SELECT jsonb_build_object('phase','restoreDenial','rows',coalesce(jsonb_agg(jsonb_build_object('entry',entry_id,'table',id,'session',session,'request',request_id,'first',outcome,'sameKeyReplay',public.floor_restore_busted_player_to_seat_v5(entry_id,id,1,revision,control_epoch,request_id,session)) ORDER BY entry_id),'[]')) FROM first_call;
 RESET ROLE;
 SELECT jsonb_build_object('phase','after','hash',${fingerprint},'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${target.tour}' AND is_active),'paid',(SELECT sum(prize_amount) FROM public.tournament_prize_payments WHERE tournament_id='${target.tour}'));
 ROLLBACK;`;
 let output;
 try{output=sql(q);}catch(error){
  writeFileSync(folder+'terminal991-blocked-local-20261027.json',JSON.stringify({kind:'HARNESS_PREPARATION_BLOCKED_NOT_PRODUCT_RESTORE_RESULT',tour:target.tour,status:error.status,stdout:String(error.stdout??''),stderr:String(error.stderr??''),restoreDispatched:false,permissionsChanged:false},null,2)+'\n');
  throw error;
 }
 writeFileSync(folder+`terminal991-${target.tour}-raw-local-20261027.txt`,output);
 const rows=output.trim().split(/\r?\n/).map(x=>JSON.parse(x));
 const [before,denied,after]=rows;
 assert.equal(before.phase,'before');assert.equal(after.phase,'after');assert.equal(before.hash,after.hash);
 assert.equal(before.entries,target.entries);assert.equal(before.activeSeats,0);assert.equal(after.activeSeats,0);
 assert.equal(Number(before.paid),target.paid);assert.equal(Number(after.paid),target.paid);
 assert.equal(denied.rows.length,target.busted);
 for(const row of denied.rows){assert.deepEqual(row.first,{ok:false,error:'tournament_not_open'});assert.deepEqual(row.sameKeyReplay,row.first);}
 result.targets.push({...target,rows,unchanged:true});
}
writeFileSync(folder+'terminal991-original-restore-local-20261027.json',JSON.stringify(result,null,2)+'\n');
console.log('TERMINAL991_ORIGINAL_22_BUSTED_ENTRIES_44_CALLS_DENIED_18_TABLES_UNCHANGED_ROLLBACK_PASS');
