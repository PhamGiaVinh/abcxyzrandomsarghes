import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_MAIN963_LOCAL,'1');
const root='D:/Quy trình/output/reports/',db='vinpoker_ops_cash115_qualified_c';
const f={event:'dbb49f8d-7d47-4c2c-afd9-f57062c9971d',final:'4cd3af4d-7e1d-4042-855f-04fb6777e580',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',flights:['782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee']};
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
assert.deepEqual(read("SELECT jsonb_build_array(current_database(),host(inet_server_addr()),inet_server_port(),current_setting('data_directory'));"),[db,'127.0.0.1',55441,'/tmp/vinpoker-sol-local-20261016-0e79a729/data']);
assert.equal(read("SELECT to_jsonb(count(*)) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),0);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','tournament_settlement_outcomes','chip_bag','multi_day_qualification_locks_v1','multi_day_final_participations_v1','multi_day_final_seatings_v1','cashier_buyin_movements','tournament_prize_payments','tournament_close_report'];
const fingerprint=()=>read(`SELECT jsonb_build_object('hash',md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const result={fixture:f,kind:'ORIGINAL_MAIN167_CURRENT_READ_ONLY_PROVENANCE_AND_ALL_TABLE_HISTORY_NOT_FULL_ACCEPTANCE',before:fingerprint(),histories:[]};
try{
 const stage=read(`SELECT jsonb_build_object('participants',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.multi_day_final_participations_v1 p WHERE event_id='${f.event}'),'seatings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY participation_id) FROM public.multi_day_final_seatings_v1 s WHERE final_tournament_id='${f.final}'),'bags',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.chip_bag b WHERE tournament_id IN('${f.flights.join("','")}')),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id IN('${f.flights.join("','")}','${f.final}')),'lock',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='${f.event}'),'hands',(SELECT jsonb_agg(jsonb_build_object('id',id,'table',tournament_table_id,'number',hand_number) ORDER BY created_at,id) FROM public.tournament_hands WHERE tournament_id='${f.final}' AND status='completed' AND NOT is_voided));`);
 assert.equal(stage.participants.length,15);assert.equal(new Set(stage.participants.map(p=>p.player_id)).size,15);assert.equal(stage.seatings.length,15);assert.equal(stage.bags.length,16);assert.equal(stage.lock.participation_count,15);
 const sourceBagIds=[],selectedIds=[];
 for(const p of stage.participants){
  assert.equal(p.policy,'SELECT_LARGEST');assert.equal(p.final_tournament_id,f.final);assert.ok(p.source_bags.length>=1);
  const selected=p.source_bags.find(b=>b.bagId===p.selected_bag_id);assert.ok(selected);assert.equal(selected.stack,Math.max(...p.source_bags.map(b=>b.stack)));assert.equal(p.carried_stack,selected.stack);selectedIds.push(p.selected_bag_id);
  for(const source of p.source_bags){
   sourceBagIds.push(source.bagId);assert.ok(f.flights.includes(source.flightId));
   const bag=stage.bags.find(b=>b.id===source.bagId),entry=stage.entries.find(e=>e.id===source.sourceEntryId);assert.ok(bag&&entry);
   assert.equal(bag.tournament_id,source.flightId);assert.equal(entry.tournament_id,source.flightId);assert.equal(bag.player_id,p.player_id);assert.equal(entry.player_id,p.player_id);assert.equal(bag.stack_value,source.stack);assert.equal(bag.sealed,true);assert.equal(bag.multi_day_sealed_version,source.bagVersion);
  }
  const seating=stage.seatings.find(s=>s.participation_id===p.id);assert.ok(seating);assert.equal(seating.player_id,p.player_id);assert.equal(seating.seed_stack,p.carried_stack);assert.deepEqual(seating.source_bags,p.source_bags);
  const entry=stage.entries.find(e=>e.id===seating.entry_id);assert.ok(entry);assert.equal(entry.tournament_id,f.final);assert.equal(entry.player_id,p.player_id);
 }
 assert.equal(sourceBagIds.length,16);assert.equal(new Set(sourceBagIds).size,16);assert.equal(new Set(selectedIds).size,15);
 const unselected=stage.bags.filter(b=>!selectedIds.includes(b.id)),duplicate=stage.participants.filter(p=>p.source_bags.length>1);
 assert.equal(duplicate.length,1);assert.equal(unselected.length,1);
 const bagTotal=stage.bags.reduce((n,b)=>n+b.stack_value,0),carry=stage.participants.reduce((n,p)=>n+p.carried_stack,0),excluded=unselected.reduce((n,b)=>n+b.stack_value,0);
 assert.equal(bagTotal,320000);assert.equal(carry,300000);assert.equal(excluded,20000);assert.equal(bagTotal,carry+excluded);
 const finalEntries=stage.entries.filter(e=>e.tournament_id===f.final);assert.equal(finalEntries.length,15);assert.equal(finalEntries.reduce((n,e)=>n+e.current_stack,0),carry);
 assert.equal(stage.hands.length,15);
 for(const table of new Set(stage.hands.map(h=>h.table))){
  const projection=read(`SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_public_tournament_table_history_v2('${f.final}','${table}',50,NULL,NULL);`);
  assert.equal(projection.access,'public');assert.equal(projection.nextCursor,null);assert.ok(projection.items.every(h=>h.result.status==='verified'));
  const expected=stage.hands.filter(h=>h.table===table).map(h=>h.id).sort(),actual=projection.items.map(h=>h.handId).sort();assert.deepEqual(actual,expected);
  result.histories.push({table,items:projection.items.map(h=>({id:h.handId,number:h.handNumber,status:h.result.status}))});
 }
 assert.equal(result.histories.flatMap(h=>h.items).length,15);
 result.provenance={bagTotal,carry,excluded,unselected:unselected.map(b=>({id:b.id,stack:b.stack_value,sealed:b.sealed})),duplicate:duplicate.map(p=>({id:p.id,player:p.player_id,policy:p.policy,carry:p.carried_stack,selected:p.selected_bag_id,sources:p.source_bags})),participants:15,sourceBags:16,seatings:15,finalEntryTotal:carry};
}finally{result.after=fingerprint();result.unchanged=result.before.hash===result.after.hash;writeFileSync(root+'main963-provenance-history-readonly-local-20261027.json',JSON.stringify(result,null,2)+'\n');assert.equal(result.unchanged,true);}
if(process.argv.includes('--update-manifest')){
 const file=root+'main-event167-journey-manifest-local-20261020.json',bytes=readFileSync(file),backup=file.replace('.json','.before963.json');assert.equal(existsSync(backup),false);writeFileSync(backup,bytes);
 const manifest=JSON.parse(bytes);assert.equal(manifest.event,f.event);manifest.provenanceHistory963={status:'NATIVE_READ_ONLY_ALL15_PUBLIC_PROOFS_AND_SELECTED_BAG_LINEAGE_VERIFIED_NOT_FULL_JOURNEY_ACCEPTANCE',database:db,provenance:result.provenance,histories:result.histories,businessUnchanged:true,evidence:'main963-provenance-history-readonly-local-20261027.json',beforeManifestSha256:createHash('sha256').update(bytes).digest('hex')};writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
}
console.log('MAIN963_ORIGINAL_NATIVE_16BAGS_15SEATS_ALL15_PUBLIC_VERIFIED_UNCHANGED_PASS');
