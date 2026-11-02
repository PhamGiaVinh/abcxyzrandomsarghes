// Actual qualification → initial draw panel over held native SELECT_LARGEST transaction. All writes ROLLBACK.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';

assert.equal(process.env.VINPOKER_D2_BROWSER948_LOCAL,'1');
const source=readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql','utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const uuid=value=>assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
let sql=source.replace("'SUM_STACKS'","'SELECT_LARGEST'")
 .replace('D2 913 SUM_STACKS boundary TEST','D2 948 SELECT_LARGEST TEST');
const cut=sql.indexOf(" PERFORM set_config('role','authenticated',true);\n preview:=public.multi_day_qualification_preview_v1(event);");
assert.ok(cut>0);
sql=sql.slice(0,cut)+String.raw`
 PERFORM set_config('role','authenticated',true);
 preview:=public.multi_day_qualification_preview_v1(event);
 ASSERT preview->>'state'='READY' AND jsonb_array_length(preview->'flights')=2;
 ASSERT (SELECT count(*)=16 FROM jsonb_array_elements(preview->'flights') f CROSS JOIN LATERAL jsonb_array_elements(f->'eligibleBags') b);
 PERFORM set_config('role','none',true);
 FOR i IN 1..3 LOOP
  physical:=gen_random_uuid();
  INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
  VALUES(physical,club,'D2 948 Final physical TEST '||i,table_no+2+i,'tournament','inactive','available');
  PERFORM set_config('role','authenticated',true);
  opened:=public.floor_open_tournament_table_v3(final,physical,'manual',gen_random_uuid());ASSERT opened->>'ok'='true',opened::text;
  PERFORM set_config('role','none',true);
  SELECT id,table_session_id INTO STRICT tt,sess FROM public.tournament_tables WHERE tournament_id=final AND game_table_id=physical;
  selected:=array_append(selected,tt);sessions:=array_append(sessions,sess);
 END LOOP;
 PERFORM set_config('local948.context',jsonb_build_object('event',event,'tour',final,'actor',actor,'club',club,'flight1',flights[1],'flight2',flights[2],'selected',selected,'sessions',sessions)::text,true);
END $$;
SET LOCAL idle_in_transaction_session_timeout='10min';
SELECT current_setting('local948.context')::jsonb;
`;
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',terminal=false;
child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;resolve(code);});});
let chain=Promise.resolve();
function execute(query){const task=chain.then(async()=>{assert.equal(terminal,false,stderr);const marker='D2_948_'+randomUUID().replaceAll('-',''),offset=stdout.length;child.stdin.write(query+'\nSELECT '+q(marker)+';\n');const end=Date.now()+30000;while(!stdout.slice(offset).includes(marker)){assert.equal(terminal,false,stderr);assert.ok(Date.now()<end,'native observation timed out');await new Promise(resolve=>setTimeout(resolve,30));}const lines=stdout.slice(offset).split(/\r?\n/).filter(line=>line.startsWith('{'));return lines.length?JSON.parse(lines.at(-1)):null;});chain=task.catch(()=>{});return task;}
const context=await execute(sql);for(const name of ['event','tour','actor','club','flight1','flight2'])uuid(context[name]);
const {event,tour,actor,club,flight1,flight2}=context;
const state={scope:'native held transaction; HTTP/Auth modeled; all rollback',context,trace:[],writerDenied:0};
const save=()=>writeFileSync('D:/Quy trình/output/reports/d2_948-select-largest-draw-browser-native-state-local-20261027.json',JSON.stringify(state,null,2)+'\n');
async function native(query,role='authenticated'){assert.ok(['authenticated','anon'].includes(role));return execute(String.raw`DO $$ DECLARE value jsonb; err jsonb;BEGIN BEGIN PERFORM set_config('role','`+role+String.raw`',true);SELECT `+query+String.raw` INTO value;EXCEPTION WHEN OTHERS THEN err:=jsonb_build_object('code',SQLSTATE,'message',SQLERRM);END;PERFORM set_config('role','none',true);PERFORM set_config('local948.response',jsonb_build_object('data',value,'error',err)::text,true);END $$;SELECT current_setting('local948.response')::jsonb;`);}
const sessions=new Map(),key=randomUUID(),user={id:actor,email:'draw948@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'))return send(403,{message:'LOCAL948_SCOPE'});if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(url.pathname==='/__local/manifest')return send(200,{tour,actor,club,d2Event:event,email:user.email,runId:'948',model:'native SQL held transaction / Auth HTTP modeled'});
  if(url.pathname==='/auth/v1/token'){if(body.email!==user.email||body.password!=='LOCAL_TEST_ONLY')return send(401,{message:'LOCAL948_EXPIRED_TEST_SESSION'});const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.set(token,true);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});}
  if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_redraw_v1'&&!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,''))){assert.equal(body.p_tournament_id,tour);const result=await native('public.get_public_tournament_redraw_v1('+q(tour)+')','anon');state.trace.push({name:'anon_redraw',error:result.error});save();return send(result.error?400:200,result.error??result.data);}
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL948_LOGIN_REQUIRED'});
  if(url.pathname==='/auth/v1/user')return send(200,user);
  if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/'))return send(200,url.pathname==='/rest/v1/clubs'?[{id:club}]:[]);
  if(req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').pop();let query;
   if(name==='multi_day_floor_read_v1'||name==='multi_day_qualification_preview_v1'||name==='multi_day_final_roster_v1'||name==='multi_day_payout_preview_v1'){
    assert.deepEqual(Object.keys(body),['p_event_id']);assert.equal(body.p_event_id,event);query='public.'+name+'('+q(event)+')';
   }
   else if(name==='get_public_tournament_redraw_v1'){assert.deepEqual(Object.keys(body),['p_tournament_id']);assert.equal(body.p_tournament_id,tour);query='public.get_public_tournament_redraw_v1('+q(tour)+')';}
   else if(name==='get_bagged_flight_tables_v1'){assert.deepEqual(Object.keys(body),['p_flight_tournament_id']);assert.ok([flight1,flight2].includes(body.p_flight_tournament_id));query='public.get_bagged_flight_tables_v1('+q(body.p_flight_tournament_id)+')';}
   else if(name==='multi_day_lock_qualification_v1'){
    assert.equal(body.p_event_id,event);uuid(body.p_request_id);assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);
    assert.ok(Array.isArray(body.p_bag_ids)&&body.p_bag_ids.length===16&&new Set(body.p_bag_ids).size===16);body.p_bag_ids.forEach(uuid);
    query='public.multi_day_lock_qualification_v1('+[q(event),'ARRAY['+body.p_bag_ids.map(value=>q(value)+'::uuid').join(',')+']',q(body.p_expected_source_hash),q(body.p_request_id)].join(',')+')';
   }
   else if(name==='multi_day_plan_initial_draw_v1'){
    assert.equal(body.p_event_id,event);assert.deepEqual([...body.p_tournament_table_ids].sort(),[...context.selected].sort());uuid(body.p_request_id);assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);
    query='public.multi_day_plan_initial_draw_v1('+[q(event),'ARRAY['+context.selected.map(value=>q(value)+'::uuid').join(',')+']',q(body.p_expected_source_hash),q(body.p_request_id)].join(',')+')';
   }
   else if(name==='multi_day_get_initial_draw_plan_v1'){assert.equal(body.p_event_id,event);uuid(body.p_request_id);query='public.multi_day_get_initial_draw_plan_v1('+q(event)+','+q(body.p_request_id)+')';}
   else if(name==='multi_day_apply_initial_draw_v1'){uuid(body.p_plan_id);uuid(body.p_request_id);assert.equal(body.p_plan_id,state.plan);query='public.multi_day_apply_initial_draw_v1('+q(body.p_plan_id)+','+q(body.p_request_id)+')';}
   else if(name==='multi_day_get_initial_draw_resolution_v1'){assert.equal(body.p_event_id,event);uuid(body.p_plan_id);assert.equal(body.p_plan_id,state.plan);query='public.multi_day_get_initial_draw_resolution_v1('+q(event)+','+q(body.p_plan_id)+')';}
   else {state.writerDenied++;state.trace.push({name,denied:true});save();return send(403,{message:'LOCAL948_RPC_NOT_ALLOWED'});}
   const result=await native(query);state.trace.push({name,error:result.error,requestId:body.p_request_id??null});
   if(!result.error&&name==='multi_day_lock_qualification_v1')state.lock=result.data;
   if(!result.error&&name==='multi_day_plan_initial_draw_v1'){state.plan=result.data.planId;state.previewAssignments=result.data.assignments.length;}
   if(!result.error&&name==='multi_day_apply_initial_draw_v1'){state.applyCalls=(state.applyCalls??0)+1;state.appliedAssignments=result.data.seatReceipts.length;}
   if(!result.error&&name==='multi_day_final_roster_v1')state.lastRoster={players:result.data.players.length,unseated:result.data.players.filter(player=>player.state==='UNSEATED').length};
   save();return send(result.error?400:200,result.error??result.data);
  }
  state.writerDenied++;state.trace.push({endpoint:url.pathname,denied:true});save();return send(403,{message:'LOCAL948_ENDPOINT_NOT_ALLOWED'});
 }catch(error){state.trace.push({adapterError:String(error)});save();return send(500,{message:'LOCAL948_ADAPTER_FAILED'});}
});save();server.listen(54329,'127.0.0.1',()=>console.log('D2_948_DRAW_ADAPTER_READY',JSON.stringify({event,tour,selected:context.selected})));

