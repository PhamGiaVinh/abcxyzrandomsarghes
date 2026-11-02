import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_PAYOUT1011_LOCAL,'1');
const db='vinpoker_ops_cash115_qualified_c';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(q));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'directory',current_setting('data_directory'),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.deepEqual(guard,{db,host:'127.0.0.1',port:55441,directory:'/tmp/vinpoker-sol-local-20261016-0e79a729/data',external:0});
const tables=['tournaments','tournament_entries','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const result={kind:'CURRENT_ORIGINAL_PAYOUT_RESPONSES_READONLY_NOT_BROWSER_E2E',guard,tables,before:fingerprint(),journeys:[]};
try{
 for(const [key,tour,actor,entries,players,recipients,paid] of [
  ['single244','c367013a-3ed3-48af-ad48-3915acadc50e','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',9,8,2,900000],
  ['main167Final','4cd3af4d-7e1d-4042-855f-04fb6777e580','675fe35e-60a8-4452-bb90-e79486d54da6',15,15,15,2500000],
 ]){
  const facts=read(`SELECT jsonb_build_object('status',(SELECT status FROM public.tournaments WHERE id='${tour}'),'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}'),'players',(SELECT count(DISTINCT player_id) FROM public.tournament_entries WHERE tournament_id='${tour}'),'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active),'rankedPlayers',(SELECT count(DISTINCT player_id) FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL),'closeReports',(SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='${tour}'),'completedHands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND status='completed'));
  `);
  const payout=read(`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  SELECT public.get_tournament_payout_recipients('${tour}');`);
  assert.equal(facts.status,'completed');assert.equal(facts.entries,entries);assert.equal(facts.players,players);assert.equal(facts.rankedPlayers,players);assert.equal(facts.activeSeats,0);assert.equal(facts.closeReports,1);
  assert.equal(Number(payout.totalCount),recipients);assert.equal(Number(payout.paidCount),recipients);assert.equal(Number(payout.paidTotal),paid);assert.equal(Number(payout.owedTotal),paid);assert.ok(payout.places.every(p=>p.isPaid));
  result.journeys.push({key,tour,actor,nativeResponse:payout,facts,payout:{totalCount:payout.totalCount,paidCount:payout.paidCount,paidTotal:payout.paidTotal,owedTotal:payout.owedTotal,unpaid:0},wholeJourneyAccepted:false});
 }
}finally{
 result.after=fingerprint();result.unchanged=result.before===result.after;
 writeFileSync('D:/Quy trình/output/reports/payout1011-original-payloads-native-local-20261027.json',JSON.stringify(result,null,2)+'\n');assert.equal(result.unchanged,true);
}
console.log('PAYOUT1011_CURRENT_FACTS_READONLY_18_GROUPS_UNCHANGED_NOT_WHOLE_ACCEPTANCE_PASS');
