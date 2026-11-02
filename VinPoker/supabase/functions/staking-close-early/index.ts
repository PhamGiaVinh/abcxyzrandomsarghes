// Phase 6: Player closes their deal early (accept partial fill).
// Sets early_closed=true. Status:
//   - committing -> committed (no new commitments accepted)
//   - listing (no purchases yet) -> cancelled (early_closed=true, no funded => cron will keep it cancelled)
import { parseBody, z } from "../_shared/validate.ts";
import {
  corsHeaders,
  json,
  createAdminClient,
  authenticateUser,
} from "../_shared/staking-common.ts";

const BodySchema = z.object({ deal_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticateUser(req);
    if (auth instanceof Response) return auth;
    const uid = auth.uid;

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("close_staking_deal_early_v1", {
      p_actor: uid, p_deal: body.deal_id,
    });
    if (error) {
      if (error.code === "42501") return json({ error: "Forbidden" }, 403);
      if (error.message === "staking_close_not_found") return json({ error: "Deal not found" }, 404);
      if (["staking_close_state_conflict", "staking_close_receipt_conflict", "staking_close_retry_snapshot"].includes(error.message)) {
        return json({ error: "Deal đã thay đổi; hãy tải lại trước khi thử đóng sớm." }, 409);
      }
      return json({ error: "Không xác minh được kết quả đóng sớm; hãy tải lại deal trước khi thử lại." }, 503);
    }
    const receipt = z.object({ success: z.literal(true),
      deal_status: z.enum(["listing", "committed", "cancelled"]),
      filled_percent: z.number().int().nonnegative(),
    }).safeParse(data);
    if (!receipt.success) return json({ error: "Không xác minh được receipt đóng sớm" }, 503);
    return json(receipt.data);
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
