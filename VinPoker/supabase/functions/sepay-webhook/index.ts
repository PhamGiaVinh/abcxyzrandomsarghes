// SePay ingestion — Patch 1b: webhook receiver.
//
// Persists raw SePay bank-transfer events into public.bank_transactions (idempotent, INERT) and
// logs every inbound call into public.bank_webhook_audit. There is NO business/money logic here —
// the matching / confirmation (fraud) gate is Patch 2 (independent SePay-API reconciliation;
// SePay API = source of truth, this webhook is only a nudge).
//
// Auth: SePay sends the configured API key in the `Authorization` header as `Apikey <key>`
// (confirmed in SePay webhook docs; `Bearer` also tolerated). We strip the scheme prefix and
// timing-safe-compare the bare key to SEPAY_WEBHOOK_SECRET (which holds the raw key, NO prefix).
// A route token in the URL path (/sepay-webhook/<token>) is the per-club seam: Patch 1 = single
// SEPAY_WEBHOOK_SECRET env; Patch 2 swaps resolveSecretForRoute() for a per-club secret store.
// Deployed with --no-verify-jwt (the external caller has no Supabase JWT).
//
// Lossless contract: SePay does NOT re-send once we respond, so we never drop an authenticated
// event because of our own parser strictness:
//   - authenticated but missing dedupe identity → preserved verbatim in bank_webhook_audit.raw_body
//     (P1-B), 400, no bank_transactions row (a NULL provider_txn_id would break the dedupe index);
//   - has identity but bad amount/date → stored with status='quarantined' (P1-A), success-contract;
//   - inserted / duplicate / quarantined → 200 {success:true}.
//
// Writes go through the service-role client (bypasses RLS — the two tables have SELECT-only policies).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_BODY_BYTES = 16_384;

