// Atomic server commitment; receipt owns audit and in-app notifications.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BodySchema = z.object({deal_id:z.string().uuid(),request_id:z.string().uuid(),percent:z.number().int().min(1).max(100)});
const ReceiptSchema = z.object({success:z.literal(true),purchase_id:z.string().uuid(),reference_code:z.string().min(1),
  committed_at:z.string().datetime({offset:true}),
  amount_vnd:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  bank_name:z.string().min(1),account_number:z.string().min(1),account_holder:z.string().min(1),
  qr_code_url:z.string().nullable(),deal_status:z.enum(["committing","committed"]),filled_percent:z.number().int().min(1).max(100)});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:corsHeaders});
  try{
    const header=req.headers.get("Authorization");
    if(!header)return json({error:"Missing auth"},401);
    const userClient=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,
      {global:{headers:{Authorization:header},fetch:retryFetch}});
    const {data:userData,error:authError}=await userClient.auth.getUser(header.replace(/^Bearer\s+/i,""));
    if(authError||!userData?.user?.id)return json({error:"Invalid token"},401);
    const parsed=await parseBody(req,BodySchema,corsHeaders);
    if(!parsed.ok)return parsed.response;
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{global:{fetch:retryFetch}});
    const {data,error}=await admin.rpc("commit_staking_purchase_v2",{
      p_actor:userData.user.id,p_request:parsed.data.request_id,p_deal:parsed.data.deal_id,p_percent:parsed.data.percent,
    });
    if(error){
      if(error.code==="42501")return json({error:"Forbidden"},403);
      if(error.message==="staking_purchase_not_found")return json({error:"Deal not found"},404);
      if(error.message==="staking_purchase_bank_profile_required")return json({error:"Vui lòng bổ sung tài khoản ngân hàng trong Profile.",code:"MISSING_BANK_ACCOUNT"},400);
      if(error.message==="staking_purchase_escrow_bank_required")return json({error:"Chưa có tài khoản nhận tiền escrow.",code:"NO_ESCROW_BANK"},400);
      if(["staking_purchase_state_conflict","staking_purchase_capacity_conflict","staking_purchase_payload_conflict","staking_purchase_retry_snapshot"].includes(error.message))
        return json({error:"Deal hoặc intent đã thay đổi; hãy tải lại để đối chiếu."},409);
      if(error.message==="staking_purchase_minimum")return json({error:"Phần trăm chưa đạt mức mua tối thiểu hoặc phần còn lại."},400);
      return json({error:"Không xác minh được kết quả cam kết; giữ nguyên request và tải lại trước khi thử tiếp."},503);
    }
    const receipt=ReceiptSchema.safeParse(data);
    if(!receipt.success)return json({error:"Không xác minh được receipt cam kết"},503);
    return json({...receipt.data,request_id:parsed.data.request_id,deal_id:parsed.data.deal_id});
  }catch(e:unknown){return json({error:e instanceof Error?e.message:"internal"},500);}
});
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
