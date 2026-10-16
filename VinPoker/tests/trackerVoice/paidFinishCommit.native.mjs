import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';
import {buildVoiceFinishCanonicalRequest} from '../../src/lib/trackerVoice/canonicalRequest.ts';

// Durable isolated SQL/engine/client proof. No hosted HTTP/Auth/provider/browser.
assert.equal(process.env.VINPOKER_NATIVE_VOICE_FINISH,'1');
const database='vinpoker_ops_cash115_qualified_c';
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const quote=value=>`'${(typeof value==='object'?JSON.stringify(value):String(value)).replaceAll("'","''")}'`;
const f=createPaidJourneyFixture(sql);
const table=JSON.parse(sql(`SELECT to_jsonb(t) FROM public.tournament_tables t JOIN public.tournament_seats s ON s.tournament_table_id=t.id WHERE s.entry_id='${f.entry}' AND s.is_active;`));
const floorActor=crypto.randomUUID();
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
const globalBefore=sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');");
try{
 // Reuse the existing paid registration/open/Voice setup exactly, not a second fixture writer.
 const journey=readFileSync(new URL('./runtimeApiPayload.test.mjs',import.meta.url),'utf8');
 const start='const payload=JSON.parse(sql(`',end=" INSERT INTO native_voice_payloads VALUES('owner_active'";
 assert.equal(journey.split(start).length,2);assert.equal(journey.split(end).length,2);
 const setup=journey.split(start)[1].split(end)[0];
 sql(runInNewContext('`'+setup+'COMMIT;`',{f,table,floorActor}));
 const hand=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND status='in_progress';`);
 assert.match(hand,/^[0-9a-f-]{36}$/);
 const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand}';`));
 assert.equal(players.length,2);
 for(const [player,type,order,amount] of [[players[0],'post_sb',1,100],[players[1],'post_bb',2,200],[players[0],'fold',3,0]]){
  const r=JSON.parse(sql(`BEGIN;${auth}SELECT public.record_action('${hand}','${player.player_id}','${type}',${order},${player.entry_number},'preflop',${amount});COMMIT;`));
  assert.equal(r.status,'success');
 }
 const snapshot=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}','${hand}');COMMIT;`));
 assert.equal(snapshot.ok,true);
 const runtime=reduceHand(snapshot.players,snapshot.actions,snapshot.button_seat);
 assert.equal(runtime.players.filter(p=>!p.is_folded).length,1);
 const settlement=await computeVoiceFinishSettlement({handId:hand,stateVersion:snapshot.state_version,buttonSeat:snapshot.button_seat,
  communityCards:snapshot.community_cards,players,actions:snapshot.actions,bettingComplete:isBettingRoundComplete(runtime)});
 assert.equal(settlement.settlementOrigin,'engine_fold_win');assert.equal(settlement.summary.conservation_total,40000);
 const handRow=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}';`));
 const record={hand_number:handRow.hand_number,hand_time:handRow.created_at,players:settlement.recordPlayers,actions:settlement.recordActions,
  side_pots:settlement.sidePots,community_cards:snapshot.community_cards,pot_size:settlement.potSize};
 const key='native-finish-'+crypto.randomUUID(),trace='native-finish-trace';
 const cashBefore=sql(`SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}';`);
 const invoke=traceId=>sql(`BEGIN;${service}SELECT public.commit_tracker_voice_finish_v0('${f.actor}','${f.tour}','${table.id}','${hand}',
 'openai_realtime','gpt-live-transcribe','${key}','ket thuc hand','${snapshot.state_version}','${key}','${traceId}',
 '${settlement.settlementOrigin}','${settlement.settlementDigest}',${quote(record)}::jsonb);COMMIT;`);
 const receipt=JSON.parse(invoke(trace));assert.equal(receipt.ok,true);
 const committedFingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE hand_id='${hand}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'))::text);`);
 const committedBeforeReplay=committedFingerprint();
 // Fresh connection after actual COMMIT, same identity: immutable replay, no second finish.
 const replay=JSON.parse(invoke('native-finish-retry'));
 assert.deepEqual(replay,{...receipt,duplicate:true});
 assert.equal(committedFingerprint(),committedBeforeReplay);
 const canonicalRequest=await buildVoiceFinishCanonicalRequest({rawTranscript:'ket thuc hand',expectedStateVersion:snapshot.state_version,
  payload:{settlementOrigin:settlement.settlementOrigin,settlementDigest:settlement.settlementDigest}});
 const source=readFileSync(new URL('../../src/lib/trackerVoice/api.ts',import.meta.url),'utf8'),tree=parseSync(source,{syntax:'typescript'});
 const fn=tree.body.find(n=>n.type==='ExportDeclaration'&&n.declaration.identifier?.value==='commitTrackerVoiceFinish').declaration;
 const body=Buffer.from(source).subarray(fn.span.start-tree.span.start,fn.span.end-tree.span.start).toString()
  .replace('const { supabase } = await import("@/integrations/supabase/client");','const supabase = client;');
 const code=transformSync(body+'\ncommitTrackerVoiceFinish;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
 let calls=0;
 for(const result of [receipt,replay]){
  const commit=runInNewContext(code,{Error,client:{functions:{invoke:async()=>{calls++;return {data:{data:result},error:null};}}}});
  assert.equal(await commit({tournamentId:f.tour,tournamentTableId:table.id,handId:hand,expectedStateVersion:snapshot.state_version,
   idempotencyKey:key,traceId:trace,canonicalRequest}),result);
 }
 assert.equal(calls,2);
 assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${hand}';`),'completed');
 assert.equal(sql(`SELECT count(*) FROM public.tracker_voice_events WHERE hand_id='${hand}' AND event_kind='canonical_receipt';`),'1');
 assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}';`),cashBefore);
 assert.equal(Number(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`)),40000);
 for(const expected of settlement.recordPlayers){
  assert.equal(Number(sql(`SELECT chip_count FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND player_id='${expected.player_id}' AND is_active;`)),expected.ending_stack);
  assert.equal(Number(sql(`SELECT current_stack FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND player_id='${expected.player_id}' AND entry_no=${expected.entry_number};`)),expected.ending_stack);
 }
 console.log('NATIVE_PAID_ENGINE_FINISH_COMMIT_REPLAY_CLIENT_PASS');
}finally{
 if(globalBefore==='ABSENT')sql("DELETE FROM public.app_settings WHERE key='tracker_voice_global_enabled';");
 else sql(`UPDATE public.app_settings SET value=${quote(globalBefore)}::jsonb WHERE key='tracker_voice_global_enabled';`);
 assert.equal(sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');"),globalBefore);
}
