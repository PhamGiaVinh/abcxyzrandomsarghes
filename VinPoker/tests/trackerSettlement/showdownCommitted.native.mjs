// Owned native PG fixture. Actual DB roles/RLS; not GoTrue/AuthHTTP or UI proof.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sql,jsonSql} from '../publicHud/nativeDb.mjs';
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;
assert.ok(['vinpoker_hud_test_showdown_20261107a','vinpoker_hud_test_showdown_20261107b','vinpoker_hud_test_showdown_20261107c'].includes(database));
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),database+'|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-showdown-20261107'+database.at(-1));
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const output=process.env.NATIVE_COMMITTED_SHOWDOWN_REPORT;
assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/showdown-committed-[a-z0-9-]+\.json$/);
assert.equal(existsSync(output),false,'Preserve prior attempt receipts');
const owner='de780000-0000-4000-8000-000000000001',club='de780002-0000-4000-8000-000000000001',tour='de780003-0000-4000-8000-000000000001';
const till='de780004-0000-4000-8000-000000000001',bank='de780005-0000-4000-8000-000000000001',level='de780006-0000-4000-8000-000000000001';
const players=[1,2,3].map(n=>'de780001-0000-4000-8000-'+String(n).padStart(12,'0'));
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const val=v=>v===null?'NULL':typeof v==='object'?q(JSON.stringify(v))+'::jsonb':typeof v==='number'?String(v):q(v);
const report={kind:'OWNED_NATIVE_SELECTED_COMMITTED_SHOWDOWN',database,driverSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),phase:'preflight',checks:{},productionChanged:false,qualification:false,limits:'Dedicated owned clone with no pg_net/cron. Simulated JWT GUC,actual PostgreSQL roles/RLS and canonical RPCs. Not GoTrue/AuthHTTP,Edge,browser or whole tournament prize/closing proof. Selected ante0 unequal-stack threeway AA/KK/QQ board only;not other ante/card-ranking/side-pot combinations.'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const rpc=(actor,role,name,args)=>{
 assert.match(name,/^[a-z][a-z0-9_]+$/);assert.ok(['authenticated','service_role'].includes(role));
 report.lastRpc=name;const params=Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z0-9_]+$/);return k+'=>'+val(v);}).join(',');
 return JSON.parse(sql('\\set VERBOSITY verbose\nBEGIN;SET LOCAL request.jwt.claim.sub='+q(actor)+';SET LOCAL request.jwt.claim.role='+q(role)+';SET LOCAL request.jwt.claims='+q(JSON.stringify({sub:actor,role}))+';SET LOCAL ROLE '+role+';SELECT public.'+name+'('+params+');COMMIT;',{captureFailure:true}));
};
const accepted=r=>{const ok=r?.ok===true||r?.success===true||r?.status==='success'||r?.status==='recorded';if(!ok){const code=r?.error??r?.code;report.denialCode=typeof code==='string'&&/^[A-Za-z_]{3,100}$/.test(code)?code:'unclassified';}assert.ok(ok,'Canonical RPC denied;bounded receipt retains phase only');return r;};
save();
try{
 report.phase='reserved-scenario-scope';save();
 assert.equal(sql("SELECT count(*) FROM public.tournament_hands WHERE tournament_id="+q(tour)+" AND hand_number=880002 AND status='completed';"),'0','Reserved scenario already completed;read retained receipt instead of replaying workload');
 report.phase='fixture-setup';save();
 const present=jsonSql("SELECT jsonb_build_object('club',EXISTS(SELECT 1 FROM public.clubs WHERE id="+q(club)+"),'tour',EXISTS(SELECT 1 FROM public.tournaments WHERE id="+q(tour)+"));");
 if(!present.club&&!present.tour){
  const ids=[owner,...players].map(q).join(',');
  sql([
   "\\set VERBOSITY verbose\nBEGIN;SET LOCAL statement_timeout='15s';",
   "INSERT INTO auth.users(id) SELECT x::uuid FROM unnest(ARRAY["+ids+"])x;",
   "INSERT INTO public.profiles(user_id,display_name) SELECT x::uuid,'Committed showdown TEST '||CASE WHEN x="+q(owner)+" THEN 'owner' ELSE right(x,1) END FROM unnest(ARRAY["+ids+"])x;",
   "INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES("+q(club)+','+q(owner)+",'Committed showdown TEST','HCM','approved');",
   "INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES("+[club,owner,owner].map(q).join(',')+");",
   "INSERT INTO public.club_trackers(club_id,user_id,granted_by) VALUES("+[club,owner,owner].map(q).join(',')+");",
   "INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES("+q(club)+",true) ON CONFLICT(club_id) DO UPDATE SET enabled=true;",
   "INSERT INTO public.platform_bank_accounts(id,club_id,bank_name,account_number,account_holder,is_active) VALUES("+q(bank)+','+q(club)+",'TEST BANK','9991780001','COMMITTED SHOWDOWN TEST',true);",
   "INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by) VALUES("+q(till)+','+q(club)+',0,'+q(owner)+");",
   "INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,free_rake_enabled,free_rake_slots,free_rake_used) VALUES("+q(tour)+','+q(club)+",'Committed showdown TEST','registering','registering',now(),6000000,600000,0,false,0,0);",
   "INSERT INTO public.tournament_levels(id,tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break) VALUES("+q(level)+','+q(tour)+",1,100,200,0,20,false);",
   "UPDATE public.tournaments SET current_level=1,current_level_id="+q(level)+' WHERE id='+q(tour)+';',
   'COMMIT;'
  ].join('\n'),{captureFailure:true});
 }else{
  assert.deepEqual(present,{club:true,tour:true},'Partial setup is not resumable');
  assert.equal(sql("SELECT count(*) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE t.id="+q(tour)+" AND t.name='Committed showdown TEST' AND c.id="+q(club)+' AND c.owner_id='+q(owner)+" AND c.name='Committed showdown TEST';"),'1');
 }
 report.checks.fixtureScope=true;report.phase='canonical-table-open';save();
 const asset=jsonSql("SELECT jsonb_build_object('id',id) FROM public.game_tables WHERE club_id="+q(club)+' AND table_number=1;');
 assert.ok(asset?.id,'Native automatic inventory must supply an owned asset');
 accepted(rpc(owner,'authenticated','floor_open_tournament_table_v3',{p_tournament_id:tour,p_game_table_id:asset.id,p_control_mode:'tracker',p_request_id:'de780007-0000-4000-8000-000000000001'}));
 report.checks.canonicalTableOpen=true;report.phase='canonical-registration-and-payment';save();
 for(let n=0;n<players.length;n++){
  const player=players[n],existing=jsonSql("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM public.tournament_registrations WHERE tournament_id="+q(tour)+' AND player_id='+q(player)+';');
  assert.ok(existing.length<=1,'One reserved first-entry registration per player');
  const registered=existing.length?{registration_id:existing[0].id}:accepted(rpc(player,'service_role','cashier_create_app_registration_v1',{p_tournament_id:tour,p_player_id:player}));
  assert.ok(registered.registration_id);
  const intent={actor_id:owner,club_id:club,tournament_id:tour,registration_id:registered.registration_id,amount:6600000,request_id:'de780008-0000-4000-8000-'+String(n+1).padStart(12,'0')};
  const paid=accepted(rpc(owner,'authenticated','resolve_cashier_cash_buyin_intent_v1',{p_intent:intent,p_action:'record'}));
  assert.equal(paid.result.payment_state,'paid');assert.equal(paid.result.seating_state,'seated');
  assert.deepEqual(rpc(owner,'authenticated','resolve_cashier_cash_buyin_intent_v1',{p_intent:intent,p_action:'record'}),paid);
 }
 const state=jsonSql("SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id="+q(tour)+"),'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id="+q(tour)+" AND is_active),'chips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id="+q(tour)+" AND is_active),'paidMovements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id="+q(tour)+" AND direction='in' AND purpose='buyin'));");
 assert.deepEqual(state,{entries:3,seats:3,chips:60000,paidMovements:3});
 report.checks.canonicalPaidFixture=state;report.phase='paid-fixture-ready';save();
 const table=jsonSql("SELECT jsonb_build_object('id',t.id,'session',s.id,'epoch',s.control_epoch) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id="+q(tour)+" AND t.status='active' AND s.closed_at IS NULL;");
 assert.ok(table?.id&&table.session&&Number.isInteger(table.epoch));
 const readHand=number=>jsonSql("SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.tournament_hands h WHERE tournament_id="+q(tour)+' AND hand_number='+number+';');
 const readPlayers=id=>jsonSql("SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'seat_number',seat_number,'starting_stack',starting_stack,'ending_stack',ending_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id="+q(id)+';');
 const actionRows=id=>jsonSql("SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'street',street,'action_type',action_type,'action_amount',action_amount,'action_order',action_order) ORDER BY action_order),'[]') FROM public.hand_actions WHERE hand_id="+q(id)+';');
 for(let scenario=1;scenario<=2;scenario++){
  const number=880000+scenario;report.phase='hand-'+scenario+'-start';save();
  let rows=readHand(number);assert.ok(rows.length<=1);
  if(!rows.length){
   accepted(rpc(owner,'authenticated','start_tracker_hand_v3',{p_tournament_id:tour,p_tournament_table_id:table.id,p_table_session_id:table.session,p_control_epoch:table.epoch,p_hand_number:number,p_hand_time:new Date().toISOString(),p_created_by:owner,p_button_seat:1}));
   rows=readHand(number);
  }
  assert.equal(rows.length,1);let hand=rows[0];const frozen=readPlayers(hand.id);assert.equal(frozen.length,3);
  assert.equal(hand.table_session_id,table.session);assert.equal(hand.tracker_bba,0);
  const sb=frozen.find(p=>p.seat_number===hand.tracker_sb_position),bb=frozen.find(p=>p.seat_number===hand.tracker_bb_position);
  assert.ok(sb&&bb);assert.equal(hand.tracker_small_blind,100);assert.equal(hand.tracker_big_blind,200);
  const forced=[{player:sb,type:'post_sb',amount:100},{player:bb,type:'post_bb',amount:200}];
  const order=[...frozen].sort((a,b)=>(a.seat_number-bb.seat_number+9)%9-(b.seat_number-bb.seat_number+9)%9);
  // BB acts last, after the first live seat clockwise from BB.
  order.push(order.shift());
  const ranked=[...frozen].sort((a,b)=>a.starting_stack-b.starting_stack);
  if(scenario===2)assert.deepEqual(ranked.map(p=>p.starting_stack),[19900,20000,20100]);
  const rest=scenario===1?order.filter(p=>p.player_id!==bb.player_id).map(player=>({player,type:'fold',amount:0})):
   order.map(player=>({player,type:'all_in',amount:player.starting_stack-forced.filter(a=>a.player.player_id===player.player_id).reduce((n,a)=>n+a.amount,0)}));
  const actions=[...forced,...rest].map((a,n)=>({player_id:a.player.player_id,entry_number:a.player.entry_number,street:'preflop',action_type:a.type,action_amount:a.amount,action_order:n+1}));
  const board=scenario===2?['2c','3d','7h','9s','Tc']:[];
  const pots=scenario===1?[{amount:200,eligible_player_ids:[bb.player_id]}]:
   [{amount:59700,eligible_player_ids:ranked.map(p=>p.player_id)},{amount:200,eligible_player_ids:ranked.slice(1).map(p=>p.player_id)}];
  const endings=scenario===1?new Map(frozen.map(p=>[p.player_id,p.starting_stack+(p.player_id===sb.player_id?-100:p.player_id===bb.player_id?100:0)])):
   new Map(ranked.map((p,n)=>[p.player_id,[59700,200,100][n]]));
  const cards=new Map(scenario===2?ranked.map((p,n)=>[p.player_id,[['As','Ad'],['Ks','Kd'],['Qs','Qd']][n]]):[]);
  if(hand.status!=='completed'){
   report.phase='hand-'+scenario+'-recorded-actions';save();
   for(const a of actions){
    const args={p_hand_id:hand.id,p_player_id:a.player_id,p_action_type:a.action_type,p_action_order:a.action_order,p_entry_number:a.entry_number,p_street:a.street,p_action_amount:a.action_amount,p_idempotency_key:'owned-showdown-'+scenario+'-action-'+a.action_order,p_trace_id:'owned-native-showdown',p_user_id:owner};
    accepted(rpc(owner,'authenticated','record_action',args));
    const replay=accepted(rpc(owner,'authenticated','record_action',args));assert.equal(replay.duplicate,true);
   }
   if(scenario===2){
    report.phase='hand-2-board-and-cards';save();
    accepted(rpc(owner,'authenticated','update_community_cards',{p_hand_id:hand.id,p_community_cards:board,p_user_id:owner}));
    hand=readHand(number)[0];const cardIntent={p_hand_id:hand.id,p_session_id:table.session,p_epoch:table.epoch,p_revision:hand.source_revision,p_request_key:'owned-native-showdown-cards-2',p_cards:frozen.map(p=>({player_id:p.player_id,entry_number:p.entry_number,hole_cards:cards.get(p.player_id)}))};
    const shown=accepted(rpc(owner,'authenticated','show_tracker_manual_cards_v1',cardIntent));
    assert.deepEqual(rpc(owner,'authenticated','show_tracker_manual_cards_v1',cardIntent),shown);
    report.checks.manualCardsExactReplay=true;
   }
   hand=readHand(number)[0];report.phase='hand-'+scenario+'-finish';save();
   const payload={players:frozen.map(p=>({...p,ending_stack:endings.get(p.player_id),is_eliminated:false,side_pots:[],hole_cards:cards.get(p.player_id)??[]})),actions,community_cards:board,side_pots:pots,pot_size:scenario===1?200:59900,hand_time:hand.hand_time};
   const intent={actor_id:owner,request_id:'de780009-0000-4000-8000-'+String(scenario).padStart(12,'0'),tournament_id:tour,tournament_table_id:table.id,hand_id:hand.id,table_session_id:table.session,control_epoch:table.epoch,source_revision:hand.source_revision,payload};
   const committed=accepted(rpc(owner,'authenticated','record_tracker_manual_hand_v1',{p_intent:intent}));
   assert.equal(committed.starting_total,60000);assert.equal(committed.ending_total,60000);
   assert.deepEqual(rpc(owner,'authenticated','record_tracker_manual_hand_v1',{p_intent:intent}),committed);
   assert.deepEqual(rpc(owner,'authenticated','get_tracker_manual_finish_receipt_v1',{p_intent:intent}),committed);
  }
  assert.equal(readHand(number)[0].status,'completed');assert.deepEqual(actionRows(hand.id),actions);
  const ended=readPlayers(hand.id);for(const p of ended)assert.equal(p.ending_stack,endings.get(p.player_id));
  const seats=JSON.parse(sql('BEGIN;'+
   "SET LOCAL request.jwt.claim.sub="+q(owner)+";SET LOCAL request.jwt.claims="+q(JSON.stringify({sub:owner,role:'authenticated'}))+";SET LOCAL ROLE authenticated;"+
   "SELECT jsonb_agg(jsonb_build_object('player',player_id,'chips',chip_count) ORDER BY player_id) FROM public.tournament_seats WHERE tournament_id="+q(tour)+" AND is_active;COMMIT;",{captureFailure:true}));
  assert.equal(seats.length,3);assert.equal(seats.reduce((n,p)=>n+p.chips,0),60000);
  for(const p of seats)assert.equal(p.chips,endings.get(p.player));
  report.checks['committedHand'+scenario]={number,actions:actions.length,pots:pots.map(p=>p.amount),chips:60000,independentAuthenticatedRead:true};save();
 }
 report.phase='selected-committed-showdown-passed';report.passed=true;report.showdown={ante:0,startingStacks:[19900,20000,20100],pots:[59700,200],pot:59900,uncalledRefund:100,endingStacks:[59700,200,100],totalChips:60000};save();
 console.log(JSON.stringify({phase:report.phase,checks:report.checks,productionChanged:false}));
}catch(error){
 report.failedPhase=report.phase;report.phase+='-failed';const diagnostic=String(error.stderr??'');report.sqlstate=diagnostic.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]??null;report.constraint=diagnostic.match(/constraint \"([a-zA-Z0-9_]+)\"/)?.[1]??null;report.contextFunctions=[...diagnostic.matchAll(/PL\/pgSQL function ([a-zA-Z_][a-zA-Z0-9_.]*)\(/g)].map(m=>m[1]);report.errorSha256=createHash('sha256').update(String(error.stderr??error.message??'unknown')).digest('hex');save();
 throw Error('Owned showdown fixture failed;inspect bounded phase receipt');
}
