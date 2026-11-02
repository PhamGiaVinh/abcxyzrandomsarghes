import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHandAtStreet,nextToActAtStreet,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';

// Independent canonical regression child. NOT either required whole-tour UAT.
export async function runMultiple113({sql}) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const mainBefore=sql("SELECT md5(jsonb_build_object('h',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),'e',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),'c',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'))::text);");
 const f=createPaidJourneyFixture(sql,{playerHistoryEnabled:true});
 console.log('MULTIPLE113_NEW_CANONICAL_CHILD',JSON.stringify(f));
 const quote=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
 const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
 const call=q=>JSON.parse(sql(`BEGIN;${auth}SELECT ${q};COMMIT;`));
 const table=JSON.parse(sql(`SELECT to_jsonb(t) FROM public.tournament_tables t JOIN public.tournament_seats s ON s.tournament_table_id=t.id AND s.is_active WHERE s.entry_id='${f.entry}';`));
 const other=JSON.parse(sql(`SELECT jsonb_build_object('id',t.id,'revision',s.revision) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.id<>'${table.id}';`));
 assert.equal(call(`public.close_tournament_table_v4('${other.id}',${other.revision},'${randomUUID()}')`).ok,true);
 for(let n=0;n<3;n++){
  const player=randomUUID();sql(`INSERT INTO auth.users(id) VALUES('${player}');INSERT INTO public.profiles(user_id,display_name) VALUES('${player}','Multiple113 paid TEST ${n+2}');`);
  const registered=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;SELECT public.cashier_create_app_registration_v1('${f.tour}','${player}');COMMIT;`));assert.equal(registered.ok,true);
  const paid=call(`public.resolve_cashier_cash_buyin_intent_v1(${quote({actor_id:f.actor,club_id:f.club,tournament_id:f.tour,registration_id:registered.registration_id,amount:100000,request_id:randomUUID()})},'record')`);
  assert.equal(paid.status,'recorded');assert.equal(paid.result.seating_state,'seated');
 }
 assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_table_id='${table.id}' AND is_active;`),'4|80000');
 let session=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${table.table_session_id}';`));
 assert.equal(call(`public.floor_start_tournament_clock('${f.tour}')`).ok,true);
 assert.equal(call(`public.floor_request_table_control_mode_v4('${table.id}','${session.id}','tracker',${session.revision},${session.control_epoch},'${randomUUID()}')`).ok,true);
 session=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${session.id}';`));
 const seats=JSON.parse(sql(`SELECT jsonb_agg(seat_number ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_table_id='${table.id}' AND is_active;`));assert.equal(seats.length,4);
 const cashBefore=sql(`SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}';`);
 const hands=[];
 async function play(number,buttonIndex,sequence,boardSteps=[],cards=null,expected){
  const started=call(`public.start_tracker_hand_v3('${f.tour}','${table.id}','${session.id}',${session.control_epoch},${number},now(),'${f.actor}',${seats[buttonIndex]})`);assert.equal(started.status,'success',JSON.stringify(started));
  const hand=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${started.hand_id}';`));
  const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand.id}';`));assert.equal(players.length,4);
  console.log('MULTIPLE113_HAND_STARTED',JSON.stringify({number,hand:hand.id,starting:players.map(p=>p.starting_stack)}));
  const actions=[];let board=[];
  for(const [index,type,amount,street='preflop']of sequence){
   const p=players[index],step=boardSteps.find(b=>b.street===street);
   if(step&&board.length!==step.cards.length){board=step.cards;const r=call(`public.update_community_cards('${hand.id}',${quote(board)},'${f.actor}')`);assert.equal(r.status,'success',JSON.stringify(r));}
   if(!type.startsWith('post_'))assert.equal(nextToActAtStreet(players,actions,hand.button_seat,street),p.player_id,'wrong action order in native scenario');
   const r=call(`public.record_action('${hand.id}','${p.player_id}','${type}',${actions.length+1},${p.entry_number},'${street}',${amount})`);assert.equal(r.status,'success',JSON.stringify(r));
   actions.push({player_id:p.player_id,entry_number:p.entry_number,action_type:type,action_amount:amount,action_order:actions.length+1,street});
   const state=reduceHandAtStreet(players,actions,hand.button_seat,street);
   assert.equal(state.players.reduce((sum,p)=>sum+p.stack+p.total_bet,0),80000,'chip conservation after action');
  }
  const lastBoard=boardSteps.at(-1)?.cards;
  if(lastBoard&&board.length!==lastBoard.length){board=lastBoard;assert.equal(call(`public.update_community_cards('${hand.id}',${quote(board)},'${f.actor}')`).status,'success');}
  if(cards){
   const rev=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand.id}';`));
   const r=call(`public.show_tracker_manual_cards_v1('${hand.id}','${session.id}',${session.control_epoch},${rev},'${randomUUID()}',${quote(players.map((p,i)=>({player_id:p.player_id,entry_number:p.entry_number,hole_cards:cards[i]})))})`);assert.equal(r.status,'success',JSON.stringify(r));
   players.forEach((p,i)=>{p.hole_cards=cards[i];});
  }
  const state=reduceHandAtStreet(players,actions,hand.button_seat,actions.at(-1).street);assert.ok(isBettingRoundComplete(state)||state.players.filter(p=>!p.is_folded).length===1);
  const result=await computeVoiceFinishSettlement({handId:hand.id,stateVersion:'native113',buttonSeat:hand.button_seat,communityCards:board,players,actions,bettingComplete:true});
  assert.deepEqual(result.recordPlayers.map(p=>p.ending_stack),expected,'independent hand ending-stack oracle');
  if(number===3){assert.equal(result.potSize,79799);assert.deepEqual(result.sidePots.map(p=>p.amount),[78396,1203,200]);}
  const intent={actor_id:f.actor,tournament_id:f.tour,tournament_table_id:table.id,table_session_id:session.id,control_epoch:session.control_epoch,hand_id:hand.id,source_revision:Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand.id}';`)),request_id:randomUUID(),payload:{hand_time:hand.hand_time,players:result.recordPlayers,actions:result.recordActions,community_cards:board,side_pots:result.sidePots,pot_size:result.potSize}};
  console.log('MULTIPLE113_FINISH_INTENT_READY',JSON.stringify({number,hand:hand.id,key:intent.request_id,revision:intent.source_revision}));
  const receipt=call(`public.record_tracker_manual_hand_v1(${quote(intent)})`);assert.equal(receipt.ok,true,JSON.stringify(receipt));
  assert.deepEqual(call(`public.get_tracker_manual_finish_receipt_v1(${quote(intent)})`),receipt);
  assert.deepEqual(call(`public.record_tracker_manual_hand_v1(${quote(intent)})`),receipt);
  const parity=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(p.ending_stack,e.current_stack,s.chip_count,c.chip_count) ORDER BY p.seat_number) FROM public.hand_players p JOIN public.tournament_entries e ON e.tournament_id='${f.tour}' AND e.player_id=p.player_id AND e.entry_no=p.entry_number JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE p.hand_id='${hand.id}';`));
  assert.deepEqual(parity,expected.map(v=>[v,v,v,v]));assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}';`),cashBefore);
  hands.push({number,id:hand.id,key:intent.request_id,revision:receipt.committed_source_revision,starting:players.map(p=>p.starting_stack),ending:expected,pot:result.potSize});
 }
 await play(1,0,[[1,'post_sb',100],[2,'post_bb',200],[3,'fold',0],[0,'fold',0],[1,'fold',0]],[],null,[20000,19900,20100,20000]);
 await play(2,3,[[0,'post_sb',100],[1,'post_bb',200],[2,'fold',0],[3,'fold',0],[0,'call',100],[1,'check',0],[0,'check',0,'flop'],[1,'bet',201,'flop'],[0,'call',201,'flop'],[0,'check',0,'turn'],[1,'bet',200,'turn'],[0,'fold',0,'turn']],[{street:'flop',cards:['2c','3d','7h']},{street:'turn',cards:['2c','3d','7h','9s']}],null,[19599,20301,20100,20000]);
 await play(3,0,[[1,'post_sb',100],[2,'post_bb',200],[3,'all_in',20000],[0,'all_in',19599],[1,'all_in',20201],[2,'all_in',19900]],[{street:'river',cards:['2c','3d','7h','9s','Tc']}],[['As','Ad'],['Qs','Qd'],['Kh','Kc'],['Ks','Kd']],[78396,201,802,601]);
 assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${f.club}' AND auto_swing_enabled;`),'0');
 assert.equal(sql("SELECT md5(jsonb_build_object('h',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),'e',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),'c',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'))::text);"),mainBefore);
 console.log('MULTIPLE113_CANONICAL_THREE_HANDS_THREE_POTS_ODD_CHIP_FINISH_PARITY_RECEIPTS_PASS',JSON.stringify({fixture:f,table:table.id,session:session.id,hands,oracle:{pots:[78396,1203,200],refund:201,oddChipSeat:seats[2],ending:[78396,201,802,601]},browser:false,worker:false}));
}
