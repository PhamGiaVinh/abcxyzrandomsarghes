import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';
import {manualFinishReceiptMatches} from '../../src/lib/trackerManualFinish.ts';

const fault959=process.env.VINPOKER_HISTORY959_LOCAL==='1',runId=fault959?'959':'958';
assert.ok(fault959||process.env.VINPOKER_HISTORY958_LOCAL==='1');
const f={tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',session:'ee2b9393-0c96-42f9-8667-7f306edeb9bc'};
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let pending=null,buffer='',stderr='',closed=false;
child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});
child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
 buffer+=chunk;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);
 if(!pending)continue;if(line===pending.marker){const done=pending;pending=null;done.resolve(done.lines);}else if(line)pending.lines.push(line);}
});
child.on('exit',code=>{closed=true;if(pending){const done=pending;pending=null;done.reject(new Error(`psql exited ${code}: ${stderr}`));}});
const send=q=>new Promise((resolve,reject)=>{assert.equal(pending,null);const marker='H958_'+randomUUID().replaceAll('-','');pending={marker,lines:[],resolve,reject};child.stdin.write(`${q}\n\\echo ${marker}\n`);});
const json=async q=>{const lines=await send(q);return JSON.parse(lines.filter(x=>x.startsWith('{')||x.startsWith('[')).at(-1));};
const j=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const auth=`SET LOCAL ROLE NONE;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${JSON.stringify({role:'authenticated',sub:f.actor})}';SET LOCAL ROLE authenticated;`;
const anon=`SET LOCAL ROLE NONE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;`;
const page=(created=null,id=null)=>json(`${anon}SELECT public.get_public_tournament_table_history_v2('${f.tour}','${f.table}',20,${created?`'${created}'::timestamptz`:'NULL'},${id?`'${id}'::uuid`:'NULL'});`);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','hand_actions','hand_players','cashier_buyin_movements','tournament_prize_payments','table_sessions','table_operation_receipts','tournament_eliminations'];
const facts=`SELECT jsonb_build_object('hash',md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`;
const evidence={fixture:f,kind:'CANONICAL_EXTRA_HANDS_IN_ROLLBACK_BRANCH_NOT_ORIGINAL_R11_JOURNEY',hands:[],reads:[],denied:0,faults:[],inFlight:0,maxInFlight:0};
const path=`D:/Quy trình/output/reports/history${runId}-pagination-native-local-20261027.json`;
let server;
try{
 const guard=await json(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()));`);
 assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);
 assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
 evidence.before=await json(facts);await send('BEGIN;SET LOCAL statement_timeout=\'10s\';');
 let whole=await json(`${anon}SELECT public.get_public_tournament_table_history_v2('${f.tour}','${f.table}',50,NULL,NULL);`);
 assert.equal(whole.access,'public');evidence.initialCount=whole.items.length;
 const count=await json(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('next',coalesce(max(hand_number),0)+1) FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND tournament_table_id='${f.table}';`);
 const state=await json(`SET LOCAL ROLE NONE;SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${f.session}';`);
 assert.equal(state.control_mode,'tracker');
 const seats=await json(`SELECT jsonb_agg(seat_number ORDER BY seat_number) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND tournament_table_id='${f.table}' AND is_active;`);assert.equal(seats.length,2);
 for(let i=0;i<21-evidence.initialCount;i++){
  const button=seats[i%2];
  const started=await json(`${auth}SELECT public.start_tracker_hand_v3('${f.tour}','${f.table}','${f.session}',${state.control_epoch},${count.next+i},now(),'${f.actor}',${button});`);
  assert.equal(started.status,'success',JSON.stringify(started));
  const h=await json(`SET LOCAL ROLE NONE;SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${started.hand_id}';`);
  const players=await json(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${h.id}';`);
  const sb=players.find(p=>p.seat_number===button),bb=players.find(p=>p.seat_number!==button);
  for(const [p,type,order,amount] of [[sb,'post_sb',1,h.tracker_small_blind],[bb,'post_bb',2,h.tracker_big_blind],[sb,'fold',3,0]]){
   const r=await json(`${auth}SELECT public.record_action('${h.id}','${p.player_id}','${type}',${order},${p.entry_number},'preflop',${amount});`);assert.equal(r.status,'success',JSON.stringify(r));
  }
  const actions=await json(`SET LOCAL ROLE NONE;SELECT jsonb_agg(to_jsonb(a) ORDER BY action_order) FROM public.hand_actions a WHERE hand_id='${h.id}';`);
  const core=reduceHand(players,actions,button);
  const r=await computeVoiceFinishSettlement({handId:h.id,stateVersion:'native-history958',buttonSeat:button,communityCards:[],players,actions,bettingComplete:isBettingRoundComplete(core)});
  assert.equal(r.settlementOrigin,'engine_fold_win');
  const revision=await json(`SELECT jsonb_build_object('revision',source_revision) FROM public.tournament_hands WHERE id='${h.id}';`);
  const intent={actor_id:f.actor,request_id:randomUUID(),tournament_id:f.tour,tournament_table_id:f.table,hand_id:h.id,table_session_id:f.session,control_epoch:state.control_epoch,source_revision:revision.revision,payload:{hand_time:h.hand_time,players:r.recordPlayers,actions:r.recordActions,side_pots:r.sidePots,community_cards:[],pot_size:r.potSize}};
  const receipt=await json(`${auth}SELECT public.record_tracker_manual_hand_v1(${j(intent)});`);assert.ok(manualFinishReceiptMatches(receipt,intent),JSON.stringify(receipt));
  evidence.hands.push({id:h.id,number:h.hand_number,receipt:receipt.request_id,starting:receipt.starting_total,ending:receipt.ending_total});
 }
 whole=await json(`${anon}SELECT public.get_public_tournament_table_history_v2('${f.tour}','${f.table}',50,NULL,NULL);`);assert.equal(whole.items.length,21);evidence.expected=whole.items.map(x=>x.handId);
 const first=await page();assert.equal(first.items.length,20);assert.ok(first.nextCursor);const second=await page(first.nextCursor.createdAt,first.nextCursor.id);assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
 assert.deepEqual([...first.items,...second.items].map(x=>x.handId),evidence.expected);
 console.log('HISTORY958_NATIVE_20_PLUS_1_CANONICAL_BRANCH_READY',JSON.stringify({initial:evidence.initialCount,added:evidence.hands.length}));
 if(process.argv.includes('--serve')){
  let chain=Promise.resolve(),cursorFault=fault959,cursorDelay=fault959;
  server=createServer(async(req,res)=>{
   res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Content-Type','application/json');
   const reply=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
   if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
   const url=new URL(req.url,'http://127.0.0.1:54329');
   if(req.method==='GET'&&url.pathname==='/__local/manifest')return reply(200,{...f,runId:'history958',singleTour:f.tour,historyTable:{id:f.table,session:f.session},model:evidence.kind});
   if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_table_history_v2'){
    try{let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=JSON.parse(raw);assert.equal(body.p_tournament_id,f.tour);assert.equal(body.p_tournament_table_id,f.table);assert.equal(body.p_limit,20);
     assert.equal(body.p_before_created_at===null,body.p_before_id===null);if(body.p_before_id!==null){assert.ok(evidence.expected.includes(body.p_before_id));assert.match(body.p_before_created_at,/^[0-9T:.+Z-]+$/);}
     evidence.inFlight++;evidence.maxInFlight=Math.max(evidence.maxInFlight,evidence.inFlight);
     try{
      if(cursorFault&&body.p_before_id!==null){cursorFault=false;evidence.faults.push({kind:'cursor503',cursor:body.p_before_id});return reply(503,{message:'LOCAL959_MODELED_CURSOR_FAILURE'});}
      const started=Date.now();let delayed=false;
      if(cursorDelay&&body.p_before_id!==null){cursorDelay=false;delayed=true;await new Promise(resolve=>setTimeout(resolve,5000));}
      const task=chain.then(()=>page(body.p_before_created_at,body.p_before_id));chain=task.catch(()=>{});const value=await task;evidence.reads.push({cursor:body.p_before_id,ids:value.items.map(x=>x.handId),next:value.nextCursor,delayed,ms:Date.now()-started});return reply(200,value);
     }finally{evidence.inFlight--;}
    }catch(error){evidence.denied++;return reply(400,{message:error.name});}
   }
   return reply(403,{message:'LOCAL958_HISTORY_READ_ONLY'});
  });
  await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));console.log('HISTORY958_BROWSER_READY');
  await new Promise(resolve=>process.stdin.once('data',resolve));process.stdin.pause();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await chain;
  assert.ok(evidence.reads.some(x=>x.ids.length===20)&&evidence.reads.some(x=>x.ids.length===1));assert.equal(evidence.denied,0);
  if(fault959){assert.equal(evidence.faults.length,1);assert.ok(evidence.reads.some(x=>x.delayed&&x.ms>=5000));assert.equal(evidence.maxInFlight,1);assert.equal(evidence.inFlight,0);}
 }
}finally{
 if(server?.listening){server.closeAllConnections();server.close();}
 if(!closed){await send('ROLLBACK;SET ROLE NONE;');evidence.after=await json(facts);evidence.unchanged=evidence.after.hash===evidence.before?.hash;child.stdin.end();}
 writeFileSync(path,JSON.stringify(evidence,null,2)+'\n');
}
assert.equal(evidence.unchanged,true);console.log('HISTORY958_ROLLBACK_PROTECTED_FACTS_UNCHANGED_PASS');
