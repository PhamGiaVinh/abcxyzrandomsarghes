// Funding is one canonical purchase transaction; receipt outbox owns delivery.
import {parseBody,z} from '../_shared/validate.ts';
import {corsHeaders,json,createAdminClient,authenticateUser,requireAdminRoles} from '../_shared/staking-common.ts';
import {drainStakingFundingEmails,parseFundingEmailStatus} from '../_shared/stakingFundingEffects.ts';
const BodySchema=z.object({purchase_id:z.string().uuid().optional(),deal_id:z.string().uuid().optional(),
 bank_tx_id:z.string().trim().max(200).optional(),note:z.string().trim().max(1000).optional()});
const ReceiptSchema=z.object({success:z.literal(true),purchase_id:z.string().uuid(),purchase_status:z.literal('funded'),
 deal_status:z.enum(['committing','committed','funded']),total_funded_percent:z.number().int().nonnegative().max(100),total_committed_percent:z.number().int().nonnegative().max(100)});

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const auth=await authenticateUser(req);if(auth instanceof Response)return auth;
  const admin=createAdminClient({retry:false});const roles=await requireAdminRoles(admin,auth.uid);if(roles instanceof Response)return roles;
  const parsed=await parseBody(req,BodySchema,corsHeaders);if(!parsed.ok)return parsed.response;const body=parsed.data;
  // All repository callers pass purchase_id. Do not guess a mutable "only purchase" on deal-only retry.
  if(!body.purchase_id||body.deal_id)return json({error:'Cần purchase_id chính xác; không xác nhận tiền theo deal_id.',code:'PURCHASE_ID_REQUIRED'},400);
  const committed=await admin.rpc('commit_staking_funding_v1',{p_actor:auth.uid,p_purchase:body.purchase_id,
   p_bank_tx:body.bank_tx_id?.trim()||null,p_note:body.note?.trim()||null});
  if(committed.error)return json({error:'Chưa xác minh được FUNDED. Kiểm tra lại cùng purchase và nội dung, không ghi giao dịch mới.',purchase_id:body.purchase_id},
   committed.error.code==='42501'?403:committed.error.code==='P0001'?409:503);
  const receipt=ReceiptSchema.safeParse(committed.data);
  if(!receipt.success||receipt.data.purchase_id!==body.purchase_id)return json({error:'Receipt FUNDED chưa xác minh được; giữ nguyên yêu cầu.',purchase_id:body.purchase_id},502);
  const effects=await drainStakingFundingEmails(admin,auth.uid,body.purchase_id);
  let delivery:Record<string,unknown>={state:'unavailable'};
  try{const read=await admin.rpc('get_staking_funding_email_status_v1',{p_actor:auth.uid,p_purchase:body.purchase_id});
   const status=parseFundingEmailStatus(read.data,body.purchase_id);if(!read.error&&status)delivery={...status};
  }catch{/* Financial receipt and email delivery state remain distinct. */}
  return json({...receipt.data,effects,delivery});
 }catch{return json({error:'Kết quả FUNDED chưa xác minh được. Kiểm tra lại đúng purchase và nội dung cũ, không ghi giao dịch mới.'},500);}
});
