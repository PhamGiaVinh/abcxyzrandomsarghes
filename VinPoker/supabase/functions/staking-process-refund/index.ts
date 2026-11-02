// One atomic DB money commit; receipt-bound outbox handles post-commit delivery.
import { parseBody, z } from '../_shared/validate.ts';
import { corsHeaders, json, createAdminClient, authenticateUser, requireAdminRoles } from '../_shared/staking-common.ts';
import { drainStakingRefundEmails, parseRefundEmailStatus } from '../_shared/stakingRefundEffects.ts';

const BodySchema=z.object({deal_id:z.string().uuid(),request_id:z.string().uuid(),reason:z.string().trim().min(1).max(1000)});
const ReceiptSchema=z.object({success:z.literal(true),deal_id:z.string().uuid(),
  refunded_backers:z.number().int().nonnegative().safe(),ledger_failures:z.literal(0)});

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try {
    const auth=await authenticateUser(req);
    if(auth instanceof Response)return auth;
    const admin=createAdminClient({retry:false});
    const roles=await requireAdminRoles(admin,auth.uid);
    if(roles instanceof Response)return roles;
    const parsed=await parseBody(req,BodySchema,corsHeaders);
    if(!parsed.ok)return parsed.response;
    const body=parsed.data;
    const committed=await admin.rpc('commit_staking_refund_v1',{
      p_actor:auth.uid,p_request:body.request_id,p_deal:body.deal_id,p_reason:body.reason,
    });
    if(committed.error)return json({error:'Chưa xác minh được hoàn tiền. Giữ nguyên yêu cầu để kiểm tra lại.',
      request_id:body.request_id},committed.error.code==='42501'?403:committed.error.code==='P0001'?409:503);
    const receipt=ReceiptSchema.safeParse(committed.data);
    if(!receipt.success||receipt.data.deal_id!==body.deal_id)return json({
      error:'Receipt hoàn tiền chưa xác minh được; không tạo yêu cầu mới.',request_id:body.request_id},502);
    const effects=await drainStakingRefundEmails(admin,auth.uid,body.request_id);
    let delivery:Record<string,unknown>={state:'unavailable'};
    try {
      const read=await admin.rpc('get_staking_refund_email_status_v1',{p_actor:auth.uid,p_request:body.request_id});
      const status=parseRefundEmailStatus(read.data,body.request_id,body.deal_id);
      if(!read.error&&status)delivery={...status};
    }catch { /* Money receipt is valid; email state is explicitly unavailable. */ }
    return json({...receipt.data,request_id:body.request_id,effects,delivery});
  }catch {
    return json({error:'Kết quả hoàn tiền chưa xác minh được. Kiểm tra bằng cùng yêu cầu, không tạo giao dịch mới.'},500);
  }
});
