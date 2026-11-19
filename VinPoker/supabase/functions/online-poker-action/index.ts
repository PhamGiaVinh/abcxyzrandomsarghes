// supabase/functions/online-poker-action/index.ts
//
// GE-2C — thin, DARK Edge entrypoint for online poker (play-money, closed alpha).
// This is the ONLY runtime where the TS poker engine executes. The client sends
// INTENT only; this function runs the engine and routes persistence through the
// op_* RPCs. It ships disabled: until the GE-2C migration is applied AND the
// owner flips online_poker_config.enabled, every request returns "disabled".
//
// SECURITY (locked):
//   G2  every non-OPTIONS request must carry a valid Bearer JWT; uid comes ONLY
//       from auth.getUser(token) — NEVER from the request body.
//   dark flag-check runs first (any error / missing object => disabled).
//   engine/write RPCs are called with the SERVICE-ROLE client (service-role-only
//       grants); self RPCs (sit/stand/claim/hole) are called with the USER client
//       so the RPC's auth.uid() binding holds.
//   G1  NEVER log deck / board_future / holes / hole cards / private views /
//       secret-bearing RPC responses. Observability emits ONE structured line per
//       request via ./log.ts (buildLog), whose whitelist allows only a correlation id,
//       op, hand_id/table_id, machine outcome code, http status, latency, CAS attempt —
//       and DROPS everything else. get_my_hole_cards is hard-blocked from data logging.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.105.4";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
import { corsHeaders, handleOptions, jsonResp } from "../_shared/cors.ts";
import { buildLog, newCid, now } from "./log.ts";
import { dealNextHand } from "../_shared/pokerRuntime/dealNextHand.ts";
import {
  applyAction,
  actionFromRequest, classifyActionError, toWireLegalActions,
} from "../_shared/pokerEngine/index.ts";
import {
  serializeAuthoritative, deserializeAuthoritative,
  actionToRow, privateView,
} from "../_shared/pokerAdapter/index.ts";

const ACT_TIMEOUT_SECS = 30;
const MAX_CAS_RETRIES = 3;

/** Emit one whitelist-only structured `op_done` line (see ./log.ts). `extra` may carry
 *  hand_id / table_id / http / attempt; any non-allowed key is dropped by buildLog. */
type LogDone = (outcome: string, extra?: Record<string, unknown>) => void;

