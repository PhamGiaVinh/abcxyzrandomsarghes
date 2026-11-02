import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
assert.equal(existsSync('D:/Quy trình/output/reports/fnb1084-native-browser-local-20261027.json'),false,'Retained artifact exists');
assert.equal(process.env.VINPOKER_CASHIER1084_LOCAL,'1');
const healthy985=false;
const healthy984=true;
assert.ok(healthy984||process.env.VINPOKER_CASHIER983_LOCAL==='1');
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='782a5196-5ea1-44ed-8a27-1b872d5f88d9',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['fnb_categories','fnb_menu_items','fnb_ingredients','fnb_recipe_items','fnb_stock_movements','fnb_stocktakes','fnb_stocktake_lines','fnb_orders','fnb_order_items','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_bank_ledger','tournament_hands','table_operation_receipts'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
let candidateMode=false;
const patch='';
const native=(q,candidate=false)=>JSON.parse(sql(`BEGIN${candidate?'':' READ ONLY'};SET LOCAL statement_timeout='10s';${candidate?patch:''}SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const state={kind:'ACTUAL_FNB_CATALOG_DIALOG_NATIVE_BACKGROUND_READ_RECOVERY_NOT_FULL_ACCEPTANCE',runId:983,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[],ancillaryWrites:[]};
if(healthy984){state.runId=1084;state.kind='ACTUAL_BAGGED_QUEUE_NATIVE_BROWSER_READ_RECOVERY_NOT_FULL_ACCEPTANCE';}
let armed=null;let menuFault=false,recipeFault=false,stockFault=false;
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'cashier983@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,singleTour:true,email:user.email,runId:String(state.runId),model:'READ ONLY native PG / local modeled session'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value,closed=false;
  if(req.method==='PATCH'&&name==='profiles'){state.ancillaryWrites.push({method:req.method,name});return send(403,{message:'LOCAL1084_READ_ONLY_NO_PROFILE_WRITE'});}
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   if(name==='get_my_floor_operator_scope')value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_floor_operator_scope()x;");
   else if(name==='get_tournament_participation_v1'){assert.deepEqual(body,{p_tournament_id:tour});value=native("SELECT public.get_tournament_participation_v1('"+tour+"');",candidateMode);}
   else if(name==='get_floor_tournament_table_inventory_v1'){assert.deepEqual(body,{p_tournament_id:tour});value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_floor_tournament_table_inventory_v1('"+tour+"')x;");}
   else {state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1084_NO_WRITERS'});}
  }else if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(name)){
    assert.equal(u.searchParams.get('user_id'),'eq.'+actor);const select=u.searchParams.get('select');assert.equal(select,name==='user_roles'?'role':name==='dealers'?'id':'club_id');
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT "+select+" FROM public."+name+" WHERE user_id='"+actor+"'"+(name==='dealers'?" AND deleted_at IS NULL":"")+(name==='user_roles'?"":" LIMIT 1")+")x;");
   }else if(['tournament_registrations','tournament_entries','seat_draw_receipts'].includes(name)){
    assert.equal(u.searchParams.get('tournament_id'),'eq.'+tour);
    const columns={tournament_registrations:'id,reference_code,status,total_pay,committed_at,confirmed_at,confirmed_by,player_id',tournament_entries:'id,registration_id,player_id,status,current_stack',seat_draw_receipts:'entry_id,registration_id,receipt_code,status,table_number,seat_number,display_name,issued_at'};
    assert.equal(u.searchParams.get('select').replaceAll(' ',''),columns[name]);
    let tail='';if(name==='tournament_registrations'){assert.equal(u.searchParams.get('status'),'in.(pending,confirmed)');assert.equal(u.searchParams.get('limit'),'300');tail=" AND status IN('pending','confirmed') ORDER BY committed_at ASC LIMIT 300";}else if(name==='seat_draw_receipts'){assert.equal(u.searchParams.get('status'),'in.(issued,printed)');tail=" AND status IN('issued','printed') ORDER BY issued_at DESC";}
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT "+columns[name]+" FROM public."+name+" WHERE tournament_id='"+tour+"'"+tail+")x;");
    if(name==='tournament_registrations'&&armed==='queueNull'){state.faults.push({kind:'NATIVE_REGISTRATIONS_RESPONSE_NULL',nativeRows:value.length});armed=null;value=null;}
   }else if(['fnb_categories','fnb_menu_items','fnb_ingredients'].includes(name)){
    assert.equal(u.searchParams.get('select'),'*');assert.equal(u.searchParams.get('club_id'),'eq.'+club);
    const order=name==='fnb_categories'?'sort_order,name':name==='fnb_menu_items'?'sort_order':'name';
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public."+name+" WHERE club_id='"+club+"' ORDER BY "+order+")x;");
    if(name==='fnb_menu_items'&&menuFault){menuFault=false;state.faults.push({kind:'NATIVE_MENU_ITEMS_NULL',nativeRows:value.length});value=null;}
   }else if(name==='fnb_recipe_items'){
    assert.equal(u.searchParams.get('select'),'ingredient_id,qty');const id=u.searchParams.get('menu_item_id')?.slice(3);uuid(id);
    const item=native("SELECT to_jsonb(EXISTS(SELECT FROM public.fnb_menu_items WHERE id='"+id+"' AND club_id='"+club+"'));");assert.equal(item,true);
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ingredient_id,qty FROM public.fnb_recipe_items WHERE menu_item_id='"+id+"')x;");
    if(recipeFault){recipeFault=false;state.faults.push({kind:'NATIVE_RECIPE_NULL',nativeRows:value.length});assert.ok(value.length>0);value=null;}
   }else if(name==='fnb_stocktakes'){
    assert.equal(u.searchParams.get('select'),'id');assert.equal(u.searchParams.get('club_id'),'eq.'+club);assert.equal(u.searchParams.get('status'),'eq.open');assert.equal(u.searchParams.get('limit'),'1');
    value=native("SELECT coalesce((SELECT to_jsonb(x) FROM(SELECT id FROM public.fnb_stocktakes WHERE club_id='"+club+"' AND status='open' LIMIT 1)x),'null'::jsonb);");assert.equal(value,null);
    if(stockFault){stockFault=false;state.reads.push({name,nativeRows:0});state.faults.push({kind:'NATIVE_STOCKTAKE_READ_503',nativeValue:null});return send(503,{message:'LOCAL1084_READ_UNAVAILABLE'});}
   }else if(['leaderboard_entries','all_time_money_list','club_money_list','player_results'].includes(name)){
    assert.equal(u.searchParams.get('select'),'*');let where='';if(name==='player_results'){assert.equal(u.searchParams.get('verified_by_admin'),'eq.true');where=' WHERE verified_by_admin=true';assert.equal(u.searchParams.has('event_date'),false);}
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public."+name+where+")x;");
    if(name==='player_results'&&armed==='money'){assert.ok(value.length>0);const beforePrize=value[0].prize;value[0]={...value[0],prize:null};state.faults.push({kind:'NATIVE_PRIZE_RESPONSE_NULL',nativeRows:value.length,originalPrizeWasNumber:typeof beforePrize==='number'});armed=null;}
   }else if(name==='profiles'){
    assert.equal(u.searchParams.get('select'),'user_id,display_name,phone');const selection=u.searchParams.get('user_id');assert.ok(selection.startsWith('in.(')&&selection.endsWith(')'));const ids=selection.slice(4,-1).split(',');ids.forEach(uuid);
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT user_id,display_name,phone FROM public.profiles WHERE user_id IN("+ids.map(literal).join(',')+"))x;");
   }else if(name==='clubs'&&u.searchParams.get('select')==='*'){
    assert.equal(u.searchParams.get('status'),'eq.approved');assert.equal(u.searchParams.get('order'),'schedule_sort_order.asc,name.asc');
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.clubs WHERE status='approved' ORDER BY schedule_sort_order ASC,name ASC)x;");assert.equal(value.length,491);assert.ok(value.every(c=>!c.cover_url),'No external image URLs in this local browser run');
    if(armed==='clubsNull'){state.faults.push({kind:'NATIVE_CLUBS_RESPONSE_NULL',nativeRows:value.length});value=null;armed=null;}
   }else if(name==='clubs'&&u.searchParams.get('select')==='id,name'){
    assert.equal(u.searchParams.get('status'),'eq.approved');value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,name FROM public.clubs WHERE status='approved')x;");
   }else if(name==='clubs'){assert.equal(u.searchParams.get('select'),'id');assert.equal(u.searchParams.get('owner_id'),'eq.'+actor);value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='"+actor+"' LIMIT 1)x;");}
   else if(name==='tournaments'){assert.equal(u.searchParams.get('select'),'*');assert.equal(u.searchParams.get('id'),'eq.'+tour);value=native("SELECT to_jsonb(t) FROM public.tournaments t WHERE id='"+tour+"';");}
   else {state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1084_READ_NOT_ALLOWED'});}
  }else {state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1084_READ_ONLY'});}
  state.reads.push({name,selection:u.searchParams.get('select'),closed,candidateMode,nativeRows:Array.isArray(value)?value.length:null,waiting:name==='get_tournament_participation_v1'?value.counts.waiting:null,bagged:name==='get_tournament_participation_v1'?value.entries.filter(e=>e.status==='bagged').length:null});
  if(armed==='metadata'&&name==='cashier_tour_worklist_v1'){armed=null;state.faults.push({kind:'INVALID_UPDATED_AT',nativeRows:value.rows.length});return send(200,{...value,updated_at:'invalid-date'});}
  if(armed==='toursNull'&&name==='tournaments'||armed==='closedNull'&&name==='cashier_till_shifts'&&closed){const kind=armed;armed=null;state.faults.push({kind,nativeRows:value.length});return send(200,null);}
  if(armed==='hangTours'&&name==='tournaments'){
   armed=null;const observation={kind:'hangTours',started:Date.now(),clientClosed:false};state.faults.push(observation);res.once('close',()=>{observation.clientClosed=true;observation.closedAfterMs=Date.now()-observation.started;});await new Promise(resolve=>setTimeout(resolve,12000));observation.delayMs=Date.now()-observation.started;observation.closedBeforeSend=res.destroyed;send(200,value);return;
  }
  send(200,value);
 }catch(error){state.errors.push({message:error.message});send(500,{message:'LOCAL983_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('CASHIER983_READONLY_READY');
 await new Promise(resolve=>{let index=0;process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='arm-queue'){assert.equal(armed,null);armed='queueNull';console.log('QUEUE1084_FAULT_ARMED');}else if(command==='arm-menu'){assert.equal(menuFault,false);menuFault=true;console.log('FNB1084_MENU_FAULT_ARMED');}else if(command==='candidate'){candidateMode=true;console.log('PLAYERS1084_TRANSACTION_CANDIDATE_ENABLED');}else if(command==='badrefund'){assert.equal(armed,null);armed='refund';console.log('CASHIER1084_REFUND_FAULT_ARMED');}else if(command==='badmeta'){assert.equal(armed,null);armed='metadata';console.log('CASHIER1084_METADATA_ARMED');}else if(command==='next'){assert.ok(!healthy984);assert.equal(armed,null);assert.ok(index<3);armed=['toursNull','closedNull','hangTours'][index++];console.log('CASHIER983_ARMED_'+armed);}else if(command==='stop'){process.stdin.pause();resolve();}else throw new Error('unknown command');});});
 if(healthy984){assert.equal(state.faults.length,1);assert.equal(state.faults[0].nativeRows,8);assert.ok(state.reads.filter(r=>r.name==='tournament_registrations').length>=3);}else{assert.equal(state.faults.length,3);assert.ok(state.faults[2].clientClosed);assert.ok(state.faults[2].delayMs>=12000);assert.ok(state.faults[2].closedBeforeSend);assert.ok(state.faults[2].closedAfterMs<state.faults[2].delayMs);}assert.equal(armed,null);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.after=fingerprint();state.unchanged=state.before===state.after;state.finalBody=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure;");assert.equal(state.finalBody,'b9624adaa8d7bb35713917486c40fe67');writeFileSync('D:/Quy trình/output/reports/fnb1084-native-browser-local-20261027.json',JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);
}
console.log(healthy984?'CASHIER984_HEALTHY_SCREEN_READS_UNCHANGED_PASS':'CASHIER983_THREE_FAULTS_NATIVE_UNCHANGED_PASS');
