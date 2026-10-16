import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {computeAuthoritativeSettlement,normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';

// Actual transaction overlap on the guarded canonical paid fixture, not a timer
// pretending to prove concurrency. No hosted HTTP/Edge/provider claim.
export async function runPaidCorrectionOverlap({sql,service,fixture,hand}){
 const database='vinpoker_ops_cash115_qualified_c';
 assert.equal(process.env.PGDATABASE,database);assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
 const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
 const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
 const quote=v=>`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
 const business=()=>sql(`SELECT jsonb_build_object('seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'))::text;`);
 const before=business();
 async function plan(board){
  const snapshot=JSON.parse(sql(service+`SELECT public.get_tracker_historical_display_snapshot('${hand}',NULL);`));
  const source=normalizeSettlementSourceRpcResult(JSON.parse(sql(service+`SELECT to_jsonb(s) FROM public.get_tournament_settlement_source_hash('${hand}') s;`)));
  const liveStacks=JSON.parse(sql(service+`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'chip_count',chip_count)) FROM public.tournament_chip_counts WHERE tournament_id='${fixture.tour}';`));
  const revision=Number(sql(service+`SELECT coalesce(max(settlement_revision),0)+1 FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';`));
  const correctionReason='TEST serialized correction resolver overlap',key='native-overlap-'+crypto.randomUUID();
  const result=await computeAuthoritativeSettlement({tournamentId:fixture.tour,targetHandId:hand,hands:[snapshot.hand],players:snapshot.players,actions:snapshot.actions,
   liveStacks,edit:{communityCards:board},actor:{userId:fixture.actor,role:'club_owner_or_admin'},sourceRevisionOverride:source.sourceRevision,sourceChainHashOverride:source.sourceChainHash,settlementRevisionOverride:revision});
  const expectedEndingStacks=snapshot.players.map(p=>({player_id:p.player_id,entry_number:p.entry_number,ending_stack:p.ending_stack}));
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJsonV1({contract:'tracker-hand-correction-commit-v1',tournamentId:fixture.tour,handId:hand,
   actorUserId:fixture.actor,sourceRevision:source.sourceRevision,sourceChainHash:source.sourceChainHash,outcomeHash:result.privateOutcome.outcomeHash,correctionReason,expectedEndingStacks,edit:result.persistedEdit})));
  const requestHash=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const commit=`SELECT public.commit_tracker_hand_correction_outcome('${hand}','${fixture.actor}',${source.sourceRevision},${quote(source.sourceChainHash)},${revision},
   ${quote(result.privateOutcome.outcomeHash)},${quote(requestHash)},${quote(key)},${quote(result.publicOutcome)}::jsonb,${quote(result.persistedEdit)}::jsonb,
   ${quote(result.handChanges)}::jsonb,${quote(result.finalStacks)}::jsonb,${quote(correctionReason)});`;
  const resolve=`SELECT public.resolve_tracker_correction_intent_v1('${hand}','${fixture.tour}','${fixture.actor}',${quote(key)},${source.sourceRevision},${quote(source.sourceChainHash)},${quote(result.privateOutcome.outcomeHash)},${quote(requestHash)});`;
  return {commit,resolve,key,source};
 }
 function tx(name,query,hold){const child=spawn(binary,[...prefix,...flags]);let out='',error='';
  const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
  const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(command+';\n');};
  child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='15s';${service}${query}\n`);
  if(!hold)end('COMMIT');return {result,end};
 }
 async function barrier(name,condition){for(let i=0;i<100;i++){
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }assert.fail('actual resolver overlap barrier absent: '+name);}
 const parse=result=>{assert.equal(result.code,0,result.error);return JSON.parse(result.out.split('\n').find(l=>l.startsWith('{')));};
 for(const commitFirst of [true,false]){
  const p=await plan(commitFirst?['5c','6d','7h']:['8c','9d','Th']);
  const suffix=crypto.randomUUID().slice(0,8),hname='corr118_holder_'+suffix,wname='corr118_waiter_'+suffix;
  let holder,waiter;
  try{
   holder=tx(hname,commitFirst?p.commit:p.resolve,true);await barrier(hname,"wait_event='ClientRead' AND xact_start IS NOT NULL");
   waiter=tx(wname,commitFirst?p.resolve:p.commit,false);
   await barrier(wname,`wait_event_type='Lock' AND (SELECT pid FROM pg_stat_activity WHERE application_name='${hname}')=ANY(pg_blocking_pids(pid))`);
   assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND idempotency_key=${quote(p.key)};`),'0','no uncommitted receipt visible');
   holder.end('COMMIT');const h=parse(await holder.result),w=parse(await waiter.result);
   const resolution=commitFirst?w:h,receipt=commitFirst?h:w;
   assert.equal(receipt.ok,true);assert.equal(resolution.status,commitFirst?'receipt_found':'receipt_not_found');
   assert.equal(resolution.current_source_revision,commitFirst?Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`)):p.source.sourceRevision);
   if(!commitFirst)assert.equal(resolution.receipt,null,'resolver-first same revision cannot assert obsolete');
   const retry=JSON.parse(sql(service+p.resolve));assert.equal(retry.status,'receipt_found');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND idempotency_key=${quote(p.key)};`),'1');
   assert.equal(business(),before);
  }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
 }
 console.log('ACTUAL_PAID_CORRECTION_RESOLVER_TWO_SESSION_BOTH_LOCK_ORDERS_PASS');
}
