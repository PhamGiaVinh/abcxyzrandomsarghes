import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const literal=v=>`'${String(v).replaceAll("'","''")}'`;

/** One owned local transaction across UI requests; never commits correction data. */
export async function createMultiDayCorrectionBrowser({sql,actor,event,club,tour,log}){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(process.env.VINPOKER_CORRECTION_BROWSER,'1');
 const paymentReversal=process.env.VINPOKER_CORRECTION_PAYMENT_REVERSAL_BROWSER==='1';
 const paymentOnly=process.env.VINPOKER_PAYMENT461_BROWSER==='1';
 assert.equal(event,paymentOnly?'dbb49f8d-7d47-4c2c-afd9-f57062c9971d':'b8ebfbc7-ff78-4515-8812-7d748b828d0b');assert.ok(uuid(actor)&&uuid(club));
 if(paymentOnly){assert.equal(tour,'4cd3af4d-7e1d-4042-855f-04fb6777e580');assert.equal(paymentReversal,false);}
 const before=sql(`SELECT md5(jsonb_build_object('requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY request_id),'[]') FROM public.multi_day_payout_correction_requests_v1 r),
  'corrections',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.multi_day_payout_corrections_v1 r),
  'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.tournament_prize_payments p))::text);`);
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
  'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',waiting=null,ended=false,queue=Promise.resolve(),correction=null,approval=null,paymentSeed=null;
 const failures=[];
 child.stderr.on('data',b=>{failures.push(String(b).slice(0,1000));});
 const closed=new Promise(resolve=>child.once('close',code=>{ended=true;waiting?.reject(new Error(`local transaction ended ${code}`));waiting=null;resolve(code);}));
 child.on('error',error=>{ended=true;waiting?.reject(error);waiting=null;});
 child.stdout.on('data',chunk=>{
  output+=chunk.toString();
  if(output.length>2e6){waiting?.reject(new Error('local transaction output too large'));child.stdin.end();return;}
  if(waiting&&output.includes(waiting.marker+'\n')){
   const index=output.indexOf(waiting.marker+'\n'),lines=output.slice(0,index).trim().split('\n').filter(Boolean);
   output=output.slice(index+waiting.marker.length+1);const done=waiting;waiting=null;
   try{assert.equal(lines.length,1);done.resolve(JSON.parse(lines[0]));}catch(error){done.reject(error);}
  }
 });
 const execute=statement=>{
  const task=queue.then(()=>new Promise((resolve,reject)=>{
   if(ended){reject(new Error('local transaction unavailable'));return;}
   const marker=`LOCAL_RESULT_${randomUUID()}`;waiting={marker,resolve,reject};
   child.stdin.write(`${statement}\n\\echo ${marker}\n`);
  }));queue=task.catch(()=>{});return task;
 };
 try{
  await execute(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL idle_in_transaction_session_timeout='10min';
   UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid];
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
   SELECT '{}'::jsonb;`);
  if(paymentReversal){
   const candidates=await execute(`SELECT public.get_multi_day_payout_recipients_v1('${event}');`);
   const person=candidates.places.find(p=>p.prizeAmount>0&&p.paidAmount===0);
   assert.ok(person&&uuid(person.multiDayParticipationId)&&/^[a-f0-9]{32}$/.test(person.confirmationToken));
   assert.ok(Number.isSafeInteger(person.prizeAmount)&&person.prizeAmount>0);
   const request=randomUUID();
   const paid=await execute(`SELECT public.record_multi_day_prize_payment_v1('${event}','${person.multiDayParticipationId}','cash','${person.confirmationToken}','${request}');`);
   assert.equal(paid.ok,true);assert.equal(paid.outcome,'recorded');assert.ok(uuid(paid.payment_id));assert.equal(paid.prize_amount,person.prizeAmount);
   const current=await execute(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`);
   assert.ok(current.reversiblePayments.some(p=>p.id===paid.payment_id&&p.participationId===person.multiDayParticipationId));
   paymentSeed={paymentId:paid.payment_id,participationId:person.multiDayParticipationId,amount:person.prizeAmount,requestId:request};
   log.push({correctionPaymentSeed:paymentSeed,transaction:'ROLLBACK_ONLY'});
  }
 }catch(error){child.stdin.end();await closed;throw error;}
 const reads=new Set(['multi_day_floor_read_v1','multi_day_qualification_preview_v1','multi_day_payout_postfinal_state_v1']);
 let requestFault=true,approvalFault=true,paymentFault=true,paymentIntent=null;
 return {
  manifest:paymentSeed,
  async handle(path,method,body){
   const name=path.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];if(!name)return null;
   assert.equal(method,'POST');let statement;
   if(paymentOnly){
    if(name==='get_tournament_payout_recipients'){
     assert.deepEqual(body,{p_tournament_id:tour});statement=`SELECT public.get_tournament_payout_recipients('${tour}');`;
    }else if(name==='record_multi_day_prize_payment_v1'){
     assert.equal(body.p_event_id,event);assert.ok(uuid(body.p_participation_id)&&uuid(body.p_request_id));
     assert.equal(body.p_method,'cash');assert.match(body.p_expected_token,/^[a-f0-9]{32}$/);
     if(paymentIntent)assert.deepEqual(body,paymentIntent);else paymentIntent={...body};
     statement=`SELECT public.record_multi_day_prize_payment_v1('${event}','${body.p_participation_id}','cash','${body.p_expected_token}','${body.p_request_id}');`;
    }else if(name==='get_tournament_prize_payment_receipt_v2'){
     assert.ok(paymentIntent);assert.deepEqual(body,{p_request_id:paymentIntent.p_request_id});
     statement=`SELECT public.get_tournament_prize_payment_receipt_v2('${body.p_request_id}');`;
    }else return {status:401,value:{message:'LOCAL_PAYMENT461_TRANSACTION_ONLY'}};
   }else if(reads.has(name)){
    assert.deepEqual(body,{p_event_id:event});statement=`SELECT public.${name}('${event}');`;
   }else if(name==='multi_day_request_payout_correction_v1'){
    assert.equal(body.p_event_id,event);assert.equal(body.p_kind,paymentReversal?'PAYMENT_REVERSAL':'OBLIGATION_DELTA');
    assert.equal(body.p_original_payment_id,paymentSeed?.paymentId??null);
    assert.equal(body.p_delta_vnd,paymentSeed?-paymentSeed.amount:-1);assert.ok(uuid(body.p_participation_id)&&uuid(body.p_request_id));
    if(paymentSeed)assert.equal(body.p_participation_id,paymentSeed.participationId);
    assert.match(body.p_expected_revision,/^[a-f0-9]{32}$/);assert.equal(body.p_reason,'Local browser recovery TEST');
    assert.equal(body.p_evidence_ref,'local-transaction-rollback');
    if(correction)assert.deepEqual(body,correction);else correction={...body};
    statement=`SELECT public.${name}('${event}','${body.p_kind}','${body.p_participation_id}',${paymentSeed?literal(paymentSeed.paymentId):'NULL'},${body.p_delta_vnd},
     '${body.p_expected_revision}',${literal(body.p_reason)},${literal(body.p_evidence_ref)},'${body.p_request_id}');`;
   }else if(name==='multi_day_approve_payout_correction_v1'){
    assert.ok(correction&&uuid(body.p_approval_request_id));assert.equal(body.p_request_id,correction.p_request_id);
    if(approval)assert.deepEqual(body,approval);else approval={...body};
    statement=`SELECT public.${name}('${body.p_request_id}','${body.p_approval_request_id}');`;
   }else return {status:401,value:{message:'LOCAL_CORRECTION_TRANSACTION_ONLY'}};
   const result=await execute(statement);log.push({rpc:name,args:body,result,transaction:'ROLLBACK_ONLY'});
   if(paymentOnly&&name==='record_multi_day_prize_payment_v1'&&paymentFault){
    assert.equal(result.ok,true);assert.equal(result.outcome,'recorded');paymentFault=false;
    return {status:503,value:{message:'LOCAL_PAYMENT461_COMMITTED_RESPONSE_LOSS'}};
   }
   if(name==='multi_day_request_payout_correction_v1'&&requestFault){requestFault=false;return {status:503,value:{message:'LOCAL_CORRECTION_RESPONSE_LOSS'}};}
   if(name==='multi_day_approve_payout_correction_v1'&&approvalFault){approvalFault=false;return {status:503,value:{message:'LOCAL_APPROVAL_RESPONSE_LOSS'}};}
   return {status:200,value:result};
  },
  async cleanup(){
   if(!ended){await execute("ROLLBACK;SELECT '{}'::jsonb;");child.stdin.end('\\q\n');}
   const code=await closed;assert.equal(code,0,failures.join('\n'));
   const after=sql(`SELECT md5(jsonb_build_object('requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY request_id),'[]') FROM public.multi_day_payout_correction_requests_v1 r),
    'corrections',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.multi_day_payout_corrections_v1 r),
    'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.tournament_prize_payments p))::text);`);
   assert.equal(after,before);console.log('LOCAL_BROWSER_CORRECTION_APPROVAL_ROLLBACK_NO_ROW_PAYMENT_DELTA_PASS');
  },
 };
}
