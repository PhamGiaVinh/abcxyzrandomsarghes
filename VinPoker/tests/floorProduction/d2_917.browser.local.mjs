// Actual product D2 panel over a held native transaction. All writes ROLLBACK.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_D2_BROWSER917_LOCAL,'1');
const source=readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql','utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',terminal=false;
child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;resolve(code);});});
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
let chain=Promise.resolve();
function execute(query){const task=chain.then(async()=>{assert.equal(terminal,false,'native session terminal');const marker='D2_917_'+randomUUID().replaceAll('-',''),offset=stdout.length;child.stdin.write(query+'\nSELECT '+q(marker)+';\n');const end=Date.now()+20000;while(!stdout.slice(offset).includes(marker)){assert.equal(terminal,false,stderr);assert.ok(Date.now()<end,'native observation timed out; do not restart session');await new Promise(r=>setTimeout(r,30));}const lines=stdout.slice(offset).split(/\r?\n/).filter(s=>s.startsWith('{'));return lines.length?JSON.parse(lines.at(-1)):null;});chain=task.catch(()=>{});return task;}
const cut=source.indexOf(' FOR i IN 1..3 LOOP\n  seat_result:=');assert.ok(cut>0 && source.indexOf(' FOR i IN 1..3 LOOP\n  seat_result:=',cut+1)<0);
let preparation=source.slice(0,cut);
preparation+=String.raw`
 PERFORM set_config('role','authenticated',true);
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT (SELECT count(*)=8 FROM jsonb_array_elements(snap->'players')x WHERE x->>'state'='UNSEATED');
 ASSERT (SELECT count(*)=3 FROM jsonb_array_elements(snap->'tables')x WHERE x->>'blocker' IS NULL);
 PERFORM set_config('role','none',true);
 PERFORM set_config('local917.context',jsonb_build_object('event',event,'tour',final,'actor',actor,'club',club,'selected',selected,'sessions',sessions)::text,true);
END $$;
SET LOCAL idle_in_transaction_session_timeout='10min';
SELECT current_setting('local917.context')::jsonb;
`;
const context=await execute(preparation);for(const k of ['event','tour','actor','club'])uuid(context[k]);
const {event,tour,actor,club}=context;
const state={scope:'native uncommitted fixture, modeled Auth/HTTP, all rollback; not managed E2E',context,trace:[],writerDenied:0};
const save=()=>writeFileSync('D:/Quy trình/output/reports/d2_917-native-browser-state-local-20261026.json',JSON.stringify(state,null,2)+'\n');
async function native(query,role='authenticated'){assert.ok(['authenticated','anon'].includes(role));return execute(String.raw`DO $$ DECLARE value jsonb; err jsonb;BEGIN BEGIN PERFORM set_config('role','`+role+String.raw`',true);SELECT `+query+String.raw` INTO value;EXCEPTION WHEN OTHERS THEN err:=jsonb_build_object('code',SQLSTATE,'message',SQLERRM);END;PERFORM set_config('role','none',true);PERFORM set_config('local917.response',jsonb_build_object('data',value,'error',err)::text,true);END $$;SELECT current_setting('local917.response')::jsonb;`);}
const sessions=new Map(),key=randomUUID(),user={id:actor,email:'capacity917@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-26T00:00:00Z'};
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'))return send(403,{message:'LOCAL917_SCOPE'});if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const c of req){raw+=c;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
 if(url.pathname==='/__local/manifest')return send(200,{tour,actor,club,d2Event:event,email:user.email,runId:'917',model:'native SQL held transaction / Auth HTTP modeled'});
 if(url.pathname==='/auth/v1/token'){assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.set(token,true);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});}
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_redraw_v1'&&!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,''))){assert.equal(body.p_tournament_id,tour);const result=await native('public.get_public_tournament_redraw_v1('+q(tour)+')','anon');state.trace.push({kind:'native_anon_redraw',error:result.error});save();return send(result.error?400:200,result.error??result.data);}
 if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL917_LOGIN_REQUIRED'});
 if(url.pathname==='/auth/v1/user')return send(200,user);
 if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/'))return send(200,url.pathname==='/rest/v1/clubs'?[{id:club}]:[]);
 if(req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
 const name=url.pathname.split('/').pop();let query;
 if(name==='multi_day_final_roster_v1'){assert.equal(body.p_event_id,event);query='public.multi_day_final_roster_v1('+q(event)+')';}
 else if(name==='get_public_tournament_redraw_v1'){assert.equal(body.p_tournament_id,tour);query='public.get_public_tournament_redraw_v1('+q(tour)+')';}
 else if(name==='multi_day_plan_initial_draw_v1'){
 assert.equal(body.p_event_id,event);assert.deepEqual([...body.p_tournament_table_ids].sort(),[...context.selected].sort());uuid(body.p_request_id);assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);
 query='public.multi_day_plan_initial_draw_v1('+[q(event),'ARRAY['+context.selected.map(id=>q(id)+'::uuid').join(',')+']',q(body.p_expected_source_hash),q(body.p_request_id)].join(',')+')';}
 else if(name==='multi_day_get_initial_draw_plan_v1'){assert.equal(body.p_event_id,event);uuid(body.p_request_id);query='public.multi_day_get_initial_draw_plan_v1('+q(event)+','+q(body.p_request_id)+')';}
 else if(name==='multi_day_apply_initial_draw_v1'){
 uuid(body.p_plan_id);uuid(body.p_request_id);assert.equal(body.p_plan_id,state.plan);query='public.multi_day_apply_initial_draw_v1('+q(body.p_plan_id)+','+q(body.p_request_id)+')';}
 else if(name==='multi_day_get_initial_draw_resolution_v1'){assert.equal(body.p_event_id,event);uuid(body.p_plan_id);assert.equal(body.p_plan_id,state.plan);query='public.multi_day_get_initial_draw_resolution_v1('+q(event)+','+q(body.p_plan_id)+')';}
 else if(name==='floor_continue_tournament_redraw_v1'){uuid(body.p_batch_id);uuid(body.p_request_id);assert.equal(Number.isSafeInteger(body.p_expected_redraw_revision),true);query='public.floor_continue_tournament_redraw_v1('+[q(body.p_batch_id),body.p_expected_redraw_revision,q(body.p_request_id)].join(',')+')';}
 else {state.writerDenied++;state.trace.push({kind:'rpc_denied',name});save();return send(403,{message:'LOCAL917_RPC_NOT_ALLOWED'});}
 const result=await native(query);
 state.trace.push({kind:'native_rpc',name,error:result.error,request:body.p_request_id??null});
 if(!result.error&&name==='multi_day_plan_initial_draw_v1'){state.plan=result.data.planId;state.previewAssignments=result.data.assignments.length;}
 if(!result.error&&name==='multi_day_apply_initial_draw_v1'){state.applyCalls=(state.applyCalls??0)+1;state.appliedAssignments=result.data.seatReceipts.length;}
 if(!result.error&&name==='floor_continue_tournament_redraw_v1'){state.continueCalls=(state.continueCalls??0)+1;state.continueResult=result.data;}
 if(!result.error&&name==='multi_day_final_roster_v1'){state.lastRoster={players:result.data.players.length,unseated:result.data.players.filter(p=>p.state==='UNSEATED').length,blockers:result.data.tables.map(t=>({table:t.tableNumber,blocker:t.blocker}))};}
 save();return send(result.error?400:200,result.error??result.data);
 }
 state.writerDenied++;state.trace.push({kind:'endpoint_denied',path:url.pathname});save();return send(403,{message:'LOCAL917_ENDPOINT_NOT_ALLOWED'});
 }catch{state.trace.push({kind:'adapter_error'});save();return send(500,{message:'LOCAL917_ADAPTER_FAILED'});}
});save();server.listen(54329,'127.0.0.1',()=>console.log('D2_917_NATIVE_MULTIPLAYER_ADAPTER_READY',JSON.stringify({event,tour,selected:context.selected})));

