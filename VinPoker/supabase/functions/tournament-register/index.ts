// Player self-register a tournament: creates a tournament_registration row and returns CLB bank info
// for the player to transfer the buy-in (+ optional platform fixed fee).
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
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Missing auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
    );
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: cErr } = await userClient.auth.getUser(token);
    if (cErr || !userData?.user?.id) return j({ error: "Invalid token" }, 401);
    const uid = userData.user.id;

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Tournament + club
    const { data: tour, error: tErr } = await admin
      .from("tournaments")
      .select("id, name, buy_in, start_time, status, club_id, rake_amount, free_rake_enabled, free_rake_slots, free_rake_used")
      .eq("id", body.tournament_id)
      .maybeSingle();
    if (tErr || !tour) return j({ error: "Tournament not found" }, 404);
    if (!tour.club_id) return j({ error: "Tournament has no club" }, 400);
    const { data: tourSetting, error: tourSettingError } = await admin.from("cashier_tour_settings")
      .select("enabled").eq("club_id", tour.club_id).maybeSingle();
    if (tourSettingError) return j({ error: "Payment configuration unavailable" }, 500);
    // A V2 transfer QR must point at the exact account the SePay worker pulls.
    // Without an active SePay config, registration is still valid for counter cash.
    // Disabled clubs retain the existing account selection and platform fallback.
    let bank: any = null;
    if (tourSetting?.enabled) {
      const { data: paymentConfig, error: configError } = await admin.from("club_payment_config")
        .select("master_account_number").eq("club_id", tour.club_id)
        .eq("is_active", true).not("api_token_vault_key", "is", null).maybeSingle();
      if (configError) return j({ error: "Payment configuration unavailable" }, 500);
      if (paymentConfig) {
        if (!paymentConfig.master_account_number) return j({ error: "SePay master account missing" }, 500);
        const { data: accounts, error: accountError } = await admin.from("platform_bank_accounts")
          .select("id, club_id, bank_name, account_number, account_holder, qr_code_url")
          .eq("is_active", true).eq("account_number", paymentConfig.master_account_number);
        if (accountError) return j({ error: "Club bank account unavailable" }, 500);
        if (accounts?.length !== 1 || accounts[0].club_id !== tour.club_id) {
          return j({ error: "SePay master account is not exclusive to this club" }, 500);
        }
        bank = accounts[0];
      }
    } else {
      const { data: clubBank } = await admin.from("platform_bank_accounts")
        .select("id, bank_name, account_number, account_holder, qr_code_url")
        .eq("is_active", true).eq("club_id", tour.club_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      bank = clubBank;
      if (!bank) {
        const { data: fallbackBank } = await admin.from("platform_bank_accounts")
          .select("id, bank_name, account_number, account_holder, qr_code_url")
          .eq("is_active", true).is("club_id", null)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        bank = fallbackBank;
      }
    }
    if (!bank && !tourSetting?.enabled) return j({ error: "CLB chưa cấu hình tài khoản nhận tiền." }, 400);

    // bank_bin (VietQR acquirer BIN) — GUARDED separate select so this fn is safe to deploy whether or
    // not the Stage-2 `bank_bin` column has been applied yet (absent → null → the app falls back to the
    // free-text bank-name map). Mirrors the service_fee_amount guard pattern below.
    let bankBin: string | null = null;
    if (bank) {
      const { data: bb, error: bbErr } = await admin
        .from("platform_bank_accounts")
        .select("bank_bin")
        .eq("id", bank.id)
        .maybeSingle();
      if (!bbErr && bb) bankBin = (bb as { bank_bin?: string | null }).bank_bin ?? null;
    }

    // A club that has not opted in must keep the existing registration path.
    // The new RPC and its server-owned price snapshot are reserved for clubs
    // explicitly enabled in cashier_tour_settings.
    if (!tourSetting?.enabled) {
      if (tour.start_time && new Date(tour.start_time as string).getTime() < Date.now() - 60 * 60 * 1000) {
        return j({ error: "Giải đã bắt đầu hoặc kết thúc." }, 400);
      }
      const rakeAmount = Number(tour.rake_amount ?? 0);
      const { data: existing, error: existingErr } = await admin
        .from("tournament_registrations")
        .select("id,status,reference_code,total_pay,buy_in,platform_fixed_fee,transfer_proof_image_url,transfer_proof_submitted,committed_at,used_free_rake")
        .eq("tournament_id", tour.id).eq("player_id", uid)
        .in("status", ["pending", "confirmed"]).maybeSingle();
      if (existingErr) return j({ error: "Registration unavailable" }, 500);
      if (existing) return j({
        success: true, already_registered: true, registration_id: existing.id,
        status: existing.status, reference_code: existing.reference_code,
        total_pay: Number(existing.total_pay),
        breakdown: {
          buy_in: Number(existing.buy_in),
          club_fee: Math.max(0, Number(existing.total_pay) - Number(existing.buy_in)),
          service_fee: 0, platform_fee: Number(existing.platform_fixed_fee),
        },
        bank_name: bank.bank_name, account_number: bank.account_number,
        account_holder: bank.account_holder, qr_code_url: bank.qr_code_url, bank_bin: bankBin,
        transfer_proof_url: existing.transfer_proof_image_url,
        transfer_proof_submitted: existing.transfer_proof_submitted,
        committed_at: existing.committed_at,
        free_rake_applied: existing.used_free_rake ?? false,
        savings: existing.used_free_rake ? rakeAmount : 0,
      });
      // A retry/read failure must not spend a second free-rake allocation.
      // Requests with no existing registration observed reach the quota writer;
      // this does not make the legacy create sequence atomic across requests.
      let freeRakeApplied = false;
      if (tour.free_rake_enabled) {
        const { data: consume, error: consumeErr } = await admin.rpc("try_consume_free_rake_slot", {
          _tournament_id: tour.id,
        });
        if (consumeErr || typeof consume !== "boolean") {
          return j({ error: "Không xác minh được suất miễn rake. Vui lòng thử lại sau." }, 503);
        }
        if (!consumeErr && consume === true) freeRakeApplied = true;
      }
      let serviceFee = 0;
      const { data: sf, error: sfErr } = await admin.from("tournaments")
        .select("service_fee_amount").eq("id", tour.id).maybeSingle();
      if (!sfErr && sf) serviceFee = Number((sf as { service_fee_amount?: number }).service_fee_amount ?? 0);
      const totalPay = (freeRakeApplied ? Number(tour.buy_in) : Number(tour.buy_in) + rakeAmount) + serviceFee;
      const refCode = "VINReg" + String(tour.id).replace(/-/g, "").slice(0, 4).toUpperCase() +
        Math.random().toString(36).slice(2, 6).toUpperCase();
      const { data: ins, error: insErr } = await admin.from("tournament_registrations")
        .insert({ tournament_id: tour.id, player_id: uid, club_id: tour.club_id,
          buy_in: tour.buy_in, platform_fixed_fee: 0, total_pay: totalPay,
          reference_code: refCode, status: "pending", used_free_rake: freeRakeApplied })
        .select("id").single();
      if (insErr?.code === "23514" && insErr.message === "multi_day_rules_required_before_registration") {
        return j({ error: "Main Event chưa khóa rules. Vui lòng liên hệ Floor trước khi đăng ký.", code: "MAIN_EVENT_RULES_NOT_READY" }, 409);
      }
      if (insErr) return j({ error: insErr.message }, 500);
      try {
        await admin.from("notifications").insert({ user_id: uid, type: "registration_confirmed",
          title: "Đăng ký giải thành công", body: `Bạn đã đăng ký giải "${tour.name}" thành công.`,
          data: { tournament_id: tour.id, club_id: tour.club_id } });
      } catch (_) { /* A notification failure must not create a second registration. */ }
      return j({
        success: true, registration_id: ins.id, status: "pending", reference_code: refCode,
        total_pay: totalPay,
        breakdown: { buy_in: Number(tour.buy_in), club_fee: freeRakeApplied ? 0 : rakeAmount,
          service_fee: serviceFee, platform_fee: 0 },
        bank_name: bank.bank_name, account_number: bank.account_number,
        account_holder: bank.account_holder, qr_code_url: bank.qr_code_url, bank_bin: bankBin,
        committed_at: new Date().toISOString(), free_rake_applied: freeRakeApplied,
        savings: freeRakeApplied ? rakeAmount : 0,
      });
    }

    // One server transaction owns idempotency, the exact price and free-rake slot.
    const { data: registration, error: regError } = await admin.rpc("cashier_create_app_registration_v1", {
      p_tournament_id: tour.id,
      p_player_id: uid,
    });
    if (regError?.code === "23514" && regError.message === "multi_day_rules_required_before_registration") {
      return j({ error: "Main Event chưa khóa rules. Vui lòng liên hệ Floor trước khi đăng ký.", code: "MAIN_EVENT_RULES_NOT_READY" }, 409);
    }
    if (regError) return j({ error: "Registration unavailable" }, 500);
    if (!registration?.ok) return j({ error: registration?.error ?? "Registration unavailable" }, 400);
    const snapshot = registration.price_snapshot as {
      buy_in?: number; rake?: number; waived_rake?: number; service_fee?: number; platform_fee?: number;
    } | null;

    if (!registration.already_registered) {
      try {
        await admin.from("notifications").insert({
          user_id: uid,
          type: "registration_confirmed",
          title: "Đăng ký giải thành công",
          body: `Bạn đã đăng ký giải "${tour.name}" thành công.`,
          data: { tournament_id: tour.id, club_id: tour.club_id },
        });
      } catch (_) {
        // Non-critical; never create a second registration to retry a notice.
      }
    }

    return j({
      success: true,
      already_registered: registration.already_registered,
      registration_id: registration.registration_id,
      status: registration.status,
      reference_code: registration.reference_code,
      total_pay: Number(registration.total_pay),
      breakdown: {
        buy_in: Number(registration.buy_in),
        club_fee: snapshot?.rake ?? null,
        service_fee: snapshot?.service_fee ?? null,
        platform_fee: Number(registration.platform_fixed_fee),
      },
      bank_name: bank?.bank_name ?? null,
      account_number: bank?.account_number ?? null,
      account_holder: bank?.account_holder ?? null,
      qr_code_url: bank?.qr_code_url ?? null,
      bank_bin: bankBin,
      transfer_proof_url: registration.transfer_proof_image_url ?? null,
      transfer_proof_submitted: registration.transfer_proof_submitted ?? false,
      committed_at: registration.committed_at,
      free_rake_applied: registration.used_free_rake ?? false,
      savings: registration.used_free_rake ? (snapshot?.waived_rake ?? null) : 0,
      price_detail_available: snapshot !== null,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
