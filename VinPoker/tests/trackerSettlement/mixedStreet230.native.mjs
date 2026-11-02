import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHandAtStreet,nextToActAtStreet,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';

// Explicit canonical regression child, NOT a replacement for either R11 journey.
export async function runMixedStreet230({sql}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const protectedState=()=>sql(`SELECT md5(jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id IN('46cab483-91e7-4220-aacf-e17bdf05269c','4cd3af4d-7e1d-4042-855f-04fb6777e580')),
 'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c),
 'payroll',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payroll_periods p))::text);`);
 const before=protectedState();
 const f=createPaidJourneyFixture(sql,{playerHistoryEnabled:true});
 console.log('MIXED230_CHILD_CREATED',JSON.stringify(f));
 const j=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const call=q=>JSON.parse(sql(`BEGIN;${auth}SELECT ${q};COMMIT;`));
 const table=JSON.parse(sql(`SELECT to_jsonb(t) FROM public.tournament_tables t JOIN public.tournament_seats s ON s.tournament_table_id=t.id AND s.is_active WHERE s.entry_id='${f.entry}';`));
 const other=JSON.parse(sql(`SELECT jsonb_build_object('id',t.id,'revision',s.revision) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.id<>'${table.id}';`));
 assert.equal(call(`public.close_tournament_table_v4('${other.id}',${other.revision},'${randomUUID()}')`).ok,true);
 for(let i=0;i<2;i++){
  const p=randomUUID();sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${p}');INSERT INTO public.profiles(user_id,display_name) VALUES('${p}','Mixed230 TEST ${p.slice(0,8)}');COMMIT;`);
  const r=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;SELECT public.cashier_create_app_registration_v1('${f.tour}','${p}');COMMIT;`));assert.equal(r.ok,true);
  const paid=call(`public.resolve_cashier_cash_buyin_intent_v1(${j({actor_id:f.actor,club_id:f.club,tournament_id:f.tour,registration_id:r.registration_id,amount:100000,request_id:randomUUID()})},'record')`);
  assert.equal(paid.status,'recorded');assert.equal(paid.result.seating_state,'seated');
 }
 assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_table_id='${table.id}' AND is_active;`),'3|60000');
 let s=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${table.table_session_id}';`));
 assert.equal(call(`public.floor_start_tournament_clock('${f.tour}')`).ok,true);
 assert.equal(call(`public.floor_request_table_control_mode_v4('${table.id}','${s.id}','tracker',${s.revision},${s.control_epoch},'${randomUUID()}')`).ok,true);
 s=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${s.id}';`));
 const numbers=JSON.parse(sql(`SELECT jsonb_agg(seat_number ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_table_id='${table.id}' AND is_active;`));
 const hands=[];
 async function play(number,button,sequence,expected,cards){
  const started=call(`public.start_tracker_hand_v3('${f.tour}','${table.id}','${s.id}',${s.control_epoch},${number},now(),'${f.actor}',${numbers[button]})`);assert.equal(started.status,'success',JSON.stringify(started));
  const h=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${started.hand_id}';`));
  const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${h.id}';`));
  console.log('MIXED230_HAND_STARTED',JSON.stringify({id:h.id,number,starting:players.map(p=>p.starting_stack)}));
  const actions=[];let board=[];
  for(const [index,type,amount,street='preflop'] of sequence){
   const p=players[index];
   if(street==='flop'&&board.length===0){board=['2c','3d','7h'];assert.equal(call(`public.update_community_cards('${h.id}',${j(board)},'${f.actor}')`).status,'success');}
   if(!type.startsWith('post_'))assert.equal(nextToActAtStreet(players,actions,h.button_seat,street),p.player_id);
   assert.equal(call(`public.record_action('${h.id}','${p.player_id}','${type}',${actions.length+1},${p.entry_number},'${street}',${amount})`).status,'success');
   actions.push({player_id:p.player_id,entry_number:p.entry_number,action_type:type,action_amount:amount,action_order:actions.length+1,street});
   const state=reduceHandAtStreet(players,actions,h.button_seat,street);
   assert.equal(state.players.reduce((sum,p)=>sum+p.stack+p.total_bet,0),60000);
  }
  if(cards){board=['2c','3d','7h','9s','Tc'];assert.equal(call(`public.update_community_cards('${h.id}',${j(board)},'${f.actor}')`).status,'success');
   const revision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${h.id}';`));
   assert.equal(call(`public.show_tracker_manual_cards_v1('${h.id}','${s.id}',${s.control_epoch},${revision},'${randomUUID()}',${j(players.map((p,i)=>({player_id:p.player_id,entry_number:p.entry_number,hole_cards:cards[i]})))})`).status,'success');
   players.forEach((p,i)=>{p.hole_cards=cards[i];});}
  const state=reduceHandAtStreet(players,actions,h.button_seat,actions.at(-1).street);
  assert.ok(isBettingRoundComplete(state)||state.players.filter(p=>!p.is_folded).length===1);
  const result=await computeVoiceFinishSettlement({handId:h.id,stateVersion:'mixed230',buttonSeat:h.button_seat,communityCards:board,players,actions,bettingComplete:true});
  assert.deepEqual(result.recordPlayers.map(p=>p.ending_stack),expected);
  if(number===2){assert.equal(result.potSize,59900);assert.deepEqual(result.sidePots.map(p=>p.amount),[59700,200]);}
  const intent={actor_id:f.actor,tournament_id:f.tour,tournament_table_id:table.id,table_session_id:s.id,control_epoch:s.control_epoch,hand_id:h.id,
   source_revision:Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${h.id}';`)),request_id:randomUUID(),
   payload:{hand_time:h.hand_time,players:result.recordPlayers,actions:result.recordActions,community_cards:board,side_pots:result.sidePots,pot_size:result.potSize}};
  const receipt=call(`public.record_tracker_manual_hand_v1(${j(intent)})`);assert.equal(receipt.ok,true,JSON.stringify(receipt));
  assert.deepEqual(call(`public.record_tracker_manual_hand_v1(${j(intent)})`),receipt);
  assert.deepEqual(call(`public.get_tracker_manual_finish_receipt_v1(${j(intent)})`),receipt);
  hands.push({id:h.id,number,revision:receipt.committed_source_revision,request:intent.request_id,starting:players.map(p=>p.starting_stack),ending:expected});
 }
 await play(1,2,[[0,'post_sb',100],[1,'post_bb',200],[2,'fold',0],[0,'fold',0]],[19900,20100,20000]);
 await play(2,0,[[1,'post_sb',100],[2,'post_bb',200],[0,'all_in',19900],[1,'call',19800],[2,'call',19700],[1,'bet',100,'flop'],[2,'call',100,'flop']],
  [59700,300,0],[['As','Ad'],['Ks','Kd'],['Qs','Qd']]);
 assert.equal(sql(`SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'300000');
 assert.equal(sql(`SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),'60000');
 // The global cash fingerprint must differ ONLY by this explicit child's three buys.
 const after=sql(`SELECT md5(jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id IN('46cab483-91e7-4220-aacf-e17bdf05269c','4cd3af4d-7e1d-4042-855f-04fb6777e580')),
 'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id<>'${f.tour}'),
 'payroll',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payroll_periods p))::text);`);
 assert.equal(after,before);
 console.log('MIXED230_CANONICAL_TWO_HANDS_RECEIPTS_CONSERVATION_PASS',JSON.stringify({fixture:f,table:table.id,session:s.id,hands,worker:false,browser:false}));
}
