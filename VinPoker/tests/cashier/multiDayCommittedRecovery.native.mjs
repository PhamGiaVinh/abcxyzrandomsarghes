import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {parseCorrectionIntent,persistCorrectionIntent,readCorrectionIntent,clearCorrectionIntent} from '../../src/ops/floor/multiDayCorrectionIntent.ts';
import {parseApprovalIntent,persistApprovalIntent,readApprovalIntent,clearApprovalIntent} from '../../src/ops/floor/multiDayApprovalIntent.ts';
import {parsePrizePaymentIntent,persistPrizePaymentIntent,prizePaymentJournalKey,resolvePrizePaymentReceipt,clearPrizePaymentIntent} from '../../src/lib/prizePaymentIntent.ts';
import {verifyMultiDayFloorRead} from '../../src/ops/floor/multiDayFloorRead.ts';

export function verifyCommittedMultiDayRecovery(sourceSql,{paymentReversal=false}={}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const source='vinpoker_ops_cash115_qualified_c',clone=`vinpoker_recovery_${randomUUID().replaceAll('-','')}`;
 assert.match(clone,/^vinpoker_recovery_[a-f0-9]{32}$/);assert.notEqual(source,clone);
 const run=(command,args,input)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
  command,...args],{input,encoding:'utf8',timeout:60000,maxBuffer:2e6}).trim();
 const sql=input=>run('psql',['-d',clone,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],input);
 const fingerprint=()=>sourceSql(`SELECT md5(jsonb_build_object('requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM public.multi_day_payout_correction_requests_v1 r),
  'corrections',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.multi_day_payout_corrections_v1 r),
  'final',(SELECT jsonb_agg(to_jsonb(r) ORDER BY event_id) FROM public.multi_day_payout_finalizations_v1 r),
  'gate',(SELECT jsonb_agg(to_jsonb(r)) FROM public.multi_day_package_release_v1 r),
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
  'paymentCommits',(SELECT jsonb_agg(to_jsonb(p) ORDER BY payment_id) FROM private.multi_day_payment_commits_v1 p),
  'paymentReceipts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY actor_id,request_id) FROM floor_private.payout_payment_receipts_v1 p))::text);`);
 assert.equal(sourceSql('SELECT current_database();'),source);
 assert.ok(Number(sourceSql('SELECT pg_database_size(current_database());'))<256*1024*1024,'do not copy a large database under resource hold');
 assert.equal(sourceSql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();"),'0');
 const before=fingerprint();let created=false;
 try{
  run('createdb',['-w','--template',source,clone]);created=true;
  assert.equal(sql('SELECT current_database();'),clone);
  assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
  const event='b8ebfbc7-ff78-4515-8812-7d748b828d0b';
  const scope=JSON.parse(sql(`SELECT jsonb_build_object('actor',c.owner_id,'club',e.club_id,'person',p.id,'tour',e.final_tournament_id)
   FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id JOIN public.multi_day_final_participations_v1 p ON p.event_id=e.id
   WHERE e.id='${event}' AND e.name='Multi-day SELECT_LARGEST local TEST' ORDER BY p.id LIMIT 1;`));
  sql(`UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${scope.club}'::uuid];`);
  const call=(statement,actor=scope.actor)=>sql(`BEGIN;SET LOCAL statement_timeout='5s';
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
   ${statement}COMMIT;`);
  const initialState=JSON.parse(call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`));
  let rows=new Map();const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  let paidIntent=null,paidReceipt=null,amount=0;
  const frozen=()=>sql(`SELECT md5(to_jsonb(f)::text) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${event}';`);
  const frozenBefore=frozen();
  const recipient=()=>JSON.parse(call(`SELECT public.get_multi_day_payout_recipients_v1('${event}');`)).places.find(p=>p.multiDayParticipationId===scope.person);
  const paymentStatement=i=>`SELECT public.record_multi_day_prize_payment_v1('${event}','${i.multiDayParticipationId}','${i.method}','${i.confirmationToken}','${i.requestId}');`;
  if(paymentReversal){
   const person=recipient();assert.ok(person);amount=person.prizeAmount;assert.ok(Number.isSafeInteger(amount)&&amount>0);
   paidIntent=parsePrizePaymentIntent(JSON.stringify({...person,actorId:scope.actor,tournamentId:scope.tour,requestId:randomUUID(),method:'cash'}),scope.actor,scope.tour);
   persistPrizePaymentIntent(storage,paidIntent);
   // Commit in one psql process, discard response, then reload the actual client journal.
   call(paymentStatement(paidIntent));rows=new Map(JSON.parse(JSON.stringify([...rows])));
   const retained= parsePrizePaymentIntent(storage.getItem(prizePaymentJournalKey(scope.actor,scope.tour)),scope.actor,scope.tour);
   paidReceipt=JSON.parse(call(`SELECT public.get_tournament_prize_payment_receipt_v2('${retained.requestId}');`));
   assert.equal(resolvePrizePaymentReceipt(retained,paidReceipt).status,'committed');
   assert.deepEqual(JSON.parse(call(paymentStatement(retained))),paidReceipt.result);
   assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE id='${paidReceipt.result.payment_id}';`),'1');
   clearPrizePaymentIntent(storage,retained);
  }
  const state=JSON.parse(call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`));
  verifyMultiDayFloorRead('multi_day_payout_postfinal_state_v1',state,event);
  if(paymentReversal){
   assert.equal(state.paidPlayerVnd,initialState.paidPlayerVnd+amount);assert.equal(state.unpaidObligationVnd,initialState.unpaidObligationVnd-amount);
   const floor=JSON.parse(call(`SELECT public.multi_day_floor_read_v1('${event}');`));
   assert.ok(!floor.finalization.sourceSnapshot.payments.some(p=>p.id===paidReceipt.result.payment_id),'new payout must not rewrite the original finalized snapshot');
   assert.ok(Array.isArray(state.reversiblePayments)&&state.reversiblePayments.some(p=>p.id===paidReceipt.result.payment_id&&p.participationId===scope.person&&p.amountVnd===amount),
    'current read must expose the committed post-final payment for the reversal picker');
   assert.throws(()=>call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`,randomUUID()),/multi_day_payout_read_actor_denied/);
   assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE anon;SELECT public.multi_day_payout_postfinal_state_v1('${event}');ROLLBACK;`),/permission denied/);
  }
  const originalPayment=paymentReversal?sql(`SELECT md5(to_jsonb(p)::text) FROM public.tournament_prize_payments p WHERE id='${paidReceipt.result.payment_id}';`):null;
  const immutable=()=>sql(`SELECT md5(jsonb_build_object('final',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${event}'),
   'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p))::text);`);
  const immutableBefore=immutable();
  const request=randomUUID(),approval=randomUUID();
  const delta=paymentReversal?-amount:-1;
  const intent=parseCorrectionIntent({actorId:scope.actor,eventId:event,args:{p_event_id:event,p_kind:paymentReversal?'PAYMENT_REVERSAL':'OBLIGATION_DELTA',p_participation_id:scope.person,
   p_original_payment_id:paidReceipt?.result.payment_id??null,p_delta_vnd:delta,p_expected_revision:state.revision,p_reason:'Local committed recovery TEST',p_evidence_ref:'disposable-database-evidence',p_request_id:request}},scope.actor,event);
  persistCorrectionIntent(storage,intent);
  const requestStatement=value=>`SELECT public.multi_day_request_payout_correction_v1('${event}','${intent.args.p_kind}','${scope.person}',${intent.args.p_original_payment_id?`'${intent.args.p_original_payment_id}'`:'NULL'},${value},
   '${intent.args.p_expected_revision}','${intent.args.p_reason}','${intent.args.p_evidence_ref}','${request}');`;
  // Real COMMIT succeeds and this psql process exits; discard its receipt.
  call(requestStatement(delta));rows=new Map(JSON.parse(JSON.stringify([...rows])));
  const recovered=readCorrectionIntent(storage,scope.actor,event);assert.deepEqual(recovered,intent);
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_payout_correction_requests_v1 WHERE request_id='${request}';`),'1');
  const receipt=JSON.parse(call(requestStatement(recovered.args.p_delta_vnd)));assert.equal(receipt.requestId,request);assert.equal(receipt.idempotent,true);
  assert.throws(()=>call(requestStatement(delta-1)),/multi_day_payout_request_conflict/);
  clearCorrectionIntent(storage,recovered);
  const approveIntent=parseApprovalIntent({actorId:scope.actor,eventId:event,args:{p_request_id:request,p_approval_request_id:approval}},scope.actor,event);
  persistApprovalIntent(storage,approveIntent);
  const approvalStatement=`SELECT public.multi_day_approve_payout_correction_v1('${request}','${approval}');`;
  call(approvalStatement);rows=new Map(JSON.parse(JSON.stringify([...rows])));
  const retained=readApprovalIntent(storage,scope.actor,event);assert.deepEqual(retained,approveIntent);
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_payout_corrections_v1 WHERE request_id='${request}';`),'1');
  const replay=JSON.parse(call(approvalStatement));assert.equal(replay.idempotent,true);assert.equal(replay.ok,true);
  assert.equal(sql(`SELECT id FROM public.multi_day_payout_corrections_v1 WHERE request_id='${request}';`),replay.correctionId);
  assert.throws(()=>call(`SELECT public.multi_day_approve_payout_correction_v1('${request}','${randomUUID()}');`),/multi_day_payout_request_conflict/);
  assert.throws(()=>call(approvalStatement,randomUUID()),/multi_day_payout_owner_required/);
  const current=JSON.parse(call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`));
  if(paymentReversal)assert.ok(!current.reversiblePayments.some(p=>p.id===paidReceipt.result.payment_id),'approved reversal must remove the original from eligible records');
  assert.equal(current.unpaidObligationVnd,state.unpaidObligationVnd+(paymentReversal?amount:-1));assert.equal(current.unallocatedPoolVnd,state.unallocatedPoolVnd+(paymentReversal?0:1));
  assert.equal(current.paidPlayerVnd,state.paidPlayerVnd-(paymentReversal?amount:0));assert.equal(current.revision,replay.revision);
  const requestAfterApproval=JSON.parse(call(requestStatement(delta)));assert.equal(requestAfterApproval.idempotent,true);
  assert.equal(immutable(),immutableBefore);
  clearApprovalIntent(storage,retained);assert.equal(rows.size,0);
  if(paymentReversal){
   // An old payment nonce is a historical receipt, never a new payout after reversal.
   assert.deepEqual(JSON.parse(call(paymentStatement(paidIntent))),paidReceipt.result);
   assert.equal(JSON.parse(call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`)).paidPlayerVnd,initialState.paidPlayerVnd);
   const person=recipient();assert.equal(person.prizeAmount,amount);
   const repayment={...paidIntent,requestId:randomUUID(),confirmationToken:person.confirmationToken};
   const repaid=JSON.parse(call(paymentStatement(repayment)));assert.equal(repaid.ok,true);assert.notEqual(repaid.payment_id,paidReceipt.result.payment_id);
   assert.deepEqual(JSON.parse(call(paymentStatement(repayment))),repaid);
   const afterRepay=JSON.parse(call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`));
   assert.ok(afterRepay.reversiblePayments.some(p=>p.id===repaid.payment_id)&&!afterRepay.reversiblePayments.some(p=>p.id===paidReceipt.result.payment_id));
   assert.equal(afterRepay.paidPlayerVnd,state.paidPlayerVnd);assert.equal(afterRepay.unpaidObligationVnd,state.unpaidObligationVnd);
   assert.equal(frozen(),frozenBefore);
   assert.equal(sql(`SELECT md5(to_jsonb(p)::text) FROM public.tournament_prize_payments p WHERE id='${paidReceipt.result.payment_id}';`),originalPayment);
   assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE id IN('${paidReceipt.result.payment_id}','${repaid.payment_id}') AND status='paid' AND prize_amount=${amount};`),'2');
   const duplicate=randomUUID();
   const duplicateRequest=JSON.parse(call(`SELECT public.multi_day_request_payout_correction_v1('${event}','PAYMENT_REVERSAL','${scope.person}','${paidReceipt.result.payment_id}',${-amount},
    '${afterRepay.revision}','Local duplicate reversal TEST','disposable-database-evidence','${duplicate}');`));assert.equal(duplicateRequest.ok,true);
   assert.throws(()=>call(`SELECT public.multi_day_approve_payout_correction_v1('${duplicate}','${randomUUID()}');`),/multi_day_payout_payment_already_reversed/);
   assert.equal(sql(`SELECT count(*) FROM public.multi_day_payout_corrections_v1 WHERE original_payment_id='${paidReceipt.result.payment_id}';`),'1');
   assert.equal(JSON.parse(call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`)).revision,afterRepay.revision);
   assert.deepEqual(JSON.parse(call(approvalStatement)),replay,'original approval receipt survives a subsequent repayment/revision');
   assert.deepEqual(JSON.parse(call(`SELECT public.get_tournament_prize_payment_receipt_v2('${paidIntent.requestId}');`)),paidReceipt);
   assert.equal(rows.size,0);
   console.log('MULTIDAY_PAYMENT_REVERSAL_RECOVERY_EVIDENCE',JSON.stringify({event,tour:scope.tour,participation:scope.person,amount,
    paymentRequest:paidIntent.requestId,payment:paidReceipt.result.payment_id,correctionRequest:request,approvalRequest:approval,correction:replay.correctionId,
    repaymentRequest:repayment.requestId,repayment:repaid.payment_id,duplicateRequest:duplicate,
    before:{paid:initialState.paidPlayerVnd,unpaid:initialState.unpaidObligationVnd},
    paid:{paid:state.paidPlayerVnd,unpaid:state.unpaidObligationVnd},reversed:{paid:current.paidPlayerVnd,unpaid:current.unpaidObligationVnd},
    repaid:{paid:afterRepay.paidPlayerVnd,unpaid:afterRepay.unpaidObligationVnd}}));
   console.log('MULTIDAY_PAYMENT_REAL_COMMIT_LOST_RECEIPT_REVERSAL_APPROVAL_REPAY_DUPLICATE_DENIAL_IMMUTABLE_PASS');
  }else console.log('MULTIDAY_REAL_COMMIT_NEW_CONNECTION_RELOAD_REQUEST_APPROVAL_CONFLICT_OUTSIDER_PASS');
 }finally{
  if(created){
   // Only the exact random database created above. Never force-disconnect others.
   assert.match(clone,/^vinpoker_recovery_[a-f0-9]{32}$/);run('dropdb',['-w',clone]);
   console.log('LOCAL_OWNED_RECOVERY_DATABASE_REMOVED');
  }
  assert.equal(fingerprint(),before);console.log('LOCAL_SOURCE_DATABASE_CORRECTION_FINANCIAL_GATE_UNCHANGED_PASS');
 }
}
