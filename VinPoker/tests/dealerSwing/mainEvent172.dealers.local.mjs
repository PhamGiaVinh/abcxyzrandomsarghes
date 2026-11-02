import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {runPaidTourInitialAssignments} from './paidTourInitialAssign.native.mjs';
assert.equal(process.env.VINPOKER_MAIN172_DEALERS,'1');
assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const f={club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',
 tour:'fdf91018-09f3-4cdc-b76a-f688eb216cee',player:'3add8ca8-34ff-4f52-8b40-a48c192d3aa5'};
const table='8ce69933-b2d0-4dfe-962e-86709c6222ac',session='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55';
assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
 JOIN public.tournaments tr ON tr.id=t.tournament_id JOIN public.clubs c ON c.id=tr.club_id
 WHERE t.id='${table}' AND s.id='${session}' AND s.closed_at IS NULL AND s.control_mode='tracker' AND s.control_epoch=2
 AND tr.id='${f.tour}' AND tr.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND c.id='${f.club}' AND c.owner_id='${f.actor}');`),'t');
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${session}' AND released_at IS NULL;`),'0','fresh initial assignment only; never clear history to rerun');
const money=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s))::text);`);
const before=money(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
const query=statement=>JSON.parse(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
 SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 ${statement}RESET ROLE;${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
const shifts=JSON.parse(sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.dealer_shifts WHERE club_id='${f.club}' AND tour_name='Linked Main Event 172 TEST';`));
assert.ok(shifts.length<=1);const shift=shifts[0]??randomUUID();
if(!shifts.length)sql(`INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${f.club}','Linked Main Event 172 TEST','00:00','23:59');`);
const dealers=[],attendance=[];
for(let n=1;n<=4;n++){
 const name=`Linked Main Event 172 TEST dealer ${n}`;
 const prior=JSON.parse(sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.dealers WHERE club_id='${f.club}' AND full_name='${name}' AND deleted_at IS NULL;`));
 assert.ok(prior.length<=1);const id=prior[0]??randomUUID();
 if(!prior.length)sql(`INSERT INTO public.dealers(id,club_id,full_name,status,user_id) VALUES('${id}','${f.club}','${name}','active',NULL);`);
 const key=randomUUID(),call=()=>query(`SELECT public.operator_check_in_dealer_v1('${id}','${f.club}','${shift}','${key}');`);
 const checked=call();assert.equal(checked.ok,true);assert.equal(checked.outcome,'checked_in');assert.deepEqual(call(),checked);
 dealers.push(id);attendance.push({dealer:id,request:key,result:checked});
}
await runPaidTourInitialAssignments(sql,f,[{id:table,table_session_id:session}],dealers);
assert.equal(money(),before,'Dealer operations must not change cash, entries or seats');
console.log('LOCAL_MAIN172_CHECKIN_ASSIGN_EDGE_REPLAY_PASS',JSON.stringify({shift,dealers,attendance,financialFingerprint:before,
 assignments:JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(a)) FROM public.dealer_assignments a WHERE table_session_id='${session}' AND released_at IS NULL;`))}));
