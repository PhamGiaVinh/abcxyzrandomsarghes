// Actual server verifier -> actual PostgreSQL commit -> serialized resolution.
// Owned synthetic hand; not an HTTP/provider/browser or production test.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {webcrypto,createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {buildSync} from 'esbuild';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_history99_verified');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const bundle=buildSync({stdin:{contents:`export {verifyHistoricalDisplaySettlement} from './supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts';export {canonicalJsonV1} from './supabase/functions/_shared/trackerSettlement/outcomeV1.ts';`,resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node'});
const module={exports:{}};
runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),crypto:webcrypto,TextEncoder,TextDecoder,console});
const {verifyHistoricalDisplaySettlement,canonicalJsonV1}=module.exports;
const args=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','psql','-h','127.0.0.1','-p','55441','-U','postgres','-d',process.env.PGDATABASE,'-w','-X','-qAt','-v','ON_ERROR_STOP=1']:['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const command=process.platform==='win32'?'wsl':'psql';
function sql(input){const r=spawnSync(command,args,{input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND inet_server_addr()='127.0.0.1'::inet AND current_database()='vinpoker_ops_history99_verified';"),'t');
const hand='86000000-0000-4000-8000-000000000001',tour='85000000-0000-4000-8000-000000000001',actor='81100000-0000-4000-8000-000000000001';
const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const parse=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')));
const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
function tx(name,query,hold=false){
 const child=spawn(command,args);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';${query}\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(name,condition){for(let i=0;i<100;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(done=>setTimeout(done,25));}assert.fail(`missing actual overlap ${name}`);}
const conserved=()=>sql("SELECT jsonb_build_object('seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e));");
const before=conserved();
sql(`BEGIN;SET LOCAL statement_timeout='15s';
 DELETE FROM public.hand_actions WHERE hand_id='${hand}';
 UPDATE public.tournament_hands SET status='completed',is_voided=false,button_seat=1,community_cards='["2c","3d","4h","5s","9c"]'::jsonb,pot_size=200,side_pots='[]'::jsonb,
 tracker_level_id=coalesce(tracker_level_id,'85500000-0000-4000-8000-000000000001'),tracker_level_number=1,tracker_small_blind=50,tracker_big_blind=100,tracker_bba=0,tracker_is_break=false WHERE id='${hand}';
 WITH p AS(SELECT id,row_number()OVER(ORDER BY seat_number) n FROM public.hand_players WHERE hand_id='${hand}')
 UPDATE public.hand_players hp SET starting_stack=30000,ending_stack=CASE WHEN p.n=1 THEN 30100 ELSE 29900 END,
 hole_cards=CASE WHEN p.n=1 THEN '["As","Kd"]'::jsonb ELSE '["Qs","Qc"]'::jsonb END,is_eliminated=false FROM p WHERE p.id=hp.id;
 INSERT INTO public.hand_actions(id,hand_id,player_id,entry_number,street,action_type,action_amount,action_order)
 SELECT gen_random_uuid(),hand_id,player_id,entry_number,'preflop',CASE WHEN row_number()OVER(ORDER BY seat_number)=1 THEN 'bet' ELSE 'call' END,
 100,row_number()OVER(ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${hand}';COMMIT;`);
for(const commitFirst of [true,false]){
 // Touch an outcome-relevant field to obtain a new source generation without
 // changing the intended stacks or poker evidence between the two cases.
 sql(`UPDATE public.tournament_hands SET hand_number=hand_number+1 WHERE id='${hand}';`);
 const snapshot=parse(sql(`SELECT public.get_tracker_historical_display_snapshot('${hand}','${tour}');`));
 const settlementRevision=Number(sql(`SELECT coalesce(max(settlement_revision),0)+1 FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';`));
 const verified=await verifyHistoricalDisplaySettlement({tournamentId:tour,hand:snapshot.hand,players:snapshot.players,actions:snapshot.actions,
  sourceRevision:snapshot.sourceRevision,sourceChainHash:snapshot.sourceChainHash,settlementRevision});
 assert.equal(verified.publicOutcome.players.reduce((sum,p)=>sum+p.endingStack,0),60000);
 const outcomeHash=verified.privateOutcome.outcomeHash,key=`history99-verified-${randomUUID()}`;
 const requestHash=createHash('sha256').update(canonicalJsonV1({contract:'historical-settlement-display-v1',tournamentId:tour,handId:hand,
  sourceRevision:snapshot.sourceRevision,sourceChainHash:snapshot.sourceChainHash,outcomeHash})).digest('hex');
 const call=`SELECT public.commit_tracker_historical_display_outcome_v2('${hand}','${actor}','owner_admin',${snapshot.sourceRevision},'${snapshot.sourceChainHash}',
 '${outcomeHash}','${requestHash}','${key}',${json(verified.publicOutcome)},NULL);`;
 const resolve=`SELECT public.resolve_tracker_historical_display_intent_v1('${hand}','${tour}','${actor}','${key}',${snapshot.sourceRevision},'${snapshot.sourceChainHash}','${outcomeHash}');`;
 let holder,waiter;
 try{
  holder=tx('history99_verified_holder',service+(commitFirst?call:resolve),true);
  await barrier('history99_verified_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx('history99_verified_waiter',service+(commitFirst?resolve:call));
  await barrier('history99_verified_waiter',"wait_event_type='Lock'");
  holder.end('COMMIT');const first=await holder.result,last=await waiter.result;
  assert.equal(first.code,0,first.error);assert.equal(last.code,0,last.error);
  assert.equal(parse(commitFirst?first.out:last.out).ok,true);
  assert.equal(parse(commitFirst?last.out:first.out).status,commitFirst?'receipt_found':'receipt_not_found');
  const recovered=parse(sql(`BEGIN;${service}${resolve}COMMIT;`));assert.equal(recovered.status,'receipt_found');
  assert.equal(recovered.receipt.source_revision,snapshot.sourceRevision);
  const published=JSON.parse(sql(`BEGIN;SET LOCAL ROLE anon;SELECT public.get_public_tournament_settlement('${hand}');COMMIT;`));
  assert.equal(published.status,'verified');
  assert.deepEqual(published.players,JSON.parse(JSON.stringify(verified.publicOutcome.players)));
  assert.deepEqual(published.pots,JSON.parse(JSON.stringify(verified.publicOutcome.pots)));
  assert.equal(published.outcomeHash,undefined,'public RPC must not expose its internal proof hash');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE idempotency_key='${key}';`),'1');
  sql(`UPDATE public.tournament_hands SET hand_number=hand_number+1 WHERE id='${hand}';`);
  const past=parse(sql(`BEGIN;${service}${resolve}COMMIT;`));assert.equal(past.status,'receipt_found');
  assert.ok(past.current_source_revision>snapshot.sourceRevision);
  const invalidated=JSON.parse(sql(`BEGIN;SET LOCAL ROLE anon;SELECT public.get_public_tournament_settlement('${hand}');COMMIT;`));
  assert.notEqual(invalidated?.status,'verified','correction revived prior public outcome');
  const replay=parse(sql(`BEGIN;${service}${call}COMMIT;`));assert.equal(replay.idempotent,true);
  assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE idempotency_key='${key}';`),'1');
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
assert.equal(conserved(),before,'display verification changed live seats or entries');
console.log('HISTORY99_ACTUAL_VERIFIER_COMMIT_RESOLUTION_BOTH_ORDER_RECEIPT_REPLAY_PASS');
