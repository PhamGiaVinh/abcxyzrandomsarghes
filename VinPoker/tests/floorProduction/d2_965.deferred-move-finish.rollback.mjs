import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,isBettingRoundComplete} from '../../src/lib/tracker-poker/handStateCore.ts';
import {manualFinishReceiptMatches} from '../../src/lib/trackerManualFinish.ts';
const browser966=process.env.VINPOKER_D2_966_LOCAL==='1',cancel967=process.env.VINPOKER_D2_967_LOCAL==='1',close968=process.env.VINPOKER_D2_968_LOCAL==='1',runId=browser966?'966':cancel967?'967':close968?'968':'965';
assert.ok(browser966||cancel967||close968||process.env.VINPOKER_D2_965_LOCAL==='1');assert.ok([browser966,cancel967,close968].filter(Boolean).length<=1);
const cancelBefore=cancel967&&!process.argv.includes('--cancel-after-finish');
const baseBytes=readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql');
assert.equal(createHash('sha256').update(baseBytes).digest('hex'),'54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const wrapperBytes=readFileSync('tests/floorProduction/d2_932.tracker-finish-browser.local.mjs');
assert.equal(createHash('sha256').update(wrapperBytes).digest('hex'),'8c704cee673909525966023861b4f10e223940ee76d44cfa6ae35cabfa1efbdb');
const base=baseBytes.toString().replaceAll('\r\n','\n'),wrapper=wrapperBytes.toString().replaceAll('\r\n','\n');
const cut=base.indexOf(' FOR i IN 1..3 LOOP\n  seat_result:='),head='let sql=source.slice(0,cut)+`';
const start=wrapper.indexOf(head)+head.length,end=wrapper.indexOf('`;\nif(validItm)',start);assert.ok(cut>0&&start>=head.length&&end>start);
const setup=base.slice(0,cut)+wrapper.slice(start,end).replaceAll('${request}',randomUUID());assert.ok(!setup.includes('${'));
const boundary=setup.lastIndexOf('\nROLLBACK;\n');assert.ok(boundary>0);
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let pending=null,buffer='',stderr='',closed=false;
child.stderr.setEncoding('utf8');child.stderr.on('data',x=>{stderr+=x;});child.stdout.setEncoding('utf8');child.stdout.on('data',x=>{buffer+=x;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!pending)continue;if(line===pending.marker){const done=pending;pending=null;done.resolve(done.lines);}else if(line)pending.lines.push(line);}});
child.on('exit',code=>{closed=true;if(pending){const done=pending;pending=null;done.reject(new Error(`psql exited ${code}: ${stderr}`));}});
const send=q=>new Promise((resolve,reject)=>{assert.equal(pending,null);const marker='D965_'+randomUUID().replaceAll('-','');pending={marker,lines:[],resolve,reject};child.stdin.write(`${q}\n\\echo ${marker}\n`);});
let chain=Promise.resolve();
const read=q=>{const task=chain.then(async()=>{const lines=await send(q);return JSON.parse(lines.filter(x=>x.startsWith('{')||x.startsWith('[')).at(-1));});chain=task.catch(()=>{});return task;};
const j=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const evidence={kind:'CANONICAL_D2_ROLLBACK_CHILD_NOT_ORIGINAL_MAIN167_OR_BROWSER',phase:'preparing'};
let rolledBack=false,server;
try{
 const result=await read(setup.slice(0,boundary));evidence.setup=result;
 const context=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${result.handId}'),'source',(SELECT to_jsonb(s) FROM public.tournament_seats s WHERE tournament_id='${result.final}' AND tournament_table_id<>(SELECT tournament_table_id FROM public.tournament_hands WHERE id='${result.handId}') AND is_active ORDER BY tournament_table_id,seat_number LIMIT 1));`);
 const h=context.hand,s=context.source;assert.ok(h&&s);assert.equal(h.status,'in_progress');
 const auth=`SET LOCAL ROLE NONE;SET LOCAL request.jwt.claim.sub='${h.created_by}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${JSON.stringify({sub:h.created_by,role:'authenticated'})}';SET LOCAL ROLE authenticated;`;
 const sessions=await read(`SELECT jsonb_build_object('source',(SELECT to_jsonb(t) FROM public.table_sessions t WHERE id='${s.table_session_id}'),'destination',(SELECT to_jsonb(t) FROM public.table_sessions t WHERE id='${h.table_session_id}'));`);
 assert.equal(sessions.source.control_mode,'manual');assert.equal(sessions.destination.control_mode,'tracker');
 const prior=await read(`SELECT jsonb_build_object('receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.seat_draw_receipts r WHERE entry_id='${s.entry_id}'),'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${h.id}'));`);assert.equal(prior.players.length,3);assert.ok(!prior.players.some(p=>p.player_id===s.player_id));
 let request=randomUUID();
 const args=()=>`'${s.entry_id}','${s.tournament_table_id}','${s.table_session_id}','${h.tournament_table_id}','${h.table_session_id}',9,${sessions.source.revision},${sessions.destination.revision},${sessions.source.control_epoch},${sessions.destination.control_epoch},'Cân bàn','${request}'`;
 let queued;
 if(browser966){
  evidence.browser={queueCalls:0,reads:[],errors:[],denied:0};let queueResolve;
  const queueResult=new Promise(resolve=>{queueResolve=resolve;});
  server=createServer(async(req,res)=>{
   res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   const reply=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
   try{
    const url=new URL(req.url,'http://127.0.0.1:54329');
    if(req.method==='GET'&&url.pathname==='/__local/manifest')return reply(200,{tour:result.final,actor:h.created_by,club:sessions.source.club_id,moveEntry:s.entry_id,moveWriteRollback:true,runId:'d2_966',model:'CANONICAL_QUEUE_FINISH_OUTER_ROLLBACK'});
    if(url.pathname.startsWith('/auth/'))return reply(401,{message:'LOCAL966_MODELED_AUTH_UNAVAILABLE'});
    if(req.method==='GET'&&url.pathname==='/rest/v1/tournaments'){assert.equal(url.searchParams.get('id'),`eq.${result.final}`);assert.equal(url.searchParams.get('select'),'name,start_time');const value=await read(`${auth}SELECT jsonb_build_object('name',name,'start_time',start_time) FROM public.tournaments WHERE id='${result.final}';`);evidence.browser.reads.push({read:'metadata',phase:evidence.phase});return reply(200,value);}
    let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};const name=url.pathname.split('/').at(-1);
    if(req.method==='POST'&&['get_floor_tournament_table_roster_v3','get_floor_tournament_table_roster_v6','get_floor_pending_tracker_moves_v1'].includes(name)){assert.deepEqual(body,{p_tournament_id:result.final});const value=await read(`${auth}SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.${name}('${result.final}')x;`);evidence.browser.reads.push({read:name,phase:evidence.phase});return reply(200,value);}
    if(req.method==='POST'&&name==='move_player_seat_v5'){
     assert.equal(evidence.browser.queueCalls,0);assert.match(body.p_request_id,/^[a-f0-9-]{36}$/);
     assert.deepEqual(body,{p_entry_id:s.entry_id,p_from_tournament_table_id:s.tournament_table_id,p_from_table_session_id:s.table_session_id,p_to_tournament_table_id:h.tournament_table_id,p_to_table_session_id:h.table_session_id,p_to_seat_number:9,p_expected_source_revision:sessions.source.revision,p_expected_destination_revision:sessions.destination.revision,p_expected_source_epoch:sessions.source.control_epoch,p_expected_destination_epoch:sessions.destination.control_epoch,p_reason:'Cân bàn',p_request_id:body.p_request_id});
     request=body.p_request_id;const value=await read(`${auth}SELECT public.move_player_seat_v5(${args()});`);evidence.browser.queueCalls++;reply(200,value);queueResolve(value);return;
    }
    evidence.browser.denied++;return reply(403,{message:'LOCAL966_ENDPOINT_NOT_ALLOWED'});
   }catch(error){evidence.browser.errors.push(error.message);return reply(400,{message:'LOCAL966_INVALID_REQUEST'});}
  });
  await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));console.log('D2_966_BROWSER_QUEUE_READY',JSON.stringify({source:s.tournament_table_id,destination:h.tournament_table_id,sourceNumber:sessions.source.table_number,destinationNumber:sessions.destination.table_number}));queued=await queueResult;
 }else queued=await read(`${auth}SELECT public.move_player_seat_v5(${args()});`);
 evidence.queued=queued;assert.equal(queued.ok,true,JSON.stringify(queued));assert.equal(queued.queued,true);assert.equal(queued.receipt_code??null,null);
 assert.deepEqual(await read(`${auth}SELECT public.move_player_seat_v5(${args()});`),queued);
 const waiting=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('source',(SELECT to_jsonb(x) FROM public.tournament_seats x WHERE id='${s.id}'),'move',(SELECT to_jsonb(m) FROM public.floor_pending_tracker_moves m WHERE id='${queued.pending_move_id}'),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.seat_draw_receipts r WHERE entry_id='${s.entry_id}'),'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${h.id}'));`);
 assert.deepEqual(waiting.source,s);assert.equal(waiting.move.status,'pending');assert.deepEqual(waiting.receipts,prior.receipts);assert.deepEqual(waiting.players,prior.players);evidence.waiting=waiting;evidence.phase='queued_source_held';
 const probeClose=async phase=>{
  const before=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('hash',pg_temp.d2_789_fingerprint());`),attempts=[];
  for(const table of [s.tournament_table_id,h.tournament_table_id]){
   const roster=await read(`${auth}SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_floor_tournament_table_roster_v6('${result.final}')x;`);
   const row=roster.find(x=>x.tournament_table_id===table);assert.ok(row);const current={revision:row.session_revision};assert.ok(Number.isSafeInteger(current.revision));
   const request=randomUUID(),q=`${auth}SELECT public.close_tournament_table_v4('${table}',${current.revision},'${request}');`;
   const blocked=await read(q);assert.equal(blocked.ok,false);assert.equal(blocked.error,'table_not_empty');assert.deepEqual(await read(q),blocked);
   const stale=await read(`${auth}SELECT public.close_tournament_table_v4('${table}',${current.revision-1},'${randomUUID()}');`);assert.equal(stale.ok,false);assert.equal(stale.error,'STALE_STATE');
   attempts.push({table,revision:current.revision,blocked,stale});
  }
  const after=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('hash',pg_temp.d2_789_fingerprint());`);assert.deepEqual(after,before);return{phase,before,after,attempts,unchanged:true};
 };
 if(close968)evidence.closeBeforeFinish=await probeClose('pending_active_destination_hand');
 if(cancelBefore){
  const cancel=await read(`${auth}SELECT public.floor_cancel_pending_tracker_move_v1('${queued.pending_move_id}');`);assert.equal(cancel.ok,true);assert.equal(cancel.status,'cancelled');evidence.cancel=cancel;
  const revision=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('revision',revision) FROM public.table_sessions WHERE id='${h.table_session_id}';`);
  const repeat=await read(`${auth}SELECT public.floor_cancel_pending_tracker_move_v1('${queued.pending_move_id}');`);assert.equal(repeat.ok,true);assert.equal(repeat.status,'cancelled');assert.equal(repeat.already_resolved,true);evidence.cancelReplay=repeat;
  assert.deepEqual(await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('revision',revision) FROM public.table_sessions WHERE id='${h.table_session_id}';`),revision);
  const visible=await read(`${auth}SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_floor_pending_tracker_moves_v1('${result.final}')x;`);assert.ok(!visible.some(x=>x.pending_move_id===queued.pending_move_id));evidence.pendingReadAfterCancel=visible;
  await send('SAVEPOINT cancelled_reservation_reuse;');
  const fresh=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('source',(SELECT revision FROM public.table_sessions WHERE id='${s.table_session_id}'),'destination',(SELECT revision FROM public.table_sessions WHERE id='${h.table_session_id}'));`);
  const reservedAgain=await read(`${auth}SELECT public.move_player_seat_v5('${s.entry_id}','${s.tournament_table_id}','${s.table_session_id}','${h.tournament_table_id}','${h.table_session_id}',9,${fresh.source},${fresh.destination},${sessions.source.control_epoch},${sessions.destination.control_epoch},'Cân bàn','${randomUUID()}');`);assert.equal(reservedAgain.ok,true,JSON.stringify(reservedAgain));assert.equal(reservedAgain.queued,true);assert.notEqual(reservedAgain.pending_move_id,queued.pending_move_id);evidence.cancelledDestinationReusable={receipt:reservedAgain,savepointRolledBack:true};
  await send('ROLLBACK TO SAVEPOINT cancelled_reservation_reuse;RELEASE SAVEPOINT cancelled_reservation_reuse;');
  const restored=await read(`${auth}SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_floor_pending_tracker_moves_v1('${result.final}')x;`);assert.deepEqual(restored,visible);
 }
 if(browser966){console.log('D2_966_BROWSER_QUEUED_NATIVE_VERIFIED_PRESS_ENTER_TO_FINISH');await new Promise(resolve=>process.stdin.once('data',resolve));}
 const actions=await read(`SET LOCAL ROLE NONE;SELECT jsonb_agg(to_jsonb(a) ORDER BY action_order) FROM public.hand_actions a WHERE hand_id='${h.id}';`);
 const engine=await computeVoiceFinishSettlement({handId:h.id,stateVersion:'native965',buttonSeat:h.button_seat,communityCards:h.community_cards??[],players:prior.players,actions,bettingComplete:isBettingRoundComplete(reduceHand(prior.players,actions,h.button_seat))});assert.equal(engine.settlementOrigin,'engine_fold_win');
 const intent={actor_id:h.created_by,request_id:randomUUID(),tournament_id:result.final,tournament_table_id:h.tournament_table_id,hand_id:h.id,table_session_id:h.table_session_id,control_epoch:sessions.destination.control_epoch,source_revision:h.source_revision,payload:{hand_time:h.hand_time,players:engine.recordPlayers,actions:engine.recordActions,side_pots:engine.sidePots,community_cards:h.community_cards??[],pot_size:engine.potSize}};
 const receipt=await read(`${auth}SELECT public.record_tracker_manual_hand_v1(${j(intent)});`);assert.ok(manualFinishReceiptMatches(receipt,intent),JSON.stringify(receipt));evidence.finish=receipt;
 const replay=await read(`SELECT public.record_tracker_manual_hand_v1(${j(intent)});`);assert.deepEqual(replay,receipt);evidence.finishReplay=replay;
 const after=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('hand',(SELECT to_jsonb(x) FROM public.tournament_hands x WHERE id='${h.id}'),'source',(SELECT to_jsonb(x) FROM public.tournament_seats x WHERE id='${s.id}'),'active',(SELECT jsonb_agg(to_jsonb(x)) FROM public.tournament_seats x WHERE entry_id='${s.entry_id}' AND is_active),'move',(SELECT to_jsonb(m) FROM public.floor_pending_tracker_moves m WHERE id='${queued.pending_move_id}'),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.seat_draw_receipts r WHERE entry_id='${s.entry_id}'),'handPlayerIds',(SELECT jsonb_agg(player_id ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${h.id}'),'entryTotal',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${result.final}'),'seatTotal',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${result.final}' AND is_active));`);
 evidence.after=after;assert.equal(after.hand.status,'completed');assert.equal(after.source.is_active,cancelBefore);assert.equal(after.move.status,cancelBefore?'cancelled':'applied',JSON.stringify(after.move));assert.equal(after.move.resolution_reason,cancelBefore?'floor_cancelled':'hand_finished');assert.equal(after.active.length,1);assert.equal(after.active[0].tournament_table_id,cancelBefore?s.tournament_table_id:h.tournament_table_id);assert.equal(after.active[0].seat_number,cancelBefore?s.seat_number:9);assert.equal(after.active[0].chip_count,s.chip_count);assert.ok(!after.handPlayerIds.includes(s.player_id));assert.equal(after.entryTotal,320000);assert.equal(after.seatTotal,320000);
 if(cancelBefore){assert.deepEqual(after.source,s);assert.deepEqual(after.receipts,prior.receipts);evidence.phase='cancel_before_finish_source_ticket_preserved';}
 else{
  const tickets=after.receipts.filter(r=>r.status==='issued'||r.status==='printed');assert.equal(tickets.length,1);assert.equal(tickets[0].seat_number,9);assert.ok(!prior.receipts.some(r=>r.id===tickets[0].id));assert.equal(after.receipts.length,prior.receipts.length+1);for(const old of prior.receipts.filter(r=>r.status==='issued'||r.status==='printed'))assert.equal(after.receipts.find(r=>r.id===old.id)?.status,'superseded');evidence.phase='finish_applied_ticket_verified';
  if(cancel967){
   const revisions=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('source',(SELECT revision FROM public.table_sessions WHERE id='${s.table_session_id}'),'destination',(SELECT revision FROM public.table_sessions WHERE id='${h.table_session_id}'));`);
   const cancel=await read(`${auth}SELECT public.floor_cancel_pending_tracker_move_v1('${queued.pending_move_id}');`);assert.equal(cancel.ok,true);assert.equal(cancel.status,'applied');assert.equal(cancel.already_resolved,true);evidence.cancel=cancel;
   const unchanged=await read(`SET LOCAL ROLE NONE;SELECT jsonb_build_object('move',(SELECT to_jsonb(m) FROM public.floor_pending_tracker_moves m WHERE id='${queued.pending_move_id}'),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.seat_draw_receipts r WHERE entry_id='${s.entry_id}'),'active',(SELECT jsonb_agg(to_jsonb(x)) FROM public.tournament_seats x WHERE entry_id='${s.entry_id}' AND is_active));`);
   assert.deepEqual(unchanged,{move:after.move,receipts:after.receipts,active:after.active});evidence.lateCancelUnchanged=unchanged;evidence.phase='cancel_after_finish_already_applied_unchanged';
   assert.deepEqual(await read(`SELECT jsonb_build_object('source',(SELECT revision FROM public.table_sessions WHERE id='${s.table_session_id}'),'destination',(SELECT revision FROM public.table_sessions WHERE id='${h.table_session_id}'));`),revisions);evidence.lateCancelRevisions=revisions;
  }
 }
 if(browser966){console.log('D2_966_FINISH_APPLIED_BROWSER_REOPEN_READY');await new Promise(resolve=>process.stdin.once('data',resolve));process.stdin.pause();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await chain;assert.equal(evidence.browser.queueCalls,1);assert.equal(evidence.browser.denied,0);assert.equal(evidence.browser.errors.length,0);assert.ok(evidence.browser.reads.some(x=>x.phase==='finish_applied_ticket_verified'));}
 if(close968)evidence.closeAfterFinish=await probeClose('applied_hand_completed_tables_still_occupied');
 const final=await read(setup.slice(boundary));assert.equal(final.protectedUnchanged,true);evidence.rollback=final;rolledBack=true;console.log('D2_965_QUEUE_SOURCE_HELD_FINISH_APPLIED_NEW_TICKET_CONSERVATION_PASS');
}finally{
 if(server?.listening){server.closeAllConnections();server.close();}await chain;
 if(!closed){if(!rolledBack)await send('ROLLBACK;');child.stdin.end();}
 writeFileSync(`D:/Quy trình/output/reports/d2_${runId}-deferred-move-finish${cancel967?(cancelBefore?'-cancel-before':'-cancel-after'):''}-local-20261027.json`,JSON.stringify(evidence,null,2)+'\n');
}
