// Request, deal transition, and audit commit together. No direct table-write fallback.
import { parseBody, z } from '../_shared/validate.ts';
import { corsHeaders, json, createAdminClient, authenticateUser, requireAdminRoles } from '../_shared/staking-common.ts';

const Body = z.object({
  deal_id: z.string().uuid(), backer_amount: z.number().int().min(0).max(1e10),
  player_amount: z.number().int().min(0).max(1e10), note: z.string().trim().max(1000).nullish(),
}).strict();
const Receipt = z.object({
  success: z.literal(true), release_request_id: z.string().uuid(), deal_id: z.string().uuid(),
  status: z.enum(['release_requested', 'cosigned']), existing: z.boolean(),
});
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const auth = await authenticateUser(req);if (auth instanceof Response) return auth;
    const admin = createAdminClient({ retry: false });
    const roles = await requireAdminRoles(admin, auth.uid);if (roles instanceof Response) return roles;
    const parsed = await parseBody(req, Body, corsHeaders);if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const result = await admin.rpc('request_staking_release_v1', {
      p_actor: auth.uid, p_deal: body.deal_id, p_backer: body.backer_amount,
      p_player: body.player_amount, p_note: body.note || null,
    });
    if (result.error) {
      const status = result.error.code === '42501' ? 403 : ['P0001', '40001'].includes(result.error.code) ? 409 : 503;
      return json({ error: 'Chưa xác minh được yêu cầu thanh toán. Không tạo yêu cầu khác trước khi kiểm tra lại.' }, status);
    }
    const receipt = Receipt.safeParse(result.data);
    if (!receipt.success || receipt.data.deal_id !== body.deal_id) return json({ error: 'Receipt yêu cầu thanh toán chưa xác minh được.' }, 502);
    return json(receipt.data);
  } catch {
    return json({ error: 'Chưa xác minh được yêu cầu thanh toán. Kiểm tra lại cùng nội dung, không tạo thao tác mới.' }, 503);
  }
});
