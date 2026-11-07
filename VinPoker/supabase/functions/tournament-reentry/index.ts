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
  const started = performance.now();
  type Phase = 'auth' | 'tour' | 'configuration' | 'registration' | 'notification';
  const timings = new Map<Phase, { ms: number; calls: number }>();
  async function timed<T>(phase: Phase, task: () => PromiseLike<T>): Promise<T> {
    const at = performance.now();
    try { return await task(); }
    finally {
      const previous = timings.get(phase) ?? { ms: 0, calls: 0 };
      timings.set(phase, { ms: previous.ms + performance.now() - at, calls: previous.calls + 1 });
    }
  }
  function j(body: unknown, status = 200) {
    const timing = [...timings].map(([phase, value]) => `reentry_${phase};dur=${value.ms.toFixed(3)};desc="${value.calls}"`);
    timing.push(`reentry_total;dur=${(performance.now() - started).toFixed(3)}`);
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Server-Timing': timing.join(', ') } });
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Missing auth" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } });
    const { data: userData, error: authError } = await timed('auth', () => userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, "")));
    if (authError) {
      const unavailable = authError.status === 0 || (authError.status ?? 0) >= 500;
      return j({ error: unavailable ? "Authentication unavailable" : "Invalid token" }, unavailable ? 503 : 401);
    }
    if (!userData?.user?.id) return j({ error: "Invalid token" }, 401);
    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: tour, error: tourError } = await timed('tour', () => admin.from("tournaments")
      .select("id,name,club_id").eq("id", parsed.data.tournament_id).maybeSingle());
    if (tourError) return j({ error: "Tournament unavailable" }, 503);
    if (!tour) return j({ error: "Tournament not found" }, 404);

    if (!tour.club_id) return j({ error: "Tournament has no club" }, 400);
    // Match registration: cashier clubs advertise only the account actually
    // configured for SePay, or accept payment at the counter without a bank.
    const setting = await timed('configuration', () => admin.from("cashier_tour_settings").select("enabled")
      .eq("club_id", tour.club_id).maybeSingle());
    if (setting.error) return j({ error: "Payment configuration unavailable" }, 503);
    const columns = "id,bank_name,account_number,account_holder,qr_code_url";
    let bank: { id: string; bank_name: string; account_number: string; account_holder: string; qr_code_url: string | null } | null = null;
    if (setting.data?.enabled) {
      const config = await timed('configuration', () => admin.from("club_payment_config").select("master_account_number")
        .eq("club_id", tour.club_id).eq("is_active", true)
        .not("api_token_vault_key", "is", null).maybeSingle());
      if (config.error) return j({ error: "Payment configuration unavailable" }, 503);
      if (config.data) {
        const masterAccountNumber = config.data.master_account_number;
        if (!masterAccountNumber) return j({ error: "SePay master account missing" }, 503);
        const accounts = await timed('configuration', () => admin.from("platform_bank_accounts").select(`${columns},club_id`)
          .eq("is_active", true).eq("account_number", masterAccountNumber));
        if (accounts.error) return j({ error: "Club bank account unavailable" }, 503);
        if (accounts.data?.length !== 1 || accounts.data[0].club_id !== tour.club_id) {
          return j({ error: "SePay master account is not exclusive to this club" }, 503);
        }
        bank = accounts.data[0];
      }
    } else {
      const result = await timed('configuration', () => admin.from("platform_bank_accounts").select(columns)
        .eq("is_active", true).eq("club_id", tour.club_id).order("created_at", { ascending: false }).limit(1).maybeSingle());
      if (result.error) return j({ error: "Bank configuration unavailable" }, 503);
      bank = result.data;
      if (!bank) {
        const fallback = await timed('configuration', () => admin.from("platform_bank_accounts").select(columns)
          .eq("is_active", true).is("club_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle());
        if (fallback.error) return j({ error: "Bank configuration unavailable" }, 503);
        bank = fallback.data;
      }
      if (!bank) return j({ error: "CLB chưa cấu hình tài khoản nhận tiền." }, 400);
    }
    const bin = bank ? await timed('configuration', () => admin.from("platform_bank_accounts").select("bank_bin").eq("id", bank.id).maybeSingle()) : null;

    // No insert or client/Edge price arithmetic. Existing pending registrations
    // retain their committed snapshot even if tournament pricing changes later.
    const { data: registration, error: registrationError } = await timed('registration', () => admin.rpc("cashier_create_app_reentry_v1", {
      p_tournament_id: tour.id, p_player_id: userData.user.id,
    }));
    if (registrationError?.code === "23514" && registrationError.message === "multi_day_rules_required_before_registration") {
      return j({ error: "Main Event chưa khóa rules. Vui lòng liên hệ Floor trước khi đăng ký.", code: "MAIN_EVENT_RULES_NOT_READY" }, 409);
    }
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
      await timed('notification', () => admin.from("notifications").insert({
        user_id: userData.user.id, type: "registration_confirmed", title: "Yêu cầu mua lại giải",
        body: `Bạn đã tạo yêu cầu mua lại giải "${tour.name}". ${bank ? "Vui lòng chuyển khoản để vào lại bàn." : "Vui lòng thanh toán tại quầy để vào lại bàn."}`,
        data: { tournament_id: tour.id, club_id: tour.club_id, reentry: true },
      }).then(() => undefined, () => undefined));
    }
    return j({
      success: true, reentry: true, already_registered: registration.already_registered,
      registration_id: registration.registration_id, status: registration.status,
      reference_code: registration.reference_code, total_pay: registration.total_pay,
      breakdown: { buy_in: snapshot.buy_in, club_fee: snapshot.rake, service_fee: snapshot.service_fee, platform_fee: snapshot.platform_fee },
      bank_name: bank?.bank_name ?? null, account_number: bank?.account_number ?? null, account_holder: bank?.account_holder ?? null,
      qr_code_url: bank?.qr_code_url ?? null, bank_bin: bin?.error ? null : bin?.data?.bank_bin ?? null,
      transfer_proof_url: registration.transfer_proof_image_url,
      transfer_proof_submitted: registration.transfer_proof_submitted,
      committed_at: registration.committed_at, free_rake_applied: false, savings: 0,
    });
  } catch {
    return j({ error: "Re-entry unavailable" }, 500);
  }
});
