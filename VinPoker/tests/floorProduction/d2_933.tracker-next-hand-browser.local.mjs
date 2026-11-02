// Full initial D2 draw from the same two-flight SUM_STACKS fixture. No fixture
// or feature gate survives the outer transaction; this is native SQL, not E2E.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {isManualFinishIntent,manualFinishReceiptMatches} from '../../src/lib/trackerManualFinish.ts';
import {reconcileSidePots} from '../../supabase/functions/_shared/trackerEngine/validateAction.ts';

assert.equal(process.env.VINPOKER_D2_933_LOCAL,'1');
const source=readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql','utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const marker=' FOR i IN 1..3 LOOP\n  seat_result:=';
const cut=source.indexOf(marker);
assert.ok(cut>0 && source.indexOf(marker,cut+1)<0,'fixture boundary drift');
const request=randomUUID();
const sql=source.slice(0,cut)+`
 PERFORM set_config('role','authenticated',true);
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(snap->'players')x WHERE x->>'state'='UNSEATED'),'not eight unseated';
 ASSERT (SELECT count(*)=3 FROM jsonb_array_elements(snap->'tables')x WHERE x->>'blocker' IS NULL),'table blockers before draw';
 plan:=public.multi_day_plan_initial_draw_v1(event,selected,snap->>'sourceHash','${request}'::uuid);
 ASSERT plan->>'state'='PLANNED' AND jsonb_array_length(plan->'assignments')=8,plan::text;
 p:=(plan->>'planId')::uuid;
 applied:=public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 ASSERT applied->>'state'='APPLIED' AND jsonb_array_length(applied->'seatReceipts')=8,applied::text;
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(snap->'players')x WHERE x->>'state'='SEATED'),'not eight seated';
 ASSERT (SELECT count(*)=8 AND sum(current_stack)=320000 FROM public.tournament_entries WHERE tournament_id=final),'entry/stack mismatch';
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=320000 FROM public.tournament_seats WHERE tournament_id=final AND is_active),'seat/chip mismatch';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=8 FROM public.multi_day_final_seatings_v1 WHERE final_tournament_id=final),'saved final seating mismatch';
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true);
 r:=public.get_public_tournament_redraw_v1(final);
 PERFORM set_config('role','none',true);
 ASSERT r->>'kind'='initial_d2' AND jsonb_array_length(r->'moves')=8,r::text;
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(r->'moves')m
  JOIN public.tournament_tables t ON t.tournament_id=final AND t.table_number=(m->>'to_table_number')::integer
  JOIN public.tournament_seats s ON s.tournament_id=final AND s.tournament_table_id=t.id
   AND s.seat_number=(m->>'to_seat_number')::integer AND s.is_active),'TV/seat mismatch';
 state:=r;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 recorded:=public.floor_continue_tournament_redraw_v1(p,(state->>'redraw_revision')::bigint,gen_random_uuid());
 ASSERT recorded->>'ok'='true' AND (recorded->>'redraw_revision')::integer=2,recorded::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=0 FROM public.table_sessions WHERE tournament_id=final AND redraw_hold_batch_id=p),'hold not cleared';
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=sessions[1];
 r:=public.get_public_tournament_redraw_v1(final);
 ASSERT r->>'batch_id' IS NULL AND r->'moves'='[]'::jsonb,'TV not cleared';
 UPDATE public.tournaments SET current_level=1 WHERE id=final;
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break)
 VALUES(final,1,100,200,0,false);
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_request_table_control_mode_v4(selected[1],sessions[1],'tracker',rev,epoch,gen_random_uuid());
 ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=sessions[1];
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3(final,selected[1],sessions[1],epoch,1,now(),actor,1);
 ASSERT r->>'status'='success',r::text;
 h:=(r->>'hand_id')::uuid;
 preview:=public.get_tracker_hand_input_tables_v4(final);
 snap:=public.get_tracker_roster_snapshot_v2(final,selected[1],sessions[1],epoch);
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=2;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'post_sb',1,(seat_result->>'entry_number')::integer,'preflop',100);
 ASSERT r->>'status'='success',r::text;
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=3;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'post_bb',2,(seat_result->>'entry_number')::integer,'preflop',200);
 ASSERT r->>'status'='success',r::text;
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=1;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'fold',3,(seat_result->>'entry_number')::integer,'preflop',0);
 ASSERT r->>'status'='success',r::text;
 SELECT to_jsonb(hp) INTO seat_result FROM public.hand_players hp WHERE hp.hand_id=h AND hp.seat_number=2;
 r:=public.record_action(h,(seat_result->>'player_id')::uuid,'fold',4,(seat_result->>'entry_number')::integer,'preflop',0);
 ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=3 AND sum(starting_stack)=120000 FROM public.hand_players WHERE hand_id=h),'D2 hand snapshot mismatch';
 ASSERT (SELECT count(*)=4 FROM public.hand_actions WHERE hand_id=h),'D2 action chain mismatch';
 ASSERT (SELECT status='in_progress' FROM public.tournament_hands WHERE id=h),'hand unexpectedly closed';
 ASSERT (SELECT count(*)=8 AND sum(current_stack)=320000 FROM public.tournament_entries WHERE tournament_id=final),'D2 current chips changed at Start';
 PERFORM set_config('local933.result',jsonb_build_object('event',event,'final',final,'flights',flights,
   'qualified',8,'initiallyUnseated',8,'planAssignments',jsonb_array_length(plan->'assignments'),
   'seatReceipts',jsonb_array_length(applied->'seatReceipts'),'cashMovements',
   (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=ANY(flights)),
   'carryStacks',(SELECT sum(carried_stack) FROM public.multi_day_final_participations_v1 WHERE event_id=event),
   'redrawBeforeContinue',state,'continue',recorded,'handId',h,'handPlayers',
   (SELECT count(*) FROM public.hand_players WHERE hand_id=h),'handActions',
   (SELECT count(*) FROM public.hand_actions WHERE hand_id=h),'actionSummary',
   (SELECT jsonb_agg(jsonb_build_object('order',action_order,'type',action_type,'amount',action_amount) ORDER BY action_order)
    FROM public.hand_actions WHERE hand_id=h),'handStatus',
   (SELECT status FROM public.tournament_hands WHERE id=h),'trackerContext',preview,'trackerRoster',snap)::text,true);
END $$;
SELECT current_setting('local933.result')::jsonb;
ROLLBACK;
DO $$BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'protected facts changed';END $$;
SELECT jsonb_build_object('protectedUnchanged',true,'tables',41);
`;
const boundary=sql.lastIndexOf('\nROLLBACK;\n');
assert.ok(boundary>0,'rollback boundary missing');
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let pending=null,buffer='',stderr='';
child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});
child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
 buffer+=chunk;
 while(buffer.includes('\n')){
  const cut=buffer.indexOf('\n'),line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+1);
  if(!pending)continue;
  if(line===pending.marker){const done=pending;pending=null;done.resolve(done.lines);}
  else if(line)pending.lines.push(line);
 }
});
child.on('exit',code=>{if(pending){const done=pending;pending=null;done.reject(new Error(`psql exited ${code}: ${stderr}`));}});
const send=statement=>new Promise((resolve,reject)=>{
 assert.equal(pending,null,'overlapping psql requests');
 const marker=`VINPOKER_933_${randomUUID().replaceAll('-','')}`;
 pending={marker,lines:[],resolve,reject};
 child.stdin.write(`${statement}\n\\echo ${marker}\n`);
});
const onlyJson=lines=>{
 const rows=lines.filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 assert.ok(rows.length>=1,JSON.stringify(lines));return rows.at(-1);
};
const result=onlyJson(await send(sql.slice(0,boundary)));
assert.equal(result.qualified,8);assert.equal(result.handPlayers,3);assert.equal(result.handActions,4);
assert.equal(result.handStatus,'in_progress');assert.equal(result.trackerContext?.ok,true);
const liveTable=result.trackerContext.tables.find(table=>table.has_live_hand);
assert.ok(liveTable&&liveTable.player_count===3);
const fixtureActor=onlyJson(await send(`SELECT jsonb_build_object('actor',(SELECT created_by FROM public.tournament_hands WHERE id='${result.handId}'),
 'club',(SELECT club_id FROM public.tournaments WHERE id='${result.final}'));`));
