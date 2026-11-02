import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_MULTIDAY1019_LOCAL,'1');
const db='vinpoker_ops_cash115_qualified_c';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(q));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'directory',current_setting('data_directory'),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.deepEqual(guard,{db,host:'127.0.0.1',port:55441,directory:'/tmp/vinpoker-sol-local-20261016-0e79a729/data',external:0});
const tables=['tournaments','tournament_entries','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);

const before=fingerprint();const data=read("SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{\"sub\":\"675fe35e-60a8-4452-bb90-e79486d54da6\",\"role\":\"authenticated\"}';SET LOCAL ROLE authenticated;SELECT public.multi_day_floor_read_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d');");
const original=JSON.parse(readFileSync('D:/Quy trình/output/reports/multiday1019-native-floor-before-local-20261027.json','utf8'));assert.deepEqual(data,original);assert.equal(data.finalization.obligations.length,15);assert.equal(data.finalization.paidPlayerVnd,0);assert.equal(data.finalization.unpaidObligationVnd,2500000);const after=fingerprint();assert.equal(before,after);writeFileSync('D:/Quy trình/output/reports/multiday1019-native-parity-local-20261027.json',JSON.stringify({kind:'GUARDED_CURRENT_NATIVE_FROZEN_SNAPSHOT_PARITY_READONLY_NOT_BROWSER_E2E',guard,tables,before,after,unchanged:true,originalSnapshotByteStructureEqual:true,data},null,2)+'\n');console.log('MULTIDAY1019_NATIVE_SNAPSHOT_UNCHANGED_18_GROUPS_READONLY_PASS');
