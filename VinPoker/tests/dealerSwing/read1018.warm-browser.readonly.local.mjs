import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const healthy988=true;
assert.equal(process.env.VINPOKER_DEALER1018_LOCAL,'1');
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['game_tables','dealers','dealer_assignments','dealer_attendance','table_sessions','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const state={kind:'ACTUAL_DEALER_CONTROL_NATIVE_READONLY_FAULTS_MODELED_SESSION_NOT_FULL_ACCEPTANCE',runId:1018,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[]};
if(healthy988){state.runId=1018;state.kind='ACTUAL_DEALER_WARM_FRESH_READS_MODELED_SESSION_NOT_FULL_PERFORMANCE_ACCEPTANCE';}
let armed=null;
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'dealer1018@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,email:user.email,runId:String(state.runId),model:'READ ONLY native PG / local modeled session'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value;
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   if(name==='get_my_ops_capability_scope')value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_ops_capability_scope() x;");
   else if(name==='get_my_ops_global_capability')value=native("SELECT jsonb_agg(jsonb_build_object('is_super_admin',is_super_admin)) FROM public.get_my_ops_global_capability();");
   else if(name==='get_club_table_inventory'){assert.equal(body.p_club_id,club);value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_club_table_inventory('${club}') x;`);}
   else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_NO_WRITERS'});}
  }else if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(name==='clubs'){
    assert.equal(u.searchParams.get('select'),'id,name');const ids=u.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id IN(${list.map(literal).join(',')});`);
   }else if(['game_tables','dealers','dealer_assignments','dealer_attendance'].includes(name)){
    const columns={game_tables:'id,table_name,table_type,status',dealers:'id,full_name,tier',dealer_assignments:'id,table_id,table_session_id,dealer_id,swing_due_at,status,needs_replacement,assigned_at',dealer_attendance:'dealer_id,current_state,check_in_time'};
    assert.equal(u.searchParams.get('select').replaceAll(' ',''),columns[name]);
    const clauses=[];let order;
    if(name!=='dealer_attendance'){assert.equal(u.searchParams.get('club_id'),'eq.'+club);clauses.push('club_id='+literal(club));}
    if(name==='game_tables'){assert.equal(u.searchParams.get('limit'),'200');assert.equal(u.searchParams.get('order'),'table_name.asc');order='table_name';}
    if(name==='dealers'){assert.equal(u.searchParams.get('limit'),'500');assert.equal(u.searchParams.get('deleted_at'),'is.null');assert.equal(u.searchParams.get('order'),'full_name.asc');clauses.push('deleted_at IS NULL');order='full_name';}
    if(name==='dealer_assignments'||name==='dealer_attendance'){
     const col=name==='dealer_assignments'?'table_id':'dealer_id',status=name==='dealer_assignments'?'assigned':'checked_in';
     assert.equal(u.searchParams.get('status'),'eq.'+status);clauses.push('status='+literal(status));
     const ids=u.searchParams.get(col);assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);clauses.push(col+' IN('+list.map(literal).join(',')+')');
     order=name==='dealer_assignments'?'assigned_at DESC':'check_in_time DESC';assert.equal(u.searchParams.get('order'),name==='dealer_assignments'?'assigned_at.desc':'check_in_time.desc');
    }
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT "+columns[name]+' FROM public.'+name+' WHERE '+clauses.join(' AND ')+' ORDER BY '+order+(name==='game_tables'?' LIMIT 200':name==='dealers'?' LIMIT 500':'')+')x;');
   }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_READ_NOT_ALLOWED'});}
  }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_NO_WRITERS'});}
  state.reads.push({name,nativeRows:Array.isArray(value)?value.length:null});
  if(armed===name){assert.ok(Array.isArray(value));state.faults.push({kind:armed,nativeRows:value.length});armed=null;return send(200,null);}
  if(armed==='hangAttendance'&&name==='dealer_attendance'){
   armed=null;const observation={kind:'hangAttendance',started:Date.now()};state.faults.push(observation);res.once('close',()=>{observation.closedAfterMs=Date.now()-observation.started;});await new Promise(resolve=>setTimeout(resolve,12000));observation.delayMs=Date.now()-observation.started;observation.closedBeforeSend=res.destroyed;send(200,value);return;
  }
  send(200,value);
 }catch(error){state.errors.push({message:error.message});send(500,{message:'LOCAL983_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('DEALER1018_NATIVE_READONLY_READY');
 await new Promise(resolve=>{let index=0;process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(!command)return;if(command==='next'){assert.ok(!healthy988);assert.equal(armed,null);assert.ok(index<5);armed=['game_tables','dealers','dealer_assignments','dealer_attendance','hangAttendance'][index++];console.log('DEALER1018_ARMED_'+armed);}else if(command==='stop'){process.stdin.pause();resolve();}else throw new Error('unknown command');});});
 if(healthy988){assert.equal(state.faults.length,0);assert.ok(state.reads.filter(r=>r.name==='get_club_table_inventory').length>=21);}else{assert.equal(state.faults.length,5);assert.ok(state.faults[4].closedBeforeSend);assert.ok(state.faults[4].delayMs>=12000);assert.ok(state.faults[4].closedAfterMs<state.faults[4].delayMs);}assert.equal(armed,null);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.after=fingerprint();state.unchanged=state.before===state.after;writeFileSync(`D:/Quy trình/output/reports/dealer${state.runId}-browser-native-local-20261027.json`,JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);
}
console.log(healthy988?'DEALER1018_WARM_READS_NATIVE_UNCHANGED_PASS':'DEALER1018_FIVE_READ_FAULTS_NATIVE_UNCHANGED_PASS');
