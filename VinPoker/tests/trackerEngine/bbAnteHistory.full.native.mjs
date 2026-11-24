// Actual isolated SQL snapshot -> historical verifier -> leased outcome commit.
// No hosted Auth/HTTP/Edge or production privilege-parity claim.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyHistoricalDisplaySettlement} from '../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';
import {computeAuthoritativeSettlement} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';

const env={...process.env};
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])delete env[key];
const child=spawn(process.env.TRACKER_TEST_PSQL??'psql',[
 '-h','127.0.0.1','-p','56419','-U','postgres','-d','tracker_bba350_full','-w','-X','-qAt','-v','ON_ERROR_STOP=1',
],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const pending=new Map();let serial=0,errors='';
child.stderr.on('data',data=>{errors+=data;});
createInterface({input:child.stdout}).on('line',line=>{
 if(!line.startsWith('{'))return;
 const row=JSON.parse(line);const waiter=pending.get(row.tag);
 if(waiter){clearTimeout(waiter.timer);pending.delete(row.tag);waiter.resolve(row.data);}
});
const done=new Promise(resolve=>child.on('close',code=>{
 for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(new Error(errors||`psql closed: ${code}`));}
 pending.clear();resolve(code);
}));
child.on('error',error=>{for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}pending.clear();});
function send(sql,expression){
 const tag=++serial;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(tag);child.kill();reject(new Error(`local SQL timeout: ${errors}`));},20000);
  pending.set(tag,{resolve,reject,timer});
  child.stdin.write(`${sql}\nSELECT jsonb_build_object('tag',${tag}${expression?`, 'data',(${expression})`:''});\n`);
 });
}
const value=expression=>send('',expression);
const quote=value=>`'${(typeof value==='string'?value:JSON.stringify(value)).replaceAll("'","''")}'`;
const systemActor='00000000-0000-4000-8000-000000000001';
try{
 const identity=await value("SELECT jsonb_build_object('database',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'data',current_setting('data_directory'))");
 assert.equal(identity.database,'tracker_bba350_full');assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,56419);
 assert.ok(identity.data.includes('tracker-bba349-pg17-'));
 const fixture=readFileSync('tests/trackerEngine/bbAnteSettlement.local.pg17.sql','utf8');
 assert.match(fixture,/ROLLBACK;\s*$/);
 await send(fixture.replace(/ROLLBACK;\s*$/,''));
 await send(`SET LOCAL request.jwt.claims='{"role":"service_role"}';`);
 const cases=await value("SELECT jsonb_agg(to_jsonb(c) ORDER BY bb_start) FROM bba_finished_cases c");
 assert.equal(cases.length,2);
 for(const item of cases)assert.match(item.hand_id,/^[a-f0-9-]{36}$/);
 const jobs=await value(`SELECT jsonb_agg(to_jsonb(j)) FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY[${cases.map(item=>quote(item.hand_id)).join(',')}]::uuid[],20) j`);
 assert.equal(jobs.length,2);
 for(const item of cases){
  const job=jobs.find(job=>job.hand_id===item.hand_id);assert.ok(job);
  const snapshot=await value(`SELECT public.get_tracker_historical_display_snapshot(${quote(item.hand_id)}::uuid,NULL::uuid)`);
  assert.equal(snapshot.hand.tracker_big_blind_ante_only,true);
  assert.equal(snapshot.hand.tracker_bba,200);
  assert.equal(snapshot.sourceRevision,job.source_revision);
  const result=await verifyHistoricalDisplaySettlement({tournamentId:snapshot.hand.tournament_id,
   hand:snapshot.hand,players:snapshot.players,actions:snapshot.actions,sourceRevision:snapshot.sourceRevision,
   sourceChainHash:snapshot.sourceChainHash,settlementRevision:1,actor:{userId:systemActor,role:'system_worker'}});
  assert.equal(result.publicOutcome.pots.reduce((sum,pot)=>sum+pot.amount,0),item.pot);
  assert.equal(result.publicOutcome.refunds.length,0);
  const requestHash=createHash('sha256').update(canonicalJsonV1({contract:'historical-settlement-display-worker-v1',
   handId:item.hand_id,sourceRevision:snapshot.sourceRevision,sourceChainHash:snapshot.sourceChainHash,
   settlementRevision:1,outcomeHash:result.privateOutcome.outcomeHash})).digest('hex');
  const receipt=await value(`SELECT public.commit_tracker_historical_display_outcome_v2(
   ${quote(item.hand_id)}::uuid,${quote(systemActor)}::uuid,'system_worker',${snapshot.sourceRevision},
   ${quote(snapshot.sourceChainHash)},${quote(result.privateOutcome.outcomeHash)},${quote(requestHash)},
   ${quote(`history-worker:${item.hand_id}:${snapshot.sourceRevision}:1:${result.privateOutcome.outcomeHash}`)},
   ${quote(result.publicOutcome)}::jsonb,${quote(job.lease_token)}::uuid)`);
  assert.equal(receipt.ok,true);assert.equal(receipt.outcome_hash,result.privateOutcome.outcomeHash);
  const stored=await value(`SELECT jsonb_build_object('status',status,'scope',verification_scope,'outcome',public_outcome)
   FROM public.tournament_settlement_outcomes WHERE hand_id=${quote(item.hand_id)}::uuid`);
  assert.equal(stored.status,'verified');assert.equal(stored.scope,'historical_display');
  assert.equal(stored.outcome.pots.reduce((sum,pot)=>sum+pot.amount,0),item.pot);
  await send(`SET LOCAL ROLE anon; SET LOCAL request.jwt.claims='{"role":"anon"}';`);
  const publicHand=await value(`SELECT public.get_public_tournament_table_hand_v2(
   ${quote(snapshot.hand.tournament_id)}::uuid,${quote(snapshot.hand.tournament_table_id)}::uuid,${quote(item.hand_id)}::uuid)`);
  assert.equal(publicHand.id,item.hand_id);assert.equal(publicHand.bigBlindAnteOnly,true);
  const history=await value(`SELECT public.get_public_tournament_table_history_v2(
   ${quote(snapshot.hand.tournament_id)}::uuid,${quote(snapshot.hand.tournament_table_id)}::uuid,50,NULL,NULL)`);
  const listed=history.items?.find(row=>row.handId===item.hand_id);assert.ok(listed);
  assert.equal(listed.result.status,'verified');
  assert.equal(listed.result.recipients.reduce((sum,recipient)=>sum+recipient.potAward,0),item.pot);
  await send(`RESET ROLE; SET LOCAL request.jwt.claims='{"role":"service_role"}';`);
  const source=await value(`SELECT to_jsonb(s) FROM public.get_tournament_settlement_source_hash(${quote(item.hand_id)}::uuid)s`);
  const owner=await value(`SELECT c.owner_id FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id WHERE t.id=${quote(snapshot.hand.tournament_id)}::uuid`);
  const liveStacks=await value(`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'chip_count',chip_count))
   FROM public.tournament_chip_counts WHERE tournament_id=${quote(snapshot.hand.tournament_id)}::uuid`);
  const correction=await computeAuthoritativeSettlement({tournamentId:snapshot.hand.tournament_id,targetHandId:item.hand_id,
   hands:[snapshot.hand],players:snapshot.players,actions:snapshot.actions,liveStacks,edit:{actions:snapshot.actions},
   actor:{userId:owner,role:'club_owner_or_admin'},sourceRevisionOverride:source.source_revision,
   sourceChainHashOverride:source.source_chain_hash,settlementRevisionOverride:2});
  const correctionCall=(edit,key)=>`public.commit_tracker_hand_correction_outcome(
   ${quote(item.hand_id)}::uuid,${quote(owner)}::uuid,${correction.privateOutcome.sourceRevision},
   ${quote(correction.privateOutcome.sourceChainHash)},2,${quote(correction.privateOutcome.outcomeHash)},repeat('b',64),
   ${quote(key)},${quote(correction.publicOutcome)}::jsonb,
   ${quote(edit)}::jsonb,${quote(correction.handChanges)}::jsonb,${quote(correction.finalStacks)}::jsonb,
   'BB ante TEST preserved action sequence')`;
  const changedForced=structuredClone(correction.persistedEdit);
  changedForced.actions.find(action=>action.action_type==='post_ante').action_amount=0;
  await send(`DO $reject$ BEGIN
   PERFORM ${correctionCall(changedForced,`bb-ante-change-forced:${item.hand_id}`)};
   RAISE EXCEPTION 'changed forced posts unexpectedly accepted';
   EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='tracker_blind_correction_requires_frozen_posts',SQLERRM;
   END $reject$;`);
  const corrected=await value(`SELECT ${correctionCall(correction.persistedEdit,`bb-ante-action-correction:${item.hand_id}`)}`);
  assert.equal(corrected.ok,true);assert.equal(corrected.correction_reason_recorded,true);
  assert.notEqual(await value("SELECT current_setting('vinpoker.blind_batch_hand',true)"),item.hand_id);
  const after=await value(`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'chip_count',chip_count) ORDER BY player_id)
   FROM public.tournament_chip_counts WHERE tournament_id=${quote(snapshot.hand.tournament_id)}::uuid`);
  assert.deepEqual(after,[...liveStacks].sort((a,b)=>a.player_id.localeCompare(b.player_id)));
  const refreshed=await value(`SELECT public.get_public_tournament_table_history_v2(
   ${quote(snapshot.hand.tournament_id)}::uuid,${quote(snapshot.hand.tournament_table_id)}::uuid,50,NULL,NULL)`);
  const correctedRow=refreshed.items.find(row=>row.handId===item.hand_id);
  assert.equal(correctedRow.result.status,'verified');
  assert.equal(correctedRow.result.recipients.reduce((sum,recipient)=>sum+recipient.potAward,0),item.pot);
  if(item.bb_start===1000){
   await send(`DO $rollback$ DECLARE prior text; BEGIN
    SELECT definition INTO STRICT prior FROM floor_private.tracker_bb_ante_originals351
    WHERE signature='floor_private.snapshot_tracker_hand_blinds()';
    EXECUTE prior;
   END $rollback$;`);
   await send(`INSERT INTO public.tournament_hands(
    tournament_id,table_id,tournament_table_id,table_session_id,hand_number,status,button_seat,created_by,locked_by_user_id,locked_at)
    VALUES(${quote(snapshot.hand.tournament_id)}::uuid,${quote(snapshot.hand.table_id)}::uuid,
     ${quote(snapshot.hand.tournament_table_id)}::uuid,${quote(snapshot.hand.table_session_id)}::uuid,
     2,'in_progress',2,${quote(owner)}::uuid,${quote(owner)}::uuid,now());`);
   const next=await value(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id=${quote(snapshot.hand.tournament_id)}::uuid AND hand_number=2`);
   assert.equal(next.tracker_big_blind_ante_only,false);assert.equal(next.tracker_bba,0);
   assert.equal(await value(`SELECT tracker_big_blind_ante_only FROM public.tournament_hands WHERE id=${quote(item.hand_id)}::uuid`),true);
  }
  console.log(`BB_ANTE_HISTORY_FULL_PASS: BB ${item.bb_start}, pot ${item.pot}, verified stored outcome`);
 }
 await send('ROLLBACK;');
 assert.equal(await value('SELECT count(*) FROM public.tournament_hands'),0);
}finally{
 if(child.exitCode===null){child.stdin.end('ROLLBACK;\n\\q\n');}
 const code=await done;assert.equal(code,0,errors);
}