/** Patch 1: single test route → one env secret. Patch 2: per-club lookup by the opaque token. */
function resolveSecretForRoute(token: string | undefined): string | null {
  if (!token) return null; // a route token is required (the actual auth is the Apikey header)
  const secret = Deno.env.get("SEPAY_WEBHOOK_SECRET") ?? "";
  return secret.length > 0 ? secret : null;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time string equality via SHA-256 digests (double-hash: no early-exit, no length leak). */
async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

function clientIp(req: Request): string | null {
  const first = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return first.length > 0 ? first : null;
}

type Outcome = "inserted" | "duplicate" | "unauthorized" | "bad_payload";

async function writeAudit(row: {
  verified: boolean;
  http_status: number;
  outcome: Outcome;
  remote_ip: string | null;
  bank_transaction_id?: string | null;
  raw_body?: string | null;
}): Promise<void> {
  // Best-effort observability — NOT the source of truth. Never throw out of the request path.
  // raw_payload is left at its '{}' default (no payer-PII duplication); the Apikey lives in the
  // header, never the body, so raw_body is secret-free.
  try {
    const { error } = await admin.from("bank_webhook_audit").insert({
      provider: "sepay",
      verified: row.verified,
      http_status: row.http_status,
      outcome: row.outcome,
      bank_transaction_id: row.bank_transaction_id ?? null,
      remote_ip: row.remote_ip,
      raw_body: row.raw_body ?? null,
    });
    if (error) console.error("sepay-webhook: audit write failed");
  } catch {
    // Audit is observability, not authority — never throw out of the request path. But log it:
    // for 401/400 outcomes the audit row is the ONLY trace (no bank_transactions row), so a silent
    // failure would lose forensics. Edge logs capture this. (P2-4)
    // Database/transport details may contain private payer data. The failure
    // marker is enough for telemetry; never echo those details into Edge logs.
    console.error("sepay-webhook: audit write failed");
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** SePay transferAmount may be a number (5000000) or a decimal string ("18067000.00"). */
function parseAmount(v: unknown): number | null {
  if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  const rounded = Math.round(n);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

/** SePay transactionDate "YYYY-MM-DD HH:MM:SS" has no offset; VN has no DST → fix +07:00. */
function parseOccurredAt(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const local = v.trim().replace(" ", "T");
  const d = new Date(local + "+07:00");
  if (Number.isNaN(d.getTime())) return null;
  const roundTrip = new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return roundTrip === local.slice(0, 19) ? d.toISOString() : null;
}

Deno.serve(async (req) => {
  const remote_ip = clientIp(req);

  // 1) Method gate — cheap, no audit.
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 2) Size cap BEFORE reading the body, then re-assert on real byte length (UTF-8, not UTF-16 units).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  const body = await req.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  // 3) Auth — route token (per-club seam) + timing-safe Apikey equality. BEFORE parsing the body.
  // SePay sends `Authorization: Apikey <key>` (per SePay docs); strip the scheme prefix and
  // timing-safe-compare the bare key to the resolved secret. `Bearer` is also tolerated.
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const fnPos = segments.lastIndexOf("sepay-webhook");
  const token = fnPos >= 0 ? segments[fnPos + 1] : segments[segments.length - 1];
  const expected = resolveSecretForRoute(token);
  const presented = (req.headers.get("Authorization") ?? "").replace(/^(Apikey|Bearer)\s+/i, "").trim();
  const authed = expected !== null && presented.length > 0 &&
    (await timingSafeEqualStr(presented, expected));
  if (!authed) {
    // Only failure worth recording (it passed method + size). No attacker payload / raw_body.
    await writeAudit({ verified: false, http_status: 401, outcome: "unauthorized", remote_ip });
    return new Response("Unauthorized", { status: 401 });
  }

  // 4) Parse + ingest decision tree.
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch (_e) {
    payload = null;
  }

  const provider_txn_id = payload ? nonEmpty(payload["id"]) : null;
  const account_number = payload ? nonEmpty(payload["accountNumber"]) : null;

  // Missing identity → cannot dedupe/reconcile (NULL provider_txn_id would break the unique index).
  // It is authenticated (real SePay) → preserve raw_body in the audit for Patch-2 API-poll, then 400.
  if (!provider_txn_id || !account_number) {
    await writeAudit({
      verified: true,
      http_status: 400,
      outcome: "bad_payload",
      remote_ip,
      raw_body: body,
    });
    return jsonResponse(400, { success: false, error: "missing transaction identity" });
  }

  // Has identity → ALWAYS persist. Defensive parse; any failure → quarantine (never 400, never dropped).
  const amount = parseAmount(payload!["transferAmount"]);
  const occurred_at = parseOccurredAt(payload!["transactionDate"]);
  const status = amount === null || occurred_at === null ? "quarantined" : "unmatched";

  const row = {
    provider: "sepay",
    provider_txn_id,
    account_number,
    sub_account: nonEmpty(payload!["subAccount"]),
    club_id: null, // resolved in Patch 2 (via sub_account)
    gateway: nonEmpty(payload!["gateway"]),
    amount,
    transfer_type: nonEmpty(payload!["transferType"]),
    content: typeof payload!["content"] === "string" ? (payload!["content"] as string) : null,
    txn_ref: nonEmpty(payload!["referenceCode"]),
    occurred_at,
    status,
    raw_payload: payload,
    raw_body: body,
  };

  // 5) Idempotent insert — ignoreDuplicates ⇒ ON CONFLICT DO NOTHING; onConflict matches uq_bank_txn.
  const { data: inserted, error: insErr } = await admin
    .from("bank_transactions")
    .upsert(row, { onConflict: "provider,account_number,provider_txn_id", ignoreDuplicates: true })
    .select("id");

  if (insErr) {
    // DB write failed → do NOT claim success (would lose the event). 500 lets SePay/Patch-2 recover.
    // Database errors may include payer/account/reference values. Keep only
    // a stable failure marker, as in the audit failure path above.
    console.error("sepay-webhook: ingest failed");
    return jsonResponse(500, { success: false, error: "ingest failed" });
  }

  let bank_transaction_id: string | null = null;
  let outcome: Outcome;
  if (inserted && inserted.length > 0) {
    bank_transaction_id = inserted[0].id as string;
    outcome = "inserted";
  } else {
    // Conflict (already ingested) → fetch the existing id to link the audit.
    const { data: existing } = await admin
      .from("bank_transactions")
      .select("id")
      .eq("provider", "sepay")
      .eq("account_number", account_number)
      .eq("provider_txn_id", provider_txn_id)
      .maybeSingle();
    bank_transaction_id = (existing?.id as string) ?? null;
    outcome = "duplicate";
  }

  // 6) Audit (no payload/raw_body duplication for persisted rows — the data lives in bank_transactions).
  await writeAudit({ verified: true, http_status: 200, outcome, bank_transaction_id, remote_ip });

  // 7) Success-contract — SePay won't re-send after a response; 200 on every persisted outcome.
  return jsonResponse(200, { success: true });
});
