// Legacy single-backer funding; purchase-based deals use admin-confirm-funded.
import { parseBody, z } from "../_shared/validate.ts";
import {
  corsHeaders,
  json,
  createAdminClient,
  authenticateUser,
} from "../_shared/staking-common.ts";

const BodySchema = z.object({
  deal_id: z.string().uuid(),
  bank_tx_id: z.string().trim().min(1).max(200),
  amount_vnd: z.number().int().min(1).max(1e10),
  proof_image_url: z.string().url().max(2048).nullish(),
  note: z.string().trim().max(1000).nullish(),
});
const ReceiptSchema = z.object({success:z.literal(true),deal_id:z.string().uuid(),status:z.literal('locked')}).strict();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);

  try {
    const auth = await authenticateUser(req);
    if (auth instanceof Response) return auth;
    const uid = auth.uid;

    const admin = createAdminClient({retry:false});
    const { data: roleRow, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "super_admin")
      .maybeSingle();
    if (roleError) return json({error:'Permission check unavailable'},503);
    if (!roleRow) return json({ error: "Forbidden: super_admin only" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const {data,error}=await admin.rpc('commit_staking_legacy_funding_v1',{
      p_actor:uid,p_deal:body.deal_id,p_bank_tx:body.bank_tx_id,p_amount:body.amount_vnd,
      p_proof:body.proof_image_url??null,p_note:body.note??null,
    });
    if(error){
      const code=typeof error.message==='string'&&error.message.startsWith('staking_legacy_funding_')?error.message:'staking_legacy_funding_unavailable';
      const status=error.code==='42501'?403:code==='staking_legacy_funding_deal_not_found'?404:
        ['staking_legacy_funding_invalid_payload','staking_legacy_funding_amount_mismatch','staking_legacy_funding_state_conflict'].includes(code)?400:
          code==='staking_legacy_funding_unavailable'?500:409;
      return json({error:'Legacy funding not confirmed',code},status);
    }
    const receipt=ReceiptSchema.safeParse(data);
    if(!receipt.success||receipt.data.deal_id!==body.deal_id)return json({error:'Funding receipt unverified'},502);
    return json(receipt.data);
  } catch {
    return json({error:'Funding outcome unavailable; verify the same deal and bank transaction before retrying'},500);
  }
});