// ── request schema (discriminated by op) ────────────────────────────────────
const IdemKey = z.string().min(8).max(200);
const Body = z.discriminatedUnion("op", [
  // Keep-warm ping (fast-path): authenticated no-op — answered right after auth, BEFORE the
  // admin client / dark-switch, so it does zero Postgres IO. Static 8-byte body; strictly
  // cheaper than every real op. Clients fire-and-forget it to keep the isolate + GoTrue warm.
  z.object({ op: z.literal("ping") }),
  z.object({ op: z.literal("claim_daily_chips") }),
  z.object({ op: z.literal("get_my_hole_cards"), handId: z.string().uuid() }),
  z.object({ op: z.literal("legal_actions"), handId: z.string().uuid() }),
  z.object({ op: z.literal("sit_down"), tableId: z.string().uuid(), seat: z.number().int().min(1).max(10), buyin: z.string().regex(/^[1-9][0-9]*$/), idempotencyKey: IdemKey }),
  z.object({ op: z.literal("stand_up"), tableId: z.string().uuid(), idempotencyKey: IdemKey }),
  z.object({ op: z.literal("start_hand"), tableId: z.string().uuid(), idempotencyKey: IdemKey }),
  // Friends-practice (open tables, wallet-free, host succession)
  z.object({ op: z.literal("create_open_table"), expectedActorId: z.string().uuid(), requestId: z.string().uuid(), name: z.string().max(40).optional(), sb: z.string().regex(/^[1-9][0-9]*$/), bb: z.string().regex(/^[1-9][0-9]*$/), buyin: z.string().regex(/^[1-9][0-9]*$/), maxSeats: z.number().int().min(2).max(10).optional() }),
  z.object({ op: z.literal("get_create_receipt"), expectedActorId: z.string().uuid(), requestId: z.string().uuid() }),
  z.object({ op: z.literal("sit_open"), tableId: z.string().uuid(), seat: z.number().int().min(1).max(10), buyin: z.string().regex(/^[1-9][0-9]*$/), idempotencyKey: IdemKey }),
  z.object({ op: z.literal("transfer_host"), tableId: z.string().uuid(), toUserId: z.string().uuid() }),
  z.object({ op: z.literal("leave_open_table"), tableId: z.string().uuid() }),
  z.object({ op: z.literal("rebuy_open"), tableId: z.string().uuid(), amount: z.string().regex(/^[1-9][0-9]*$/), idempotencyKey: IdemKey }),
  z.object({
    op: z.literal("submit_action"), handId: z.string().uuid(),
    seat: z.number().int().min(1).max(10),
    type: z.enum(["fold", "check", "call", "bet", "raise", "allin"]),
    amount: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
    idempotencyKey: IdemKey, expectedSeq: z.number().int().optional(),
  }),
]);
type BodyT = z.infer<typeof Body>;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const cors = corsHeaders(req);
  // Per-request correlation id (groups a submit_action's CAS retries) + start clock.
  const cid = newCid();
  const t0 = now();
  let op = "preparse"; // becomes body.op once the body is parsed
  const json = (data: unknown, status = 200) => {
    const resp = jsonResp(req, data, status);
    // P0.4: best-effort correlation header — must NEVER fail the response.
    try { resp.headers.set("x-correlation-id", cid); } catch { /* ignore */ }
    return resp;
  };
  // P0.3: ONE unified structured line per request. Whitelist-only (see ./log.ts) — no
  // secret/card/private data can ever be emitted, even if passed in `extra`.
  const logDone: LogDone = (outcome, extra = {}) =>
    console.log(buildLog("op_done", { cid, op, ms: now() - t0, outcome, ...extra }));

  try {
    // G2: require a valid Bearer JWT BEFORE any work. uid only from getUser().
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) { logDone("unauthorized", { http: 401 }); return json({ error: "unauthorized" }, 401); }
    const token = authHeader.slice("Bearer ".length);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader }, fetch: retryFetch },
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !userData?.user?.id) { logDone("unauthorized", { http: 401 }); return json({ error: "unauthorized" }, 401); }
    const uid = userData.user.id;

    const parsed = await parseBody(req, Body, cors);
    if (!parsed.ok) { logDone("bad_request", { http: 400 }); return parsed.response; }
    const body = parsed.data;
    op = body.op;

    // This is an expectation fence, never an authorization identity. The JWT
    // remains authoritative if the SDK account changed after intent capture.
    if ((body.op === "create_open_table" || body.op === "get_create_receipt") && body.expectedActorId !== uid) {
      logDone("actor_context_changed", { http: 403 });
      return json({ error: "actor_context_changed" }, 403);
    }

    // Keep-warm ping: return BEFORE the admin client + dark-switch (zero Postgres IO).
    // Auth already ran above (G2) — a ping still requires a valid user JWT.
    if (body.op === "ping") { logDone("ok", { http: 200 }); return json({ ok: true }, 200); }

    // Resolve an existing intent even after gameplay was disabled. This is a
    // USER-bound read, never an unkeyed create or an admin lookup by actor input.
    if (body.op === "get_create_receipt") {
      return await rpcPassthrough(userClient, "op_get_create_receipt_v1", { p_request_id: body.requestId }, json, (o) => logDone(o), { logData: false });
    }

    const admin = createClient(url, serviceKey, { global: { fetch: retryFetch } });

    // Dark switch: any error / missing object => disabled => refuse.
    if (!(await isEnabled(admin))) { logDone("disabled", { http: 403 }); return json({ error: "online poker is disabled" }, 403); }

    switch (body.op) {
      case "claim_daily_chips": return await rpcPassthrough(userClient, "op_claim_daily_chips", {}, json, (o) => logDone(o));
      // P0.2: get_my_hole_cards is the most sensitive endpoint — NEVER inspect/log its
      // data; logData:false forces a generic ok/error outcome only.
      case "get_my_hole_cards": return await rpcPassthrough(userClient, "op_get_my_hole_cards", { p_hand_id: body.handId }, json, (o) => logDone(o, { hand_id: body.handId }), { logData: false });
      case "legal_actions":     return await handleLegal(admin, uid, body, json, logDone);
      case "sit_down":          return await rpcPassthrough(userClient, "op_sit_down", { p_table_id: body.tableId, p_seat_no: body.seat, p_buyin: body.buyin, p_idempotency_key: body.idempotencyKey }, json, (o) => logDone(o, { table_id: body.tableId }));
      case "stand_up":          return await rpcPassthrough(userClient, "op_stand_up", { p_table_id: body.tableId, p_idempotency_key: body.idempotencyKey }, json, (o) => logDone(o, { table_id: body.tableId }));
      case "start_hand":        return await handleStart(admin, uid, body, json, logDone);
      case "submit_action":     return await handleSubmit(admin, uid, body, json, logDone);
      case "create_open_table": return await rpcPassthrough(userClient, "op_create_open_table_v2", { p_name: body.name ?? null, p_sb: body.sb, p_bb: body.bb, p_buyin: body.buyin, p_max_seats: body.maxSeats ?? 9, p_request_id: body.requestId }, json, (o) => logDone(o));
      case "sit_open":          return await rpcPassthrough(userClient, "op_sit_open", { p_table_id: body.tableId, p_seat_no: body.seat, p_buyin: body.buyin, p_idempotency_key: body.idempotencyKey }, json, (o) => logDone(o, { table_id: body.tableId }));
      case "transfer_host":     return await rpcPassthrough(userClient, "op_transfer_host", { p_table_id: body.tableId, p_to_user_id: body.toUserId }, json, (o) => logDone(o, { table_id: body.tableId }));
      case "leave_open_table":  return await rpcPassthrough(userClient, "op_leave_open_table", { p_table_id: body.tableId }, json, (o) => logDone(o, { table_id: body.tableId }));
      case "rebuy_open":        return await rpcPassthrough(userClient, "op_rebuy_open", { p_table_id: body.tableId, p_amount: body.amount, p_idempotency_key: body.idempotencyKey }, json, (o) => logDone(o, { table_id: body.tableId }));
    }
  } catch (_e) {
    // G1/P0.3: structured error line, NO stack/body/internal message ever emitted.
    console.error(buildLog("op_error", { cid, op, ms: now() - t0, outcome: "internal", http: 500 }));
    return json({ error: "internal error" }, 500);
  }
});

