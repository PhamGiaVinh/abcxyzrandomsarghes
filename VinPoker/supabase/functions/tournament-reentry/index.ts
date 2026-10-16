// Player-authenticated transport; the service-only RPC owns source-entry,
// window, immutable full price and pending-registration idempotency atomically.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BodySchema = z.object({ tournament_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Missing auth" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } });
    const { data: userData, error: authError } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (authError) {
      const unavailable = authError.status === 0 || (authError.status ?? 0) >= 500;
      return j({ error: unavailable ? "Authentication unavailable" : "Invalid token" }, unavailable ? 503 : 401);
    }
    if (!userData?.user?.id) return j({ error: "Invalid token" }, 401);
    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: tour, error: tourError } = await admin.from("tournaments")
      .select("id,name,club_id").eq("id", parsed.data.tournament_id).maybeSingle();
    if (tourError) return j({ error: "Tournament unavailable" }, 503);
    if (!tour) return j({ error: "Tournament not found" }, 404);

    // Preserve configured club-bank preference. Read errors are not evidence
    // the club lacks an account and must not silently select a different bank.
    const columns = "id,bank_name,account_number,account_holder,qr_code_url";
    let bank: { id: string; bank_name: string; account_number: string; account_holder: string; qr_code_url: string | null } | null = null;
    if (tour.club_id) {
      const result = await admin.from("platform_bank_accounts").select(columns)
        .eq("is_active", true).eq("club_id", tour.club_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) return j({ error: "Bank configuration unavailable" }, 503);
      bank = result.data;
    }
    if (!bank) {
      const result = await admin.from("platform_bank_accounts").select(columns)
        .eq("is_active", true).is("club_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) return j({ error: "Bank configuration unavailable" }, 503);
      bank = result.data;
    }
    if (!bank) return j({ error: "CLB chưa cấu hình tài khoản nhận tiền." }, 400);
    const bin = await admin.from("platform_bank_accounts").select("bank_bin").eq("id", bank.id).maybeSingle();

    // No insert or client/Edge price arithmetic. Existing pending registrations
    // retain their committed snapshot even if tournament pricing changes later.
    const { data: registration, error: registrationError } = await admin.rpc("cashier_create_app_reentry_v1", {
      p_tournament_id: tour.id, p_player_id: userData.user.id,
    });
    if (registrationError) return j({ error: "Re-entry unavailable" }, 503);
    if (!registration?.ok) return j({ error: registration?.error ?? "Re-entry unavailable" }, 400);
    const snapshot = registration.price_snapshot as {
      buy_in?: number; rake?: number; service_fee?: number; platform_fee?: number;
    } | null;
    if (!snapshot || ![registration.total_pay, snapshot.buy_in, snapshot.rake, snapshot.service_fee, snapshot.platform_fee]
      .every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
      // Unknown outcome: caller must resume the same pending registration, not
      // issue another payment or fall back to an independently computed price.
      return j({ error: "Re-entry price unavailable" }, 503);
    }
    if (!registration.already_registered) {
      // Existing notification behavior; not part of the payment commit and
      // never retried by this transport after a registration response is lost.
      await admin.from("notifications").insert({
        user_id: userData.user.id, type: "registration_confirmed", title: "Yêu cầu mua lại giải",
        body: `Bạn đã tạo yêu cầu mua lại giải "${tour.name}". Vui lòng chuyển khoản để vào lại bàn.`,
        data: { tournament_id: tour.id, club_id: tour.club_id, reentry: true },
      }).then(() => undefined, () => undefined);
    }
    return j({
      success: true, reentry: true, already_registered: registration.already_registered,
      registration_id: registration.registration_id, status: registration.status,
      reference_code: registration.reference_code, total_pay: registration.total_pay,
      breakdown: { buy_in: snapshot.buy_in, club_fee: snapshot.rake, service_fee: snapshot.service_fee, platform_fee: snapshot.platform_fee },
      bank_name: bank.bank_name, account_number: bank.account_number, account_holder: bank.account_holder,
      qr_code_url: bank.qr_code_url, bank_bin: bin.error ? null : bin.data?.bank_bin ?? null,
      transfer_proof_url: registration.transfer_proof_image_url,
      transfer_proof_submitted: registration.transfer_proof_submitted,
      committed_at: registration.committed_at, free_rake_applied: false, savings: 0,
    });
  } catch {
    return j({ error: "Re-entry unavailable" }, 500);
  }
});
function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
