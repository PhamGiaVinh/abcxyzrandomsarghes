// Real canonical Start/Action/Finish and engine settlement, synthetic setup,
// one outer rollback on the owned clone. Not a paid/browser/Voice-provider E2E.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
assert.equal(process.env.VINPOKER_RANKING869_LOCAL,'1');
const clone='vinpoker_ranking860_local',primary='vinpoker_ops_cash115_qualified_c';
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(db,input)=>execFileSync('wsl',args(db),{input,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const json=v=>quote(JSON.stringify(v))+'::jsonb';
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,'SELECT package_hash FROM floor_private.ranking860_install_backup;'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['public.tournaments','public.tournament_entries','public.tournament_seats','public.tournament_hands','public.hand_players','public.hand_actions','public.tournament_eliminations','public.tournament_chip_counts','public.tournament_close_report','public.cashier_buyin_movements','public.tournament_prize_payments','public.game_tables','public.table_sessions','public.tournament_tables','public.table_operation_receipts','floor_private.tracker_hand_seat_snapshots193'];
const proof=db=>sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SELECT md5(jsonb_build_array(${[...tables,...(db===clone?['floor_private.tournament_ranking_reviews296']:[])].map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM ${t} r)`).join(',')},(SELECT count(*) FROM auth.users WHERE id='fa869000-0000-4000-8000-000000000011'))::text);ROLLBACK;`);
const beforePrimary=proof(primary),beforeClone=proof(clone);
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',tab='d294f4a4-082b-4efc-a6ca-1f96579ea344',session='ee2b9393-0c96-42f9-8667-7f306edeb9bc',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const extra='fa869000-0000-4000-8000-000000000011',extraEntry='fa869000-0000-4000-8000-000000000021',extraSeat='fa869000-0000-4000-8000-000000000031';
const child=spawn('wsl',args(clone),{stdio:['pipe','pipe','pipe'],timeout:60000});let output='',errors='',terminal=false;
child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;resolve(code);});});
const until=async marker=>{const deadline=Date.now()+15000;while(!output.includes(marker)){assert.ok(!terminal,errors);assert.ok(Date.now()<deadline,`869 barrier ${marker} unavailable: ${errors}`);await new Promise(r=>setTimeout(r,50));}};
let phaseError;
try{
 child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';SET LOCAL idle_in_transaction_session_timeout='30s';
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';
 DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='${tour}' AND status='in_progress');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL);
 ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${extra}');
 END $$;
 -- Synthetic preparation: rebalance the retained 60K test chips, no issuance.
 UPDATE public.tournament_seats SET chip_count=20000 WHERE tournament_id='${tour}' AND is_active;
 UPDATE public.tournament_entries e SET current_stack=20000 WHERE id IN(SELECT entry_id FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active);
 UPDATE public.tournament_chip_counts c SET chip_count=20000 WHERE tournament_id='${tour}' AND EXISTS(SELECT 1 FROM public.tournament_seats s WHERE s.tournament_id=c.tournament_id AND s.player_id=c.player_id AND s.entry_number=c.entry_number AND s.is_active);
 INSERT INTO auth.users(id) VALUES('${extra}');
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,current_stack,status,source,seat_number)
 VALUES('${extraEntry}','${tour}','${extra}',1,20000,'seated','manual',3);
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,seat_number,chip_count,entry_id,status,player_name,tournament_table_id,table_session_id)
 VALUES('${extraSeat}','${tour}','${extra}',1,3,20000,'${extraEntry}','active','TEST869 third seat','${tab}','${session}');
 INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count) VALUES('${tour}','${extra}',1,20000);
 UPDATE public.tournaments SET registration_closed_at=now() WHERE id='${tour}';
 DO $$ DECLARE s public.table_sessions;h uuid;r jsonb;n int;BEGIN
 SELECT * INTO s FROM public.table_sessions WHERE id='${session}';ASSERT s.closed_at IS NULL AND s.control_mode='tracker';
 SELECT max(hand_number)+1 INTO n FROM public.tournament_hands WHERE tournament_id='${tour}';
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3('${tour}','${tab}','${session}',s.control_epoch,n,now(),'${actor}',1);ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);h:=(r->>'hand_id')::uuid;PERFORM set_config('test.ranking869.hand',h::text,true);
 END $$;
 SELECT jsonb_build_object('hand',(SELECT current_setting('test.ranking869.hand')),'epoch',(SELECT control_epoch FROM public.table_sessions WHERE id='${session}'),
 'players',(SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'seat_number',seat_number,'starting_stack',starting_stack,'hole_cards',CASE seat_number WHEN 1 THEN '["As","Ah"]'::jsonb WHEN 2 THEN '["Ks","Kh"]'::jsonb ELSE '["Qs","Qh"]'::jsonb END) ORDER BY seat_number) FROM public.hand_players WHERE hand_id=current_setting('test.ranking869.hand')::uuid));
 SELECT 'RANK869_STARTED';\n`);
 await until('RANK869_STARTED');
 const context=JSON.parse(output.split(/\r?\n/).find(x=>x.startsWith('{')));
 const {players,hand,epoch}=context;assert.equal(players.length,3);
 const actions=[{seat:2,type:'post_sb',amount:100},{seat:3,type:'post_bb',amount:200},{seat:1,type:'all_in',amount:20000},{seat:2,type:'all_in',amount:19900},{seat:3,type:'all_in',amount:19800}].map((a,index)=>({player_id:players.find(p=>p.seat_number===a.seat).player_id,entry_number:players.find(p=>p.seat_number===a.seat).entry_number,street:'preflop',action_type:a.type,action_amount:a.amount,action_order:index+1}));
 const board=['2c','3d','7h','8s','9c'];
 const settlement=await computeVoiceFinishSettlement({handId:hand,stateVersion:'869-canonical-rollback',buttonSeat:1,communityCards:board,players,actions,bettingComplete:true});
 assert.equal(settlement.potSize,60000);assert.deepEqual(settlement.recordPlayers.map(p=>p.ending_stack),[60000,0,0]);
 child.stdin.write(`SET LOCAL ROLE authenticated;
 ${actions.map(a=>`DO $$ DECLARE r jsonb;BEGIN r:=public.record_action('${hand}','${a.player_id}','${a.action_type}',${a.action_order},${a.entry_number},'preflop',${a.action_amount});ASSERT r->>'status'='success',r::text;END $$;`).join('\n')}
 SELECT public.update_community_cards('${hand}',${json(board)},'${actor}');
 RESET ROLE;
 SELECT jsonb_build_object('revision',source_revision) FROM public.tournament_hands WHERE id='${hand}';SELECT 'RANK869_ACTIONS_READY';\n`);
 await until('RANK869_ACTIONS_READY');
 const revision=output.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse).find(x=>Object.hasOwn(x,'revision')).revision;
 const intent={actor_id:actor,request_id:randomUUID(),tournament_id:tour,tournament_table_id:tab,hand_id:hand,table_session_id:session,control_epoch:epoch,source_revision:revision,payload:{hand_time:new Date().toISOString(),players:settlement.recordPlayers,actions:settlement.recordActions,community_cards:board,side_pots:settlement.sidePots,pot_size:settlement.potSize}};
 child.stdin.write(`DO $$ DECLARE r jsonb;source jsonb;review jsonb;expected jsonb;ids uuid[];BEGIN
 PERFORM set_config('role','authenticated',true);
 r:=public.record_tracker_manual_hand_v1(${json(intent)});ASSERT r->>'ok'='true',r::text;expected:=r;
 r:=public.record_tracker_manual_hand_v1(${json(intent)});ASSERT r=expected,'869 canonical Finish replay differs';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT status='completed' FROM public.tournament_hands WHERE id='${hand}');
 ASSERT (SELECT count(*)=2 FROM public.tournament_eliminations WHERE hand_id='${hand}');
 ASSERT (SELECT count(*)=3 AND sum(starting_stack)=60000 AND sum(ending_stack)=60000 AND count(*) FILTER(WHERE is_eliminated)=2 FROM public.hand_players WHERE hand_id='${hand}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL),'869 auto-finalizer prematurely ranked same-hand busts';
 source:=floor_private.tournament_ranking_source296('${tour}');
 ASSERT source->>'requiresReview'='true' AND source->>'evidencePending'='false' AND source->>'activeHand'='false' AND source->>'survivors'='1',source::text;
 r:=public.finalize_tournament_results('${tour}');ASSERT r->>'error'='manual_ranking_review_required',r::text;
 -- Choose a Floor order explicitly, independent of participant SQL ordering.
 ASSERT source->>'field'='4','869 retained unrelated bust must remain in the final field';
 SELECT array_agg((e->>'entryId')::uuid ORDER BY CASE WHEN e->>'playerId'='${players[1].player_id}' THEN 2 WHEN e->>'playerId'='${extra}' THEN 3 ELSE ord END)
 INTO ids FROM jsonb_array_elements(source->'entries') WITH ORDINALITY x(e,ord);
 PERFORM set_config('role','authenticated',true);
 RAISE NOTICE 'RANK869_SOURCE_ORDER:%',jsonb_build_object('field',source->'field','entries',(SELECT jsonb_agg(jsonb_build_object('entry',e->'entryId','player',e->'playerId','number',e->'entryNo','status',e->'status')) FROM jsonb_array_elements(source->'entries')e),'proposed',to_jsonb(ids));
 review:=public.confirm_tournament_ranking_review_v1('${tour}',source->>'sourceHash',ids,gen_random_uuid(),'${actor}');ASSERT review->>'outcome'='recorded',review::text;
 PERFORM set_config('role','none',true);
 -- Real void/restore invalidates this review; subtransaction keeps the
 -- completed hand available for the subsequent finalized-order assertion.
 BEGIN
  PERFORM set_config('role','authenticated',true);
  r:=public.void_last_hand('${hand}');ASSERT r->>'status'='success',r::text;
  PERFORM set_config('role','none',true);
  ASSERT (SELECT is_voided FROM public.tournament_hands WHERE id='${hand}');
  ASSERT (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active);
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_eliminations WHERE hand_id='${hand}');
  PERFORM set_config('role','authenticated',true);
  r:=public.get_tournament_ranking_review_v1('${tour}');ASSERT r->'review'='null'::jsonb,r::text;
  r:=public.get_tournament_ranking_review_receipt_v1('${tour}',(review->'review'->>'request_id')::uuid,'${actor}');
  ASSERT r->>'outcome'='recorded' AND r->>'sourceCurrent'='false',r::text;
  PERFORM set_config('role','none',true);
  r:=public.finalize_tournament_results('${tour}');ASSERT r->>'error'='tournament_not_finished',r::text;
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL);
  RAISE SQLSTATE 'PZ869';
 EXCEPTION WHEN SQLSTATE 'PZ869' THEN NULL;
 END;
 ASSERT (SELECT status='completed' AND NOT coalesce(is_voided,false) FROM public.tournament_hands WHERE id='${hand}');
 r:=public.finalize_tournament_results('${tour}');ASSERT r->>'ranking_review'='true',r::text;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id=ANY(ids) AND finished_place IS DISTINCT FROM array_position(ids,id));
 RAISE NOTICE 'RANK869_CANONICAL_START_ACTION_FINISH_REPLAY_TWO_BUSTS_MANUAL_REVIEW_FINALIZE_PASS';
 END $$;
 SET CONSTRAINTS ALL IMMEDIATE;
 SELECT 'RANK869_VERIFIED';ROLLBACK;\n`);child.stdin.end();
 const code=await done;assert.equal(code,0,errors);assert.ok(output.includes('RANK869_VERIFIED'),errors);
 console.log('RANK869_CANONICAL_FINISH_MANUAL_REVIEW_PASS',JSON.stringify({hand,request:intent.request_id,actions:5,pot:60000,stacks:[60000,0,0],twoBustRows:true,manualOrderRequired:true,voidRestoresAndInvalidatesReview:true,outerRollback:true}));
}catch(error){phaseError=error;throw error;}
finally{
 if(!child.stdin.writableEnded)child.stdin.end('ROLLBACK;\n');await done;
 try{assert.equal(proof(clone),beforeClone,'869 clone rollback changed protected data');assert.equal(proof(primary),beforePrimary,'869 primary changed');console.log('RANK869_CLONE_AND_PRIMARY_PROTECTED_ROLLBACK_PASS');}
 catch(error){if(!phaseError)throw error;console.error('RANK869_POSTCHECK_FAILED',error.message);}
}