async function isEnabled(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("op_is_enabled");
    if (error) return false; // missing RPC (migration unapplied) => dark
    return data === true;
  } catch {
    return false;
  }
}

/** Call a self/client RPC with the USER client (so auth.uid() binds) and return its outcome.
 *  `log(outcome)` emits the structured line; `opts.logData:false` (get_my_hole_cards) forces
 *  a generic ok/error outcome and NEVER inspects `data` (G1 — data may carry hole cards). */
async function rpcPassthrough(
  client: SupabaseClient, fn: string, args: Record<string, unknown>,
  json: (d: unknown, s?: number) => Response,
  log: (outcome: string) => void,
  opts: { logData?: boolean } = {},
): Promise<Response> {
  const { data, error } = await client.rpc(fn, args);
  if (error) { log("error"); return json({ error: `${fn} failed` }, 400); } // G1: no error.message
  // Only read a known string `outcome` code for non-secret ops; never touch `data` otherwise.
  const outcome = opts.logData === false
    ? "ok"
    : (typeof (data as { outcome?: unknown } | null)?.outcome === "string"
        ? (data as { outcome: string }).outcome
        : "ok");
  log(outcome);
  return json(data, 200);
}

async function handleStart(
  admin: SupabaseClient, uid: string,
  body: Extract<BodyT, { op: "start_hand" }>,
  json: (d: unknown, s?: number) => Response,
  log: LogDone,
): Promise<Response> {
  const tableId = body.tableId;
  const result = await dealNextHand(admin, tableId, uid);
  if (result.ok === true) {
    log("ok", { table_id: tableId, hand_id: result.handId, http: 200 });
    return json({ outcome: "ok", hand_id: result.handId, state_version: 0 }, 200);
  }
  if (result.reason === "already_active" || result.reason === "disabled") {
    log(result.reason, { table_id: tableId, http: 200 });
    return json({ outcome: result.reason }, 200);
  }

  const statuses = {
    table_not_found: 404,
    table_not_open: 409,
    seats_load_failed: 400,
    not_enough_players: 409,
    previous_hand_unavailable: 503,
    could_not_start_hand: 400,
    start_hand_failed: 400,
  };
  const status = statuses[result.reason];
  log(result.reason, { table_id: tableId, http: status });
  return json({ error: result.reason }, status);
}

