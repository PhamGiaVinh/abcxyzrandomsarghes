// Authorized exact-request continuation. Never writes financial ledger or retries unknown jobs.
import { parseBody, z } from '../_shared/validate.ts';
import { authenticateUser, createAdminClient, requireAdminRoles, corsHeaders, json } from '../_shared/staking-common.ts';
import { drainStakingReleaseEffects } from '../_shared/stakingReleaseEffects.ts';
import { deliverStakingReleaseEffect, parseReleaseDeliveryStatus } from '../_shared/stakingReleaseDelivery.ts';

const Body = z.object({ release_request_id: z.string().uuid() }).strict();
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const auth = await authenticateUser(req);if (auth instanceof Response) return auth;
    const admin = createAdminClient({ retry: false });
    const roles = await requireAdminRoles(admin, auth.uid);if (roles instanceof Response) return roles;
    const parsed = await parseBody(req, Body, corsHeaders);if (!parsed.ok) return parsed.response;
    const request = parsed.data.release_request_id;
    // This DB call rechecks actor/club and requires a committed financial receipt.
    const before = await admin.rpc('get_staking_release_effect_status_for_actor_v1', { p_actor: auth.uid, p_request: request });
    if (before.error) return json({ error: 'Không xác minh được quyền hoặc trạng thái hậu xử lý.' }, before.error.code === '42501' ? 403 : 503);
    const initial = parseReleaseDeliveryStatus(before.data, request);
    if (!initial || initial.evidence_missing) return json({ error: 'Chưa có bằng chứng giải ngân/hàng đợi hợp lệ; không gửi lại.' }, 409);
    const effects = await drainStakingReleaseEffects(admin, request, job => deliverStakingReleaseEffect(admin, job));
    const after = await admin.rpc('get_staking_release_effect_status_for_actor_v1', { p_actor: auth.uid, p_request: request });
    const delivery = !after.error ? parseReleaseDeliveryStatus(after.data, request, initial.deal_id) : null;
    if (!delivery) return json({ error: 'Chưa xác minh được kết quả hậu xử lý. Không gửi lại job không rõ kết quả.' }, 502);
    return json({ ok: true, release_request_id: request, effects, delivery });
  } catch {
    return json({ error: 'Hậu xử lý chưa xác minh được. Không tự động gửi lại.' }, 500);
  }
});
