import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_MOVE964_LOCAL,'1');
const f={tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',session:'ee2b9393-0c96-42f9-8667-7f306edeb9bc'};
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let pending=null,buffer='',stderr='',closed=false;
child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!pending)continue;if(line===pending.marker){const done=pending;pending=null;done.resolve(done.lines);}else if(line)pending.lines.push(line);}});
child.on('exit',code=>{closed=true;if(pending){const done=pending;pending=null;done.reject(new Error(`psql exited ${code}: ${stderr}`));}});
const send=q=>new Promise((resolve,reject)=>{assert.equal(pending,null);const marker='M964_'+randomUUID().replaceAll('-','');pending={marker,lines:[],resolve,reject};child.stdin.write(`${q}\n\\echo ${marker}\n`);});
const json=async q=>{const lines=await send(q);return JSON.parse(lines.filter(x=>x.startsWith('{')||x.startsWith('[')).at(-1));};
const auth=`SET LOCAL ROLE NONE;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${JSON.stringify({sub:f.actor,role:'authenticated'})}';SET LOCAL ROLE authenticated;`;
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','table_sessions','table_operation_receipts','cashier_buyin_movements','tournament_prize_payments','tournament_settlement_outcomes','dealer_attendance','dealer_assignments','chip_bag'];
const facts=`SELECT jsonb_build_object('hash',md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`;
const state={fixture:f,trace:[],requests:[],denied:0};const save=()=>writeFileSync('D:/Quy trình/output/reports/move964-native-loss-replay-local-20261027.json',JSON.stringify(state,null,2)+'\n');
let server,chain=Promise.resolve();
const native=statement=>{const task=chain.then(()=>json(statement));chain=task.catch(()=>{});return task;};
const seatFacts=()=>native(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('seats',(SELECT jsonb_agg(jsonb_build_object('id',id,'seat',seat_number,'stack',chip_count,'entry',entry_id) ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND tournament_table_id='${f.table}' AND is_active),'revision',(SELECT revision FROM public.table_sessions WHERE id='${f.session}'),'entryTotal',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${f.tour}'));`);
try{
 const guard=await json("SELECT jsonb_build_array(current_database(),host(inet_server_addr()),inet_server_port(),current_setting('data_directory'));");assert.deepEqual(guard,['vinpoker_ranking860_local','127.0.0.1',55441,'/tmp/vinpoker-sol-local-20261016-0e79a729/data']);
 const comment=await json("SELECT jsonb_build_object('comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()));");assert.equal(comment.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
 state.before=await json(facts);await send("BEGIN;SET LOCAL statement_timeout='10s';");state.initial=await seatFacts();assert.equal(state.initial.seats.length,2);assert.equal(state.initial.entryTotal,60000);
 const seat=state.initial.seats.find(s=>s.seat===1);assert.ok(seat);state.entry=seat.entry;assert.ok(!state.initial.seats.some(s=>s.seat===9));
 const epoch=await native(`SELECT jsonb_build_object('value',control_epoch) FROM public.table_sessions WHERE id='${f.session}';`);
 server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const reply=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try{
   const url=new URL(req.url,'http://127.0.0.1:54329');
   if(req.method==='GET'&&url.pathname==='/__local/manifest')return reply(200,{...f,moveEntry:state.entry,moveWriteRollback:true,runId:'move964',model:'ONE_EXACT_NATIVE_MOVE_INTENT_LOSS_REPLAY_OUTER_ROLLBACK'});
   if(url.pathname.startsWith('/auth/'))return reply(401,{message:'LOCAL964_MODELED_AUTH_UNAVAILABLE'});
   if(req.method==='GET'&&url.pathname==='/rest/v1/tournaments'){assert.equal(url.searchParams.get('id'),`eq.${f.tour}`);assert.equal(url.searchParams.get('select'),'name,start_time');const value=await native(`${auth}SELECT jsonb_build_object('name',name,'start_time',start_time) FROM public.tournaments WHERE id='${f.tour}';`);state.trace.push({read:'metadata'});return reply(200,value);}
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};const name=url.pathname.split('/').at(-1);
   if(req.method==='POST'&&['get_floor_tournament_table_roster_v3','get_floor_tournament_table_roster_v6','get_floor_pending_tracker_moves_v1'].includes(name)){assert.deepEqual(body,{p_tournament_id:f.tour});const value=await native(`${auth}SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.${name}('${f.tour}')x;`);state.trace.push({read:name});return reply(200,value);}
   if(req.method==='POST'&&name==='move_player_seat_v5'){
    const keys=['p_entry_id','p_from_tournament_table_id','p_from_table_session_id','p_to_tournament_table_id','p_to_table_session_id','p_to_seat_number','p_expected_source_revision','p_expected_destination_revision','p_expected_source_epoch','p_expected_destination_epoch','p_reason','p_request_id'];assert.deepEqual(Object.keys(body).sort(),[...keys].sort());
    for(const key of keys.slice(0,5))assert.match(body[key],/^[a-f0-9-]{36}$/);assert.equal(body.p_entry_id,state.entry);assert.equal(body.p_from_tournament_table_id,f.table);assert.equal(body.p_to_tournament_table_id,f.table);assert.equal(body.p_from_table_session_id,f.session);assert.equal(body.p_to_table_session_id,f.session);assert.equal(body.p_to_seat_number,9);assert.equal(body.p_reason,'Cân bàn');assert.match(body.p_request_id,/^[a-f0-9-]{36}$/);
    assert.equal(body.p_expected_source_revision,state.initial.revision);assert.equal(body.p_expected_destination_revision,state.initial.revision);assert.equal(body.p_expected_source_epoch,epoch.value);assert.equal(body.p_expected_destination_epoch,epoch.value);
    if(state.requests.length)assert.deepEqual(body,state.requests[0]);assert.ok(state.requests.length<2);state.requests.push(body);
    const args=keys.map(key=>typeof body[key]==='number'?String(body[key]):`'${body[key].replaceAll("'","''")}'`).join(',');const receipt=await native(`${auth}SELECT public.move_player_seat_v5(${args});`);assert.equal(receipt.ok,true,JSON.stringify(receipt));
    const current=await seatFacts();assert.equal(current.entryTotal,60000);assert.equal(current.seats.find(s=>s.entry===state.entry).seat,9);
    if(state.requests.length===1){state.receipt=receipt;state.afterFirst=current;save();return reply(503,{message:'LOCAL964_MODELED_LOST_MOVE_RESPONSE_AFTER_NATIVE_WRITE'});}
    assert.deepEqual(receipt,state.receipt);assert.deepEqual(current,state.afterFirst);state.replayed=true;state.trace.push({write:name,replay:true,request:body.p_request_id});save();return reply(200,receipt);
   }
   state.denied++;return reply(403,{message:'LOCAL964_ENDPOINT_NOT_ALLOWED'});
  }catch(error){state.trace.push({adapterError:error.message});save();return reply(400,{message:'LOCAL964_INVALID_REQUEST'});}
 });
 await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));console.log('MOVE964_HELD_TRANSACTION_BROWSER_READY');await new Promise(resolve=>process.stdin.once('data',resolve));process.stdin.pause();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await chain;
 assert.equal(state.requests.length,2);assert.equal(state.replayed,true);assert.equal(state.denied,0);assert.ok(!state.trace.some(x=>x.adapterError));
}finally{
 if(server?.listening){server.closeAllConnections();server.close();}if(!closed){await send('ROLLBACK;SET ROLE NONE;');state.after=await json(facts);state.unchanged=state.after.hash===state.before?.hash;child.stdin.end();}save();
}
assert.equal(state.unchanged,true);console.log('MOVE964_EXACT_REPLAY_SINGLE_SEAT_CHANGE_CHIP_CONSERVED_ROLLBACK_PASS');
