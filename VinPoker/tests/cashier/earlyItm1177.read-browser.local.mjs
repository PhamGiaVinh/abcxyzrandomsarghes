// Read-only browser transport for the already finalized1176 fixture. No money writer exists here.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const finance=process.env.VINPOKER_FINANCE1187_LOCAL==='1';
const normalFinance=finance&&process.argv.includes('--normal-finance1193');
const receiptRead=process.env.VINPOKER_RECEIPT1189_LOCAL==='1';
const pointerProbe=receiptRead&&process.argv.includes('--pointer-probe1190');
const eventProbe=receiptRead&&process.argv.includes('--event-probe1219');
assert.equal(finance&&receiptRead,false);
assert.equal(process.env[receiptRead?'VINPOKER_RECEIPT1189_LOCAL':finance?'VINPOKER_FINANCE1187_LOCAL':'VINPOKER_EARLYITM1177_READ_BROWSER'],'1');
const path=`D:/Quy trình/output/reports/${eventProbe?'receipt1219':normalFinance?'finance1193':pointerProbe?'receipt1190':receiptRead?'receipt1189':finance?'finance1187':'earlyitm1177'}-read-browser-state-local-20261028.json`;assert.equal(existsSync(path),false);
const origin=eventProbe?'http://127.0.0.1:53019':normalFinance?'http://127.0.0.1:52993':pointerProbe?'http://127.0.0.1:52990':receiptRead?'http://127.0.0.1:52989':finance?'http://127.0.0.1:52987':'http://127.0.0.1:5188';
const {fixture,requests}=JSON.parse(readFileSync('D:/Quy trình/output/reports/earlyitm1176-floor-browser-state-local-20261028.json','utf8'));
const {event,final:tour,actor,club,participation}=fixture;
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_earlyitm1172_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const guard=String.raw`DO $$ BEGIN ASSERT current_database()='vinpoker_earlyitm1172_local';ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_EARLYITM1172_OWNED_LOCAL_SOURCE_ranking860_HEAD_ef6a26948';ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure)='1f0369408d278b8548ced6f6037d9f8f';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));END $$;`;
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const read=q=>JSON.parse(execFileSync('wsl',args,{input:'BEGIN READ ONLY;'+guard+"SET LOCAL statement_timeout='10s';"+q+';ROLLBACK;',encoding:'utf8',timeout:20000,maxBuffer:4e6,stdio:['pipe','pipe','pipe']}).trim());
const native=q=>read(auth+q);
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const tables=['public.tournaments','public.tournament_entries','public.tournament_seats','public.tournament_prize_payments','public.cashier_buyin_movements','public.multi_day_payout_finalizations_v1','public.tournament_close_report','private.multi_day_individual_results_v1','private.multi_day_individual_rank_requests_v1','private.multi_day_individual_obligations_v1','private.multi_day_individual_obligation_requests_v1','private.multi_day_individual_payment_commits_v1','floor_private.payout_payment_receipts_v1'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM ${t} x)`).join(',')})::text))`);
const state={kind:receiptRead?'ORIGINAL_COMMITTED_PAYMENT_RECEIPT_READ_ONLY_BROWSER':finance?'FINANCE_PARTIAL_INDIVIDUAL_LIABILITY_NATIVE_READ_ONLY_BROWSER':'FLOOR_PERSISTED_OBLIGATION_FRESH_READ_BROWSER_ONLY',fixture,before:fingerprint(),reads:[],expectedReadErrors:[],errors:[],denied:[],faults:[]};
let receiptIntent;
if(receiptRead){
 const receipt=native(`SELECT public.get_tournament_prize_payment_receipt_v2('${requests.payment.p_request_id}')`);
 const recipients=native(`SELECT public.get_tournament_payout_recipients('${tour}')`);
 const place=recipients.places.find(row=>row.entryId===fixture.entry);
 assert.equal(receipt.found,true);assert.equal(receipt.actor_id,actor);assert.equal(receipt.result.prize_amount,100000);
 assert.equal(place.isPaid,true);assert.equal(receipt.result.entry_id,place.entryId);
 receiptIntent=JSON.stringify({actorId:actor,tournamentId:tour,requestId:requests.payment.p_request_id,
  entryId:place.entryId,recipientRef:place.recipientRef,recipientName:place.recipientName,
  finishedPlace:receipt.result.finished_place,prizeAmount:receipt.result.prize_amount,
  confirmationToken:receipt.payload.expected_token,method:receipt.payload.method,
  multiDayEventId:receipt.payload.event_id,multiDayParticipationId:receipt.payload.participation_id});
 state.originalReceipt=receipt;state.recipientMode='slow';
}
const save=()=>writeFileSync(path,JSON.stringify(state,null,2));
const key=randomUUID(),sessions=new Set(),user={id:actor,email:finance?'finance1187@example.invalid':'earlyitm1176@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-28T00:00:00Z'};
let corruptNext=false;
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer,x-retry-count');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.headers.host!=='127.0.0.1:54329'||req.headers.origin&&req.headers.origin!==origin)return send(403,{message:'LOCAL1177_SCOPE'});
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
  if(u.pathname==='/__local/manifest')return send(200,{tour,actor,club,...(finance||receiptRead?{singleTour:true}:{d2Event:event}),...(receiptRead?{prizeReceiptIntent:receiptIntent}:{}),email:user.email,runId:receiptRead?'1189':finance?'1187':'1177',model:'persisted debt READ ONLY / modeled session / no writers'});
  if(u.pathname==='/auth/v1/token'){
   assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600;
   const payload=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');
   const token=payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');sessions.add(token);
   return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(normalFinance&&u.pathname==='/realtime/v1/websocket'){
   state.expectedReadErrors.push({kind:'REALTIME_NOT_PROVIDED_BY_LOCAL_READ_ADAPTER'});save();return send(503,{message:'LOCAL1193_NO_REALTIME'});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL1177_MODELED_SESSION_REQUIRED'});
  if(u.pathname==='/auth/v1/user')return send(200,user);
  if(normalFinance&&['GET','HEAD'].includes(req.method)&&u.pathname.startsWith('/rest/v1/')){
   const name=u.pathname.slice('/rest/v1/'.length),select=u.searchParams.get('select');let statement;
   if(name==='app_settings'){
    assert.equal(select,'value');assert.equal(u.searchParams.get('key'),'eq.support_user_id');
    statement="SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT value FROM public.app_settings WHERE key='support_user_id')x";
   }else if(name==='booking_chats'){
    assert.equal(select,'*');assert.equal(u.searchParams.get('archived_at'),'is.null');
    statement="SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.booking_chats x WHERE archived_at IS NULL";
   }else if(name==='chat_messages'){
    assert.equal(select,'chat_id,sender_id,created_at,kind');const ids=u.searchParams.get('chat_id');assert.match(ids??'',/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');
    statement=`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT chat_id,sender_id,created_at,kind FROM public.chat_messages WHERE chat_id IN(${list.map(literal).join(',')}))x`;
   }else if(name==='notifications'){
    assert.equal(u.searchParams.get('user_id'),'eq.'+actor);
    if(req.method==='HEAD'){
     assert.equal(select,'id');assert.equal(u.searchParams.get('is_read'),'eq.false');
     const count=native(`SELECT to_jsonb(count(*)) FROM public.notifications WHERE user_id='${actor}' AND NOT is_read`);
     res.setHeader('Access-Control-Expose-Headers','Content-Range');res.setHeader('Content-Range','*/'+count);state.reads.push({table:name,head:true,count});save();res.writeHead(200);return res.end();
    }
    assert.equal(select,'*');assert.equal(u.searchParams.get('order'),'created_at.desc');assert.equal(u.searchParams.get('limit'),'15');
    statement=`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.notifications WHERE user_id='${actor}' ORDER BY created_at DESC LIMIT 15)x`;
   }else if(name==='profiles'){
    if(select==='display_name,display_name_lower,created_at'){
     assert.equal(u.searchParams.get('user_id'),'eq.'+actor);statement=`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT display_name,display_name_lower,created_at FROM public.profiles WHERE user_id='${actor}')x`;
    }else if(select==='user_id,created_at'){
     assert.equal(u.searchParams.get('user_id'),'neq.'+actor);const lower=u.searchParams.get('display_name_lower');assert.ok(lower?.startsWith('eq.'));assert.equal(u.searchParams.get('limit'),'1');
     statement=`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT user_id,created_at FROM public.profiles WHERE user_id<>'${actor}' AND display_name_lower=${literal(lower.slice(3))} LIMIT 1)x`;
    }
   }else if(name==='tournament_registrations'){
    assert.equal(select,'id,status,tournament_id');assert.equal(u.searchParams.get('player_id'),'eq.'+actor);assert.equal(u.searchParams.get('status'),'in.(pending,confirmed)');assert.equal(u.searchParams.get('limit'),'8');assert.equal(u.searchParams.get('order'),'created_at.desc');
    statement=`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,status,tournament_id FROM public.tournament_registrations WHERE player_id='${actor}' AND status IN('pending','confirmed') ORDER BY created_at DESC LIMIT 8)x`;
   }else if(name==='staking_deals'&&req.method==='HEAD'){
    assert.equal(select,'id');const status=u.searchParams.get('status');assert.ok(['eq.result_entered','eq.release_requested','eq.result_disputed'].includes(status));
    const count=native(`SELECT to_jsonb(count(*)) FROM public.staking_deals WHERE status=${literal(status.slice(3))}`);
    res.setHeader('Access-Control-Expose-Headers','Content-Range');res.setHeader('Content-Range','*/'+count);state.reads.push({table:name,head:true,count});save();res.writeHead(200);return res.end();
   }
   if(statement){const rows=native(statement);state.reads.push({table:name,rows:rows.length});save();return send(200,req.headers.accept==='application/vnd.pgrst.object+json'?rows[0]??null:rows);}
  }
  if((finance||receiptRead)&&req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   const name=u.pathname.slice('/rest/v1/'.length),columns={user_roles:'role',dealers:'id',clubs:'id',club_chip_masters:'club_id',club_marketers:'club_id',club_fnb_staff:'club_id',club_accountants:'club_id'}[name];
   if(columns){
    assert.equal(u.searchParams.get('select'),columns);assert.equal(u.searchParams.get(name==='clubs'?'owner_id':'user_id'),'eq.'+actor);
    const where=name==='clubs'?`owner_id='${actor}'`:`user_id='${actor}'${name==='dealers'?' AND deleted_at IS NULL':''}`;
    return send(200,native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.${name} WHERE ${where}${name==='user_roles'?'':' LIMIT 1'})x`));
   }
  }
  if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.slice('/rest/v1/rpc/'.length);let statement;
   if(finance&&(name==='get_club_payout_liability_v2'||normalFinance&&name==='get_club_finance_summary_v2')){
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    assert.deepEqual(body,{p_from_date:today.slice(0,7)+'-01',p_to_date:today,p_club_id:null});
    statement=`SELECT public.${name}('${body.p_from_date}','${body.p_to_date}',NULL)`;
   }else if((finance||receiptRead)&&name==='get_tournament_payout_recipients'){
    assert.deepEqual(body,{p_tournament_id:tour});statement=`SELECT public.${name}('${tour}')`;
    if(receiptRead){
     const mode=state.recipientMode;state.faults.push({kind:'RECIPIENT_READ_MODE',mode});save();
     if(mode==='missing')return send(404,{code:'PGRST202',message:'LOCAL1189_RECIPIENT_RPC_UNAVAILABLE'});
     if(mode==='error')return send(503,{code:'LOCAL1189',message:'LOCAL1189_RECIPIENT_READ_ERROR'});
     if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,8000));
    }
   }else if(receiptRead&&name==='get_tournament_prize_payment_receipt_v2'){
    assert.deepEqual(body,{p_request_id:requests.payment.p_request_id});statement=`SELECT public.${name}('${requests.payment.p_request_id}')`;
   }else if(['multi_day_floor_read_v1','multi_day_qualification_preview_v1','multi_day_payout_preview_v1','get_multi_day_individual_rank_review_v1'].includes(name)){
    assert.deepEqual(body,{p_event_id:event});statement=`SELECT public.${name}('${event}')`;
   }else if(name==='get_multi_day_individual_obligation_preview_v1'){
    assert.deepEqual(body,{p_event_id:event,p_participation_id:participation});statement=`SELECT public.${name}('${event}','${participation}')`;
   }else if(['get_multi_day_individual_rank_receipt_v1','get_multi_day_individual_obligation_receipt_v1'].includes(name)){
    const kind=name.includes('_rank_')?'rank':'obligation';assert.deepEqual(body,{p_event_id:event,p_request_id:requests[kind].p_request_id});statement=`SELECT public.${name}('${event}','${body.p_request_id}')`;
   }
   if(statement){
    try{const value=native(statement);state.reads.push({rpc:name,owedRows:value.individualObligations?.length??null});
     if(normalFinance&&name==='get_club_finance_summary_v2')state.latestCanonicalFinanceSummary=value;
     if(finance&&name==='get_club_payout_liability_v2'){
      const row=value.perTournament.find(item=>item.tournamentId===tour);assert.equal(row.liabilityScope,'INDIVIDUAL');assert.equal(row.isPartial,true);assert.equal(row.owed,100000);assert.equal(row.paid,100000);assert.equal(row.outstanding,0);
      state.latestCanonicalLiability=value;
      if(corruptNext){corruptNext=false;const corrupted=structuredClone(value);corrupted.perTournament.find(item=>item.tournamentId===tour).isPartial=false;
       state.faults.push({kind:'CONTRADICTORY_PARTIAL_FLAG_HTTP_ONLY',canonicalRow:row});save();return send(200,corrupted);}
     }
     save();return send(200,value);}
    catch(error){const detail=String(error.stderr??'').match(/ERROR:\s+([^\n]+)/)?.[1];if(detail==='multi_day_payout_results_not_ready'){state.expectedReadErrors.push({rpc:name,message:detail});save();return send(400,{code:'P0001',message:detail});}throw error;}
   }
  }
  state.denied.push({method:req.method,path:u.pathname});save();return send(403,{message:'LOCAL1177_READ_ONLY_NO_WRITERS'});
 }catch(error){state.errors.push({message:error.message});save();return send(500,{message:'LOCAL1177_UNCONFIRMED_READ'});}
});
let stopping=false;
const finish=()=>{if(stopping)return;stopping=true;process.stdin.pause();server.close(()=>{state.after=fingerprint();state.unchanged=state.before===state.after;save();assert.equal(state.unchanged,true);if(finance){assert.equal(state.faults.length,1);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);}if(receiptRead){assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);}console.log(receiptRead?'RECEIPT1189_BROWSER_READONLY_13_TABLES_UNCHANGED':finance?'FINANCE1187_BROWSER_READONLY_13_TABLES_UNCHANGED':'EARLYITM1177_BROWSER_READONLY_13_TABLES_UNCHANGED');process.exit(0);});server.closeAllConnections();};
process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(receiptRead&&['slow','missing','error','native'].includes(command)){state.recipientMode=command;save();console.log('RECEIPT1189_RECIPIENT_MODE',command);return;}if(finance&&command==='corrupt'){assert.equal(corruptNext,false);corruptNext=true;console.log('FINANCE1187_NEXT_READ_PARTIAL_FLAG_FAULT_ARMED');return;}assert.equal(command,'stop');finish();});process.once('SIGINT',finish);save();
server.listen(54329,'127.0.0.1',()=>console.log('EARLYITM1177_READONLY_BROWSER_READY',JSON.stringify({tour,event})));
