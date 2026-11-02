import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeReceiptHandler} from './buyinReceiptHandler.local.mjs';
import {fetchBuyinReceiptWithClient} from '../../src/components/tournament/seat/buyinReceiptCore.ts';

export async function readNativeBuyinReceipt(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const tour='829e61fe-0ac8-4ced-950d-ab76cb8dadc5';
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
 const query=q=>JSON.parse(sql(`BEGIN READ ONLY;${q};ROLLBACK;`)||'null');
 const fixture=query(`SELECT to_jsonb(t) FROM public.tournaments t WHERE t.id='${tour}'`);
 assert.ok(fixture&&/TEST/i.test(fixture.name),'only the retained linked TEST journey');
 const registration=query(`SELECT to_jsonb(r) FROM public.tournament_registrations r
  WHERE r.tournament_id='${tour}' AND r.status='confirmed' AND EXISTS(
   SELECT 1 FROM public.seat_draw_receipts s WHERE s.registration_id=r.id AND s.cancelled_at IS NULL)
  ORDER BY r.id LIMIT 1`);
 assert.ok(registration?.player_id,'retained paid participant/receipt required; never reseed');
 const original=query(`SELECT to_jsonb(s) FROM public.seat_draw_receipts s WHERE s.registration_id=${quote(registration.id)}
  AND s.cancelled_at IS NULL ORDER BY s.issued_at DESC LIMIT 1`);
 const expectedReceived=query(`SELECT sum(applied_amount) FROM public.cashier_buyin_movements
  WHERE registration_id=${quote(registration.id)} AND purpose='buyin' AND direction='in'`);
 const fingerprint=()=>query(`SELECT to_jsonb(md5(jsonb_build_object(
  'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tournament_registrations r WHERE tournament_id='${tour}'),
  'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.cashier_buyin_movements m WHERE tournament_id='${tour}'),
  'receipts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.seat_draw_receipts s WHERE tournament_id='${tour}'))::text))`);
 const before=fingerprint();let caller=registration.player_id;
 const handler=createNativeReceiptHandler(sql,()=>caller);
 const invoke=body=>handler(new Request('http://local.invalid/receipt',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST'},body:JSON.stringify(body)}));
 for(const body of [{registration_id:registration.id},{receipt_code:original.receipt_code}]){
  const response=await invoke(body);assert.equal(response.status,200);const payload=await response.json();
  const receipt=await fetchBuyinReceiptWithClient({functions:{invoke:async(name)=>{
    assert.equal(name,'get-buyin-receipt');return {data:payload,error:null};
  }}},body.registration_id?{registrationId:body.registration_id}:{receiptCode:body.receipt_code});
  assert.ok(receipt,'actual native handler packet must pass the product client boundary');
  assert.equal(receipt.registration_id,registration.id);assert.equal(receipt.qr_value,original.receipt_code);
  assert.equal(receipt.total_pay,Number(registration.total_pay));assert.equal(receipt.starting_stack,Number(fixture.starting_stack));
  assert.equal(receipt.received_amount,expectedReceived);assert.equal(receipt.payment_state,'confirmed');
 }
 caller=randomUUID();const denied=await invoke({registration_id:registration.id});assert.equal(denied.status,404);
 assert.deepEqual(await denied.json(),{error:'RECEIPT_NOT_FOUND'});assert.equal(fingerprint(),before);
 console.log('BUYIN_RECEIPT_ACTUAL_HANDLER_NATIVE_READ_BOTH_KEYS_OUTSIDER_NO_DELTA_PASS',JSON.stringify({tour,registration:registration.id}));
}
