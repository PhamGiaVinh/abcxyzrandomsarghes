import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,nextToAct,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';

// One actual two-contender showdown; other seats fold. No simultaneous ranking
// assumption, hand insertion, stack rewrite or invented settlement totals.
export async function runConfiguredSingleShowdown(sql,{resume=false}={}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const f={tour:'829e61fe-0ac8-4ced-950d-ab76cb8dadc5',club:'349ecf35-50ba-4c71-a581-15dc45f1cd01',actor:'a364de8e-06b1-4428-a20d-ac614ec406e5'};
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${f.tour}';`),resume?'2':'1','resume a partial hand instead of starting another');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND status='in_progress';`),resume?'1':'0');
 const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
 const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
 const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
 const table='8369beb2-7249-4ca8-9cc1-bc9a41f49f50';
 let session=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id
  WHERE t.id='${table}' AND t.tournament_id='${f.tour}' AND s.closed_at IS NULL;`));
 assert.equal(session.control_mode,resume?'tracker':'manual');
 if(!resume)assert.equal(call(`SELECT public.floor_request_table_control_mode_v4('${table}','${session.id}','tracker',${session.revision},${session.control_epoch},'${randomUUID()}');`).ok,true);
 session=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${session.id}';`));
 const prior=sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');");
 try{
  sql(`INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
   UPDATE public.tracker_voice_configs SET enabled=true,table_session_id='${session.id}',control_epoch=${session.control_epoch},configured_mode='assist'
   WHERE tournament_id='${f.tour}' AND tournament_table_id='${table}';`);
  const button=Number(sql(`SELECT min(seat_number) FROM public.tournament_seats WHERE tournament_table_id='${table}' AND is_active;`));
  if(!resume)assert.equal(call(`SELECT public.start_tracker_hand_v3('${f.tour}','${table}','${session.id}',${session.control_epoch},2,now(),'${f.actor}',${button});`).status,'success');
  const hand=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id='${f.tour}' AND hand_number=2;`));
  if(resume){assert.equal(hand.id,'a6624773-e132-410f-9460-c73ff2c88088');assert.equal(hand.status,'in_progress');assert.deepEqual(hand.community_cards,['Tc','Jc','Qc','2d','3h']);}
  console.log(resume?'CONFIGURED_SINGLE_SHOWDOWN_RESUMED':'CONFIGURED_SINGLE_SHOWDOWN_STARTED',JSON.stringify({tour:f.tour,hand:hand.id,session:session.id}));
  const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));
  assert.equal(players.length,4);
  const winner=[...players].sort((a,b)=>b.starting_stack-a.starting_stack)[0],loser=players.find(p=>p.player_id===f.actor);
  assert.ok(loser&&winner.player_id!==loser.player_id&&winner.starting_stack>loser.starting_stack);
  const snapshot=()=>call(`SELECT public.get_tracker_voice_validation_snapshot('${f.tour}','${table}','${hand.id}');`);
  let order=0;
  const action=(p,type,amount)=>{const r=call(`SELECT public.record_action('${hand.id}','${p.player_id}','${type}',${++order},${p.entry_number},'preflop',${amount});`);assert.equal(r.status,'success',JSON.stringify(r));};
  if(!resume){
  action(players[1],'post_sb',100);action(players[2],'post_bb',200);
  for(let n=0;n<8;n++){
   const s=snapshot();assert.equal(s.ok,true);const actor=nextToAct(s.players,s.actions,s.button_seat);if(!actor)break;
   const p=players.find(p=>p.player_id===actor),runtime=reduceHand(s.players,s.actions,s.button_seat),live=runtime.players.find(p=>p.player_id===actor);
   assert.ok(p&&live);action(p,[winner.player_id,loser.player_id].includes(actor)?'all_in':'fold',[winner.player_id,loser.player_id].includes(actor)?live.stack:0);
  }
  let s=snapshot();assert.equal(isBettingRoundComplete(reduceHand(s.players,s.actions,s.button_seat)),true);
  for(const [p,cards] of [[winner,['Ac','Kc']],[loser,['4d','4h']]]){
   s=snapshot();const key='configured-single-hole-'+randomUUID();
   const r=JSON.parse(sql(`BEGIN;${service}SELECT public.commit_tracker_voice_hole_cards_v0('${f.actor}','${f.tour}','${table}','${hand.id}',
    'openai_realtime','gpt-live-transcribe','${key}','${s.state_version}','${key}','local-configured-single',${p.seat_number},${q(cards)});COMMIT;`));assert.equal(r.ok,true,JSON.stringify(r));
  }
  for(const board of [['Tc','Jc','Qc'],['Tc','Jc','Qc','2d'],['Tc','Jc','Qc','2d','3h']]){
   const usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
   const r=JSON.parse(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}${auth}
    SELECT public.update_community_cards('${hand.id}',${q(board)},'${f.actor}');RESET ROLE;${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));assert.equal(r.status,'success',JSON.stringify(r));
  }
  }
  const s=snapshot();const recordedPlayers=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));
  const result=await computeVoiceFinishSettlement({handId:hand.id,stateVersion:s.state_version,buttonSeat:s.button_seat,
   communityCards:s.community_cards,players:recordedPlayers,actions:s.actions,bettingComplete:isBettingRoundComplete(reduceHand(s.players,s.actions,s.button_seat))});
  assert.equal(result.settlementOrigin,'engine_showdown');assert.equal(result.summary.conservation_total,80000);
  assert.deepEqual(result.recordPlayers.filter(p=>p.is_eliminated).map(p=>p.player_id),[f.actor]);
  const key='configured-single-finish-'+randomUUID(),record={hand_number:2,hand_time:hand.created_at,players:result.recordPlayers,actions:result.recordActions,
   side_pots:result.sidePots,community_cards:s.community_cards,pot_size:result.potSize};
  const finish=()=>JSON.parse(sql(`BEGIN;${service}SELECT public.commit_tracker_voice_finish_v0('${f.actor}','${f.tour}','${table}','${hand.id}',
   'openai_realtime','gpt-live-transcribe','${key}','ket thuc hand','${s.state_version}','${key}','local-configured-single',
   '${result.settlementOrigin}','${result.settlementDigest}',${q(record)});COMMIT;`));
  const receipt=finish();assert.equal(receipt.ok,true,JSON.stringify(receipt));assert.equal(finish().duplicate,true);
  assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'7|160000');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_eliminations WHERE hand_id='${hand.id}';`),'1');
  assert.equal(sql(`SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'800000');
  console.log('CONFIGURED_SINGLE_ONE_ELIMINATION_SHOWDOWN_COMMIT_PASS',JSON.stringify({tour:f.tour,hand:hand.id,winner:winner.player_id,loser:f.actor,request:key,pot:result.potSize,players:result.recordPlayers}));
 }finally{
  if(prior==='ABSENT')sql("DELETE FROM public.app_settings WHERE key='tracker_voice_global_enabled';");
  else sql(`UPDATE public.app_settings SET value='${prior.replaceAll("'","''")}'::jsonb WHERE key='tracker_voice_global_enabled';`);
 }
}
