import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_CONFIG1005_LOCAL,'1');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const tables=['tournaments','tournament_entries','tournament_registrations','tournament_levels','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1','tournament_state_transitions','audit_logs'];
const hash=(protectedOnly=false)=>`md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x${protectedOnly&&t==='tournaments'?` WHERE id<>'${tour}'`:protectedOnly&&t==='table_operation_receipts'?` WHERE NOT(actor_id='${actor}' AND operation_type='edit_tournament_with_levels_v1' AND request_id=:'request'::uuid)`:''})`).join(',')})::text)`;
const config=`(SELECT jsonb_build_object('name',name,'buy_in',buy_in,'starting_stack',starting_stack,'start_time',start_time,'minutes_per_level',minutes_per_level,'late_reg_close_level',late_reg_close_level) FROM public.tournaments WHERE id='${tour}')`;
const args=`'${tour}','${club}',:'context'::jsonb->'state',:'config'::jsonb,NULL,:'request'::uuid,'${actor}'`;
const sql=String.raw`BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
ASSERT current_database()='vinpoker_ranking860_local';ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
ASSERT NOT EXISTS(SELECT FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
ASSERT (SELECT status='live' AND buy_in=100000 AND starting_stack=20000 FROM public.tournaments WHERE id='${tour}');
END $$;
SELECT gen_random_uuid() AS request \gset
SELECT jsonb_build_object('phase','before','hash',${hash()},'protected',${hash(true)},'config',${config});
SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
SELECT public.get_tournament_edit_context_v1('${tour}','${actor}') AS context \gset
SELECT (:'context'::jsonb#>'{state,config}')||jsonb_build_object('name','Config1005 rollback TEST','buy_in',101000,'starting_stack',21000) AS config \gset
SELECT jsonb_build_object('phase','write','result',public.edit_tournament_with_levels_v1(${args}));
SELECT jsonb_build_object('phase','readback','result',public.get_tournament_edit_receipt_v1(${args}));
SELECT jsonb_build_object('phase','replay','result',public.edit_tournament_with_levels_v1(${args}));
SELECT jsonb_build_object('phase','conflict','result',public.edit_tournament_with_levels_v1('${tour}','${club}',:'context'::jsonb->'state',:'config'::jsonb||jsonb_build_object('name','Conflict1005 rollback TEST'),NULL,:'request'::uuid,'${actor}'));
SELECT jsonb_build_object('phase','stale','result',public.edit_tournament_with_levels_v1('${tour}','${club}',:'context'::jsonb->'state',:'config'::jsonb,NULL,gen_random_uuid(),'${actor}'));
RESET ROLE;
SELECT jsonb_build_object('phase','inside','protected',${hash(true)},'config',${config},'receiptCount',(SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='edit_tournament_with_levels_v1' AND request_id=:'request'::uuid));
ROLLBACK;
BEGIN READ ONLY;SELECT jsonb_build_object('phase','after','hash',${hash()},'config',${config});ROLLBACK;`;
const output=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:60000,maxBuffer:3e6});
writeFileSync('D:/Quy trình/output/reports/config1005-canonical-edit-raw-local-20261027.txt',output);
const rows=output.trim().split(/\r?\n/).map(s=>JSON.parse(s));const [before,write,readback,replay,conflict,stale,inside,after]=rows;
assert.equal(write.result.ok,true);assert.equal(write.result.actor_id,actor);assert.equal(write.result.tournament_id,tour);assert.equal(write.result.club_id,club);
assert.deepEqual(readback.result,write.result);assert.deepEqual(replay.result,write.result);
assert.deepEqual(conflict.result,{ok:false,error:'IDEMPOTENCY_CONFLICT'});assert.deepEqual(stale.result,{ok:false,error:'stale_edit_context'});
assert.equal(inside.config.buy_in,101000);assert.equal(inside.config.starting_stack,21000);assert.equal(inside.receiptCount,1);assert.equal(inside.protected,before.protected);
assert.deepEqual(after.config,before.config);assert.equal(after.hash,before.hash);
writeFileSync('D:/Quy trình/output/reports/config1005-canonical-edit-local-20261027.json',JSON.stringify({kind:'CANONICAL_NATIVE_CONFIG_EDIT_RECEIPT_CAS_HISTORY_CONSERVATION_ROLLBACK_NOT_BROWSER_E2E',tables,rows,unchanged:true},null,2)+'\n');
console.log('CONFIG1005_CANONICAL_EDIT_RECEIPT_REPLAY_CONFLICT_STALE_22_GROUPS_ROLLBACK_PASS');
