import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const healthy1000=process.env.VINPOKER_MULTIDAY1020_LOCAL==='1';
assert.ok(healthy1000||process.env.VINPOKER_MULTIDAY1020_LOCAL==='1');
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ops_cash115_qualified_c');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const state={kind:'ACTUAL_FLOOR_TOURNAMENTS_NATIVE_READONLY_MODELED_SESSION_NOT_FULL_ACCEPTANCE',runId:1020,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[]};
if(healthy1000){state.runId=1020;state.kind="ACTUAL_MULTIDAY_ACCOUNTING_INTEGRITY_NATIVE_READS_MODELED_SESSION_NOT_FULL_ACCEPTANCE";}
let corrupt=false; const event="dbb49f8d-7d47-4c2c-afd9-f57062c9971d";
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'multiday1020@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(req.method==='POST'&&u.pathname==='/__local/1020/mode'){assert.ok(['native','inconsistent'].includes(body.mode));corrupt=body.mode==='inconsistent';return send(200,{mode:body.mode});}
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,email:user.email,runId:'1020',d2Event:event,model:'READ ONLY native primary / existing modeled session'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value;
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   if(name==='get_my_ops_capability_scope')value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_ops_capability_scope() x;");
   else if(name==='get_my_ops_global_capability')value=native("SELECT jsonb_agg(jsonb_build_object('is_super_admin',is_super_admin)) FROM public.get_my_ops_global_capability();");
   else if(['multi_day_floor_read_v1','multi_day_qualification_preview_v1','multi_day_payout_postfinal_state_v1','multi_day_final_roster_v1'].includes(name)){
    assert.deepEqual(body,{p_event_id:event});value=native("SELECT public."+name+"('"+event+"');");
    state.nativePayloads??={};state.nativePayloads[name]=structuredClone(value);
    if(corrupt&&name==='multi_day_floor_read_v1'){value.finalization.unpaidObligationVnd+=1;state.faults.push({kind:'INCONSISTENT_UNPAID_SUMMARY',name});}
   }
   else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_NO_WRITERS'});}
  }else if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(['tournament_hands','hand_players','hand_actions','tournament_seats'].includes(name)){
    const allowed={tournament_hands:['id','hand_number','hand_time','community_cards','pot_size','status','is_voided','created_at','table_id','button_seat'],hand_players:['id','hand_id','player_id','entry_number','seat_number','starting_stack','ending_stack','is_eliminated','hole_cards','player_name'],hand_actions:['id','hand_id','player_id','entry_number','street','action_type','action_amount','action_order'],tournament_seats:['player_id','player_name','avatar_url']};
    const columns=u.searchParams.get('select').replaceAll(/\s/g,'').split(',');assert.ok(columns.length&&columns.every(c=>allowed[name].includes(c)));
    const conditions=[name==='tournament_hands'||name==='tournament_seats'?"tournament_id="+literal(tour):"hand_id IN(SELECT id FROM public.tournament_hands WHERE tournament_id="+literal(tour)+")"];
    for(const [column,filter] of u.searchParams){if(['select','order','limit','offset'].includes(column))continue;assert.ok([...allowed[name],'tournament_id','table_session_id'].includes(column));
     if(filter.startsWith('eq.')){const id=filter.slice(3);uuid(id);conditions.push(column+'='+literal(id));}
     else{assert.ok(filter.startsWith('in.(')&&filter.endsWith(')'));const ids=filter.slice(4,-1).split(',');ids.forEach(uuid);assert.ok(ids.length<=80);conditions.push(column+' IN('+ids.map(literal).join(',')+')');}}
    const order=(u.searchParams.get('order')??'').split(',').filter(Boolean).map(v=>{const [c,d]=v.split('.');assert.ok(allowed[name].includes(c)&&['asc','desc'].includes(d));return c+' '+d;});
    const limit=Number(u.searchParams.get('limit')??1000),offset=Number(u.searchParams.get('offset')??0);assert.ok(Number.isSafeInteger(limit)&&limit>0&&limit<=1000&&Number.isSafeInteger(offset)&&offset>=0&&offset<=1000);
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM(SELECT "+columns.join(',')+' FROM public.'+name+' WHERE '+conditions.join(' AND ')+(order.length?' ORDER BY '+order.join(','):'')+' LIMIT '+limit+' OFFSET '+offset+')q;');
    const probe=name==='hand_players'&&columns.length===1&&columns[0]==='player_name';

   }else if(name==='clubs'){
    assert.equal(u.searchParams.get('select'),'id,name');const ids=u.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id IN(${list.map(literal).join(',')});`);
   }else if(name==='tournaments'){
    assert.equal(u.searchParams.get('club_id'),'eq.'+club);assert.equal(u.searchParams.get('order'),'created_at.desc');
    assert.equal(u.searchParams.get('select').replaceAll(/\s/g,''),'*,tournament_tables(id,table_id,game_table_id,table_session_id,status,canonical_game_table:game_tables!tournament_tables_game_table_id_v3_fkey(id,table_name),game_tables!tournament_tables_table_id_fkey(id,table_name))');
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('tournament_tables',(SELECT coalesce(jsonb_agg(to_jsonb(tt)||jsonb_build_object('canonical_game_table',(SELECT jsonb_build_object('id',g.id,'table_name',g.table_name) FROM public.game_tables g WHERE g.id=tt.game_table_id),'game_tables',(SELECT jsonb_build_object('id',g.id,'table_name',g.table_name) FROM public.game_tables g WHERE g.id=tt.table_id))),'[]') FROM (SELECT id,table_id,game_table_id,table_session_id,status FROM public.tournament_tables WHERE tournament_id=t.id)tt)) ORDER BY t.created_at DESC),'[]') FROM public.tournaments t WHERE club_id='"+club+"';");
    state.calendarOracle=value.map(t=>({id:t.id,name:t.name,start_time:t.start_time,status:t.status}));
   }else if(name==='tracker_floor_alerts'){
    assert.equal(u.searchParams.get('select'),'id,tournament_id,physical_table_id,hand_id,title,priority,status');assert.equal(u.searchParams.get('status'),'in.(open,acknowledged,in_progress)');assert.equal(u.searchParams.get('order'),'created_at.asc');
    const ids=u.searchParams.get('tournament_id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);assert.ok(state.calendarOracle&&list.every(id=>state.calendarOracle.some(t=>t.id===id)));
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,tournament_id,physical_table_id,hand_id,title,priority,status FROM public.tracker_floor_alerts WHERE tournament_id IN("+list.map(literal).join(',')+") AND status IN('open','acknowledged','in_progress') ORDER BY created_at)x;");
   }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_READ_NOT_ALLOWED'});}
  }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL987_NO_WRITERS'});}
  state.reads.push({name,nativeRows:Array.isArray(value)?value.length:null});

  send(200,value);
 }catch(error){state.errors.push({message:error.message});send(500,{message:'LOCAL1000_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('MULTIDAY1020_NATIVE_READONLY_READY');
 await new Promise(resolve=>{process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(!command)return;if(command==='stop'){process.stdin.pause();resolve();}else throw Error('unknown command');});});
 assert.ok(state.faults.length>0);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.after=fingerprint();state.unchanged=state.before===state.after;writeFileSync('D:/Quy trình/output/reports/multiday'+state.runId+'-browser-native-local-20261027.json',JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);
}
console.log(healthy1000?'MULTIDAY1020_HEALTHY_NATIVE_UNCHANGED_PASS':'MULTIDAY1020_CALENDAR_AND_RECOVERY_NATIVE_UNCHANGED_PASS');
