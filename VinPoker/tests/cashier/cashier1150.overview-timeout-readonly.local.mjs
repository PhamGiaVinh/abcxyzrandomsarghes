import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
assert.equal(existsSync('D:/Quy trình/output/reports/cashier1150-bootstrap-browser-native-local-20261027.json'),false);
const healthy985=true;assert.equal(process.env.VINPOKER_CASHIER1150_LOCAL,'1');
const healthy984=healthy985||process.env.VINPOKER_CASHIER984_LOCAL==='1';
assert.ok(healthy984||process.env.VINPOKER_CASHIER983_LOCAL==='1');
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','cashier_till_shifts','cashier_refund_requests','user_roles','dealers','clubs','club_chip_masters','club_marketers','club_fnb_staff','club_accountants','tournament_registrations','profiles'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
assert.equal(process.cwd().replaceAll('\\','/'),'D:/wt/vinpoker-ops-local-integration/VinPoker');
const state={kind:'ACTUAL_CASHIER_WORKBENCH_NATIVE_READONLY_BOOTSTRAP_FAULTS_MODELED_SESSION_NOT_FULL_ACCEPTANCE',runId:1150,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[]};
if(healthy984){state.runId=1150;state.kind='CASHIER_OVERVIEW_HUNG_READ_RECOVERY_NATIVE_NOT_FINANCIAL_OR_AUTH_ACCEPTANCE';}
let armed=null;
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'cashier983@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5202');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,x-retry-count');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,email:user.email,runId:String(state.runId),model:'READ ONLY native PG / local modeled session'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value,closed=false;
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   if(name==='get_my_ops_capability_scope')value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_ops_capability_scope() x;");
   else if(name==='get_my_ops_global_capability')value=native("SELECT jsonb_agg(jsonb_build_object('is_super_admin',is_super_admin)) FROM public.get_my_ops_global_capability();");
   else if(name==='cashier_shift_summary_v1'){uuid(body.p_shift_id);value=native(`SELECT public.cashier_shift_summary_v1('${body.p_shift_id}');`);}
   else if(name==='cashier_tour_worklist_v1'){
    assert.equal(body.p_club_id,club);uuid(body.p_tournament_id);assert.ok(['counter','completed','waiting_seat','needs_review','all'].includes(body.p_bucket));assert.equal(body.p_limit,50);assert.ok(Number.isInteger(body.p_page)&&body.p_page>=0);assert.equal(typeof body.p_query,'string');
    value=native(`SELECT public.cashier_tour_worklist_v1('${club}','${body.p_tournament_id}',${literal(body.p_query)},${literal(body.p_bucket)},${body.p_page},50);`);
   }else if(name==='cashier_tour_issues_v1'){assert.equal(body.p_club_id,club);if(body.p_tournament_id!==null)uuid(body.p_tournament_id);value=native(`SELECT public.cashier_tour_issues_v1('${club}',${literal(body.p_tournament_id)});`);}
   else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL983_NO_WRITERS'});}
  }else if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(name)){
    assert.equal(u.searchParams.get('user_id'),'eq.'+actor);const columns=name==='user_roles'?'role':name==='dealers'?'id':'club_id';assert.equal(u.searchParams.get('select'),columns);
    if(name==='dealers')assert.equal(u.searchParams.get('deleted_at'),'is.null');if(name!=='user_roles')assert.equal(u.searchParams.get('limit'),'1');
    value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.${name} WHERE user_id='${actor}'${name==='dealers'?' AND deleted_at IS NULL':''}${name==='user_roles'?'':' LIMIT 1'})x;`);
   }else if(name==='clubs'&&u.searchParams.get('select')==='id'){
    assert.equal(u.searchParams.get('owner_id'),'eq.'+actor);assert.equal(u.searchParams.get('limit'),'1');value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM(SELECT id FROM clubs WHERE owner_id='${actor}' LIMIT 1)c;`);
   }else if(name==='clubs'){
    assert.equal(u.searchParams.get('select'),'id,name');const ids=u.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id IN(${list.map(literal).join(',')});`);
   }else if(name==='tournament_registrations'){
    assert.equal(u.searchParams.get('select')?.replaceAll(/\s/g,''),'id,reference_code,status,total_pay,player_id,tournament_id,committed_at');assert.equal(u.searchParams.get('club_id'),'eq.'+club);assert.equal(u.searchParams.get('status'),'in.(pending,confirmed)');assert.equal(u.searchParams.get('order'),'committed_at.desc');assert.equal(u.searchParams.get('limit'),'150');value=native(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY committed_at DESC),'[]') FROM(SELECT id,reference_code,status,total_pay,player_id,tournament_id,committed_at FROM tournament_registrations WHERE club_id='${club}' AND status IN('pending','confirmed') ORDER BY committed_at DESC LIMIT 150)t;`);
   }else if(name==='profiles'){
    assert.equal(u.searchParams.get('select')?.replaceAll(/\s/g,''),'user_id,display_name,phone');const ids=u.searchParams.get('user_id');assert.match(ids??'',/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');assert.ok(list.length<=150);list.forEach(uuid);const allowed=native(`SELECT coalesce(jsonb_agg(DISTINCT player_id),'[]') FROM tournament_registrations WHERE club_id='${club}' AND status IN('pending','confirmed');`);assert.ok(list.every(id=>allowed.includes(id)));value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name,'phone',phone)),'[]') FROM profiles WHERE user_id IN(${list.map(literal).join(',')});`);
   }else if(name==='tournaments'&&u.searchParams.get('select')?.replaceAll(/\s/g,'')==='id,name'){
    assert.equal(u.searchParams.get('club_id'),'eq.'+club);const ids=u.searchParams.get('id');assert.match(ids??'',/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');assert.ok(list.length<=150);list.forEach(uuid);value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM tournaments WHERE club_id='${club}' AND id IN(${list.map(literal).join(',')});`);
   }else if(name==='tournaments'&&u.searchParams.get('select')?.replaceAll(/\s/g,'')==='id,name,status,start_time,buy_in'){
    assert.equal(u.searchParams.get('club_id'),'eq.'+club);assert.equal(u.searchParams.get('order'),'created_at.desc');assert.equal(u.searchParams.get('limit'),'80');value=native(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY created_at DESC),'[]') FROM(SELECT id,name,status,start_time,buy_in,created_at FROM tournaments WHERE club_id='${club}' ORDER BY created_at DESC LIMIT 80)t;`).map(({created_at:_createdAt,...row})=>row);
   }else if(name==='tournaments'){
    assert.equal(u.searchParams.get('club_id'),`eq.${club}`);assert.equal(u.searchParams.get('deleted_at'),'is.null');assert.equal(u.searchParams.get('limit'),'80');assert.equal(u.searchParams.get('select'),'id,name,start_time,status,registration_closed_at');
    value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'start_time',start_time,'status',status,'registration_closed_at',registration_closed_at) ORDER BY start_time DESC),'[]') FROM (SELECT * FROM public.tournaments WHERE club_id='${club}' AND deleted_at IS NULL ORDER BY start_time DESC LIMIT 80) t;`);
   }else if(name==='cashier_till_shifts'){
    assert.equal(u.searchParams.get('club_id'),`eq.${club}`);closed=u.searchParams.get('closed_at')==='not.is.null';assert.equal(u.searchParams.get('closed_at'),closed?'not.is.null':'is.null');
    value=closed?native(`SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY closed_at DESC),'[]') FROM (SELECT id,opening_cash,opened_at,closed_at,counted_cash,expected_cash,variance_cash FROM public.cashier_till_shifts WHERE club_id='${club}' AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 20) s;`):native(`SELECT coalesce((SELECT jsonb_build_object('id',id,'opening_cash',opening_cash,'opened_at',opened_at) FROM public.cashier_till_shifts WHERE club_id='${club}' AND closed_at IS NULL),'null'::jsonb);`);
   }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL983_READ_NOT_ALLOWED'});}
  }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL983_NO_WRITERS'});}
  state.reads.push({name,closed,nativeRows:Array.isArray(value)?value.length:null});
  if(armed==='toursNull'&&name==='tournaments'||armed==='closedNull'&&name==='cashier_till_shifts'&&closed){const kind=armed;armed=null;state.faults.push({kind,nativeRows:value.length});return send(200,null);}
  if(armed==='hangRegistrations'&&name==='tournament_registrations'){
   armed=null;const observation={kind:'hangRegistrations',started:Date.now(),clientClosed:false};state.faults.push(observation);res.once('close',()=>{observation.clientClosed=true;observation.closedAfterMs=Date.now()-observation.started;});await new Promise(resolve=>setTimeout(resolve,12000));observation.delayMs=Date.now()-observation.started;observation.closedBeforeSend=res.destroyed;send(200,value);return;
  }
  send(200,value);
 }catch(error){state.errors.push({message:error.message});send(500,{message:'LOCAL983_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('CASHIER983_READONLY_READY');
 await new Promise(resolve=>{let index=0;process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='next'){assert.equal(armed,null);assert.equal(index++,0);armed='hangRegistrations';console.log('CASHIER1150_ARMED_'+armed);}else if(command==='stop'){process.stdin.pause();resolve();}else throw new Error('unknown command');});});
 assert.equal(state.faults.length,1);assert.ok(state.faults[0].clientClosed);assert.ok(state.faults[0].delayMs>=12000);assert.ok(state.faults[0].closedBeforeSend);assert.ok(state.faults[0].closedAfterMs<11000);assert.ok(state.reads.filter(r=>r.name==='tournament_registrations').length>=3);assert.equal(armed,null);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.after=fingerprint();state.unchanged=state.before===state.after;writeFileSync(`D:/Quy trình/output/reports/cashier${state.runId}-bootstrap-browser-native-local-20261027.json`,JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);
}
console.log(healthy984?'CASHIER984_HEALTHY_SCREEN_READS_UNCHANGED_PASS':'CASHIER983_THREE_FAULTS_NATIVE_UNCHANGED_PASS');