assert.match(fixtureActor.actor,/^[a-f0-9-]{36}$/);
const browserState={scope:'actual D2 Tracker manual Finish on held native SQL transaction; modeled Auth/HTTP Edge transport; final ROLLBACK',
 tour:result.final,hand:result.handId,table:liveTable.tournament_table_id,session:liveTable.table_session_id,actor:fixtureActor.actor,
 trace:[],denied:0,staleAuthDenials:0,workerUnavailable:0,reads:0,finish:null,nextHand:null};
const evidencePath='D:/Quy trình/output/reports/d2_933-tracker-browser-state-local-20261026.json';
const save=()=>writeFileSync(evidencePath,JSON.stringify(browserState,null,2)+'\n');
const email='d2tracker933@example.invalid',sessions=new Map(),signing=randomUUID();
const user={id:fixtureActor.actor,email,role:'authenticated',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-26T00:00:00Z'};
let chain=Promise.resolve();
const native=(expression,role='authenticated')=>{
 const claims=role==='anon'?'{"role":"anon"}':JSON.stringify({role:'authenticated',sub:fixtureActor.actor});
 const task=chain.then(()=>send(`SELECT set_config('request.jwt.claims','${claims}',true);\nSELECT set_config('request.jwt.claim.sub','${role==='anon'?'':fixtureActor.actor}',true);\nSELECT set_config('role','${role}',true);\nSELECT ${expression};`));
 chain=task.catch(()=>{});return task.then(onlyJson);
};
const quoteJson=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const reply=(response,status,data)=>{response.writeHead(status);response.end(JSON.stringify(data));};
const server=createServer(async(request,response)=>{
 response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
 response.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');
 response.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile');
 response.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(request.headers.host!=='127.0.0.1:54329'||(request.headers.origin&&request.headers.origin!=='http://127.0.0.1:5188'))return reply(response,403,{message:'D2_933_SCOPE'});
 if(request.method==='OPTIONS'){response.writeHead(204);return response.end();}
 try{
  const url=new URL(request.url,'http://127.0.0.1:54329');let raw='';for await(const chunk of request){raw+=chunk;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(request.method==='GET'&&url.pathname==='/__local/manifest')return reply(response,200,{runId:'933',tour:result.final,d2Event:result.event,actor:fixtureActor.actor,
   club:fixtureActor.club,email,model:browserState.scope,historyTable:{id:liveTable.tournament_table_id,session:liveTable.table_session_id}});
  if(request.method==='POST'&&url.pathname==='/auth/v1/token'){
   if(body.email!==email||body.password!=='LOCAL_TEST_ONLY')return reply(response,401,{message:'D2_933_LOGIN'});
   const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:fixtureActor.actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');
   const token=base+'.'+createHmac('sha256',signing).update(base).digest('base64url');sessions.set(token,true);
   return reply(response,200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  const authorized=sessions.has(String(request.headers.authorization??'').replace(/^Bearer /,''));
  if(request.method==='GET'&&url.pathname==='/auth/v1/user'&&authorized)return reply(response,200,user);
  if(request.method==='GET'&&url.pathname.startsWith('/rest/v1/')&&!authorized){
   browserState.staleAuthDenials++;browserState.trace.push({staleAuth:url.pathname});save();return reply(response,401,{message:'D2_933_LOGIN_REQUIRED'});
  }
  if(request.method==='GET'&&url.pathname.startsWith('/rest/v1/')&&authorized){
   const table=url.pathname.slice('/rest/v1/'.length);
   if(table==='clubs')return reply(response,200,[{id:fixtureActor.club}]);
   if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(table))return reply(response,200,[]);
   if(table==='tracker_floor_alerts'||table==='tournament_table_appearance')return reply(response,200,[]);
   if(table==='tournaments'&&url.searchParams.get('id')===`eq.${result.final}`){
    const select=url.searchParams.get('select');assert.ok(['id','club_id'].includes(select));
    const data={id:result.final,club_id:fixtureActor.club};browserState.trace.push({read:'tournaments',select});save();
    return reply(response,200,String(request.headers.accept??'').includes('vnd.pgrst.object')?{[select]:data[select]}:[{[select]:data[select]}]);
   }
   if(table==='tournament_tables'){
    assert.equal(url.searchParams.get('tournament_id'),`eq.${result.final}`);
    assert.equal(url.searchParams.get('id'),`eq.${liveTable.tournament_table_id}`);
    assert.equal(url.searchParams.get('select'),'max_seats,table_session_id');
    const row=await native(`jsonb_build_object('row',(SELECT jsonb_build_object('max_seats',max_seats,'table_session_id',table_session_id) FROM public.tournament_tables WHERE id='${liveTable.tournament_table_id}' AND tournament_id='${result.final}'))`);
    browserState.trace.push({read:table,query:url.search});save();
    return reply(response,200,String(request.headers.accept??'').includes('vnd.pgrst.object')?row.row:[row.row]);
   }
   if(table==='profiles'){
    assert.equal(url.searchParams.get('select'),'user_id,avatar_url');
    const rows=await native(`jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',p.user_id,'avatar_url',p.avatar_url)) FROM public.profiles p JOIN public.tournament_seats s ON s.player_id=p.user_id WHERE s.tournament_id='${result.final}' AND s.tournament_table_id='${liveTable.tournament_table_id}' AND s.is_active),'[]'::jsonb))`);
    browserState.trace.push({read:table,count:rows.rows.length});save();return reply(response,200,rows.rows);
   }
   if(table==='tournament_hands'){
    const select=url.searchParams.get('select');
    const blindSelect='tracker_level_number,tracker_small_blind,tracker_big_blind,tracker_bba';
    const finishSelect='id,tournament_id,table_id,tournament_table_id,table_session_id,source_revision,status,is_voided';
    const lineageSelect='button_seat,status,is_voided,tracker_sb_position,tracker_bb_position';
    assert.ok(['id,button_seat,status,is_voided','id,hand_number','id,hand_number,table_id,button_seat,community_cards,tracker_sb_position,tracker_bb_position',blindSelect,finishSelect,lineageSelect].includes(select));
    const explicitId=url.searchParams.get('id')?.replace(/^eq\./,'')??null;
    const targetId=explicitId??browserState.nextHand?.hand_id??result.handId;
    assert.ok([result.handId,browserState.nextHand?.hand_id].includes(targetId));
    if(select===blindSelect||select===lineageSelect)assert.equal(explicitId,targetId);
    else if(select===finishSelect){assert.equal(explicitId,targetId);assert.equal(url.searchParams.get('tournament_id'),`eq.${result.final}`);}
    else{
     assert.equal(url.searchParams.get('tournament_id'),`eq.${result.final}`);
     assert.equal(url.searchParams.get('table_id'),`eq.${liveTable.tournament_table_id}`);
     assert.equal(url.searchParams.get('table_session_id'),`eq.${liveTable.table_session_id}`);
    }
    const hand=await native(`jsonb_build_object('row',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id='${targetId}' AND h.tournament_id='${result.final}' AND h.table_id='${liveTable.tournament_table_id}' AND h.table_session_id='${liveTable.table_session_id}'))`);
    const statusFilter=url.searchParams.get('status');
    assert.ok(statusFilter===null||statusFilter==='eq.in_progress');
    const filteredHand=statusFilter==='eq.in_progress'&&hand.row?.status!=='in_progress'?null:hand.row;
    const row=filteredHand?Object.fromEntries(select.split(',').map(key=>[key,filteredHand[key]])):null;
    browserState.trace.push({read:table,select,status:row?.status??null});save();
    return reply(response,200,String(request.headers.accept??'').includes('vnd.pgrst.object')?row:row?[row]:[]);
   }
   if(table==='hand_actions'){
    const targetId=url.searchParams.get('hand_id')?.replace(/^eq\./,'');
    assert.ok([result.handId,browserState.nextHand?.hand_id].includes(targetId));
    const select=url.searchParams.get('select');
    assert.ok(['player_id,action_type,action_amount,action_order,street','player_id,entry_number,action_type'].includes(select));
    const lineage=select==='player_id,entry_number,action_type';
    if(lineage)assert.ok(url.searchParams.get('action_type')?.includes('post_sb')&&url.searchParams.get('action_type')?.includes('post_bb'));
    const data=await native(`jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object(${lineage?"'player_id',a.player_id,'entry_number',a.entry_number,'action_type',a.action_type":"'player_id',a.player_id,'action_type',a.action_type,'action_amount',a.action_amount,'action_order',a.action_order,'street',a.street"}) ORDER BY a.action_order) FROM public.hand_actions a WHERE a.hand_id='${targetId}'${lineage?" AND a.action_type IN ('post_sb','post_bb')":''}),'[]'::jsonb))`);
    browserState.trace.push({read:table,count:data.rows.length});save();return reply(response,200,data.rows);
   }
   if(table==='hand_players'){
    const targetId=url.searchParams.get('hand_id')?.replace(/^eq\./,'');
    assert.ok([result.handId,browserState.nextHand?.hand_id].includes(targetId));
    const select=url.searchParams.get('select');
    assert.ok(['player_id,entry_number,hole_cards','player_id,entry_number,seat_number'].includes(select));
    const lineage=select==='player_id,entry_number,seat_number';
    const data=await native(`jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('player_id',p.player_id,'entry_number',p.entry_number,${lineage?"'seat_number',p.seat_number":"'hole_cards',p.hole_cards"}) ORDER BY p.seat_number) FROM public.hand_players p WHERE p.hand_id='${targetId}'),'[]'::jsonb))`);
    browserState.trace.push({read:table,count:data.rows.length});save();return reply(response,200,data.rows);
   }
  }
  if(request.method==='POST'&&url.pathname==='/functions/v1/tournament-live-update'&&authorized&&body.action==='start_hand'){
   assert.ok(browserState.finish?.receipt&&browserState.nextHand===null);
   assert.equal(body.tournament_id,result.final);
   assert.equal(body.tournament_table_id,liveTable.tournament_table_id);
   assert.equal(body.table_session_id,liveTable.table_session_id);
   assert.equal(body.control_epoch,liveTable.control_epoch);
   assert.equal(body.hand_number,2);
   assert.equal(body.button_seat,2);
   assert.match(body.hand_time,/^2026-/);
   const started=await native(`public.start_tracker_hand_v3('${result.final}','${liveTable.tournament_table_id}','${liveTable.table_session_id}',${liveTable.control_epoch},${body.hand_number},'${body.hand_time}'::timestamptz,'${fixtureActor.actor}',${body.button_seat})`);
   browserState.trace.push({edge:'start_hand',result:started.status??started.error??null,hand:started.hand_id??null});
   if(started.status==='success'&&started.hand_id)browserState.nextHand=started;
   save();return reply(response,200,{data:started});
  }
  if(request.method==='POST'&&url.pathname==='/functions/v1/tournament-live-update'&&authorized){
   assert.equal(body.tournament_id,result.final);
   assert.ok(['record_manual_hand_v1','get_manual_finish_receipt_v1'].includes(body.action));
   const intent=body.finish_intent;
   assert.ok(isManualFinishIntent(intent));
   assert.equal(intent.actor_id,fixtureActor.actor);assert.equal(intent.tournament_id,result.final);
   assert.equal(intent.tournament_table_id,liveTable.tournament_table_id);
   assert.equal(intent.table_session_id,liveTable.table_session_id);assert.equal(intent.hand_id,result.handId);
   assert.equal(intent.control_epoch,liveTable.control_epoch);
   if(body.action==='record_manual_hand_v1'){
    assert.equal(browserState.finish,null,'no second Finish request');
    const recon=reconcileSidePots(intent.payload.actions,intent.payload.side_pots);
    if(recon.tampered)return reply(response,422,{error:'SIDE_POTS_TAMPERED',code:'SIDE_POTS_TAMPERED'});
   }
   const rpc=body.action==='record_manual_hand_v1'?'record_tracker_manual_hand_v1':'get_tracker_manual_finish_receipt_v1';
   const receipt=await native(`public.${rpc}(${quoteJson(intent)})`);
   if(receipt?.error){browserState.trace.push({edge:body.action,denial:receipt.error});save();return reply(response,409,{error:receipt.error,code:receipt.error});}
   assert.ok(manualFinishReceiptMatches(receipt,intent),JSON.stringify(receipt));
   browserState.trace.push({edge:body.action,request:intent.request_id,receipt:receipt.status,sourceRevision:receipt.committed_source_revision});
   if(body.action==='record_manual_hand_v1')browserState.finish={request:intent.request_id,receipt};
   save();return reply(response,200,{data:receipt});
  }
  if(request.method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_settlement'){
   assert.equal(body.p_hand_id,result.handId);
   const value=await native(`public.get_public_tournament_settlement('${result.handId}')`,'anon');
   browserState.trace.push({rpc:'get_public_tournament_settlement',empty:Object.keys(value).length===0});save();return reply(response,200,value);
  }
  if(request.method==='POST'&&url.pathname==='/functions/v1/tournament-historical-settlement'&&authorized){
   browserState.workerUnavailable++;browserState.trace.push({worker:'historical_settlement_unavailable_local',mode:body.mode});save();
   return reply(response,503,{error:'LOCAL_HISTORICAL_WORKER_NOT_HOSTED'});
  }
  if(request.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')&&authorized){
   const name=url.pathname.slice('/rest/v1/rpc/'.length);let expression=null;
   if(name==='get_tracker_hand_input_tables_v4'){assert.equal(body.p_tournament_id,result.final);expression=`public.${name}('${result.final}')`;}
   if(name==='get_tracker_table_locks'){assert.equal(body.p_tournament_id,result.final);assert.equal(body.p_actor_user_id,fixtureActor.actor);expression=`public.${name}('${result.final}','${fixtureActor.actor}')`;}
   if(name==='get_tournament_clock'){assert.equal(body.p_tournament_id,result.final);expression=`public.${name}('${result.final}')`;}
   if(name==='get_next_hand_number'){
    assert.equal(body.p_tournament_id,result.final);assert.equal(body.p_table_id,liveTable.tournament_table_id);
    expression=`jsonb_build_object('value',public.${name}('${result.final}','${liveTable.tournament_table_id}'))`;
   }
   if(name==='heartbeat_lock'){
    assert.ok([result.handId,browserState.nextHand?.hand_id].includes(body.p_hand_id));assert.equal(body.p_user_id,fixtureActor.actor);
    expression=`public.${name}('${body.p_hand_id}','${fixtureActor.actor}')`;
   }
   if(name==='is_club_tracker'){assert.equal(body._user_id,fixtureActor.actor);assert.equal(body._club_id,fixtureActor.club);expression=`jsonb_build_object('value',public.${name}('${fixtureActor.actor}','${fixtureActor.club}'))`;}
   if(name==='get_tracker_roster_snapshot_v2'){
    assert.equal(body.p_tournament_id,result.final);assert.equal(body.p_tournament_table_id,liveTable.tournament_table_id);
    assert.equal(body.p_table_session_id,liveTable.table_session_id);assert.equal(body.p_expected_epoch,liveTable.control_epoch);
    expression=`public.${name}('${result.final}','${liveTable.tournament_table_id}','${liveTable.table_session_id}',${liveTable.control_epoch})`;
   }
   if(expression){const data=await native(expression);browserState.reads++;browserState.trace.push({rpc:name,ok:data?.ok??null,status:data?.status??null});save();return reply(response,200,['is_club_tracker','get_next_hand_number'].includes(name)?data.value:data);}
  }
  browserState.denied++;browserState.trace.push({denied:url.pathname,method:request.method,query:url.search});save();return reply(response,403,{message:'D2_933_READ_NOT_ALLOWED'});
 }catch(error){browserState.trace.push({adapterError:String(error)});save();return reply(response,500,{message:'D2_933_ADAPTER_ERROR'});}
});
try{
 save();await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));
 console.log('D2_933_TRACKER_ADAPTER_READY',JSON.stringify({tour:result.final,hand:result.handId,table:liveTable.tournament_table_id,actor:fixtureActor.actor}));
 await new Promise(resolve=>process.stdin.once('data',resolve));process.stdin.pause();
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await chain;
 assert.equal(browserState.denied,0,JSON.stringify(browserState));
 assert.ok(!browserState.trace.some(item=>item.adapterError),JSON.stringify(browserState));
 assert.ok(browserState.trace.some(item=>item.rpc==='get_tracker_hand_input_tables_v4'),JSON.stringify(browserState));
 assert.ok(browserState.trace.some(item=>item.read==='hand_actions'&&item.count===4),JSON.stringify(browserState));
 assert.ok(browserState.trace.some(item=>item.read==='hand_players'&&item.count===3),JSON.stringify(browserState));
 assert.ok(browserState.trace.some(item=>item.rpc==='heartbeat_lock'&&item.status==='success'),JSON.stringify(browserState));
 assert.ok(browserState.finish?.receipt&&browserState.trace.filter(item=>item.edge==='record_manual_hand_v1').length===1,JSON.stringify(browserState));
 assert.ok(browserState.nextHand?.hand_id&&browserState.trace.filter(item=>item.edge==='start_hand').length===1,JSON.stringify(browserState));
 const nextHandFacts=onlyJson(await send(`SELECT set_config('role','none',true);
SELECT jsonb_build_object('number',hand_number,'status',status,'buttonSeat',button_seat,
 'smallBlind',tracker_small_blind,'bigBlind',tracker_big_blind,'level',tracker_level_number,
 'playerCount',(SELECT count(*) FROM public.hand_players WHERE hand_id='${browserState.nextHand.hand_id}'),
 'actionCount',(SELECT count(*) FROM public.hand_actions WHERE hand_id='${browserState.nextHand.hand_id}'))
FROM public.tournament_hands WHERE id='${browserState.nextHand.hand_id}';`));
 assert.equal(nextHandFacts.number,2);assert.equal(nextHandFacts.status,'in_progress');
 assert.equal(nextHandFacts.buttonSeat,2);assert.equal(nextHandFacts.smallBlind,100);assert.equal(nextHandFacts.bigBlind,200);
 assert.equal(nextHandFacts.playerCount,3);assert.equal(nextHandFacts.actionCount,0);
 const finishFacts=onlyJson(await send(`SELECT set_config('role','none',true);\nSELECT jsonb_build_object(
  'status',(SELECT status FROM public.tournament_hands WHERE id='${result.handId}'),
  'actionCount',(SELECT count(*) FROM public.hand_actions WHERE hand_id='${result.handId}'),
  'activeSeats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${result.final}' AND is_active),
  'seatChips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${result.final}' AND is_active),
  'entryChips',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${result.final}'),
  'handEliminations',(SELECT count(*) FROM public.tournament_eliminations WHERE hand_id='${result.handId}'));`));
 assert.equal(finishFacts.status,'completed',JSON.stringify(finishFacts));
 assert.equal(finishFacts.actionCount,4);assert.equal(finishFacts.activeSeats,8);
 assert.equal(finishFacts.seatChips,320000);assert.equal(finishFacts.entryChips,320000);
 assert.equal(finishFacts.handEliminations,0);
 const final=onlyJson(await send(sql.slice(boundary)));
 assert.equal(final.protectedUnchanged,true);
 browserState.final={protectedUnchanged:true,tables:final.tables,finishFacts,nextHandFacts};save();
 writeFileSync('D:/Quy trình/output/reports/d2_933-tracker-native-local-20261026.json',JSON.stringify({result,finishFacts,nextHandFacts,final},null,2)+'\n');
 console.log('D2_933_TRACKER_NEXT_HAND_BROWSER_ROLLBACK_PASS',JSON.stringify({reads:browserState.reads,denied:browserState.denied,finish:finishFacts.status,nextHand:nextHandFacts.status,protectedUnchanged:true}));
}finally{child.stdin.end();}