process.stdin.once('data',async()=>{process.stdin.pause();server.closeAllConnections();await new Promise(r=>server.close(r));try{
 assert.equal(state.previewAssignments,8);assert.equal(state.appliedAssignments,8);assert.equal(state.applyCalls,1);
 assert.equal(state.continueCalls,1);assert.equal(state.continueResult?.ok,true);
 const result=await execute(`DO $$DECLARE tv jsonb;BEGIN
  ASSERT (SELECT count(*)=8 AND sum(current_stack)=320000 FROM public.tournament_entries WHERE tournament_id=${q(tour)});
  ASSERT (SELECT count(*)=8 FROM public.multi_day_final_seatings_v1 WHERE final_tournament_id=${q(tour)});
  ASSERT (SELECT count(*)=1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=${q(state.plan)});
  PERFORM set_config('role','anon',true);tv:=public.get_public_tournament_redraw_v1(${q(tour)});
  ASSERT tv->>'batch_id' IS NULL AND tv->'moves'='[]'::jsonb,'redraw projection still active';
  PERFORM set_config('role','none',true);
 END $$;ROLLBACK;DO $$BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'rollback facts changed';END $$;SELECT jsonb_build_object('protectedUnchanged',true,'tables',41);`);
 state.final=result;save();child.stdin.end();assert.equal(await done,0);console.log('D2_917_FINAL_ROLLBACK_UNCHANGED',JSON.stringify(result));process.exit(0);
 }catch(e){state.finalError=String(e);save();child.stdin.end('ROLLBACK;\n');await done;console.error('D2_917_FINAL_FAILED',String(e));process.exit(1);}});
