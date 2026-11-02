import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
const batch1197=process.env.VINPOKER_SCHEDULE1197_LOCAL==='1';
const output=batch1197?'D:/Quy trình/output/reports/schedule1197-native-browser-local-20261028.json':'D:/Quy trình/output/reports/players1066-native-browser-local-20261027.json';
assert.equal(existsSync(output),false,'Retained artifact exists');
assert.equal(process.env[batch1197?'VINPOKER_SCHEDULE1197_LOCAL':'VINPOKER_CASHIER1066_LOCAL'],'1');
const healthy985=false;
const healthy984=true;
assert.ok(healthy984||process.env.VINPOKER_CASHIER983_LOCAL==='1');
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='782a5196-5ea1-44ed-8a27-1b872d5f88d9',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const db=batch1197?'vinpoker_stocktake1159_local':'vinpoker_ranking860_local';
const sql=(q,target=db)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE='+target,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,db);assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,batch1197?'VINPOKER_STOCKTAKE1159_OWNED_LOCAL_TEST_CLONE':'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','cashier_till_shifts','cashier_refund_requests','chip_bag'];
if(batch1197)tables.push('tournament_registrations','tournament_levels','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1','tournament_state_transitions','audit_logs','chip_inventory_ledger','chip_bank_ledger');
let createdIds=[],batchRequest=null,receiptEnabled=false;
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>{
 let where='';if(t==='tournaments'&&createdIds.length)where=` WHERE id NOT IN(${createdIds.map(id=>"'"+id+"'").join(',')})`;
 if(t==='table_operation_receipts'&&batchRequest){const key=batchRequest.p_request_id;where=` WHERE NOT(actor_id='${actor}' AND ((operation_type='create_tournament_schedule_batch_v1' AND request_id='${key}') OR(operation_type='create_tournament_with_levels_v1' AND request_id IN(md5('schedule-batch-v1:${key}:1')::uuid,md5('schedule-batch-v1:${key}:2')::uuid))))`;}
 return `(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x${where})`;
}).join(',')})::text));`);
const counts=()=>read("SELECT jsonb_build_object('tournaments',(SELECT count(*) FROM public.tournaments),'receipts',(SELECT count(*) FROM public.table_operation_receipts));");
const bodies=()=>read("SELECT jsonb_object_agg(oid::regprocedure::text,jsonb_build_object('body',md5(prosrc),'acl',proacl::text)) FROM pg_proc WHERE oid IN('public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid)'::regprocedure,'public.get_tournament_schedule_batch_receipt_v1(jsonb,uuid,uuid)'::regprocedure,'public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure);");
let candidateMode=false;
const patch='';
const native=(q,candidate=false)=>JSON.parse(sql(`BEGIN${candidate?'':' READ ONLY'};SET LOCAL statement_timeout='10s';${candidate?patch:''}SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const state={kind:'ACTUAL_FLOOR_SCHEDULE_BLANK_INPUT_BROWSER_FIXED_OCR_MODELED_SESSION_NOT_FULL_ACCEPTANCE',runId:983,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[],ancillaryWrites:[]};
if(healthy984){state.runId=1066;state.kind='ACTUAL_FLOOR_SCHEDULE_BLANK_INPUT_BROWSER_FIXED_OCR_MODELED_SESSION_NOT_FULL_ACCEPTANCE';}
const ocrRows=[{name:'Schedule1197 A browser TEST',start_time:'2030-01-02T13:00:00Z',buy_in:100000,starting_stack:20000,game_type:'nlh',venue:null},{name:'Schedule1197 B browser TEST',start_time:'2030-01-02T14:00:00Z',buy_in:200000,starting_stack:30000,game_type:'plo',venue:null}];
const expectedRows=ocrRows.map(({venue,...row})=>({...row,start_time:new Date(row.start_time).toISOString(),club_id:club,location:venue}));
const save=()=>{if(batch1197)writeFileSync(output.replace('.json','.progress.json'),JSON.stringify(state,null,2));};
if(batch1197){state.runId=1197;state.kind='ACTUAL_BULK_SCHEDULE_BROWSER_CANONICAL_COMMIT_RECEIPT_MODELED_OCR_AUTH_NOT_PROVIDER_OR_WHOLE_ACCEPTANCE';state.writes=[];state.receipts=[];state.beforeCounts=counts();state.beforeBodies=bodies();assert.equal(state.beforeBodies['create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'].body,'3fb4d9a225b94f23c80751da468b9f5e');save();}
let armed=null;
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'cashier983@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin',batch1197?'http://127.0.0.1:52997':'http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(batch1197){assert.equal(req.headers.host,'127.0.0.1:54329');if(req.headers.origin)assert.equal(req.headers.origin,'http://127.0.0.1:52997');}
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,singleTour:true,email:user.email,runId:String(state.runId),model:'READ ONLY native PG / local modeled session'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value,closed=false;
  if(u.pathname==='/functions/v1/parse-tournament-schedule'&&req.method==='POST'){
   assert.equal(body.image_mime,'image/png');assert.equal(typeof body.image_base64,'string');state.reads.push({name:'OCR_FIXED_TEST_NOT_PROVIDER'});
   save();return send(200,{tournaments:batch1197?ocrRows:[{name:'Blank amount browser TEST',start_time:'2030-01-02T13:00:00Z',buy_in:100000,starting_stack:20000,game_type:'nlh',venue:null}]});
  }
  if(req.method==='PATCH'&&name==='profiles'){state.ancillaryWrites.push({method:req.method,name});return send(403,{message:'LOCAL1066_READ_ONLY_NO_PROFILE_WRITE'});}
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   if(batch1197&&['create_tournament_schedule_batch_v1','get_tournament_schedule_batch_receipt_v1'].includes(name)){
    assert.deepEqual(Object.keys(body).sort(),['p_expected_actor_id','p_request_id','p_rows']);assert.equal(body.p_expected_actor_id,actor);uuid(body.p_request_id);assert.deepEqual(body.p_rows,expectedRows);
    if(batchRequest)assert.deepEqual(body,batchRequest);else batchRequest=body;
    const statement=`SELECT public.${name}(${literal(JSON.stringify(body.p_rows))}::jsonb,'${body.p_request_id}','${actor}');`;
    if(name==='get_tournament_schedule_batch_receipt_v1'&&!receiptEnabled){state.receipts.push({request:body,mode:'HELD_503_NO_DB_READ'});save();return send(503,{message:'LOCAL1197_RECEIPT_HELD'});}
    if(name==='create_tournament_schedule_batch_v1'){
     assert.equal(state.writes.length,0);state.attempt=body;save();
     const result=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${statement}COMMIT;`));
     assert.equal(result.ok,true);assert.equal(result.count,2);createdIds=result.tournaments.map(t=>t.tournament_id);assert.equal(new Set(createdIds).size,2);createdIds.forEach(uuid);
     state.writes.push({request:body,result});state.createdIds=createdIds;state.faults.push('COMMIT_RESPONSE_LOSS');save();return send(503,{message:'LOCAL1197_COMMITTED_RESPONSE_LOSS'});
    }
    const receipt=native(statement);assert.deepEqual(receipt,state.writes[0].result);state.receipts.push({request:body,mode:'NATIVE_READ',result:receipt});save();return send(200,receipt);
   }
   if(name==='get_my_floor_operator_scope')value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_floor_operator_scope()x;");
   else if(name==='get_tournament_participation_v1'){assert.deepEqual(body,{p_tournament_id:tour});value=native("SELECT public.get_tournament_participation_v1('"+tour+"');",candidateMode);}
   else if(name==='get_floor_tournament_table_inventory_v1'){assert.deepEqual(body,{p_tournament_id:tour});value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_floor_tournament_table_inventory_v1('"+tour+"')x;");}
   else {state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1066_NO_WRITERS'});}
  }else if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(name)){
    assert.equal(u.searchParams.get('user_id'),'eq.'+actor);const select=u.searchParams.get('select');assert.equal(select,name==='user_roles'?'role':name==='dealers'?'id':'club_id');
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT "+select+" FROM public."+name+" WHERE user_id='"+actor+"'"+(name==='dealers'?" AND deleted_at IS NULL":"")+(name==='user_roles'?"":" LIMIT 1")+")x;");
   }else if(name==='clubs'){assert.equal(u.searchParams.get('select'),'id');assert.equal(u.searchParams.get('owner_id'),'eq.'+actor);value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='"+actor+"' LIMIT 1)x;");}
   else if(name==='tournaments'){assert.equal(u.searchParams.get('select'),'*');assert.equal(u.searchParams.get('id'),'eq.'+tour);value=native("SELECT to_jsonb(t) FROM public.tournaments t WHERE id='"+tour+"';");}
   else {state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1066_READ_NOT_ALLOWED'});}
  }else {state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1066_READ_ONLY'});}
  state.reads.push({name,closed,candidateMode,nativeRows:Array.isArray(value)?value.length:null,waiting:name==='get_tournament_participation_v1'?value.counts.waiting:null,bagged:name==='get_tournament_participation_v1'?value.entries.filter(e=>e.status==='bagged').length:null});
  if(armed==='metadata'&&name==='cashier_tour_worklist_v1'){armed=null;state.faults.push({kind:'INVALID_UPDATED_AT',nativeRows:value.rows.length});return send(200,{...value,updated_at:'invalid-date'});}
  if(armed==='toursNull'&&name==='tournaments'||armed==='closedNull'&&name==='cashier_till_shifts'&&closed){const kind=armed;armed=null;state.faults.push({kind,nativeRows:value.length});return send(200,null);}
  if(armed==='hangTours'&&name==='tournaments'){
   armed=null;const observation={kind:'hangTours',started:Date.now(),clientClosed:false};state.faults.push(observation);res.once('close',()=>{observation.clientClosed=true;observation.closedAfterMs=Date.now()-observation.started;});await new Promise(resolve=>setTimeout(resolve,12000));observation.delayMs=Date.now()-observation.started;observation.closedBeforeSend=res.destroyed;send(200,value);return;
  }
  send(200,value);
 }catch(error){state.errors.push({message:error.message});save();send(500,{message:'LOCAL983_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('CASHIER983_READONLY_READY');
 await new Promise(resolve=>{let index=0;process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(batch1197&&command==='receipt'){receiptEnabled=true;console.log('SCHEDULE1197_NATIVE_RECEIPT_ENABLED');}else if(command==='candidate'){candidateMode=true;console.log('PLAYERS1066_TRANSACTION_CANDIDATE_ENABLED');}else if(command==='badrefund'){assert.equal(armed,null);armed='refund';console.log('CASHIER1066_REFUND_FAULT_ARMED');}else if(command==='badmeta'){assert.equal(armed,null);armed='metadata';console.log('CASHIER1066_METADATA_ARMED');}else if(command==='next'){assert.ok(!healthy984);assert.equal(armed,null);assert.ok(index<3);armed=['toursNull','closedNull','hangTours'][index++];console.log('CASHIER983_ARMED_'+armed);}else if(command==='stop'){process.stdin.pause();resolve();}else throw new Error('unknown command');});});
 if(healthy984){assert.equal(state.faults.length,batch1197?1:0);assert.equal(state.reads.filter(r=>r.name==='OCR_FIXED_TEST_NOT_PROVIDER').length,1);if(batch1197){assert.equal(state.writes.length,1);assert.equal(state.receipts.filter(r=>r.mode==='NATIVE_READ').length,1);state.afterCounts=counts();assert.equal(state.afterCounts.tournaments,state.beforeCounts.tournaments+2);assert.equal(state.afterCounts.receipts,state.beforeCounts.receipts+3);state.afterBodies=bodies();assert.deepEqual(state.afterBodies,state.beforeBodies);}}else{assert.equal(state.faults.length,3);assert.ok(state.faults[2].clientClosed);assert.ok(state.faults[2].delayMs>=12000);assert.ok(state.faults[2].closedBeforeSend);assert.ok(state.faults[2].closedAfterMs<state.faults[2].delayMs);}assert.equal(armed,null);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.after=fingerprint();state.unchanged=state.before===state.after;state.finalBody=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure;");assert.equal(state.finalBody,'b9624adaa8d7bb35713917486c40fe67');writeFileSync(output,JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);
}
console.log(healthy984?'CASHIER984_HEALTHY_SCREEN_READS_UNCHANGED_PASS':'CASHIER983_THREE_FAULTS_NATIVE_UNCHANGED_PASS');
