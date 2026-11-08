// SePay ingestion — Patch 2 (Direction 1): reconcile worker.
//
// Cron-invoked (every ~5 min). For each ACTIVE club it pulls the SePay v2 transactions API (the
// SOURCE OF TRUTH), stamps the matching bank_transactions rows api-verified (+ recovers webhook
// misses / quarantined rows), then routes the verified worklist by the club's
// Cashier gate. Enabled clubs use the movement ledger for VINREG buy-ins;
// legacy settlement remains for other references without auto-confirming
// an unhandled buy-in. Disabled clubs keep the existing settlement flow.
//
// AUTH: gated by a single shared secret. The cron passes `X-Reconcile-Secret`; we timing-safe-compare
// it to Deno.env SEPAY_RECONCILE_SECRET. Deployed --no-verify-jwt (the cron has no Supabase user JWT).
// The secret is NEVER logged. (Owner sets the SAME value in the Function env AND in Vault for the cron.)
//
// SECRETS / PII: per-club SePay API tokens are read from Vault via sepay_get_club_api_token (service-
// role) and used only in the Authorization header — never logged. The pulled transaction_content holds
// payer names (PII); it is stored in bank_transactions (raw_payload) and carried under the Patch-2
// retention/purge TODO (P2-E) — NOT redacted here.
//
// KILL-SWITCH: SEPAY_AUTO_CONFIRM (env, default false) is the authoritative auto-confirm switch. It is
// read here (not hardcoded) so flipping it never requires a code change/redeploy. NOTE: even if set to
// true today, settle still cannot auto-confirm because confirm_registration_and_assign_seat (P0-guard-v2)
// VINREG buy-ins use the server movement ledger for split payments. Other references keep
// the existing settlement path. Both paths remain gated by the existing auto-confirm settings.
//
// RESILIENCE: one club failing (bad token, SePay down, 4xx) records last_pull_error and is SKIPPED —
// the loop continues; the webhook keeps capturing realtime. retryFetch handles 429/5xx/network.
//
// INERT until activated: until the owner configures a club via sepay_set_club_payment_config (token →
// Vault, is_active=true), sepay_get_active_payment_clubs returns nothing → this worker no-ops.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retryFetch } from "../_shared/retry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECONCILE_SECRET = Deno.env.get("SEPAY_RECONCILE_SECRET") ?? "";
const AUTO_CONFIRM = (Deno.env.get("SEPAY_AUTO_CONFIRM") ?? "false").trim().toLowerCase() === "true";
// Production: https://userapi.sepay.vn · Sandbox: https://userapi-sandbox.sepay.vn (set SEPAY_API_BASE).
const SEPAY_API_BASE = (Deno.env.get("SEPAY_API_BASE") ?? "https://userapi.sepay.vn").replace(/\/+$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_PAGES = 5;                          // cap pages/club/tick (anti-runaway)
const PAGE_LIMIT = 100;
const SETTLE_BATCH = 500;                     // cap settle calls/club/tick

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
/** Constant-time equality via SHA-256 digests (no early-exit, no length leak). */
async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

function nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
/** Number/decimal string → safely representable rounded VND, otherwise unknown. */
function parseAmount(v: unknown): number | null {
  if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  const rounded = Math.round(n);
  return Number.isSafeInteger(rounded) ? rounded : null;
}
/** SePay transaction_date "YYYY-MM-DD HH:MM:SS" is VN time, no offset; VN has no DST → +07:00. */
function parseOccurredAt(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const local = v.trim().replace(" ", "T");
  const d = new Date(local + "+07:00");
  if (Number.isNaN(d.getTime())) return null;
  // Date silently rolls impossible days and 24:00 into a different calendar date.
  const roundTrip = new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return roundTrip === local.slice(0, 19) ? d.toISOString() : null;
}
/** Provider inclusive datetime in business timezone UTC+7, frozen by DB claim. */
function vnDateTime(epochMs: number): string {
  return new Date(epochMs + 7 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function legacySettlementState(value: unknown): "confirmed" | "pending" | "invalid" {
  if (!value || typeof value !== "object") return "invalid";
  const result = value as { ok?: boolean; outcome?: string; skipped?: string };
  if (result.ok !== true) return "invalid";
  if (["auto_confirmed", "manual_confirmed"].includes(result.outcome ?? "")) return "confirmed";
  if (["flagged_no_match", "flagged_amount_mismatch", "flagged_not_pending", "flagged_duplicate", "flagged_seating_failed"].includes(result.outcome ?? "")
    || ["matched", "ignored", "quarantined", "not_api_verified", "not_settleable_shape"].includes(result.skipped ?? "")) return "pending";
  return "invalid";
}

/** Map one SePay v2 transaction to the bank_transactions ingest shape (sent to the ingest RPC). */
function mapTxn(t: Record<string, unknown>) {
  const transferType = nonEmpty(t["transfer_type"]);
  const amount = transferType === "out" ? parseAmount(t["amount_out"]) : parseAmount(t["amount_in"]);
  return {
    provider_txn_id: nonEmpty(t["id"]),
    account_number: nonEmpty(t["account_number"]),
    sub_account: nonEmpty(t["va"]),
    gateway: nonEmpty(t["bank_brand_name"]),
    amount,
    transfer_type: transferType,
    content: typeof t["transaction_content"] === "string" ? (t["transaction_content"] as string) : null,
    txn_ref: nonEmpty(t["reference_number"]),
    occurred_at: parseOccurredAt(t["transaction_date"]),
    raw_payload: t,
  };
}

/** q is only a provider search hint. Exact active account identity is checked here. */
async function resolveBankAccount(masterAccount: string, token: string): Promise<string> {
  const matches = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await retryFetch(`${SEPAY_API_BASE}/v2/bank-accounts?q=${encodeURIComponent(masterAccount)}&per_page=${PAGE_LIMIT}&page=${page}`, {
      method: "GET", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`sepay_api_${res.status}`);
    const body = await res.json().catch(() => null);
    if (!body || !Array.isArray(body.data) || !body.meta?.pagination) throw new Error("sepay_account_payload_invalid");
    for (const row of body.data) {
      if (!row || typeof row !== "object") throw new Error("sepay_account_payload_invalid");
      if (nonEmpty(row.account_number) !== masterAccount || !(row.active === true || row.active === 1)) continue;
      if (typeof row.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(row.id)) {
        throw new Error("sepay_account_payload_invalid");
      }
      matches.add(row.id);
    }
    const pg = body.meta.pagination;
    if (typeof pg.has_more !== "boolean") throw new Error("sepay_account_payload_invalid");
    const hasMore = pg.has_more || (typeof pg.current_page === "number" && typeof pg.last_page === "number" && pg.current_page < pg.last_page);
    if (!hasMore) {
      if (matches.size === 0) throw new Error("sepay_account_not_found");
      if (matches.size > 1) throw new Error("sepay_account_multiple_matches");
      return [...matches][0];
    }
    if (page === MAX_PAGES) throw new Error("sepay_account_page_limit");
  }
  throw new Error("sepay_account_page_limit");
}

/** Pull up to MAX_PAGES of one account's transactions since fromDate. Throws on a non-OK HTTP status
 *  (e.g. 401 bad token) so the caller flags+skips this club. retryFetch handles 429/5xx/network. */
async function pullClubTransactions(masterAccount: string, bankAccountId: string, token: string, fromDate: string, toDate: string, startPage: number) {
  const out: Record<string, unknown>[] = [];
  let total: number | null = null;
  for (let page = startPage; page < startPage + MAX_PAGES; page++) {
    const url = `${SEPAY_API_BASE}/v2/transactions?bank_account_id=${encodeURIComponent(bankAccountId)}` +
      `&transaction_date_from=${encodeURIComponent(fromDate)}&transaction_date_to=${encodeURIComponent(toDate)}` +
      `&transaction_date_sort=asc&per_page=${PAGE_LIMIT}&page=${page}`;
    const res = await retryFetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`sepay_api_${res.status}`); // do NOT include the body (may carry account info)
    const body = await res.json().catch(() => null) as { data?: unknown; meta?: { pagination?: { total?: number; current_page?: number; last_page?: number; has_more?: boolean } } } | null;
    if (!body || !Array.isArray(body.data)) throw new Error("sepay_api_invalid_payload");
    const data = body.data as Record<string, unknown>[];
    if(data.length>PAGE_LIMIT)throw new Error('sepay_api_invalid_payload');
    if (data.some(row => !row || nonEmpty(row.account_number) !== masterAccount || row.bank_account_id !== bankAccountId)) {
      throw new Error("sepay_transaction_account_mismatch");
    }
    out.push(...data);
    const pg = body?.meta?.pagination;
    if (typeof pg?.has_more !== 'boolean' || !Number.isSafeInteger(pg.total) || pg.total!<0 || pg.total!>2147483647 || (pg.current_page !== undefined && pg.current_page !== page)
      || (pg.last_page !== undefined && (!Number.isSafeInteger(pg.last_page) || pg.last_page < page))) {
      throw new Error('sepay_api_invalid_pagination');
    }
    if(total!==null&&total!==pg.total)throw new Error('sepay_api_window_changed');
    total=pg.total!;
    const hasMore = pg?.has_more === true ||
      (typeof pg?.current_page === "number" && typeof pg?.last_page === "number" && pg.current_page < pg.last_page);
    if (data.length === 0 && hasMore) throw new Error('sepay_api_invalid_pagination');
    if (!hasMore) return { rows: out, nextPage: page + 1, complete: true, total };
  }
  return { rows: out, nextPage: startPage + MAX_PAGES, complete: false, total };
}

Deno.serve(async (req) => {
  // 1) Method gate.
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // 2) Shared-secret gate (timing-safe). Never log the secret.
  const presented = (req.headers.get("X-Reconcile-Secret") ?? "").trim();
  const authed = RECONCILE_SECRET.length > 0 && presented.length > 0 &&
    (await timingSafeEqualStr(presented, RECONCILE_SECRET));
  if (!authed) return new Response("Unauthorized", { status: 401 });

  // 3) Active clubs (service-role RPC; returns only club_id + master_account_number, no secret).
  const { data: clubs, error: clubsErr } = await Promise.resolve()
    .then(() => admin.rpc("sepay_get_active_payment_clubs"))
    .catch(() => ({ data: null, error: { message: "active_clubs_transport_unavailable" } }));
  if (clubsErr) {
    console.error("sepay-reconcile: active-clubs query failed");
    return jsonResponse(500, { ok: false, error: "clubs_query_failed" });
  }
  // Only an explicit empty array means there are no configured clubs. A null,
  // malformed or duplicated scope must not produce a healthy no-op or repeated
  // provider work. Never log the payload: it can contain account information.
  if (!Array.isArray(clubs) || clubs.some((club) => !club || typeof club !== "object" || Array.isArray(club)
    || typeof club.club_id !== "string" || !club.club_id.trim() || club.club_id !== club.club_id.trim()
    || !(club.master_account_number === null || typeof club.master_account_number === "string"))
    || new Set(clubs.map((club) => club.club_id)).size !== clubs.length) {
    console.error("sepay-reconcile: active-clubs response unverified");
    return jsonResponse(503, { ok: false, error: "clubs_query_unverified" });
  }

  const summary: Array<Record<string, unknown>> = [];
  let totalSettled = 0;

  for (const club of clubs as Array<{ club_id: string; master_account_number: string | null }>) {
    const clubId = club.club_id;
    const master = nonEmpty(club.master_account_number);
    try {
      if (!master) throw new Error("no_master_account_number");

      // Fail closed if the Cashier gate cannot be read. A V2 club must never
      // fall through to legacy auto-confirm without a movement ledger entry.
      const { data: cashierSettings, error: cashierGateErr } = await admin
        .from("cashier_tour_settings").select("enabled").eq("club_id", clubId).maybeSingle();
      if (cashierGateErr || (cashierSettings !== null && (!cashierSettings || typeof cashierSettings !== "object"
        || Array.isArray(cashierSettings) || typeof cashierSettings.enabled !== "boolean"))) {
        throw new Error("cashier_gate_read_failed");
      }
      const cashierEnabled = cashierSettings?.enabled === true;

      // Per-club SePay token (Vault, service-role). Never logged.
      const { data: token, error: tokErr } = await admin.rpc("sepay_get_club_api_token", { p_club_id: clubId });
      if (tokErr) throw new Error("token_read_failed");
      if (!token) throw new Error("no_api_token");

      // Pull (paged, retry, rate-limit-aware) → map → drop rows lacking dedupe identity.
      const bankAccountId = await resolveBankAccount(master, token as string);
      const { data: claim, error: claimError } = await admin.rpc('sepay_claim_pull_v2', {p_club_id:clubId,p_bank_account_id:bankAccountId});
      if (claimError) throw new Error('sepay_pull_claim_failed');
      if (claim?.status === 'busy') { summary.push({club_id:clubId,status:'pending',pull_status:'busy'}); continue; }
      const fromMs = Date.parse(claim?.window_from), toMs = Date.parse(claim?.window_to);
      if (claim?.status !== 'claimed' || typeof claim.lease_token !== 'string'
        || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(claim.lease_token)
        || !Number.isSafeInteger(claim.next_page) || claim.next_page<1 || claim.next_page>2147483642
        || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs>toMs) throw new Error('sepay_pull_claim_invalid');
      const pull = await pullClubTransactions(master,bankAccountId,token as string,vnDateTime(fromMs),vnDateTime(toMs),claim.next_page);
      const rows = pull.rows.map(mapTxn).filter((r) => r.provider_txn_id && r.account_number);
      if(rows.length!==pull.rows.length)throw new Error('sepay_api_invalid_payload');

      // Ingest: verify existing + insert misses + backfill quarantined NULLs, WITHOUT resetting status
      // (matched/ignored preserved) and WITHOUT re-writing already-verified rows. See the ingest RPC.
      if (rows.length > 0) {
        const { error: ingErr } = await admin.rpc("sepay_ingest_verified_transactions", { p_txns: rows });
        if (ingErr) throw new Error("ingest_failed");
      }

      // Ingest commits first. A lost checkpoint can only replay deduplicated rows;
      // only the current DB lease may advance page/window progress.
      const {data:checkpoint,error:checkpointError}=await admin.rpc('sepay_checkpoint_pull_v2',{
        p_club_id:clubId,p_lease_token:claim.lease_token,p_expected_page:claim.next_page,p_next_page:pull.nextPage,p_complete:pull.complete,
        p_provider_total:pull.total,
      });
      if(checkpoint?.restart_required===true)throw new Error('sepay_api_window_changed');
      if(checkpointError||checkpoint?.ok!==true||checkpoint.complete!==pull.complete||checkpoint.next_page!==pull.nextPage) {
        throw new Error('sepay_pull_checkpoint_unverified');
      }
      // Worklist: incoming, SePay-API-verified, still unmatched, for this club's master account.
      // Durable least-recently-attempted selection prevents a failing prefix
      // monopolizing every tick. No unsafe fallback if the DB contract is absent.
      const { data: worklist, error: wlErr } = await admin.rpc("sepay_take_settlement_batch_v1", {
        p_club_id: clubId, p_limit: SETTLE_BATCH,
      });
      if (wlErr) throw new Error("worklist_failed");
      if (!Array.isArray(worklist) || worklist.length > SETTLE_BATCH
        || worklist.some((row) => !row || typeof row.id !== "string")
        || new Set(worklist.map((row) => row.id)).size !== worklist.length) {
        throw new Error("worklist_invalid");
      }
      let settled = 0;
      let partial = 0;
      let waitingSeat = 0;
      let surplus = 0;
      let seatingReview = 0;
      let attempted = 0;
      let failed = 0;
      let succeeded = 0;
      let businessPending = 0;
      for (const bt of (worklist ?? []) as Array<{ id: string }>) {
        attempted++;
        try {
        if (cashierEnabled) {
          const { data: buyinResult, error: buyinErr } = await admin.rpc("cashier_record_verified_bank_v1", {
            p_bank_transaction_id: bt.id,
            p_auto_confirm: AUTO_CONFIRM,
          });
          if (buyinErr) { failed++; console.error("sepay-reconcile: buy-in recording failed", bt.id); continue; }
          const buyin = buyinResult as { handled?: boolean; outcome?: string;
            legacy_auto_confirm_allowed?: boolean } | null;
          if (buyin?.handled === true) {
            if (buyin.outcome === "paid_seated") { settled++; succeeded++; }
            else if (buyin.outcome === "already_recorded") succeeded++;
            else if (buyin.outcome === "paid_waiting_seat") { waitingSeat++; businessPending++; }
            else if (buyin.outcome === "partial_received") { partial++; businessPending++; }
            else if (buyin.outcome === "surplus_received") { surplus++; businessPending++; }
            else if (buyin.outcome === "paid_seating_review") { seatingReview++; businessPending++; }
            else failed++;
            continue;
          }
          if (buyin?.handled !== false) { failed++; continue; }
          // Only the server may classify an unhandled transaction as legacy.
          // Re-entry and pre-V2 VINREG keep their existing auto path; an
          // unhandled priced VINREG can never bypass the movement ledger.
          if (buyin?.legacy_auto_confirm_allowed !== true) {
            const { data: flagged, error: sErr } = await admin.rpc("settle_bank_transaction", {
              p_bank_transaction_id: bt.id, p_auto_confirm: false,
            });
            if (sErr || legacySettlementState(flagged) !== "pending") failed++;
            else businessPending++;
            continue;
          }
        }
        // Keep legacy F&B/re-entry handling for explicitly classified rows.
        const { data: legacyResult, error: sErr } = await admin.rpc("settle_bank_transaction", {
          p_bank_transaction_id: bt.id,
          p_auto_confirm: AUTO_CONFIRM,
        });
        if (sErr) { failed++; console.error("sepay-reconcile: settle failed", bt.id); continue; }
        const legacy = legacyResult as { ok?: boolean; outcome?: string; skipped?: string; already_settled?: boolean } | null;
        const legacyState = legacySettlementState(legacy);
        if (legacyState === "invalid") { failed++; continue; }
        if (legacy && legacyState === "confirmed") {
          if (!legacy.already_settled && legacy.outcome === "auto_confirmed") settled++;
          succeeded++;
        }
        else businessPending++;
        } catch {
          failed++;
          console.error("sepay-reconcile: transaction processing unavailable");
        }
      }
      totalSettled += settled;

      // Record pull state (best-effort observability; service-role write).
      // A rejected transport must not discard the already processed batch or
      // send it through the club/pull error path. Do not retry settlement here.
      let observationFailed = false;
      try {
        const { error } = await admin.from("club_payment_config")
          .update({ last_pull_status: failed || !pull.complete ? "error" : "ok", last_pull_error: failed ? `settlement_failed:${failed}` : !pull.complete ? 'pull_incomplete' : null })
          .eq("club_id", clubId);
        observationFailed = !!error;
      } catch { observationFailed = true; }
      summary.push({ club_id: clubId, pulled: rows.length, settled, partial, waiting_seat: waitingSeat,
        surplus, seating_review: seatingReview, attempted, succeeded, business_pending: businessPending, failed,
        pull_status: pull.complete ? "ok" : "pending", pull_next_page:pull.nextPage, observation_status: observationFailed ? "error" : "ok",
        status: failed || observationFailed ? "partial" : businessPending || !pull.complete ? "pending" : "ok" });
    } catch (e) {
      // DB/network exceptions may embed account identifiers, request URLs or
      // bearer tokens. Persist/return only known operation codes, never details.
      const detail = (e as Error)?.message ?? "";
      const msg = ["no_master_account_number", "cashier_gate_read_failed", "token_read_failed",
        "no_api_token", "sepay_api_invalid_payload", "sepay_api_page_limit", "sepay_account_payload_invalid",
        "sepay_account_not_found", "sepay_account_multiple_matches", "sepay_account_page_limit", "sepay_transaction_account_mismatch",
        "sepay_pull_claim_failed", "sepay_pull_claim_invalid", "sepay_api_invalid_pagination", "sepay_pull_checkpoint_unverified",
        "sepay_api_window_changed",
        "ingest_failed", "worklist_failed", "worklist_invalid"].includes(detail)
        || /^sepay_api_[1-5][0-9]{2}$/.test(detail) ? detail : "club_processing_unavailable";
      console.error("sepay-reconcile: club failed", clubId, msg);
      let observationFailed = false;
      try {
        const { error } = await admin.from("club_payment_config")
          .update({ last_pull_status: "error", last_pull_error: msg.slice(0, 500) })
          .eq("club_id", clubId);
        observationFailed = !!error;
      } catch { observationFailed = true; }
      summary.push({ club_id: clubId, status: "error", error: msg, observation_status: observationFailed ? "error" : "ok" });
      // continue with the next club
    }
  }

  // Paid registrations must keep retrying after Floor opens a table, including
  // when SePay API is unavailable or a cash-only club has no SePay config.
  const { data: retryResult, error: retryErr } = await Promise.resolve(admin.rpc("cashier_retry_paid_seating_v1", {
    p_auto_confirm: AUTO_CONFIRM, p_limit: 500,
  })).catch(() => ({ data: null, error: { message: "paid_seating_retry_transport_failed" } }));
  if (retryErr) console.error("sepay-reconcile: paid seating retry failed");
  const retry = retryResult as { attempted?: number; seated?: number } | null;

  const retryCountsValid = retryResult && typeof retryResult === "object" && (retryResult as { ok?: boolean }).ok === true
    && ["attempted", "seated", "needs_review"].every((key) => {
      const value = (retryResult as Record<string, unknown>)[key];
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    });
  const retryValid = retryCountsValid && (retryResult as { seated: number }).seated + (retryResult as { needs_review: number }).needs_review
    <= (retryResult as { attempted: number }).attempted;
  const processingOk = !retryErr && retryValid && summary.every((row) => row.status !== "error" && row.status !== "partial" && row.pull_status !== 'pending' && row.pull_status !== 'busy');
  return jsonResponse(200, { ok: !!processingOk, clubs: summary.length, settled: totalSettled,
    auto_confirm: AUTO_CONFIRM, paid_seating_retry: retryErr || !retryValid ? "error" : retry, results: summary });
});
