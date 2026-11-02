// Compare the retained original journeys across primary/owned candidate clone.
// All database calls are explicitly READ ONLY; no finalizer or writer is called.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_RANKING870_LOCAL,'1');
const primary='vinpoker_ops_cash115_qualified_c',clone='vinpoker_ranking860_local';
const single='c367013a-3ed3-48af-ad48-3915acadc50e',final='4cd3af4d-7e1d-4042-855f-04fb6777e580',event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
const actors={[single]:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',[final]:'675fe35e-60a8-4452-bb90-e79486d54da6'};
const sql=(db,q)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';${q};ROLLBACK;`,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const read=(db,q)=>JSON.parse(sql(db,q));
const auth=tour=>`SET LOCAL request.jwt.claim.sub='${actors[tour]}';SET LOCAL request.jwt.claims='{"sub":"${actors[tour]}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const identity=read(clone,"SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'directory',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()))");
assert.deepEqual(identity,{db:clone,host:'127.0.0.1',port:55441,directory:'/tmp/vinpoker-sol-local-20261016-0e79a729/data',comment:'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948'});
assert.equal(read(clone,'SELECT to_jsonb(package_hash) FROM floor_private.ranking860_install_backup'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
const baseline=read(primary,"SELECT jsonb_build_array(md5(replace(pg_get_functiondef('public.finalize_tournament_results(uuid)'::regprocedure),chr(13),'')),md5(replace(pg_get_functiondef('floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure),chr(13),'')),to_regclass('floor_private.tournament_ranking_reviews296') IS NULL)");
assert.deepEqual(baseline,['df45256a89b7a56fe6d7630803ff241a','906391392ced28d9ac94220e3ab42e2a',true]);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','tournament_chip_counts','tournament_close_report','tournament_prizes','tournament_payout_runs','cashier_buyin_movements','tournament_prize_payments','tournament_tables','table_sessions'];
const digest=(table,where)=>`(SELECT jsonb_build_array(count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${table} r WHERE ${where})`;
const scope=`'${single}','${final}','782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee'`;
const facts=db=>read(db,`SELECT jsonb_build_object(${tables.flatMap(t=>[`'${t}'`,digest(t,t==='tournaments'?`r.id IN(${scope})`:`r.tournament_id IN(${scope})`)]).join(',')},
 'participants',${digest('multi_day_final_participations_v1',`r.event_id='${event}'`)},
 'qualification',${digest('multi_day_qualification_locks_v1',`r.event_id='${event}'`)},
 'payoutFinalization',${digest('multi_day_payout_finalizations_v1',`r.event_id='${event}'`)},
 'proofs',${digest('tournament_settlement_outcomes',`r.hand_id IN(SELECT id FROM public.tournament_hands WHERE tournament_id IN(${scope}))`)})`);
const beforePrimary=facts(primary),beforeClone=facts(clone);assert.deepEqual(beforeClone,beforePrimary,'870 retained journey rows differ across clone and primary');
for(const [tour,field,bullets,owed] of [[single,8,9,900000],[final,15,15,2500000]]){
 const expected={field,status:'preserved'};
 for(const db of [primary,clone])assert.deepEqual(read(db,`SELECT floor_private.felt_official_results_close_status_v1('${tour}')`),expected);
 const readProjection=db=>read(db,`${auth(tour)}SELECT jsonb_build_object('readiness',public.get_tournament_close_readiness_v1('${tour}'),'payout',public.get_tournament_payout_recipients('${tour}'))`);
 const a=readProjection(primary),b=readProjection(clone);assert.deepEqual(a,b,'870 close/payout reader projection changed under candidate');
 assert.equal(a.readiness.already_closed,true);assert.equal(a.readiness.ok,true);
 assert.equal(Number(a.payout.owedTotal),owed);assert.equal(Number(a.payout.paidTotal),0);assert.equal(Number(a.payout.totalCount),tour===single?2:15);
 assert.ok(a.payout.places.every(p=>typeof p.recipientName==='string'&&p.recipientName.trim()&&!p.isPaid));
 const view=read(clone,`${auth(tour)}SELECT public.get_tournament_ranking_review_v1('${tour}')`);
 assert.equal(view.source.field,field);assert.equal(view.source.hasOfficial,true);assert.equal(view.source.requiresReview,false);assert.equal(view.review,null,'870 original official ranks unexpectedly require a new review');
 const counts=read(primary,`SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}'),'ranked',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL),'reports',(SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='${tour}'))`);
 assert.deepEqual(counts,{entries:bullets,ranked:field,reports:1});
 console.log('RANK870_ORIGINAL_OFFICIAL_AND_PAYOUT_PRESERVED',JSON.stringify({tour,field,bullets,owed,paid:0,newReviewRequired:false}));
 if(tour===final){
  const mapping=read(primary,`SELECT jsonb_agg(jsonb_build_object('entry',e.id,'player',e.player_id,'rank',e.finished_place,'participation',p.id,'obligation',o) ORDER BY e.finished_place)
   FROM public.tournament_entries e JOIN public.multi_day_final_participations_v1 p ON p.final_tournament_id=e.tournament_id AND p.event_id='${event}' AND p.player_id=e.player_id
   JOIN public.multi_day_payout_finalizations_v1 f ON f.event_id=p.event_id
   CROSS JOIN LATERAL jsonb_array_elements(f.obligations)o
   WHERE e.tournament_id='${final}' AND (o->>'participationId')::uuid=p.id`);
  assert.equal(mapping.length,15);assert.equal(new Set(mapping.map(p=>p.entry)).size,15);assert.equal(new Set(mapping.map(p=>p.participation)).size,15);
  for(const row of mapping){
   const recipient=a.payout.places.find(p=>p.multiDayParticipationId===row.participation);
   assert.ok(recipient);assert.equal(recipient.entryId,row.entry);assert.equal(Number(recipient.finishedPlace),row.rank);assert.equal(recipient.tournamentId,final);assert.equal(recipient.multiDayEventId,event);
   assert.equal(row.obligation.playerId,row.player);assert.equal(Number(row.obligation.rank),row.rank);assert.equal(Number(recipient.obligationAmount),Number(row.obligation.totalVnd));assert.equal(Number(row.obligation.paidVnd),0);
   assert.ok(view.source.entries.some(e=>e.entryId===row.entry&&e.playerId===row.player&&e.finishedPlace===row.rank));
  }
  assert.equal(mapping.reduce((sum,r)=>sum+Number(r.obligation.unpaidVnd),0),2500000);
  console.log('RANK870_MAIN15_ENTRY_PARTICIPATION_OBLIGATION_RECIPIENT_MAP_PASS');
 }
}
assert.deepEqual(facts(primary),beforePrimary);assert.deepEqual(facts(clone),beforeClone);
console.log('RANK870_READONLY_ORIGINAL_JOURNEYS_AND_LIABILITIES_UNCHANGED');
