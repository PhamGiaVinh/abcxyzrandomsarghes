// BLOCKED at modeled session acceptance in checkpoint1004; clock endpoints were never reached.
// Do not expand Auth/grants or claim normal-router/clock acceptance from this runner.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const healthy1004=process.env.VINPOKER_FLOOR1004_LOCAL==='1';
assert.ok(healthy1004||process.env.VINPOKER_FLOOR1004_LOCAL==='1');
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour='46cab483-91e7-4220-aacf-e17bdf05269c',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=["tournaments","tournament_entries","tournament_seats","tournament_tables","table_sessions","tournament_close_report","tournament_prizes","tournament_prize_payments","tournament_chip_counts","seat_draw_receipts","seat_assignment_history","table_operation_receipts","cashier_buyin_movements","dealer_attendance","dealer_assignments","tournament_hands","tournament_settlement_outcomes","multi_day_final_participations_v1","tournament_state_transitions","audit_logs"];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
assert.equal(read("SELECT to_jsonb(md5(replace(pg_get_functiondef('public.ops_update_tournament_live(uuid,text,integer,integer,text,text)'::regprocedure),chr(13),'')));"),'5f9825d3cda43cdbb5861e8007177455');
const state={kind:'ACTUAL_FLOOR_TOURNAMENTS_NATIVE_READONLY_MODELED_SESSION_NOT_FULL_ACCEPTANCE',runId:1004,guard,before:fingerprint(),reads:[],faults:[],denied:[],errors:[]};
if(healthy1004){state.runId=1004;state.kind="ACTUAL_FLOOR_HEALTHY_VISUAL_CONFIRMATION_NATIVE_READS_MODELED_SESSION_NOT_FULL_ACCEPTANCE";}
let remainingFailures=0;
const key=randomUUID(),sessions=new Set(),user={id:actor,email:'floor1004@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{club,tour,actor,email:user.email,runId:String(state.runId),model:'READ ONLY native PG / local modeled session'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1004)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');const token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL983_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  let value;
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   if(name==='get_my_ops_capability_scope')value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_ops_capability_scope() x;");
   else if(name==='get_my_ops_global_capability')value=native("SELECT jsonb_agg(jsonb_build_object('is_super_admin',is_super_admin)) FROM public.get_my_ops_global_capability();");
   else if(name==='get_club_table_inventory'){assert.equal(body.p_club_id,club);value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_club_table_inventory('${club}') x;`);}
   else if(['get_tournament_clock','get_tournament_participation_counts_v1','get_tv_tournament_branding_v1','list_tracker_floor_alerts'].includes(name)){
    assert.equal(body.p_tournament_id,tour);assert.deepEqual(Object.keys(body).sort(),name==='list_tracker_floor_alerts'?['p_status','p_tournament_id']:['p_tournament_id']);if(name==='list_tracker_floor_alerts')assert.equal(body.p_status,null);
    value=native("SELECT public."+name+"('"+tour+"'"+(name==='list_tracker_floor_alerts'?',NULL':'')+");");
   }else{state.denied.push({method:req.method,name});return send(403,{message:'LOCAL1004_NO_WRITERS'});}
  }else if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(name==='clubs'){
    assert.equal(u.searchParams.get('select'),'id,name');const ids=u.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');list.forEach(uuid);value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id IN(${list.map(literal).join(',')});`);
   }else if(name==='tournaments'&&u.searchParams.get('id')==='eq.'+tour){
    const columns=u.searchParams.get('select').replaceAll(/\s/g,'');
    if(columns==='id,club_id,name,status'){assert.equal(u.searchParams.get('club_id'),'eq.'+club);value=native("SELECT jsonb_build_object('id',id,'club_id',club_id,'name',name,'status',status) FROM public.tournaments WHERE id='"+tour+"' AND club_id='"+club+"';");}
    else if(columns==='satellite_payout')value=native("SELECT jsonb_build_object('satellite_payout',to_jsonb(t)->'satellite_payout') FROM public.tournaments t WHERE id='"+tour+"';");
    else{assert.equal(columns,'name,status,players_remaining,average_stack,prize_pool,starting_stack,guarantee_amount,buy_in,rake_amount,main_event:tournament_events(guarantee_amount),club:clubs(name,cover_url,tv_logo_url,tv_brand_name,tv_bg_url)');value=native("SELECT jsonb_build_object('name',t.name,'status',t.status,'players_remaining',t.players_remaining,'average_stack',t.average_stack,'prize_pool',t.prize_pool,'starting_stack',t.starting_stack,'guarantee_amount',t.guarantee_amount,'buy_in',t.buy_in,'rake_amount',t.rake_amount,'main_event',(SELECT jsonb_build_object('guarantee_amount',e.guarantee_amount) FROM public.tournament_events e WHERE e.id=t.event_id),'club',(SELECT jsonb_build_object('name',c.name,'cover_url',c.cover_url,'tv_logo_url',c.tv_logo_url,'tv_brand_name',c.tv_brand_name,'tv_bg_url',c.tv_bg_url) FROM public.clubs c WHERE c.id=t.club_id)) FROM public.tournaments t WHERE id='"+tour+"';");}
   }else if(['tournament_levels','tournament_registrations','tournament_prizes'].includes(name)){
    assert.equal(u.searchParams.get('tournament_id'),'eq.'+tour);const columns=u.searchParams.get('select').replaceAll(/\s/g,'');assert.equal(columns,{tournament_levels:'level_number,small_blind,big_blind,ante,duration_minutes,is_break',tournament_registrations:'buy_in',tournament_prizes:'position,amount'}[name]);if(name==='tournament_registrations')assert.equal(u.searchParams.get('status'),'eq.confirmed');
    value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT "+columns+' FROM public.'+name+" WHERE tournament_id='"+tour+"'"+(name==='tournament_registrations'?" AND status='confirmed'":'')+(name==='tournament_levels'?' ORDER BY level_number':name==='tournament_prizes'?' ORDER BY position':'')+')x;');
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
  if(remainingFailures>0&&name==='tournaments'){remainingFailures--;state.faults.push({kind:'503',remaining:remainingFailures});return send(503,{message:'LOCAL1004_INJECTED_READ_FAILURE'});}
  send(200,value);
 }catch(error){state.errors.push({message:error.message});send(500,{message:'LOCAL1004_ADAPTER_READ_ERROR'});}
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('FLOOR1004_NATIVE_READONLY_READY');
 await new Promise(resolve=>{process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='next'){assert.equal(healthy1004,false);assert.equal(remainingFailures,0);remainingFailures=4;console.log('FLOOR1004_ARMED_FOUR_503');}else if(command==='stop'){process.stdin.pause();resolve();}else throw Error('unknown command');});});
 assert.equal(state.faults.length,healthy1004?0:4);assert.equal(remainingFailures,0);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 state.after=fingerprint();state.unchanged=state.before===state.after;writeFileSync('D:/Quy trình/output/reports/floor'+state.runId+'-browser-native-local-20261027.json',JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);
}
console.log(healthy1004?'FLOOR1004_HEALTHY_NATIVE_UNCHANGED_PASS':'FLOOR1004_CALENDAR_AND_RECOVERY_NATIVE_UNCHANGED_PASS');
