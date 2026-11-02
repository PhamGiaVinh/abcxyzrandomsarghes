import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_JOURNEYS962_LOCAL,'1');
const root='D:/Quy trình/output/reports/';
const dbs=['vinpoker_ops_cash115_qualified_c','vinpoker_ranking860_local'];
const sql=(db,input)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=(db,query)=>JSON.parse(sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${query}ROLLBACK;`));
const sha=v=>createHash('sha256').update(v).digest('hex');
const specs=[
 {key:'single',manifest:'single244-journey-manifest-local-20261021.json',tour:'c367013a-3ed3-48af-ad48-3915acadc50e',actor:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',table:'c2ce77c0-2b61-4a19-bd43-4752232cc55a',field:8,bullets:9,hands:10,recipients:2,owed:900000,reports:['single694-official-close-local-20261024.md','payout907-original-single-browser-payment-local-20261026.md','payout908-original-single-all-paid-local-20261026.md']},
 {key:'main',manifest:'main-event167-journey-manifest-local-20261020.json',tour:'4cd3af4d-7e1d-4042-855f-04fb6777e580',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',table:'8508d715-cd7c-4f1f-bb0d-223d967e355c',field:15,bullets:15,hands:15,tableHands:13,recipients:15,owed:2500000,reports:['main910-original-main-all-paid-local-20261026.md']},
];
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','tournament_settlement_outcomes','tournament_close_report','tournament_prizes','tournament_prize_payments','cashier_buyin_movements','dealer_attendance','dealer_assignments','table_operation_receipts'];
const fingerprint=db=>read(db,`SELECT jsonb_build_object('hash',md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const result={kind:'CURRENT_READ_ONLY_ORIGINAL_JOURNEYS_NOT_FULL_ACCEPTANCE',databases:{},manifests:{}};
for(const db of dbs){
 const guard=read(db,`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'externalExtensions',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
 assert.equal(guard.db,db);assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.externalExtensions,0);
 const before=fingerprint(db),snapshots={};
 try{
  for(const s of specs){
   const raw=read(db,`SELECT jsonb_build_object('status',(SELECT status FROM public.tournaments WHERE id='${s.tour}'),'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${s.tour}'),'players',(SELECT count(DISTINCT player_id) FROM public.tournament_entries WHERE tournament_id='${s.tour}'),'rankedPlayers',(SELECT count(DISTINCT player_id) FROM public.tournament_entries WHERE tournament_id='${s.tour}' AND finished_place IS NOT NULL),'closeReports',(SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='${s.tour}'),'distinctCompletedHands',(SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${s.tour}' AND status='completed' AND NOT is_voided),'historicalOutcomeRows',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id IN(SELECT id FROM public.tournament_hands WHERE tournament_id='${s.tour}') AND verification_scope='historical_display'),'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${s.tour}' AND is_active));`);
   const projection=read(db,`SET LOCAL request.jwt.claim.sub='${s.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${JSON.stringify({sub:s.actor,role:'authenticated'})}';SET LOCAL ROLE authenticated;SELECT jsonb_build_object('readiness',public.get_tournament_close_readiness_v1('${s.tour}'),'payout',public.get_tournament_payout_recipients('${s.tour}'));`);
   const history=read(db,`SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_public_tournament_table_history_v2('${s.tour}','${s.table}',50,NULL,NULL);`);
   assert.equal(raw.status,'completed');assert.equal(raw.entries,s.bullets);assert.equal(raw.players,s.field);assert.equal(raw.rankedPlayers,s.field);assert.equal(raw.closeReports,1);assert.equal(raw.activeSeats,0);
   assert.equal(raw.distinctCompletedHands,s.hands);assert.equal(history.access,'public');assert.equal(history.items.length,s.tableHands??s.hands);assert.ok(history.items.every(x=>x.result.status==='verified'));assert.equal(new Set(history.items.map(x=>x.handId)).size,s.tableHands??s.hands);
   assert.equal(projection.readiness.already_closed,true);assert.equal(Number(projection.payout.owedTotal),s.owed);assert.equal(Number(projection.payout.totalCount),s.recipients);
   if(db===dbs[0]){assert.equal(Number(projection.payout.paidTotal),s.owed);assert.ok(projection.payout.places.every(p=>p.isPaid));}
   snapshots[s.key]={raw,projection,publicHistory:history.items.map(x=>({id:x.handId,number:x.handNumber,status:x.result.status})),unpaid:Number(projection.payout.owedTotal)-Number(projection.payout.paidTotal)};
  }
 }finally{const after=fingerprint(db);result.databases[db]={guard,before,after,unchanged:before.hash===after.hash,snapshots};assert.equal(before.hash,after.hash);}
}
for(const s of specs){
 const file=root+s.manifest,bytes=readFileSync(file),manifest=JSON.parse(bytes);
 if(s.key==='single')assert.equal(manifest.tour,s.tour);else assert.equal(manifest.children.find(x=>x.phase==='final').id,s.tour);
 const reports=s.reports.map(file=>{assert.ok(existsSync(root+file));return{file,sha256:sha(readFileSync(root+file))};});
 const latest={checkpoint:962,status:'READ_ONLY_CURRENT_FACTS_NOT_WHOLE_JOURNEY_ACCEPTANCE',authoritativeDatabase:dbs[0],sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),current:result.databases[dbs[0]].snapshots[s.key],cloneComparison:result.databases[dbs[1]].snapshots[s.key],evidenceReports:reports,historicalSectionsAreCheckpointObservations:true,outstanding:['Full linked R11 acceptance not achieved','Linked real-rest rotations/payroll finalization not accepted','Remaining module/provider/mobile/concurrency and resource-hold gaps retained; see current R00–R13 index'],productionChanged:false};
 result.manifests[s.key]={file:s.manifest,beforeSha256:sha(bytes),previousStatus:manifest.status,latest};
 if(process.argv.includes('--update-manifests')){
  const backup=root+s.manifest.replace('.json','.before962.json');assert.equal(existsSync(backup),false,'do not overwrite prior audit backup');writeFileSync(backup,bytes);
  manifest.status=s.key==='single'?'PARTIAL_OFFICIALLY_CLOSED_2_PAID_900K_NOT_END_TO_END_ACCEPTED':'PARTIAL_FINAL_CLOSED_15_PAID_2500K_NOT_END_TO_END_ACCEPTED';manifest.latestReadOnlySnapshot962=latest;
  writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');result.manifests[s.key].afterSha256=sha(readFileSync(file));
 }
}
writeFileSync(root+'journeys962-current-manifest-audit-local-20261027.json',JSON.stringify(result,null,2)+'\n');
console.log('JOURNEYS962_READONLY_CURRENT_FACTS_MANIFEST_AUDIT_PASS',JSON.stringify(Object.fromEntries(dbs.map(db=>[db,Object.fromEntries(specs.map(s=>[s.key,{paid:result.databases[db].snapshots[s.key].projection.payout.paidTotal,unpaid:result.databases[db].snapshots[s.key].unpaid,hands:s.hands}]))]))));
