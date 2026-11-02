// Existing canonical public RPC only; no direct private receipt instrumentation or grant changes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
const readonly1201=process.env.VINPOKER_FLOOR1201_LOCAL==='1';
const readonly1199=process.env.VINPOKER_FLOOR1199_LOCAL==='1'||readonly1201;
const output1199=readonly1201?'D:/Quy trình/output/reports/floor1201-browser-native-local-20261028.json':'D:/Quy trình/output/reports/floor1199-browser-native-local-20261028.json';
const healthy1032=process.env.VINPOKER_FLOOR1032_LOCAL==='1';
assert.ok(readonly1199||healthy1032);
assert.equal(existsSync(readonly1199?output1199:'D:/Quy trình/output/reports/floor1032-browser-native-local-20261027.json'),false,'Retained output exists');
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['tournaments','tournament_entries','tournament_registrations','tournament_levels','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1','tournament_state_transitions','audit_logs','chip_inventory_ledger','chip_bank_ledger'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const claims="SET LOCAL request.jwt.claim.sub='"+actor+"';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{\"sub\":\""+actor+"\",\"role\":\"authenticated\"}';SET LOCAL ROLE authenticated;";
const native=async q=>JSON.parse(sql("BEGIN READ ONLY;SET LOCAL statement_timeout='10s';"+claims+q+"ROLLBACK;"));
const commitNative=async q=>{assert.equal(readonly1199,false,'READONLY1199_NO_WRITES');return commit1032(q);};
const commit1032=async q=>JSON.parse(sql("BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';"+claims+q+"COMMIT;"));
let created=null,requestId=null;
const protectedFingerprint=()=>read("SELECT to_jsonb(md5(jsonb_build_array("+tables.map(t=>"(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."+t+" x"+(t==='tournaments'&&created?" WHERE id<>'"+created+"'":t==='table_operation_receipts'&&requestId?" WHERE NOT(actor_id='"+actor+"' AND operation_type='create_tournament_with_levels_v1' AND request_id='"+requestId+"')":"")+")").join(',')+")::text));");
const protectedBefore=protectedFingerprint();
const counts=()=>read("SELECT jsonb_build_object('tournaments',(SELECT count(*) FROM public.tournaments),'receipts',(SELECT count(*) FROM public.table_operation_receipts));");
const beforeCounts=counts();
assert.equal(read("SELECT to_jsonb(md5(prosrc)) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;"),'3fb4d9a225b94f23c80751da468b9f5e');
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const state={kind:'ACTUAL_FLOOR_TOURNAMENTS_NATIVE_READONLY_MODELED_SESSION_NOT_FULL_ACCEPTANCE',runId:1032,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[]};
if(healthy1032){state.runId=1032;state.kind="ACTUAL_OPS_CREATE_COMMITTED_RELOAD_PUBLIC_RECEIPT_MODELED_AUTH_NOT_NORMAL_ROUTER_OR_WHOLE_ACCEPTANCE";}
let remainingFailures=0,receiptEnabled=false;state.writes=[];state.receipts=[];state.kind='ACTUAL_OPS_CREATE_COMMITTED_RELOAD_PUBLIC_RECEIPT_MODELED_AUTH_NOT_NORMAL_ROUTER_OR_WHOLE_ACCEPTANCE';
if(readonly1199){state.runId=readonly1201?1201:1199;state.kind='ACTUAL_FLOOR_LIST_NATIVE_READONLY_MODELED_AUTH_NOT_NORMAL_ROUTE_OR_WHOLE_ACCEPTANCE';}
let armed1199=null;
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'floor1032@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin',readonly1201?'http://127.0.0.1:53001':readonly1199?'http://127.0.0.1:52999':'http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,email:user.email,runId:String(state.runId),model:'Committed canonical create / modeled session / retained TEST only'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value;
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   if(readonly1201&&['get_my_floor_operator_scope'].includes(name))value=await native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public."+name+"()x;");
   else if(readonly1201&&['get_tournament_participation_counts_v1','get_tournament_participation_v1','get_floor_tournament_table_roster_v3','get_floor_tournament_table_roster_v6','get_floor_seatable_entries_v3','get_floor_restorable_entries_v3','get_floor_pending_tracker_moves_v1'].includes(name)){uuid(body.p_tournament_id);assert.ok(state.calendarOracle.some(t=>t.id===body.p_tournament_id));value=await native("SELECT public."+name+"('"+body.p_tournament_id+"');");}
   else if(name==='get_my_ops_capability_scope')value=await native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_ops_capability_scope() x;");
   else if(name==='get_my_ops_global_capability')value=await native("SELECT jsonb_agg(jsonb_build_object('is_super_admin',is_super_admin)) FROM public.get_my_ops_global_capability();");
   else if(['create_tournament_with_levels_v1','get_tournament_create_receipt_v1'].includes(name)){
    assert.equal(readonly1199,false,'READONLY1199_NO_CREATE_OR_RECEIPT');assert.equal(body.p_club_id,club);assert.equal(body.p_expected_actor_id,actor);uuid(body.p_request_id);assert.deepEqual(body.p_levels,[]);
    assert.deepEqual(Object.keys(body).sort(),['p_club_id','p_config','p_expected_actor_id','p_levels','p_request_id']);
    assert.deepEqual(body.p_config,{name:'Create1032 browser durable TEST',start_time:'2030-01-02T13:00:00.000Z',buy_in:100000,rake_amount:0,service_fee_amount:0,starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6,status:'upcoming',current_level:1});
    const args=[literal(club),literal(JSON.stringify(body.p_config))+'::jsonb',"'[]'::jsonb",literal(body.p_request_id)+'::uuid',literal(actor)].join(',');
    if(name==='get_tournament_create_receipt_v1'&&!receiptEnabled){state.receipts.push({request:body,mode:'INJECTED_503_BEFORE_READ'});return send(503,{message:'LOCAL1032_RECEIPT_HELD'});}
    if(name==='create_tournament_with_levels_v1'){assert.equal(state.writes.length,0);state.attempt=body;writeFileSync('D:/Quy trình/output/reports/create1032-inflight-local-20261027.json',JSON.stringify({guard,request:body,protectedBefore,beforeCounts},null,2));}
    value=await (name==='create_tournament_with_levels_v1'?commitNative:native)('SELECT public.'+name+'('+args+');');assert.equal(value.ok,true);
    if(name==='create_tournament_with_levels_v1'){state.writes.push({request:body,result:value});created=value.tournament_id;requestId=body.p_request_id;state.createdTour=created;state.insideRow=await native("SELECT to_jsonb(t) FROM public.tournaments t WHERE id='"+created+"';");return send(503,{message:'LOCAL1032_RESPONSE_LOST_AFTER_NATIVE_COMMIT'});}
    state.receipts.push({request:body,mode:'NATIVE_READ',result:value});
   }else if(name==='get_club_table_inventory'){assert.equal(body.p_club_id,club);value=await native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_club_table_inventory('${club}') x;`);}
   else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_NO_WRITERS'});}
  }else if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(readonly1201&&['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(name)){assert.equal(u.searchParams.get('user_id'),'eq.'+actor);const select=u.searchParams.get('select');assert.equal(select,name==='user_roles'?'role':name==='dealers'?'id':'club_id');value=await native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT "+select+" FROM public."+name+" WHERE user_id='"+actor+"'"+(name==='dealers'?" AND deleted_at IS NULL":'')+(name==='user_roles'?'':' LIMIT 1')+")x;");}
   else if(readonly1201&&name==='clubs'&&u.searchParams.get('select')==='id'){assert.equal(u.searchParams.get('owner_id'),'eq.'+actor);value=await native("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='"+actor+"' LIMIT 1)x;");}
   else if(name==='clubs'){
    assert.equal(u.searchParams.get('select'),'id,name');const ids=u.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);value=await native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id IN(${list.map(literal).join(',')});`);
   }else if(name==='tournaments'){
    if(readonly1201&&u.searchParams.get('select')==='*'){assert.equal(u.searchParams.get('club_id'),'in.('+club+')');assert.equal(u.searchParams.get('deleted_at'),'is.null');assert.equal(u.searchParams.get('status'),'in.(upcoming,registering,drawing,active,live,break,final_table)');value=await native("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY created_at DESC),'[]') FROM public.tournaments t WHERE club_id='"+club+"' AND deleted_at IS NULL AND status IN('upcoming','registering','drawing','active','live','break','final_table');");state.calendarOracle=value.map(t=>({id:t.id,name:t.name,start_time:t.start_time,status:t.status}));}
    else {assert.equal(u.searchParams.get('club_id'),'eq.'+club);assert.equal(u.searchParams.get('order'),'created_at.desc');
    assert.equal(u.searchParams.get('select').replaceAll(/\s/g,''),'*,tournament_tables(id,table_id,game_table_id,table_session_id,status,canonical_game_table:game_tables!tournament_tables_game_table_id_v3_fkey(id,table_name),game_tables!tournament_tables_table_id_fkey(id,table_name))');
    value=await native("SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('tournament_tables',(SELECT coalesce(jsonb_agg(to_jsonb(tt)||jsonb_build_object('canonical_game_table',(SELECT jsonb_build_object('id',g.id,'table_name',g.table_name) FROM public.game_tables g WHERE g.id=tt.game_table_id),'game_tables',(SELECT jsonb_build_object('id',g.id,'table_name',g.table_name) FROM public.game_tables g WHERE g.id=tt.table_id))),'[]') FROM (SELECT id,table_id,game_table_id,table_session_id,status FROM public.tournament_tables WHERE tournament_id=t.id)tt)) ORDER BY t.created_at DESC),'[]') FROM public.tournaments t WHERE club_id='"+club+"';");
    state.calendarOracle=value.map(t=>({id:t.id,name:t.name,start_time:t.start_time,status:t.status}));}
   }else if(name==='tracker_floor_alerts'){
    assert.equal(u.searchParams.get('select'),'id,tournament_id,physical_table_id,hand_id,title,priority,status');assert.equal(u.searchParams.get('status'),'in.(open,acknowledged,in_progress)');assert.equal(u.searchParams.get('order'),'created_at.asc');
    const ids=u.searchParams.get('tournament_id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);assert.ok(state.calendarOracle&&list.every(id=>state.calendarOracle.some(t=>t.id===id)));
    value=await native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,tournament_id,physical_table_id,hand_id,title,priority,status FROM public.tracker_floor_alerts WHERE tournament_id IN("+list.map(literal).join(',')+") AND status IN('open','acknowledged','in_progress') ORDER BY created_at)x;");
   }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_READ_NOT_ALLOWED'});}
  }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_NO_WRITERS'});}
  state.reads.push({name,nativeRows:Array.isArray(value)?value.length:null});
  if(readonly1199&&name==='tournaments'&&armed1199){
   const kind=armed1199;armed1199=null;const fault={kind,startedAt:Date.now()};state.faults.push(fault);
   if(kind==='null')return send(200,null);
   if(kind==='503')return send(503,{message:'LOCAL1201_LIST_503'});
   assert.equal(kind,'hang');
   res.once('close',()=>{fault.clientClosed=true;fault.closedAfterMs=Date.now()-fault.startedAt;});
   return;
  }
  if(remainingFailures>0&&name==='tournaments'){remainingFailures--;state.faults.push({kind:'503',remaining:remainingFailures});return send(503,{message:'LOCAL1032_INJECTED_READ_FAILURE'});}
  send(200,value);
 }catch(error){state.errors.push({message:error.message});send(500,{message:'LOCAL1032_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('CONFIG1032_CANONICAL_NATIVE_TRANSACTION_READY');
 await new Promise(resolve=>{process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(!command)return;if(readonly1199&&['null','hang','503'].includes(command)){assert.equal(armed1199,null);armed1199=command;console.log('FLOOR1199_ARMED_'+command);}else if(command==='recover'){receiptEnabled=true;console.log('CONFIG1032_RECEIPT_RECOVERY_ENABLED');}else if(command==='next'){assert.equal(healthy1032,false);assert.equal(remainingFailures,0);remainingFailures=4;console.log('FLOOR1032_ARMED_FOUR_503');}else if(command==='stop'){process.stdin.pause();resolve();}else throw Error('unknown command');});});
 if(readonly1199){assert.equal(state.writes.length,0);assert.equal(state.receipts.length,0);assert.equal(armed1199,null);assert.ok(state.faults.some(f=>f.kind==='null'));assert.ok(state.faults.some(f=>f.kind==='hang'&&f.clientClosed&&f.closedAfterMs>=9000));assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);}
 else {assert.equal(state.writes.length,1);assert.equal(state.receipts.filter(r=>r.mode==='NATIVE_READ').length,1);assert.deepEqual(state.receipts.at(-1).request,state.writes[0].request);assert.deepEqual(state.receipts.at(-1).result,state.writes[0].result);assert.equal(state.insideRow.name,'Create1032 browser durable TEST');assert.equal(state.insideRow.status,'upcoming');assert.equal(state.insideRow.current_level,1);assert.equal(state.faults.length,0);assert.equal(remainingFailures,0);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);}
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.protectedBefore=protectedBefore;state.protectedAfter=protectedFingerprint();assert.equal(state.protectedBefore,state.protectedAfter);
 state.beforeCounts=beforeCounts;state.afterCounts=counts();assert.equal(state.afterCounts.tournaments,beforeCounts.tournaments+(readonly1199?0:1));assert.equal(state.afterCounts.receipts,beforeCounts.receipts+(readonly1199?0:1));
state.after=fingerprint();state.unchanged=state.before===state.after;writeFileSync(readonly1199?output1199:'D:/Quy trình/output/reports/floor'+state.runId+'-browser-native-local-20261027.json',JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,readonly1199);
}
console.log(healthy1032?'CONFIG1032_CANONICAL_CREATE_COMMIT_RELOAD_RECEIPT_PASS':'FLOOR1032_CALENDAR_AND_RECOVERY_NATIVE_UNCHANGED_PASS');
