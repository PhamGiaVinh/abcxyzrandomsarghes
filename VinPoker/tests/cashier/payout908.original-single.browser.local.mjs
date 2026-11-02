// Actual original Single244 local TEST payment recording. One canonical COMMIT, normal HTTP response, prior907receipt retained; no real transfer.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_PAYOUT908_COMMIT_LOCAL,'1');
const db='vinpoker_ops_cash115_qualified_c',tour='c367013a-3ed3-48af-ad48-3915acadc50e',actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',club='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${db}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['tournament_hands','tournament_close_report','dealer_attendance','dealer_assignments','bank_transactions','payment_settlements','club_payment_config','tournament_registrations','tournament_entries','tournament_seats','cashier_buyin_movements','notifications','tournaments','stack_template','stack_template_issuance','tournament_chip_counts','chip_inventory_ledger','chip_bank_ledger'];
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')})::text);ROLLBACK;`);
const before=proof(),state={scope:'original Single244 place1 700K canonical LOCAL payment recording COMMIT normal response, prior907payment retained; no real cash/bank transfer',before,tour,trace:[],writerDenied:0};
const save=()=>writeFileSync('D:/Quy trình/output/reports/payout908-native-browser-state-local-20261026.json',JSON.stringify(state,null,2)+'\n');
const native=query=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='8s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${query};ROLLBACK;`));
const otherPayments=()=>sql(`BEGIN READ ONLY;SELECT md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) FROM public.tournament_prize_payments r WHERE NOT(tournament_id='${tour}' AND finished_place=1);ROLLBACK;`);
const receiptOthers=(request)=>sql(`BEGIN READ ONLY;SELECT md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) FROM floor_private.payout_payment_receipts_v1 r WHERE ${request?`NOT(actor_id='${actor}' AND request_id='${request}')`:'true'};ROLLBACK;`);
const paymentsBefore=otherPayments(),receiptsBefore=receiptOthers(null);
if(process.argv.includes('--verify-recorded')){
 const prior=JSON.parse(readFileSync('D:/Quy trình/output/reports/payout908-native-browser-state-local-20261026.json','utf8'));assert.equal(prior.recorded,true);assert.equal(proof(),prior.before);assert.equal(otherPayments(),prior.otherPaymentBaseline);assert.equal(receiptOthers(prior.attempt.request),prior.otherReceiptBaseline);
 const receipt=native(`SELECT public.get_tournament_prize_payment_receipt_v2('${prior.attempt.request}')`);assert.equal(receipt.found,true);assert.equal(receipt.result.payment_id,prior.paymentId);assert.equal(receipt.result.prize_amount,700000);
 const current=native(`SELECT public.get_tournament_payout_recipients('${tour}')`);assert.equal(Number(current.owedTotal),900000);assert.equal(Number(current.paidTotal),900000);assert.equal(current.places.find(p=>p.finishedPlace===1).isPaid,true);
 console.log('PAYOUT908_DURABLE_CANONICAL_RECEIPT_AND_PROTECTED_FACTS_READONLY_VERIFIED');process.exit(0);
}
assert.equal(sql(`SELECT count(*)||'|'||min(finished_place) FROM public.tournament_prize_payments WHERE tournament_id='${tour}';`),'1|2');
assert.equal(sql(`SELECT id FROM public.tournament_prize_payments WHERE tournament_id='${tour}' AND finished_place=2 AND prize_amount=200000 AND status='paid';`),'efe62275-4d29-41c1-acf0-96d7b579bb78');
const source=native(`SELECT public.get_tournament_payout_recipients('${tour}')`);
assert.equal(source.places.length,2);assert.equal(Number(source.owedTotal),900000);assert.equal(Number(source.paidTotal),200000);
const target=source.places.find(p=>p.finishedPlace===1);assert.equal(target.prizeAmount,700000);assert.equal(target.isPaid,false);
state.target={entry:target.entryId,recipient:target.recipientRef,place:1,amount:700000};state.otherPaymentBaseline=paymentsBefore;state.otherReceiptBaseline=receiptsBefore;
const assertAfter=()=>{assert.equal(proof(),before);assert.equal(otherPayments(),paymentsBefore);assert.equal(receiptOthers(state.attempt?.request),receiptsBefore);if(state.recorded)assert.deepEqual(JSON.parse(sql(`SELECT jsonb_build_array(count(*),sum(prize_amount)) FROM public.tournament_prize_payments WHERE tournament_id='${tour}' AND finished_place=1 AND status='paid';`)),[1,700000]);};
const templates=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id,name,stack_value FROM public.stack_template WHERE tournament_id='${tour}' ORDER BY stack_value)w`);assert.equal(templates.length,1);let corruptIssuance=true;
const inventory=native(`SELECT public.get_issued_chip_inventory('${tour}')`);assert.equal(inventory.total_value,180000);assert.equal(inventory.reconciliation_value,180000);
assert.equal(sql("SELECT pg_get_function_result('public.get_my_ops_global_capability()'::regprocedure);"),'TABLE(is_super_admin boolean)');
const sessions=new Map(),key=randomUUID(),user={id:actor,email:'chip908@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-26T00:00:00Z'};
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer');res.setHeader('Access-Control-Allow-Methods','GET,HEAD,POST,OPTIONS');res.setHeader('Cache-Control','no-store');const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'))return send(403,{message:'LOCAL908_SCOPE'});if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const c of req){raw+=c;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
 if(url.pathname==='/__local/manifest')return send(200,{tour,actor,club,email:user.email,runId:'908',model:'native SQL COMMIT / Auth HTTP modeled / no real transfer'});
 if(url.pathname==='/auth/v1/token'){assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.set(token,true);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});}
 if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL908_LOGIN_REQUIRED'});
 if(url.pathname==='/auth/v1/user')return send(200,user);
 if((req.method==='GET'||req.method==='HEAD')&&url.pathname.startsWith('/rest/v1/')){
 const name=url.pathname.slice('/rest/v1/'.length);
 if(name==='user_roles'){const value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT role FROM public.user_roles WHERE user_id='${actor}')w`);state.trace.push({read:name,rows:value.length});save();return send(200,value);}
 if(name==='dealers'){const value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id FROM public.dealers WHERE user_id='${actor}' AND deleted_at IS NULL LIMIT 1)w`);state.trace.push({read:name,rows:value.length});save();return send(200,value);}
 if(name==='clubs'){const value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id,name FROM public.clubs WHERE id='${club}')w`);return send(200,value);}
 state.writerDenied++;save();return send(403,{message:'LOCAL908_READ_NOT_IN_SCOPE'});
 }
 if(req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
 const name=url.pathname.slice('/rest/v1/rpc/'.length);
 if(name==='get_tournament_payout_recipients'){assert.equal(body.p_tournament_id,tour);const value=native(`SELECT public.get_tournament_payout_recipients('${tour}')`);state.trace.push({rpc:name,paid:Number(value.paidTotal)});save();return send(200,value);}
 if(name==='get_tournament_prize_payment_receipt_v2'){assert.equal(body.p_request_id,state.attempt?.request);const value=native(`SELECT public.get_tournament_prize_payment_receipt_v2('${body.p_request_id}')`);state.trace.push({rpc:name,found:value.found});assertAfter();save();return send(200,value);}
 if(name==='record_tournament_prize_payment_v2'){
 assert.equal(body.p_tournament_id,tour);assert.equal(body.p_finished_place,1);assert.equal(body.p_method,'cash');assert.equal(body.p_expected_token,target.confirmationToken);assert.match(body.p_request_id,/^[a-f0-9-]{36}$/);
 if(state.attempt)assert.equal(body.p_request_id,state.attempt.request);else{state.attempt={request:body.p_request_id};save();}
 const value=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT public.record_tournament_prize_payment_v2('${tour}',1,'cash','${target.confirmationToken}','${body.p_request_id}');COMMIT;`));
 assert.equal(value.ok,true);assert.ok(['recorded','already_paid'].includes(value.outcome));assert.equal(value.prize_amount,700000);assert.equal(value.entry_id,target.entryId);assert.equal(value.recipient_ref,target.recipientRef);
 state.recorded=true;state.paymentId=value.payment_id;state.trace.push({rpc:name,request:body.p_request_id,outcome:value.outcome,payment:value.payment_id,amount:value.prize_amount,responseLoss:false});assertAfter();save();return send(200,value);
 }
 state.writerDenied++;save();return send(403,{message:'LOCAL908_RPC_NOT_IN_SCOPE'});
 }
 state.writerDenied++;state.trace.push({kind:'endpoint_denied',path:url.pathname});save();return send(403,{message:'LOCAL908_ENDPOINT_NOT_ALLOWED'});
 }catch{state.trace.push({kind:'adapter_error'});save();return send(500,{message:'LOCAL908_ADAPTER_FAILED'});}
});save();server.listen(54329,'127.0.0.1',()=>console.log('PAYOUT908_ORIGINAL_SINGLE_RECORD_ADAPTER_READY',JSON.stringify({tour})));

process.stdin.once('data',()=>{process.stdin.pause();server.close(()=>{assertAfter();state.finalProtectedUnchanged=true;save();console.log('PAYOUT908_FINAL_PROTECTED_FACTS_AND_EXACT_PAYMENT_VERIFIED');process.exit(0);});server.closeAllConnections();});
