import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runRegisterBrowserEdge} from './registerBrowserEdge.local.mjs';

assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
assert.equal(process.env.VINPOKER_NATIVE_REGISTRATION_REPLAY,'1');
const tour='7638ff64-b5ca-402a-89fc-91e7f325c32f',registration='f4eeb553-e14b-4d0f-9e59-f5f1785a4165';
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env',
 'PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
 'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||current_setting('data_directory')||'|'||inet_server_port();"),
 'vinpoker_ops_cash115_qualified_c|/tmp/vinpoker-sol-local-20261016-0e79a729/data|55441');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',t.club_id,'player',r.player_id)
 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
 JOIN public.tournament_registrations r ON r.tournament_id=t.id
 JOIN public.club_settings cs ON cs.club_id=c.id
 WHERE t.id='${tour}' AND r.id='${registration}' AND r.status='confirmed' AND r.total_pay=100000
 AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND cs.auto_swing_enabled=false
 AND (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE registration_id=r.id)=100000;`)||'null');
assert.ok(fixture,'exact confirmed bank-paid TEST registration required');
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),
 'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r WHERE tournament_id='${tour}'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${tour}'),
 'notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n WHERE user_id='${fixture.player}'))::text);`);
const before=fingerprint(),log=[];
try{
 const response=await runRegisterBrowserEdge({body:{tournament_id:tour},fixture,user:{id:fixture.player},sql,log});
 const result=await response.json();
 assert.equal(response.status,200,`native registration replay failed: ${result.error??'unknown'}`);
 assert.equal(result.success,true);assert.equal(result.already_registered,true);
 assert.equal(result.registration_id,registration);assert.equal(result.total_pay,100000);assert.equal(result.status,'confirmed');
 assert.equal(log.filter(row=>row.edgeRpc==='cashier_create_app_registration_v1').length,1);
 assert.equal(log.filter(row=>row.edgeNotification).length,0);
 console.log('NATIVE_ACTUAL_REGISTRATION_HANDLER_EXISTING_BANK_RECEIPT_REPLAY_PASS',JSON.stringify({tour,registration,totalPay:result.total_pay,alreadyRegistered:result.already_registered}));
}finally{assert.equal(fingerprint(),before,'existing registration replay must not change money/quota/entries/seats/notices');}
