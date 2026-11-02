// HISTORICAL FAILED ADAPTER PRECONDITION: do not run for acceptance; see checkpoint1025.
import assert from 'node:assert/strict';
import {createSingle643Reads} from '../dealerSwing/single643.swing-read.local.mjs';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const healthy1000=process.env.VINPOKER_SWING1023_LOCAL==='1';
assert.ok(healthy1000||process.env.VINPOKER_SWING1023_LOCAL==='1');
const club='d4427834-5f5f-48ef-bde5-e2dc388ed00b',tour='c367013a-3ed3-48af-ad48-3915acadc50e',actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ops_cash115_qualified_c');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const state={kind:'ACTUAL_FLOOR_TOURNAMENTS_NATIVE_READONLY_MODELED_SESSION_NOT_FULL_ACCEPTANCE',runId:1023,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[]};
if(healthy1000){state.runId=1023;state.kind="ACTUAL_MULTIDAY_ACCOUNTING_INTEGRITY_NATIVE_READS_MODELED_SESSION_NOT_FULL_ACCEPTANCE";}
let corrupt=false;const bridgeLog=[];const swingRead=createSingle643Reads({sql,query:native,club,log:bridgeLog});
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'swing1023@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(req.method==='POST'&&u.pathname==='/__local/1023/mode'){assert.ok(['native','inconsistent'].includes(body.mode));corrupt=body.mode==='inconsistent';return send(200,{mode:body.mode});}
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,email:user.email,runId:'1023',dealerPhone:true,model:'READ ONLY primary / existing modeled session'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value;
  if(req.method==='POST'&&name==='logout'){sessions.clear();return send(200,{});}
  if(req.method==='GET'&&name==='user_roles'){assert.equal(u.searchParams.get('user_id'),'eq.'+actor);value=native("SELECT coalesce(jsonb_agg(jsonb_build_object('role',role)),'[]') FROM public.user_roles WHERE user_id='"+actor+"';");}
  else if(req.method==='GET'&&name==='clubs'){assert.equal(u.searchParams.get('owner_id'),'eq.'+actor);value=native("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='"+actor+"' LIMIT 1)c;");}
  else if(req.method==='GET'&&name==='dealers'&&u.searchParams.has('user_id')){assert.equal(u.searchParams.get('user_id'),'eq.'+actor);value=native("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM(SELECT id FROM public.dealers WHERE user_id='"+actor+"' AND deleted_at IS NULL LIMIT 1)d;");}
  else if(req.method==='GET'&&['club_accountants','club_chip_masters','club_fnb_staff','club_marketers'].includes(name)){assert.equal(u.searchParams.get('user_id'),'eq.'+actor);value=native("SELECT coalesce(jsonb_agg(jsonb_build_object('club_id',club_id)),'[]') FROM(SELECT club_id FROM public."+name+" WHERE user_id='"+actor+"' LIMIT 1)m;");}
  else if(req.method==='PATCH'&&name==='profiles'){state.heldProfileWrites??=[];state.heldProfileWrites.push({name});return send(403,{message:'LOCAL_NOTIFICATION_PROFILE_WRITE_HELD'});}
  else {const answer=swingRead(req.method,u,body);if(!answer.matched){state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1023_READONLY_UNSUPPORTED'});}value=answer.value;if(answer.singular)value=value[0]??null;}
  if(corrupt&&name==='tournaments'&&u.searchParams.has('status')){state.faults.push({kind:'NULL_ACTIVE_TOURNAMENTS',nativeRows:Array.isArray(value)?value.length:null});value=null;}
  state.reads.push({name,nativeRows:Array.isArray(value)?value.length:null});

  send(200,value);
 }catch(error){state.errors.push({message:error.message});send(500,{message:'LOCAL1000_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('SWING1023_NATIVE_READONLY_READY');
 await new Promise(resolve=>{process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(!command)return;if(command==='stop'){process.stdin.pause();resolve();}else throw Error('unknown command');});});
 assert.ok(state.faults.length>0);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.bridgeLog=bridgeLog;state.after=fingerprint();state.unchanged=state.before===state.after;writeFileSync('D:/Quy trình/output/reports/swing'+state.runId+'-browser-native-local-20261027.json',JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);
}
console.log(healthy1000?'SWING1023_HEALTHY_NATIVE_UNCHANGED_PASS':'SWING1023_CALENDAR_AND_RECOVERY_NATIVE_UNCHANGED_PASS');