async function handleSubmit(
  admin: SupabaseClient, uid: string,
  body: Extract<BodyT, { op: "submit_action" }>,
  json: (d: unknown, s?: number) => Response,
  log: LogDone,
): Promise<Response> {
  const hid = body.handId;
  let action;
  try {
    action = actionFromRequest(body);
  } catch {
    log("bad_request", { hand_id: hid, http: 400 });
    return json({ ok: false, code: "bad_request" }, 400);
  }
  const actionRow = actionToRow(action);
  const readReceipt = async () => {
    const { data, error } = await admin.from("online_poker_actions")
      .select("user_id,hand_id,action,response")
      .eq("idempotency_key", body.idempotencyKey)
      .maybeSingle();
    if (error) return { kind: "unavailable" } as const;
    if (!data) return { kind: "missing" } as const;
    const stored = data.action;
    const response = data.response;
    if (data.user_id !== uid || data.hand_id !== hid || !stored
      || stored.type !== actionRow.type || stored.seat !== actionRow.seat || stored.amount !== actionRow.amount
      || response?.outcome !== "ok" || response.hand_id !== hid
      || !Number.isSafeInteger(response.state_version) || response.state_version < 1) {
      return { kind: "conflict" } as const;
    }
    return { kind: "committed", stateVersion: response.state_version as number } as const;
  };
  const acknowledgeReceipt = (stateVersion: number, attempt: number) => {
    // The original post-action view may have been superseded. The client
    // already refreshes on a successful response without a view.
    log("receipt_recovered", { hand_id: hid, attempt, http: 200 });
    return json({ ok: true, handId: hid, stateVersion }, 200);
  };
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const tryNo = attempt + 1; // 1-based for human-readable logs
    const { data: ctx, error: lErr } = await admin.rpc("op_load_action_context", { p_hand_id: body.handId });
    if (lErr) { log("load_failed", { hand_id: hid, attempt: tryNo, http: 400 }); return json({ error: "load_failed" }, 400); }
    if (!ctx || ctx.outcome !== "ok") {
      const httpCode = ctx?.outcome === "not_found" ? 404 : 400;
      log(ctx?.outcome ?? "load_failed", { hand_id: hid, attempt: tryNo, http: httpCode });
      return json({ error: ctx?.outcome ?? "load_failed" }, httpCode);
    }

    // Rebuild authoritative state in the trusted runtime (deck + holes attached).
    let state;
    try {
      state = deserializeAuthoritative(ctx.state, ctx.live_deck ?? [], ctx.holes ?? []);
    } catch (_e) {
      log("state_error", { hand_id: hid, attempt: tryNo, http: 500 });
      return json({ error: "state_error" }, 500); // G1: no invariant message (may name a card)
    }

    if (!state.seats.some(seat => seat.seat === body.seat && seat.playerId === uid)) {
      log("forbidden", { hand_id: hid, attempt: tryNo, http: 409 });
      return json({ ok: false, code: "forbidden" }, 409);
    }

    // Server-authoritative validation: the engine decides legality.
    const result = applyAction(state, action);
    if (result.error) {
      const receipt = await readReceipt();
      if (receipt.kind === "committed") return acknowledgeReceipt(receipt.stateVersion, tryNo);
      log(classifyActionError(result.error), { hand_id: hid, attempt: tryNo, http: 409 });
      return json({ ok: false, code: classifyActionError(result.error), message: result.error }, 409);
    }

    const next = result.state;
    const split = serializeAuthoritative(next);
    const deadline = next.toAct != null
      ? new Date(Date.now() + ACT_TIMEOUT_SECS * 1000).toISOString() : null;

    const { data: sub, error: subErr } = await admin.rpc("op_submit_action", {
      p_hand_id: body.handId,
      p_actor_user_id: uid,
      p_action: actionRow,
      p_new_state: split.stateJson,
      p_board_future: split.liveDeck,
      p_events: result.events.map((e) => ({ type: e.type, payload: e.payload })),
      p_expected_state_version: ctx.state_version,
      p_act_deadline: deadline,
      p_idempotency_key: body.idempotencyKey,
    });
    if (subErr) {
      const receipt = await readReceipt();
      if (receipt.kind === "committed") return acknowledgeReceipt(receipt.stateVersion, tryNo);
      log("submit_failed", { hand_id: hid, attempt: tryNo, http: 400 });
      return json({ error: "submit_failed" }, 400);
    }
    if (sub?.outcome === "race_lost") { log("race_lost", { hand_id: hid, attempt: tryNo }); continue; } // re-load and retry
    if (sub?.outcome !== "ok") { log(sub?.outcome ?? "rejected", { hand_id: hid, attempt: tryNo, http: 409 }); return json({ ok: false, code: sub?.outcome ?? "rejected" }, 409); }

    // PostgreSQL's legacy idempotency key is global. Confirm owner, hand and
    // intent before returning a receipt or the locally reduced private view.
    const receipt = await readReceipt();
    if (receipt.kind === "conflict") {
      log("idempotency_conflict", { hand_id: hid, attempt: tryNo, http: 409 });
      return json({ ok: false, code: "idempotency_conflict" }, 409);
    }
    if (receipt.kind !== "committed") {
      log("receipt_unavailable", { hand_id: hid, attempt: tryNo, http: 503 });
      return json({ ok: false, code: "receipt_unavailable" }, 503);
    }
    if (receipt.stateVersion !== ctx.state_version + 1) return acknowledgeReceipt(receipt.stateVersion, tryNo);

    // Success: return the caller's OWN private view (own hole cards only).
    log("ok", { hand_id: hid, attempt: tryNo, http: 200 });
    return json({ ok: true, handId: hid, stateVersion: receipt.stateVersion, view: privateView(next, body.seat) }, 200);
  }
  log("race_lost", { hand_id: hid, attempt: MAX_CAS_RETRIES, http: 409 });
  return json({ ok: false, code: "race_lost" }, 409);
}

