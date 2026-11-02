// DB owns the complete financial transaction; outbox owns post-commit delivery.
import { parseBody, z } from "../_shared/validate.ts";
import { corsHeaders, json, createAdminClient, authenticateUser, requireAdminRoles } from "../_shared/staking-common.ts";
import { drainStakingReleaseEffects } from "../_shared/stakingReleaseEffects.ts";
import { deliverStakingReleaseEffect, parseReleaseDeliveryStatus } from "../_shared/stakingReleaseDelivery.ts";

const BackerPayoutSchema = z.object({
  purchase_id: z.string().uuid(), payout_method: z.enum(["bank_transfer", "cash"]),
  proof_url: z.string().url().max(2048).nullish(), paid: z.literal(true),
});
const BodySchema = z.object({
  release_request_id: z.string().uuid(), player_paid: z.literal(true),
  preview_hash: z.string().regex(/^[a-f0-9]{32}$/),
  backer_payouts: z.array(BackerPayoutSchema).min(1).max(100).refine(
    rows => new Set(rows.map(row => row.purchase_id)).size === rows.length,
    { message: "Mỗi purchase chỉ được xác nhận trả tiền một lần" },
  ),
  note: z.string().trim().max(1000).nullish(),
});
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ReceiptSchema = z.object({
  success: z.literal(true), status: z.literal("completed"),
  release_request_id: z.string().uuid(), deal_id: z.string().uuid(),
  amounts: z.object({ backer: money, player: money, fee: money }),
});

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = await authenticateUser(req);
    if (auth instanceof Response) return auth;
    // Outbox claims and provider sends must not be replayed by the transport.
    const admin = createAdminClient({ retry: false });
    const roles = await requireAdminRoles(admin, auth.uid);
    if (roles instanceof Response) return roles;
    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    // DB rechecks actor/club/snapshots under locks; never fall back to multi-write.
    const committed = await admin.rpc("commit_staking_release_v2", { p_actor: auth.uid, p_payload: body });
    if (committed.error) {
      const code = committed.error.code;
      return json({ error: "Không thể xác minh giải ngân. Giữ nguyên yêu cầu để kiểm tra lại.", release_request_id: body.release_request_id }, code === '42501' ? 403 : code === 'P0001' ? 409 : 500);
    }
    const receipt = ReceiptSchema.safeParse(committed.data);
    if (!receipt.success || receipt.data.release_request_id !== body.release_request_id) {
      return json({ error: "Kết quả giải ngân chưa xác minh được; không tạo yêu cầu mới.", release_request_id: body.release_request_id }, 502);
    }
    const effects = await drainStakingReleaseEffects(admin, body.release_request_id, job => deliverStakingReleaseEffect(admin, job));
    // Read persistent state: a previous unknown send must not disappear on replay.
    let delivery: Record<string, unknown> = { state: 'unavailable' };
    try {
      const status = await admin.rpc('get_staking_release_effect_status_for_actor_v1', { p_actor: auth.uid, p_request: body.release_request_id });
      const parsedStatus = parseReleaseDeliveryStatus(status.data, body.release_request_id, receipt.data.deal_id);
      if (!status.error && parsedStatus) {
        delivery = { ...parsedStatus };
      }
    } catch { /* Financial receipt remains valid; delivery is explicitly unavailable. */ }
    return json({ ...receipt.data, effects, delivery });
  } catch {
    return json({ error: "Kết quả chưa xác minh được. Kiểm tra lại bằng cùng yêu cầu, không ghi giao dịch mới." }, 500);
  }
});
