import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,nextToAct,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';

// Continue the ONE retained configured journey. No hand/seat/stack inserts or
// simultaneous-bust ranking oracle. Native RPC acceptance, not browser proof.
export async function runConfiguredSingleSequential(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const tour='829e61fe-0ac8-4ced-950d-ab76cb8dadc5',actor='a364de8e-06b1-4428-a20d-ac614ec406e5';
 const table='8369beb2-7249-4ca8-9cc1-bc9a41f49f50',sessionId='ffcfe3fb-1a8f-42b5-898d-f36b09756805';
 const winnerId='1c1d8317-d4d9-4ee3-8b8f-6781f4989564';
 const losers=['88416b44-7d2a-4f35-83d1-fe2fcf191e09','79b8765d-b08a-4b98-8504-e5f882c176e9',
  '716b73a8-9e89-4fa8-8610-e31123445bf0','88ba089a-0c1b-4cfe-87cb-71c5db547333','94aa69ff-01da-4920-854d-7e606bf3d16b'];
 assert.equal(sql(`SELECT count(*)||'|'||max(hand_number) FROM public.tournament_hands WHERE tournament_id='${tour}';`),'3|3','partial batch requires explicit resume review, never start over');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND status='in_progress';`),'0');
 assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'7|180000');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='637c2e84-d785-4f68-901e-d001e84a6bc3' AND status='verified' AND source_revision=43;`),'1');
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
 const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
 const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
 const prior=sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');");
 try{
  sql(`INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
  for(const [index,loserId] of losers.entries()){
   const number=index+4;
   const session=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id
    WHERE s.id='${sessionId}' AND t.id='${table}' AND t.tournament_id='${tour}' AND s.closed_at IS NULL;`));
   assert.equal(session.control_mode,'tracker');
   const seats=JSON.parse(sql(`SELECT jsonb_agg(seat_number ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_table_id='${table}' AND is_active;`));
   const previousButton=Number(sql(`SELECT button_seat FROM public.tournament_hands WHERE tournament_id='${tour}' ORDER BY hand_number DESC LIMIT 1;`));
   const button=seats.find(n=>n>previousButton)??seats[0];
   assert.equal(call(`SELECT public.start_tracker_hand_v3('${tour}','${table}','${sessionId}',${session.control_epoch},${number},now(),'${actor}',${button});`).status,'success');
   const hand=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id='${tour}' AND hand_number=${number};`));
   console.log('CONFIGURED_SEQUENTIAL_HAND_STARTED',JSON.stringify({number,hand:hand.id,loser:loserId,button}));
   const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));
   assert.equal(players.length,7-index);
   const winner=players.find(p=>p.player_id===winnerId),loser=players.find(p=>p.player_id===loserId);
   assert.ok(winner&&loser&&winner.starting_stack>loser.starting_stack);
   assert.equal(players.reduce((n,p)=>n+p.starting_stack,0),180000);
   const afterButton=players.filter(p=>p.seat_number>button).concat(players.filter(p=>p.seat_number<=button));
   let order=0;
   const action=(p,type,amount)=>{const r=call(`SELECT public.record_action('${hand.id}','${p.player_id}','${type}',${++order},${p.entry_number},'preflop',${amount});`);assert.equal(r.status,'success',JSON.stringify(r));};
   action(afterButton[0],'post_sb',100);action(afterButton[1],'post_bb',200);
   const deadBlind=[{p:afterButton[0],amount:100},{p:afterButton[1],amount:200}]
    .filter(x=>![winnerId,loserId].includes(x.p.player_id)).reduce((n,x)=>n+x.amount,0);
   const snapshot=()=>call(`SELECT public.get_tracker_voice_validation_snapshot('${tour}','${table}','${hand.id}');`);
   for(let n=0;n<players.length+2;n++){
    const s=snapshot();assert.equal(s.ok,true);const current=nextToAct(s.players,s.actions,s.button_seat);if(!current)break;
    const p=players.find(p=>p.player_id===current),runtime=reduceHand(s.players,s.actions,s.button_seat),live=runtime.players.find(p=>p.player_id===current);
    assert.ok(p&&live);const contender=[winnerId,loserId].includes(current);action(p,contender?'all_in':'fold',contender?live.stack:0);
   }
   assert.equal(isBettingRoundComplete(reduceHand(snapshot().players,snapshot().actions,button)),true);
   for(const [p,cards] of [[winner,['Ac','Kc']],[loser,['4d','4h']]]){
    const s=snapshot(),key='configured-sequential-hole-'+randomUUID();
    const r=JSON.parse(sql(`BEGIN;${service}SELECT public.commit_tracker_voice_hole_cards_v0('${actor}','${tour}','${table}','${hand.id}',
     'openai_realtime','gpt-live-transcribe','${key}','${s.state_version}','${key}','local-configured-sequential',${p.seat_number},${json(cards)});COMMIT;`));assert.equal(r.ok,true,JSON.stringify(r));
   }
   for(const board of [['Tc','Jc','Qc'],['Tc','Jc','Qc','2d'],['Tc','Jc','Qc','2d','3h']]){
    const usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
    const r=JSON.parse(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}${auth}
     SELECT public.update_community_cards('${hand.id}',${json(board)},'${actor}');RESET ROLE;${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));assert.equal(r.status,'success',JSON.stringify(r));
   }
   const s=snapshot(),recorded=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));
   const result=await computeVoiceFinishSettlement({handId:hand.id,stateVersion:s.state_version,buttonSeat:button,communityCards:s.community_cards,
    players:recorded,actions:s.actions,bettingComplete:isBettingRoundComplete(reduceHand(s.players,s.actions,button))});
   assert.equal(result.settlementOrigin,'engine_showdown');assert.equal(result.summary.conservation_total,180000);
   assert.deepEqual(result.recordPlayers.filter(p=>p.is_eliminated).map(p=>p.player_id),[loserId]);
   assert.equal(result.potSize,2*loser.starting_stack+deadBlind);
   assert.equal(result.recordPlayers.find(p=>p.player_id===winnerId).ending_stack,winner.starting_stack+loser.starting_stack+deadBlind);
   const key='configured-sequential-finish-'+randomUUID(),record={hand_number:number,hand_time:hand.created_at,players:result.recordPlayers,
    actions:result.recordActions,side_pots:result.sidePots,community_cards:s.community_cards,pot_size:result.potSize};
   const finish=()=>JSON.parse(sql(`BEGIN;${service}SELECT public.commit_tracker_voice_finish_v0('${actor}','${tour}','${table}','${hand.id}',
    'openai_realtime','gpt-live-transcribe','${key}','ket thuc hand','${s.state_version}','${key}','local-configured-sequential',
    '${result.settlementOrigin}','${result.settlementDigest}',${json(record)});COMMIT;`));
   assert.equal(finish().ok,true);assert.equal(finish().duplicate,true);
   assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),`${6-index}|180000`);
   assert.equal(sql(`SELECT count(*) FROM public.tournament_eliminations WHERE hand_id='${hand.id}';`),'1');
   assert.equal(sql(`SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${tour}';`),'900000');
   console.log('CONFIGURED_SEQUENTIAL_SINGLE_ELIMINATION_PASS',JSON.stringify({number,hand:hand.id,request:key,loser:loserId,winner:winnerId,pot:result.potSize,
    starting:players.map(p=>({player:p.player_id,stack:p.starting_stack})),ending:result.recordPlayers.map(p=>({player:p.player_id,stack:p.ending_stack}))}));
  }
 }finally{
  if(prior==='ABSENT')sql("DELETE FROM public.app_settings WHERE key='tracker_voice_global_enabled';");
  else sql(`UPDATE public.app_settings SET value='${prior.replaceAll("'","''")}'::jsonb WHERE key='tracker_voice_global_enabled';`);
 }
}
