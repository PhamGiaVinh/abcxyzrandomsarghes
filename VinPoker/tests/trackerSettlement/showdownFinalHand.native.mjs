// Continuation of the owned committed-showdown fixture. No source-row repairs.
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from '../publicHud/nativeDb.mjs';
const db=process.env.PUBLIC_HUD_LOCAL_DATABASE;
assert.ok(['vinpoker_hud_test_showdown_20261107a','vinpoker_hud_test_showdown_20261107b','vinpoker_hud_test_showdown_20261107c','vinpoker_hud_test_showdown_20261107d','vinpoker_hud_test_showdown_20261107e','vinpoker_hud_test_showdown_20261107f'].includes(db));
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),db+'|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-showdown-20261107'+db.at(-1));
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const output=process.env.NATIVE_FINAL_HAND_REPORT;
assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/showdown-final-hand-[a-z0-9-]+\.json$/);
assert.equal(existsSync(output),false);
const owner='de780000-0000-4000-8000-000000000001',tour='de780003-0000-4000-8000-000000000001';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const val=v=>v===null?'NULL':typeof v==='object'?q(JSON.stringify(v))+'::jsonb':typeof v==='number'?String(v):q(v);
const report={phase:'preflight',passed:false,productionChanged:false,limits:'Owned native PostgreSQL roles/RLS and canonical RPCs. Not AuthHTTP, browser, successful prize payment or tour close.'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const rpc=(name,args)=>{
 assert.match(name,/^[a-z][a-z0-9_]+$/);report.lastRpc=name;save();
 const params=Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z0-9_]+$/);return k+'=>'+val(v);}).join(',');
 const result=JSON.parse(sql('\\set VERBOSITY verbose\nBEGIN;SET LOCAL request.jwt.claim.sub='+q(owner)+';SET LOCAL request.jwt.claims='+q(JSON.stringify({sub:owner,role:'authenticated'}))+';SET LOCAL ROLE authenticated;SELECT public.'+name+'('+params+');COMMIT;',{captureFailure:true}));
 if(!(result?.ok===true||result?.success===true||['success','recorded'].includes(result?.status))){report.denial=typeof result?.error==='string'&&/^[a-z_]+$/.test(result.error)?result.error:'unclassified';save();assert.fail('Canonical RPC denied');}return result;
};
save();
try{
 assert.equal(sql("SELECT count(*) FROM public.tournament_hands WHERE tournament_id="+q(tour)+" AND hand_number=880003;"),'0','One-shot continuation; preserve completed attempts');
 const pre=jsonSql("SELECT jsonb_agg(chip_count ORDER BY chip_count) FROM public.tournament_seats WHERE tournament_id="+q(tour)+" AND is_active;");assert.deepEqual(pre,[100,200,59700]);
 if(!db.endsWith('b'))assert.equal(sql("SELECT count(*) FROM public.club_settings WHERE club_id='de780002-0000-4000-8000-000000000001' AND player_history_enabled;"),'1','History-enabled continuation requires explicit fixture configuration before the hand');
 const table=jsonSql("SELECT jsonb_build_object('id',t.id,'session',s.id,'epoch',s.control_epoch) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id="+q(tour)+" AND t.status='active' AND s.closed_at IS NULL;");assert.ok(table?.id);
 report.phase='start';save();
 rpc('start_tracker_hand_v3',{p_tournament_id:tour,p_tournament_table_id:table.id,p_table_session_id:table.session,p_control_epoch:table.epoch,p_hand_number:880003,p_hand_time:new Date().toISOString(),p_created_by:owner,p_button_seat:1});
 const read=()=>jsonSql("SELECT to_jsonb(h) FROM public.tournament_hands h WHERE tournament_id="+q(tour)+" AND hand_number=880003;");
 let hand=read();assert.equal(hand.tracker_bba,0);
 const players=jsonSql("SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'seat_number',seat_number,'starting_stack',starting_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id="+q(hand.id)+';');assert.equal(players.length,3);
 const sb=players.find(p=>p.seat_number===hand.tracker_sb_position),bb=players.find(p=>p.seat_number===hand.tracker_bb_position);assert.ok(sb&&bb);
 const forced=[{p:sb,type:'post_sb',amount:Math.min(100,sb.starting_stack)},{p:bb,type:'post_bb',amount:Math.min(200,bb.starting_stack)}];
 const order=[...players].sort((a,b)=>(a.seat_number-bb.seat_number+9)%9-(b.seat_number-bb.seat_number+9)%9);order.push(order.shift());
 const actions=[...forced,...order.map(p=>({p,type:'all_in',amount:p.starting_stack-forced.filter(a=>a.p.player_id===p.player_id).reduce((n,a)=>n+a.amount,0)})).filter(a=>a.amount>0)].map((a,n)=>({player_id:a.p.player_id,entry_number:a.p.entry_number,street:'preflop',action_type:a.type,action_amount:a.amount,action_order:n+1}));
 report.phase='actions';save();for(const a of actions){const args={p_hand_id:hand.id,p_player_id:a.player_id,p_action_type:a.action_type,p_action_order:a.action_order,p_entry_number:a.entry_number,p_street:a.street,p_action_amount:a.action_amount,p_idempotency_key:'owned-final-hand-action-'+a.action_order,p_trace_id:'owned-native-final-hand',p_user_id:owner};rpc('record_action',args);assert.equal(rpc('record_action',args).duplicate,true);}
 const board=['2c','3d','7h','9s','Tc'];rpc('update_community_cards',{p_hand_id:hand.id,p_community_cards:board,p_user_id:owner});hand=read();
 const ranked=[...players].sort((a,b)=>b.starting_stack-a.starting_stack),winner=ranked[0].player_id;
 const cards=new Map(ranked.map((p,n)=>[p.player_id,[['As','Ad'],['Ks','Kd'],['Qs','Qd']][n]]));
 const cardIntent={p_hand_id:hand.id,p_session_id:table.session,p_epoch:table.epoch,p_revision:hand.source_revision,p_request_key:'owned-final-hand-cards',p_cards:players.map(p=>({player_id:p.player_id,entry_number:p.entry_number,hole_cards:cards.get(p.player_id)}))};const shown=rpc('show_tracker_manual_cards_v1',cardIntent);assert.deepEqual(rpc('show_tracker_manual_cards_v1',cardIntent),shown);hand=read();
 const pots=[{amount:300,eligible_player_ids:players.map(p=>p.player_id)},{amount:200,eligible_player_ids:ranked.slice(0,2).map(p=>p.player_id)}];
 const payload={players:players.map(p=>({...p,ending_stack:p.player_id===winner?60000:0,is_eliminated:p.player_id!==winner,side_pots:[],hole_cards:cards.get(p.player_id)})),actions,community_cards:board,side_pots:pots,pot_size:500,hand_time:hand.hand_time};
 const intent={actor_id:owner,request_id:'de780009-0000-4000-8000-000000000003',tournament_id:tour,tournament_table_id:table.id,hand_id:hand.id,table_session_id:table.session,control_epoch:table.epoch,source_revision:hand.source_revision,payload};
 report.phase='finish';save();const finish=rpc('record_tracker_manual_hand_v1',{p_intent:intent});assert.equal(finish.starting_total,60000);assert.equal(finish.ending_total,60000);assert.deepEqual(rpc('record_tracker_manual_hand_v1',{p_intent:intent}),finish);assert.deepEqual(rpc('get_tracker_manual_finish_receipt_v1',{p_intent:intent}),finish);
 const state=jsonSql("SELECT jsonb_build_object('status',(SELECT status FROM public.tournament_hands WHERE id="+q(hand.id)+"),'stacks',(SELECT jsonb_agg(ending_stack ORDER BY ending_stack) FROM public.hand_players WHERE hand_id="+q(hand.id)+"),'eliminated',(SELECT count(*) FROM public.hand_players WHERE hand_id="+q(hand.id)+" AND is_eliminated));");assert.deepEqual(state,{status:'completed',stacks:[0,0,60000],eliminated:2});report.state=state;report.phase='final-hand-committed';report.passed=true;save();console.log(JSON.stringify(report));
}catch(error){report.failedPhase=report.phase;report.phase='failed';const stderr=String(error.stderr??'');report.sqlstate=stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]??null;save();console.log(JSON.stringify(report));process.exitCode=1;}
