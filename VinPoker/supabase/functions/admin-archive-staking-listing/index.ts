// Archive an unfunded reviewed listing; preserve deal, ledger and immutable audit.
import {parseBody,z} from '../_shared/validate.ts';
import {corsHeaders,json,createAdminClient,authenticateUser,requireAdminRoles} from '../_shared/staking-common.ts';
const Body=z.object({deal_id:z.string().uuid(),expected_review:z.enum(['approved','rejected'])}).strict();
const Receipt=z.object({success:z.literal(true),deal_id:z.string().uuid(),status:z.literal('cancelled'),archived:z.literal(true)}).strict();
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const auth=await authenticateUser(req);if(auth instanceof Response)return auth;
  const admin=createAdminClient({retry:false});const roles=await requireAdminRoles(admin,auth.uid);
  if(roles instanceof Response)return roles;
  if(!roles.isSuper)return json({error:'Chỉ Super Admin được lưu trữ phiếu đã duyệt/từ chối.'},403);
  const parsed=await parseBody(req,Body,corsHeaders);if(!parsed.ok)return parsed.response;
  const read=await admin.rpc('archive_staking_listing_v1',{p_actor:auth.uid,p_deal:parsed.data.deal_id,p_expected_review:parsed.data.expected_review});
  if(read.error){
   if(read.error.code==='42501')return json({error:'Không có quyền lưu trữ phiếu.'},403);
   if(read.error.message==='staking_archive_not_found')return json({error:'Không tìm thấy phiếu để lưu trữ.'},404);
   if(['staking_archive_state_conflict','staking_archive_dependencies_present','staking_archive_receipt_conflict'].includes(read.error.message))return json({error:'Phiếu đã thay đổi hoặc có dữ liệu liên quan. Chưa lưu trữ; tải lại để đối chiếu.'},409);
   return json({error:'Chưa xác minh được kết quả lưu trữ. Không gửi lại tự động.'},503);
  }
  const receipt=Receipt.safeParse(read.data);
  if(!receipt.success||receipt.data.deal_id!==parsed.data.deal_id)return json({error:'Receipt lưu trữ chưa được xác minh. Tải lại để đối chiếu.'},502);
  return json(receipt.data);
 }catch{return json({error:'Không xác minh được kết quả lưu trữ. Tải lại đúng phiếu để đối chiếu.'},500);}
});