process.stdin.once('data',async()=>{process.stdin.pause();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));try{
 assert.equal(state.previewAssignments,8);assert.equal(state.appliedAssignments,8);assert.equal(state.applyCalls,1);
 const result=await execute("DO $$ BEGIN ASSERT (SELECT count(*)=8 AND sum(carried_stack)=160000 AND bool_and(carried_stack=20000) FROM public.multi_day_final_participations_v1 WHERE event_id="+q(event)+"),'SELECT_LARGEST carry mismatch';ASSERT (SELECT count(*)=8 AND sum(current_stack)=160000 FROM public.tournament_entries WHERE tournament_id="+q(tour)+"),'Final entry carry mismatch';ASSERT (SELECT count(*)=8 FROM public.multi_day_final_seatings_v1 WHERE final_tournament_id="+q(tour)+"),'Final seating count mismatch';ASSERT (SELECT count(*)=1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id="+q(state.plan)+"),'Apply receipt mismatch';ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id="+q(tour)+"),'Final cash unexpectedly changed';END $$;ROLLBACK;DO $$BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'rollback facts changed';END $$;SELECT jsonb_build_object('protectedUnchanged',true,'tables',41);");state.final=result;save();child.stdin.end();assert.equal(await done,0);console.log('D2_948_FINAL_ROLLBACK_UNCHANGED',JSON.stringify(result));process.exit(0);
 }catch(error){state.finalError=String(error);save();child.stdin.end('ROLLBACK;\n');await done;console.error('D2_948_FINAL_FAILED',String(error),stderr);process.exit(1);}});