/**
 * legal_actions — server-authoritative action menu for the CALLER's own seat in the
 * given hand. The engine (not the client) decides legality; this just exposes the menu
 * the client renders. Returns {ok:true, legal, mySeat} (legal carries empty `types`
 * when it is not the caller's turn) or {ok:true, legal:null, mySeat:null} when the
 * caller is not in the hand. No secret data ever crosses this path (G1).
 */
async function handleLegal(
  admin: SupabaseClient, uid: string,
  body: Extract<BodyT, { op: "legal_actions" }>,
  json: (d: unknown, s?: number) => Response,
  log: LogDone,
): Promise<Response> {
  const hid = body.handId;
  const { data: ctx, error: lErr } = await admin.rpc("op_load_action_context", { p_hand_id: body.handId });
  if (lErr) { log("load_failed", { hand_id: hid, http: 200 }); return json({ ok: false, code: "load_failed" }, 200); }
  if (!ctx || ctx.outcome !== "ok") { log(ctx?.outcome ?? "load_failed", { hand_id: hid, http: 200 }); return json({ ok: false, code: ctx?.outcome ?? "load_failed" }, 200); }

  let state;
  try {
    state = deserializeAuthoritative(ctx.state, ctx.live_deck ?? [], ctx.holes ?? []);
  } catch (_e) {
    log("state_error", { hand_id: hid, http: 200 });
    return json({ ok: false, code: "state_error" }, 200); // G1: no invariant message
  }

  // Identify the caller's seat from the authoritative state (NEVER from the body).
  const mine = state.seats.find((s) => s.playerId === uid);
  if (!mine) { log("not_in_hand", { hand_id: hid, http: 200 }); return json({ ok: true, legal: null, mySeat: null }, 200); }

  // toWireLegalActions returns an empty-types menu unless it is genuinely this seat's turn.
  const legal = toWireLegalActions(state, mine.seat);
  log("ok", { hand_id: hid, http: 200 });
  return json({ ok: true, legal, mySeat: mine.seat }, 200);
}
