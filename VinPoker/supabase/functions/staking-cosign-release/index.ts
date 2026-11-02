// Atomic request/deal/audit transition. Cashier one-step/admin-distinct policy is in DB.
import { parseBody, z } from '../_shared/validate.ts';
import { corsHeaders, json, createAdminClient, authenticateUser, requireAdminRoles } from '../_shared/staking-common.ts';

const Body = z.object({ release_request_id: z.string().uuid(), note: z.string().trim().max(1000).nullish() }).strict();
const Receipt = z.object({ success: z.literal(true), release_request_id: z.string().uuid(), deal_id: z.string().uuid(), status: z.literal('cosigned'), existing: z.boolean() });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const auth = await authenticateUser(req);if (auth instanceof Response) return auth;
    const admin = createAdminClient({ retry: false });
    const roles = await requireAdminRoles(admin, auth.uid);if (roles instanceof Response) return roles;
    const parsed = await parseBody(req, Body, corsHeaders);if (!parsed.ok) return parsed.response;
    const result = await admin.rpc('cosign_staking_release_v1', { p_actor: auth.uid, p_request: parsed.data.release_request_id, p_note: parsed.data.note || null });
    if (result.error) {
      const status = result.error.code === '42501' ? 403 : ['P0001', '40001'].includes(result.error.code) ? 409 : 503;
      return json({ error: 'Đồng ký chưa xác minh được. Kiểm tra trạng thái và giữ nguyên yêu cầu trước khi tiếp tục.' }, status);
    }
    const receipt = Receipt.safeParse(result.data);
    if (!receipt.success || receipt.data.release_request_id !== parsed.data.release_request_id) return json({ error: 'Receipt đồng ký chưa xác minh được.' }, 502);
    return json(receipt.data);
  } catch {
    return json({ error: 'Đồng ký chưa xác minh được. Không tự tạo yêu cầu mới.' }, 503);
  }
});
