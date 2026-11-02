// Read-only recovery; never archives, claims delivery or changes audit.
import {parseBody,z} from '../_shared/validate.ts';
import {corsHeaders,json,createAdminClient,authenticateUser,requireAdminRoles} from '../_shared/staking-common.ts';
const Body=z.object({deal_id:z.string().uuid(),expected_review:z.enum(['approved','rejected'])}).strict();
const Receipt=z.object({success:z.literal(true),deal_id:z.string().uuid(),status:z.literal('cancelled'),archived:z.literal(true)}).strict();
const Observation=z.object({success:z.literal(false),deal_id:z.string().uuid(),state:z.enum(['not_recorded','needs_attention'])}).strict();
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const auth=await authenticateUser(req);if(auth instanceof Response)return auth;
  const admin=createAdminClient({retry:false});const roles=await requireAdminRoles(admin,auth.uid);
  if(roles instanceof Response)return roles;
  if(!roles.isSuper)return json({error:'Chỉ Super Admin được tra yêu cầu lưu trữ.'},403);
  const parsed=await parseBody(req,Body,corsHeaders);if(!parsed.ok)return parsed.response;
  const read=await admin.rpc('get_staking_listing_archive_receipt_v1',{p_actor:auth.uid,p_deal:parsed.data.deal_id,p_expected_review:parsed.data.expected_review});
  if(read.error)return json({error:'Chưa tra được kết quả lưu trữ. Không gửi lại thao tác tự động.'},read.error.code==='42501'?403:503);
  const receipt=Receipt.safeParse(read.data),observation=Observation.safeParse(read.data);
  const value=receipt.success?receipt.data:observation.success?observation.data:null;
  if(!value||value.deal_id!==parsed.data.deal_id)return json({error:'Kết quả lưu trữ chưa được xác minh.'},502);
  return json(value);
 }catch{return json({error:'Không tra được kết quả lưu trữ. Yêu cầu cũ chưa được xác minh.'},500);}
});
