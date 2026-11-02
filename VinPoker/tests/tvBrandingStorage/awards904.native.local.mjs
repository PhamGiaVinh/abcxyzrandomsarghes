// Existing original Main TV data through native anon RPC. HTTP fault controls
// and a loopback token alias are modeled; no pairing/credential is created.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_TV904_LOCAL,'1');
const clone='vinpoker_ranking860_local',primary='vinpoker_ops_cash115_qualified_c';
const display='ca1f1e29-0d57-4e59-b7e5-309f7928f3da',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580';
const alias='LOCAL873-FINAL',base='http://127.0.0.1:54329',origin='http://127.0.0.1:5188';
const report='D:/Quy trình/output/reports/tv904-awards-reconcile-local-20261026.json';
const sql=(db,q)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:15000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,`SELECT count(*) FROM public.tv_displays WHERE id='${display}' AND name='Local166 final TEST' AND assigned_tournament_id='${tour}' AND status='paired' AND layout='clock';`),'1');
assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['tournament_prizes','tv_displays','tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','tournament_close_report','cashier_buyin_movements','tournament_prize_payments','multi_day_final_participations_v1','multi_day_payout_finalizations_v1'];
const proof=db=>sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')},md5(pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure)))::text);ROLLBACK;`);

const result={scope:'original Main167 frozen rank awards versus full Cashier obligations; no payout calculation',sources:[]};
for(const db of [primary,clone]){
 const before=proof(db);
 const payload=JSON.parse(sql(db,`BEGIN;SET LOCAL statement_timeout='10s';SELECT set_config('local904.token',(SELECT display_token FROM public.tv_displays WHERE id='${display}'),true) IS NOT NULL;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4(current_setting('local904.token'),true);ROLLBACK;`).split('\n').slice(1).join('\n'));
 assert.equal(payload.status,'paired');assert.equal(payload.tournament.id,tour);
 const finalization=JSON.parse(sql(db,`BEGIN READ ONLY;SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';ROLLBACK;`));
 const recipients=JSON.parse(sql(db,`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT public.get_tournament_payout_recipients('${tour}');ROLLBACK;`));
 assert.equal(recipients.places.length,15);assert.equal(Number(recipients.owedTotal),2500000);assert.equal(Number(recipients.paidTotal),0);
 assert.equal(finalization.obligations.length,15);assert.equal(finalization.obligations.reduce((n,r)=>n+Number(r.totalVnd),0),2500000);
 assert.equal(finalization.obligations.reduce((n,r)=>n+Number(r.paidVnd),0),0);
 const prizes=JSON.parse(sql(db,`BEGIN READ ONLY;SELECT coalesce(jsonb_agg(jsonb_build_object('position',position,'amount',amount) ORDER BY position),'[]') FROM public.tournament_prizes WHERE tournament_id='${tour}';ROLLBACK;`));
 assert.deepEqual(payload.prizes,prizes);
 const rankTotal=prizes.reduce((n,r)=>n+Number(r.amount),0);assert.equal(rankTotal,1180000);
 for(const obligation of finalization.obligations){
  const prize=prizes.find(p=>Number(p.position)===Number(obligation.rank));
  assert.equal(Number(obligation.rankAwardVnd),Number(prize?.amount??0),'TV rank award must match frozen obligation rank component');
  const recipient=recipients.places.find(p=>p.multiDayParticipationId===obligation.participationId);
  assert.ok(recipient);assert.equal(Number(recipient.finishedPlace),Number(obligation.rank));
  assert.equal(Number(recipient.obligationAmount),Number(obligation.totalVnd));
 }
 assert.equal(Number(recipients.owedTotal)-rankTotal,1320000);

 assert.equal(proof(db),before);
 result.sources.push({database:db,before,afterUnchanged:true,prizes,obligationKeys:Object.keys(finalization.obligations[0]),obligationTotals:finalization.obligations.map(r=>Object.fromEntries(Object.entries(r).filter(([k,v])=>k==='rank'||k.endsWith('Vnd')))),rankTotal,additionalObligationBeyondRank:Number(recipients.owedTotal)-rankTotal,cashierOwed:recipients.owedTotal,cashierPaid:recipients.paidTotal});
}
assert.deepEqual(result.sources[0].prizes,result.sources[1].prizes);
writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({sources:result.sources.map(r=>({database:r.database,prizes:r.prizes,keys:r.obligationKeys,unchanged:r.afterUnchanged}))}));
