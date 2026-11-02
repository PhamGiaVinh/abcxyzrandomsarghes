import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runPaidTourInitialAssignments} from './paidTourInitialAssign.native.mjs';
assert.equal(process.env.VINPOKER_MAIN181_REUSE_DEALERS,'1');
assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const f={club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',
 tour:'782a5196-5ea1-44ed-8a27-1b872d5f88d9',player:'42447e3e-5020-4841-8d0f-3d3fa35c9b99'};
const table='04305b3a-217f-4d31-8654-e14df5e606c5',session='0f8ed188-785b-4105-a8c2-6a93f6192f01';
const dealers=['9b59a231-4377-4d70-a179-172baaca23dd','67e4f54a-84c5-42da-ac1e-5336f270d5a4',
 '9e817a04-955b-47a3-86f7-06e741d087ec','24803da6-62f3-4f42-af5b-7e8884e74171'];
assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
 JOIN public.tournaments tr ON tr.id=t.tournament_id JOIN public.clubs c ON c.id=tr.club_id JOIN public.club_settings cs ON cs.club_id=c.id
 WHERE t.id='${table}' AND s.id='${session}' AND s.closed_at IS NULL AND s.control_mode='tracker' AND s.control_epoch=2 AND s.revision=10
 AND tr.id='${f.tour}' AND tr.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND c.id='${f.club}' AND c.owner_id='${f.actor}' AND NOT cs.auto_swing_enabled);`),'t');
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${session}';`),'0','fresh initial assignment only; never release or reset to rerun');
const ids=dealers.map(id=>`'${id}'`).join(',');
assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE dealer_id IN(${ids}) AND status='checked_in'
 AND check_out_time IS NULL AND current_state='available' AND shift_id='b714cf6d-a528-4da0-8e72-37bf86d51768'
 AND shift_date=(now() AT TIME ZONE 'Asia/Bangkok')::date;`),'4');
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE dealer_id IN(${ids}) AND released_at IS NULL;`),'0');
assert.equal(sql(`SELECT released_at IS NOT NULL AND released_at<=now()-interval '15 minutes'
 FROM public.dealer_assignments WHERE id='3928ef05-30d9-4d8f-915b-08862cfc6fc8';`),'t','do not backdate or force rest');
const timeFacts=()=>sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'shift',shift_id,'date',shift_date,
 'in',check_in_time,'out',check_out_time,'worked',total_worked_minutes_today,'ot',overtime_minutes) ORDER BY id)
 FROM public.dealer_attendance WHERE dealer_id IN(${ids});`);
const protectedFacts=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT to_jsonb(x) FROM public.dealer_assignments x WHERE id='3928ef05-30d9-4d8f-915b-08862cfc6fc8'))::text);`);
const before=protectedFacts(),times=timeFacts();
await runPaidTourInitialAssignments(sql,f,[{id:table,table_session_id:session}],dealers);
assert.equal(protectedFacts(),before);assert.equal(timeFacts(),times,'do not fabricate check-in, worked time or OT');
console.log('LOCAL_MAIN181_EXISTING_ATTENDANCE_CANONICAL_ASSIGN_REPLAY_PASS',JSON.stringify({session,protectedFingerprint:before,
 assignments:JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(a)) FROM public.dealer_assignments a WHERE table_session_id='${session}';`)),
 newCheckIns:0,manualEdgeNotBrowser:true,externalDelivery:false}));
