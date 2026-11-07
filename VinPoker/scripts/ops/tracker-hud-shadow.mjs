// Offline read-only certification. Never called by a spectator request and
// never enables readers, changes jobs, or stores raw player/hand data.
// Set explicit PGHOST/PGPORT/PGUSER/PGDATABASE and a fresh
// TRACKER_HUD_SHADOW_REPORT path. Production additionally requires SSL and
// --production-read-only. A PASS binds one source snapshot to the classifier
// and SQL hashes; reassess queued changes before separately approved activation.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function loadClassifier(){
 const result=await build({entryPoints:[resolve(root,'supabase/functions/_shared/publicHudContribution.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
 const text=result.outputFiles[0].text;
 return {...await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64')),shadowClassifierSha256:createHash('sha256').update(text).digest('hex')};
}
const fields=['numerators','denominators','missingProof'];
function fromStored(row){return {numerators:row.numerators,denominators:row.denominators,missingProof:row.missing_proof,
 publicHands:row.public_hands,handsObserved:row.observed_hands,omittedHands:row.omitted_hands};}
export function normalizeSource(row){
 if(!row.hand)return null;
 const proof=row.proof;
 const valid=proof?.schemaVersion==='settlement-outcome-v1'&&proof.status==='verified'
  &&Array.isArray(proof.pots)&&Array.isArray(proof.handRanks)
  &&proof.pots.every(p=>Array.isArray(p?.winnerIds))&&proof.handRanks.every(r=>typeof r?.playerId==='string');
 return {...row.hand,settlement:valid?{verified:true,current:true,
  winnerPlayerIds:[...new Set(proof.pots.flatMap(p=>p.winnerIds))],eligiblePlayerIds:proof.handRanks.map(r=>r.playerId),showdown:proof.handRanks.length>=2}:null};
}
export function createShadow(classifier){
 const players=new Map(),tours=new Map();
 const report={kind:'READ_ONLY_RAW_SOURCE_SHADOW_NOT_LOAD_TEST',complete:false,passed:false,snapshot:null,version:classifier.PUBLIC_HUD_PROJECTION_VERSION,classifierSha256:classifier.shadowClassifierSha256,sqlSha256:createHash('sha256').update(shadowSql).digest('hex'),
  sourceHands:0,contributions:0,results:0,playerTotals:0,tournamentTotals:0,mismatches:0,examples:[]};
 let header=false,end=false;
 function mismatch(code,key){report.mismatches++;if(report.examples.length<20)report.examples.push({code,entityHash:createHash('sha256').update(String(key)).digest('hex')});}
 function check(actual,expected,code,key){try{assert.deepEqual(actual,expected);}catch{mismatch(code,key);}}
 function total(map,key){if(!map.has(key))map.set(key,{...classifier.emptyPublicHudCounters(),winnings:0n,resultCount:0});return map.get(key);}
 function add(target,row){for(const field of fields)row[field].forEach((n,i)=>{target[field][i]+=n;});
  for(const field of ['publicHands','handsObserved','omittedHands'])target[field]+=row[field];classifier.validatePublicHudCounters(target);}
 function compareTotal(map,key,row,global){const expected=map.get(key)??{...classifier.emptyPublicHudCounters(),winnings:0n,resultCount:0};
  const {winnings,resultCount,...counters}=expected;check(fromStored(row),counters,global?'player_counters':'tour_counters',key);
  if(global){check(String(row.winnings),winnings.toString(),'winnings',key);check(row.result_count,resultCount,'result_count',key);}
  else check(row.included,row.publicEligible,'tour_visibility',key);
  map.delete(key);
 }
 return {report,accept(row){
  if(row.kind==='header'){
   assert.ok(!header);header=true;report.snapshot=row.snapshot;
   assert.equal(row.readOnly,true);assert.equal(row.isolation,'repeatable read');
   assert.equal(row.version,classifier.PUBLIC_HUD_PROJECTION_VERSION);
   assert.equal(row.backfillComplete,true);assert.equal(row.handsDone,true);assert.equal(row.resultsDone,true);
   assert.equal(row.pendingJobs,0);assert.equal(row.barriers,0);return;
  }
  assert.ok(header&&!end);
  if(row.kind==='hand'){
   report.sourceHands+=row.hand?1:0;
   const source=normalizeSource(row),expected=source?classifier.classifyPublicHudHand(source):[];
   const stored=row.projected;report.contributions+=stored.length;
   check(stored.map(c=>c.player_id).sort(),expected.map(c=>c.playerId).sort(),'hand_player_coverage',row.id);
   for(const c of expected){
    const actual=stored.find(s=>s.player_id===c.playerId);const {playerId,...counters}=c;
    if(actual){check(fromStored(actual),counters,'hand_counters',row.id);
     check({played_at:actual.played_at,hand_number:actual.hand_number,table_id:actual.table_id,session_id:actual.session_id},row.metadata,'hand_history_metadata',row.id);
     check(actual.settlement_evidence,row.evidence,'hand_settlement_evidence',row.id);
     check([actual.tournament_id,String(actual.source_revision),actual.source_fingerprint],
      [row.tournamentId,String(row.sourceRevision),row.fingerprint],'hand_source_identity',row.id);}
    const scoped=total(tours,JSON.stringify([row.tournamentId,playerId]));add(scoped,counters);
    if(row.publicEligible)add(total(players,playerId),counters);
   }
  }else if(row.kind==='result'){
   report.results++;const {verified_by_admin,...sourceResult}=row.source??{};
   const expected=verified_by_admin?sourceResult:null;
   check(row.projected,expected,'result_contribution',row.id);
   if(expected){const value=total(players,expected.player_id);value.winnings+=BigInt(expected.prize);value.resultCount++;}
  }else if(row.kind==='tour'){
   report.tournamentTotals++;compareTotal(tours,JSON.stringify([row.value.tournament_id,row.value.player_id]),row.value,false);
  }else if(row.kind==='player'){
   report.playerTotals++;compareTotal(players,row.value.player_id,row.value,true);
  }else if(row.kind==='end'){
   end=true;for(const [key,value]of tours)if(value.publicHands)mismatch('missing_tour_total',key);
   for(const [key,value]of players)if(value.publicHands||value.resultCount)mismatch('missing_player_total',key);
   report.complete=true;report.passed=report.mismatches===0;
  }else throw Error('Unknown shadow record');
 },finish(){assert.ok(header&&end,'Incomplete source stream');return report;}};
}

export const shadowSql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60min';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT jsonb_build_object('kind','header','snapshot',pg_current_snapshot()::text,'database',current_database(),'serverVersion',current_setting('server_version_num')::int,'serverAddress',inet_server_addr()::text,
 'currentUser',current_user,'databaseComment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'version',version,'backfillComplete',backfill_complete,'handsDone',hands_done,'resultsDone',results_done,
 'pendingJobs',(SELECT count(*) FROM tracker_analytics_v1.jobs),'barriers',(SELECT count(*) FROM tracker_analytics_v1.visibility_barriers))
 FROM tracker_analytics_v1.config WHERE singleton;
SELECT jsonb_build_object('kind','hand','id',ids.id,'tournamentId',h.tournament_id,'sourceRevision',h.source_revision::text,
 'fingerprint',tracker_analytics_v1.hand_fingerprint(ids.id),
 'metadata',jsonb_build_object('played_at',h.hand_time,'hand_number',h.hand_number,'table_id',h.tournament_table_id,'session_id',h.table_session_id),
 'evidence',jsonb_build_object('policyEligible',EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=h.tournament_id AND t.deleted_at IS NULL AND t.status IN ('live','final_table','completed','finished')),
  'latest',(SELECT jsonb_build_object('sourceRevision',o.source_revision::text,'settlementRevision',o.settlement_revision::text,'status',o.status,'schemaVersion',o.public_outcome->>'schemaVersion') FROM public.tournament_settlement_outcomes o WHERE o.hand_id=ids.id ORDER BY o.settlement_revision DESC,o.id DESC LIMIT 1),
  'publicVerified',(SELECT jsonb_build_object('sourceRevision',o.source_revision::text,'settlementRevision',o.settlement_revision::text,'status',o.status,'schemaVersion',o.public_outcome->>'schemaVersion') FROM public.tournament_settlement_outcomes o WHERE o.hand_id=ids.id AND o.source_revision=h.source_revision AND o.status='verified' ORDER BY o.settlement_revision DESC,o.id DESC LIMIT 1)),
 'publicEligible',EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=h.tournament_id AND t.deleted_at IS NULL),
 'hand',CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object('handId',h.id,'status',h.status,'isVoided',coalesce(h.is_voided,false),
  'buttonSeat',h.button_seat,'boardCardCount',jsonb_array_length(coalesce(to_jsonb(h.community_cards),'[]'::jsonb)),
  'players',(SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',p.player_id,'seat_number',p.seat_number,'starting_stack',p.starting_stack) ORDER BY p.seat_number,p.player_id,p.entry_number),'[]') FROM public.hand_players p WHERE p.hand_id=h.id AND p.tournament_id=h.tournament_id),
  'actions',(SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',a.player_id,'street',a.street,'action_type',a.action_type,'action_amount',a.action_amount,'action_order',a.action_order) ORDER BY a.action_order,a.id),'[]') FROM public.hand_actions a WHERE a.hand_id=h.id)) END,
 'proof',CASE WHEN h.id IS NOT NULL THEN public.get_public_tournament_settlement(h.id) END,
 'projected',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=ids.id AND c.version=(SELECT version FROM tracker_analytics_v1.config WHERE singleton)))
 FROM (SELECT id FROM public.tournament_hands UNION SELECT hand_id FROM tracker_analytics_v1.hand_contributions WHERE version=(SELECT version FROM tracker_analytics_v1.config WHERE singleton)) ids
 LEFT JOIN public.tournament_hands h ON h.id=ids.id ORDER BY ids.id;
SELECT jsonb_build_object('kind','result','id',ids.id,
 'source',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('player_id',r.player_id,'verified_by_admin',r.verified_by_admin,'prize',r.prize::text,'tournament_name',r.tournament_name,'event_date',r.event_date,'position',r.position,'total_entries',r.total_entries) END,
 'projected',(SELECT jsonb_build_object('player_id',c.player_id,'prize',c.prize::text,'tournament_name',c.tournament_name,'event_date',c.event_date,'position',c.position,'total_entries',c.total_entries) FROM tracker_analytics_v1.result_contributions c WHERE c.result_id=ids.id AND c.version=(SELECT version FROM tracker_analytics_v1.config WHERE singleton)))
 FROM (SELECT id FROM public.player_results UNION SELECT result_id FROM tracker_analytics_v1.result_contributions WHERE version=(SELECT version FROM tracker_analytics_v1.config WHERE singleton)) ids LEFT JOIN public.player_results r ON r.id=ids.id ORDER BY ids.id;
SELECT jsonb_build_object('kind','tour','value',to_jsonb(t)||jsonb_build_object('publicEligible',EXISTS(SELECT 1 FROM public.tournaments s WHERE s.id=t.tournament_id AND s.deleted_at IS NULL))) FROM tracker_analytics_v1.tournament_totals t WHERE version=(SELECT version FROM tracker_analytics_v1.config WHERE singleton);
SELECT jsonb_build_object('kind','player','value',to_jsonb(p)||jsonb_build_object('winnings',p.winnings::text)) FROM tracker_analytics_v1.player_totals p WHERE version=(SELECT version FROM tracker_analytics_v1.config WHERE singleton);
SELECT '{"kind":"end"}'::jsonb;ROLLBACK;`;

export function validateShadowTarget(row,env,local){
 assert.equal(row.database,env.PGDATABASE);assert.equal(row.currentUser,'postgres');
 assert.ok(row.serverVersion>=170000&&row.serverVersion<180000);
 if(!local)return 'exact-production-ssl-read-only';
 if(row.serverAddress==='127.0.0.1/32')return 'native-loopback';
 // Actions' postgres:17 service is published on client loopback but PostgreSQL
 // sees its container interface. Require the exact workflow-created database
 // and marker as well as the CLI's existing loopback host/port validation.
 assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.PGPORT,'5432');
 assert.equal(env.PGDATABASE,'vinpoker_hud_test_ci');
 assert.equal(row.databaseComment,'vinpoker-hud-shadow-isolated-ci');
 return 'marked-isolated-actions-container';
}

async function main(){
 const env=process.env,db=env.PGDATABASE;
 assert.equal(env.PGUSER,'postgres');
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!env[key]);
 const local=env.PGHOST==='127.0.0.1'&&(env.PGPORT==='55441'||env.GITHUB_ACTIONS==='true'&&env.PGPORT==='5432')&&/^vinpoker_hud_test_[a-z0-9_]+$/.test(db??'');
 const production=process.argv.includes('--production-read-only')&&env.PGHOST==='db.orlesggcjamwuknxwcpk.supabase.co'&&env.PGPORT==='5432'&&db==='postgres'&&env.PGSSLMODE==='require';
 assert.ok(local||production,'Exact read-only target required');
 assert.ok(env.TRACKER_HUD_SHADOW_REPORT,'Nonsecret report destination required');
 const shadow=createShadow(await loadClassifier());
 const windows=process.platform==='win32'&&local;
 const args=['-w','-X','-qAt','-v','ON_ERROR_STOP=1','-v','FETCH_COUNT=100'];
 const child=spawn(windows?'wsl':'psql',windows?['-d','PokerVision-P16-4C-Eval','--','env',`PGHOST=${env.PGHOST}`,`PGPORT=${env.PGPORT}`,`PGUSER=${env.PGUSER}`,`PGDATABASE=${db}`,'psql',...args]:args,{env,stdio:['pipe','pipe','pipe']});
 // Consume diagnostics privately without retaining raw SQL/rows/credentials.
 child.stderr.resume();
 const done=new Promise((resolve,reject)=>{child.on('error',()=>reject(Error('Shadow database process unavailable')));child.on('close',code=>resolve(code));});
 child.stdin.on('error',()=>{});child.stdin.end(shadowSql);
 try{for await(const line of createInterface({input:child.stdout}))if(line.trim()){
   const row=JSON.parse(line);
   if(row.kind==='header')shadow.report.target=validateShadowTarget(row,env,local);
   shadow.accept(row);
  }
  assert.equal(await done,0,'Read-only shadow transaction failed');shadow.finish();
 }catch{child.kill();await done;shadow.report.complete=false;shadow.report.passed=false;}
 writeFileSync(env.TRACKER_HUD_SHADOW_REPORT,JSON.stringify(shadow.report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(shadow.report));if(!shadow.report.passed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Shadow certification failed; no activation was performed');process.exitCode=1;});
