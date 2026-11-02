// READ ONLY retained SUM_STACKS qualification; no fixture constructors or writers.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {parseD2Roster} from '../../src/ops/floor/multiDayInitialDraw.ts';
assert.equal(process.env.VINPOKER_SUM883_LOCAL,'1');
const clone='vinpoker_ranking860_local',primary='vinpoker_ops_cash115_qualified_c';
const sql=(db,q)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q};ROLLBACK;`,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const read=(db,q)=>JSON.parse(sql(db,q));
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory')"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,'SELECT package_hash FROM floor_private.ranking860_install_backup'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
const events=['30eb935c-8ba6-43ab-a6a6-0c0934f71570','321da566-55e4-4994-b8bb-8d6954d360df','36d36bd4-99f8-4a2b-a75f-f1e5710f56cd','1fb6d735-7ca1-4aac-99c9-6b3d39cff8bd','2061e37f-8979-467f-9f1b-37101b524b86','1cb64e29-c5d8-43e3-b8d9-7815905749b1'];
const facts=db=>read(db,`SELECT jsonb_build_array(${['multi_day_final_participations_v1','multi_day_qualification_locks_v1','multi_day_qualification_rules_v1','chip_bag','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_chip_counts'].map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')})`);
const before={primary:facts(primary),clone:facts(clone)},results=[];
for(const event of events){
 const meta=read(clone,`SELECT jsonb_build_object('actor',c.owner_id,'final',e.final_tournament_id) FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id WHERE e.id='${event}'`);
 const auth=`SET LOCAL request.jwt.claim.sub='${meta.actor}';SET LOCAL request.jwt.claims='{"sub":"${meta.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const projection=db=>read(db,`${auth}SELECT public.multi_day_final_roster_v1('${event}')`);
 const a=projection(primary),b=projection(clone);assert.deepEqual(b,a);const roster=parseD2Roster(b,event);
 assert.equal(roster.players.length,8);assert.ok(roster.players.every(p=>p.state==='SEATED'&&p.stack===40000&&p.sourceBags.length===2));
 const saved=roster.initialDraws.flatMap(d=>d.assignments);assert.equal(saved.length,8);assert.equal(new Set(saved.map(a=>a.participationId)).size,8);
 assert.ok(saved.every(a=>a.stack===40000&&roster.players.some(p=>p.participationId===a.participationId&&p.playerId===a.playerId)));
 const bagProof=read(clone,`SELECT jsonb_build_object('participants',count(DISTINCT p.id),'bags',count(*),'flights',count(DISTINCT bag->>'flightId'),'matched',bool_and(p.policy='SUM_STACKS' AND p.carried_stack=40000 AND p.selected_bag_id IS NULL AND jsonb_array_length(p.source_bags)=2 AND b.player_id=p.player_id AND b.tournament_id=(bag->>'flightId')::uuid AND b.stack_value=(bag->>'stack')::bigint AND b.multi_day_sealed_version=(bag->>'bagVersion')::bigint AND b.sealed AND src.player_id=p.player_id AND src.tournament_id=b.tournament_id AND f.event_id=p.event_id),'sourceTotal',sum((bag->>'stack')::bigint)) FROM public.multi_day_final_participations_v1 p CROSS JOIN LATERAL jsonb_array_elements(p.source_bags)bag JOIN public.chip_bag b ON b.id=(bag->>'bagId')::uuid JOIN public.tournament_entries src ON src.id=(bag->>'sourceEntryId')::uuid JOIN public.tournaments f ON f.id=b.tournament_id WHERE p.event_id='${event}'`);
 assert.deepEqual(bagProof,{participants:8,bags:16,flights:2,matched:true,sourceTotal:320000});
 const perPerson=read(clone,`SELECT to_jsonb(bool_and(p.carried_stack=(SELECT sum((b->>'stack')::bigint) FROM jsonb_array_elements(p.source_bags)b))) FROM public.multi_day_final_participations_v1 p WHERE p.event_id='${event}'`);assert.equal(perPerson,true);
 assert.equal(sql(clone,`SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${meta.final}'`),'0');
 results.push({event,final:meta.final,players:8,bagProof,savedSeats:8,carryTotal:320000,finalBuyinMovements:0,readerParity:true});
}
assert.deepEqual(facts(primary),before.primary);assert.deepEqual(facts(clone),before.clone);
const result={scope:'retained six SUM_STACKS eight-player native reader/source evidence, not browser/new gameplay/full journey acceptance',results,protectedTables:before.primary.map(x=>x[0]),primaryUnchanged:true,cloneUnchanged:true};
writeFileSync('D:/Quy trình/output/reports/d2_883-sum-stacks-retained-readonly-local-20261026.json',JSON.stringify(result,null,2)+'\n');console.log('D2_883_RETAINED_SUM_STACKS_SOURCE_AND_SAVED_SEATS_PASS',JSON.stringify(result));
