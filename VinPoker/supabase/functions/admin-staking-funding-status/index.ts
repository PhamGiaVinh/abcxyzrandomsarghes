// Read historical financial receipt/current email status; no money or delivery mutation.
import {parseBody,z} from '../_shared/validate.ts';
import {corsHeaders,json,createAdminClient,authenticateUser,requireAdminRoles} from '../_shared/staking-common.ts';
import {parseFundingEmailStatus} from '../_shared/stakingFundingEffects.ts';
const BodySchema=z.object({purchase_id:z.string().uuid()}).strict();
const ReceiptSchema=z.object({success:z.literal(true),purchase_id:z.string().uuid(),purchase_status:z.literal('funded'),
 deal_status:z.enum(['committing','committed','funded']),total_funded_percent:z.number().int().min(0).max(100),total_committed_percent:z.number().int().min(0).max(100)});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const auth=await authenticateUser(req);if(auth instanceof Response)return auth;
  const admin=createAdminClient({retry:false});const role=await requireAdminRoles(admin,auth.uid);if(role instanceof Response)return role;
  const parsed=await parseBody(req,BodySchema,corsHeaders);if(!parsed.ok)return parsed.response;
  const read=await admin.rpc('get_staking_funding_receipt_v1',{p_actor:auth.uid,p_purchase:parsed.data.purchase_id});
  if(read.error)return json({error:'Chưa xác minh được receipt FUNDED và trạng thái email.'},read.error.code==='42501'?403:503);
  const pending=z.object({success:z.literal(false),purchase_id:z.string().uuid(),state:z.enum(['not_recorded','needs_attention'])}).strict().safeParse(read.data);
  if(pending.success&&pending.data.purchase_id===parsed.data.purchase_id)return json(pending.data);
  const receipt=ReceiptSchema.safeParse(read.data),delivery=parseFundingEmailStatus(read.data?.delivery,parsed.data.purchase_id);
  if(!receipt.success||receipt.data.purchase_id!==parsed.data.purchase_id||!delivery
   ||read.data?.error!=null||read.data?.ok===false)return json({error:'Receipt hoặc trạng thái email chưa được xác minh.'},502);
  return json({...receipt.data,delivery});
 }catch{return json({error:'Không đọc được trạng thái FUNDED. Chưa gửi lại xác nhận tiền hoặc email.'},500);}
});
