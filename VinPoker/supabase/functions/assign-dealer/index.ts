import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  pickTopDealersWithDiagnostics,
  buildScoreLabel,
  computeSwingDuration,
  corsHeaders,
  jsonResponse,
  type ScoreBreakdown,
} from "../_shared/dealer-utils.ts";
import {
  notifyIncomingDealer,
  getClubTelegramChatId,
  sendTelegramNotification,
  mention,
} from "../_shared/telegram.ts";
import { OPEN_TABLE_GRACE_MINUTES } from "../_shared/openTableGrace.ts";
import { authenticateUser } from "../_shared/staking-common.ts";
import { manualDealerIntentHeaders } from "../_shared/dealerMutationIntent.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authResult = await authenticateUser(req);
    if (authResult instanceof Response) return authResult;
    const uid = authResult.uid;
    const wire = await req.json().catch(() => ({}));
    const mode = wire?.mode;
    // Nested read-only packet is deliberately incompatible with legacy handlers:
    // they see no outer table_id/force_dealer_id and stop before any writer.
    const body = mode === "receipt" || mode === "resolve" ? wire?.assignment_intent : wire;
    if ((mode === "receipt" || mode === "resolve") && (!body || typeof body !== "object" || Array.isArray(body)))
      return json({error: "EXACT_ASSIGNMENT_RECEIPT_INTENT_REQUIRED"}, 400);
    const { table_id, table_session_id, force_dealer_id, requested_by, idempotency_key, return_suggestions_only, shift_id,
      expected_actor_id, expected_club_id } = body ?? {};
    if (!table_id) return json({ error: "table_id required" }, 400);
    if (mode !== undefined && mode !== "assign" && mode !== "receipt" && mode !== "resolve") return json({ error: "INVALID_ASSIGNMENT_MODE" }, 400);
    if ((expected_actor_id !== undefined && expected_actor_id !== uid)
        || (requested_by != null && requested_by !== uid)) return json({ error: "ASSIGNMENT_ACTOR_MISMATCH" }, 403);
    const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
    if (expected_club_id !== undefined && !uuid(expected_club_id)) return json({ error: "INVALID_EXPECTED_CLUB" }, 400);
    if ((mode === "receipt" || mode === "resolve") && (expected_actor_id !== uid || return_suggestions_only === true
        || ![expected_club_id, table_id, table_session_id, force_dealer_id, idempotency_key].every(uuid)))
      return json({ error: "EXACT_ASSIGNMENT_RECEIPT_INTENT_REQUIRED" }, 400);
    const admin = createClient(url, service, { global: { headers: manualDealerIntentHeaders(uid) } });
    const authorizeClub = async (clubId: string): Promise<Response | null> => {
      try {
        const {data, error} = await admin.rpc("is_club_dealer_control", {_user_id: uid, _club_id: clubId});
        if (error || (data !== true && data !== false)) return json({error: "DEALER_AUTHORITY_UNVERIFIED"}, 503);
        return data === true ? null : json({error: "Forbidden — not a dealer controller"}, 403);
      } catch { return json({error: "DEALER_AUTHORITY_UNVERIFIED"}, 503); }
    };
    if (mode === "resolve") {
      const denied = await authorizeClub(expected_club_id);
      if (denied) return denied;
      try {
        const {data: resolved, error} = await admin.rpc("resolve_dealer_initial_assignment_intent_v1", {
          p_actor_user_id: uid, p_club_id: expected_club_id, p_table_id: table_id,
          p_table_session_id: table_session_id, p_dealer_id: force_dealer_id, p_request_id: idempotency_key,
        });
        if (error) {
          if (error.code === "42501") return json({error: "DEALER_AUTHORITY_REVOKED"}, 403);
          if (error.code === "22023" && error.message === "INITIAL_ASSIGNMENT_IDEMPOTENCY_CONFLICT")
            return json({error: "IDEMPOTENCY_CONFLICT"}, 409);
          return json({error: "ASSIGNMENT_RESOLUTION_UNVERIFIED"}, 503);
        }
        const status = resolved?.status;
        const receipt = resolved?.receipt;
        const found = status === "receipt_found" && receipt?.outcome === "ok" && uuid(receipt?.assignment_id);
        const missing = ["receipt_not_found", "intent_obsolete", "legacy_receipt_review_required"].includes(status)
          && receipt === null;
        if (!found && !missing) return json({error: "ASSIGNMENT_RESOLUTION_MALFORMED"}, 502);
        return json({mode: "resolve", status, expected_actor_id: uid, expected_club_id,
          table_id, table_session_id, force_dealer_id, idempotency_key,
          assignment: found ? {id: receipt.assignment_id, status: "success"} : null});
      } catch { return json({error: "ASSIGNMENT_RESOLUTION_UNVERIFIED"}, 503); }
    }
    // Historical read only: do not require an active table/session/attendance,
    // compute a new duration, invoke a writer or send any notifications.
    if (mode === "receipt") {
      const denied = await authorizeClub(expected_club_id);
      if (denied) return denied;
      try {
        const {data: receipt, error} = await admin.rpc("worker_read_initial_assignment_receipt_v1", {
          p_request_key: `open_manual_${uid}_${idempotency_key}`, p_club_id: expected_club_id,
          p_table_id: table_id, p_table_session_id: table_session_id, p_dealer_id: force_dealer_id,
        });
        if (error) return json({error: "ASSIGNMENT_RECEIPT_UNVERIFIED"}, 503);
        if (receipt?.outcome === "idempotency_mismatch") return json({error: "IDEMPOTENCY_CONFLICT"}, 409);
        if (receipt !== null && (receipt?.outcome !== "ok" || !uuid(receipt?.assignment_id)))
          return json({error: "ASSIGNMENT_RECEIPT_MALFORMED"}, 502);
        return json({mode: "receipt", status: receipt === null ? "receipt_not_found" : "receipt_found",
          expected_actor_id: uid, expected_club_id, table_id, table_session_id, force_dealer_id, idempotency_key,
          assignment: receipt === null ? null : {id: receipt.assignment_id, status: "success"}});
      } catch { return json({error: "ASSIGNMENT_RECEIPT_UNVERIFIED"}, 503); }
    }

    console.log(`[assign-dealer] table=${table_id} force=${force_dealer_id} shift=${shift_id} idemp=${idempotency_key}`);

    if (idempotency_key) {
      // Format validation only — atomic idempotency check is in RPC Step 0
      if (typeof idempotency_key !== "string" || idempotency_key.length > 255) {
        return json({ error: "Invalid idempotency_key" }, 400);
      }
    }

    const { data: table, error: te } = await Promise.resolve(admin
      .from("game_tables")
      .select("id, club_id, table_name, table_type, status, shift_id")
      .eq("id", table_id)
      .maybeSingle()).catch(() => ({data: null, error: {message: "table read unavailable"}}));
    if (te) return json({error: "TABLE_READ_UNVERIFIED"}, 503);
    if (!table) return json({ error: "Table not found" }, 404);
    if (expected_club_id !== undefined && table.club_id !== expected_club_id)
      return json({error: "ASSIGNMENT_CLUB_MISMATCH"}, 403);

    const denied = await authorizeClub(table.club_id);
    if (denied) return denied;
    let manualKey: string | undefined;
    if (force_dealer_id && !return_suggestions_only) {
      if (!table_session_id || typeof idempotency_key !== "string" || !/^[0-9a-f-]{36}$/i.test(idempotency_key)) {
        return json({ error: "EXACT_SESSION_AND_REQUEST_ID_REQUIRED" }, 400);
      }
      manualKey = `open_manual_${uid}_${idempotency_key}`;
      const { data: receipt, error: receiptError } = await admin.rpc("worker_read_initial_assignment_receipt_v1", {
        p_request_key: manualKey, p_club_id: table.club_id, p_table_id: table_id,
        p_table_session_id: table_session_id, p_dealer_id: force_dealer_id,
      });
      if (receiptError) return json({ error: "ASSIGNMENT_RECEIPT_UNVERIFIED" }, 503);
      if (receipt) {
        if (receipt.outcome !== "ok" || !receipt.assignment_id) return json({ error: "IDEMPOTENCY_CONFLICT" }, 409);
        return json({ assignment: { id: receipt.assignment_id, status: "success" }, status: "success", idempotent_replay: true });
      }
    }

    // Manual assignment is an open-table operation. A replacement/swing must go
    // through the dedicated atomic swing RPC, never through this wrapper.
    const { data: activeAssignment } = await admin
      .from("dealer_assignments")
      .select("id, status")
      .eq("table_id", table_id)
      .in("status", ["assigned", "on_break"])
      .is("released_at", null)
      .maybeSingle();
    if (activeAssignment && !return_suggestions_only) {
      return json({ error: "Table already has an active dealer", assignment_id: activeAssignment.id }, 409);
    }


    const { data: config } = await admin
      .from("swing_config")
      .select("*")
      .eq("club_id", table.club_id)
      .eq("table_type", table.table_type)
      .maybeSingle();

    const breakDuration = config?.break_duration_minutes ?? 20;
    const tourTier = table.table_type === "TOURNAMENT" ? "HIGH" : undefined;
    const { data: localDate } = await admin.rpc("club_local_date", { p_club_id: table.club_id });
    const today = localDate ?? new Date().toISOString().split("T")[0];

    const durResult = await computeSwingDuration(admin, table.club_id, {
      swing_duration_minutes: config?.swing_duration_minutes ?? 45,
      auto_adjust_duration: config?.auto_adjust_duration ?? false,
      min_duration: Math.max(30, config?.min_duration_minutes ?? 30),
    });
    const swingDuration = durResult.durationMinutes;
    console.log(`[assign-dealer] Swing duration for club ${table.club_id}:`, durResult.durationRationale);

    if (force_dealer_id) {
      const query = admin
        .from("dealer_attendance")
        .select("id, shift_id, dealers!inner(full_name, telegram_username, telegram_user_id)")
        .eq("dealer_id", force_dealer_id)
        .eq("status", "checked_in");

      const { data: attendanceRows, error: ae } = await query
        .order("check_in_time", { ascending: false })
        .limit(1);

      if (ae) return json({ error: `ATTENDANCE_QUERY_FAILED: ${ae.message}` }, 500);
      if (!attendanceRows?.length) {
        const countAll = await admin
          .from("dealer_attendance")
          .select("id", { count: "exact", head: true })
          .eq("dealer_id", force_dealer_id)
          .eq("status", "checked_in");
        console.log(`[assign-dealer] dealer ${force_dealer_id} not found (total today: ${countAll.count})`);
        return json({ error: "DEALER_NOT_CHECKED_IN: Dealer hasn't checked in today", dealer_id: force_dealer_id, shift_id }, 400);
      }

      const attendance = attendanceRows[0];

      // ═══════════════════════════════════════════════════════════════════
      // SINGLE SOURCE OF TRUTH: Call assign_dealer_to_table RPC
      // All release + insert logic lives in the RPC (atomic transaction).
      // Edge fn = auth/validation wrapper only.
      // ═══════════════════════════════════════════════════════════════════

      // Open-table grace: the incoming dealer gets OPEN_TABLE_GRACE_MINUTES of
      // warmup before the swing clock starts — swing_due_at = now + grace + duration
      // so the table is not counted overdue during setup. assigned_at = now (the
      // frontend shows "Vào swing sau M:SS" for the grace window keyed off it).
      const assignedNow = Date.now();
      const swingDueAt = new Date(assignedNow + (OPEN_TABLE_GRACE_MINUTES + swingDuration) * 60 * 1000).toISOString();
      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "worker_assign_dealer_to_session_v1",
        {
          p_attendance_id: attendance.id,
          p_table_id: table_id,
          p_table_session_id: table_session_id,
          p_swing_due_at: swingDueAt,
          p_club_id: table.club_id,
          // "open_manual_" marker (2026-07-07): tells the floor card this row was a
          // manual open carrying the 5-min grace → show WARMUP. Deterministic wrap of
          // the client's idempotency key so client retries still replay-dedupe in the
          // RPC (same client key → same wrapped key).
          p_idempotency_key: manualKey,
          // Never replace an existing dealer from the manual-open endpoint.
          // A true swing uses its own atomic executor and policy checks.
        }
      );

      if (rpcErr) {
        console.error("[assign-dealer] RPC error:", rpcErr.message);
        return json({ error: rpcErr.message }, 500);
      }

      // Concurrent same-key requests may both miss the initial lookup and compute
      // slightly different due times. Reconcile the winner; never issue a new key.
      if (rpcResult?.outcome === "idempotency_mismatch") {
        const { data: committed, error: reconcileError } = await admin.rpc("worker_read_initial_assignment_receipt_v1", {
          p_request_key: manualKey, p_club_id: table.club_id, p_table_id: table_id,
          p_table_session_id: table_session_id, p_dealer_id: force_dealer_id,
        });
        if (reconcileError) return json({ error: "ASSIGNMENT_RECEIPT_UNVERIFIED" }, 503);
        if (committed?.outcome === "ok" && committed.assignment_id) {
          return json({ assignment: { id: committed.assignment_id, status: "success" }, status: "success", idempotent_replay: true });
        }
        return json({ error: "IDEMPOTENCY_CONFLICT" }, 409);
      }

      const outcome = typeof rpcResult === "string" ? rpcResult : rpcResult?.outcome;

      if (outcome === "conflict") {
        return json({
          error: "DEALER_BUSY: Dealer này vừa được phân công bởi người dùng khác. Vui lòng thử lại.",
          dealer_id: force_dealer_id,
        }, 409);
      }

      if (outcome === "table_occupied") {
        return json({ error: "Table already has an active dealer" }, 409);
      }

      if (outcome !== "ok") {
        return json({ error: `Unexpected outcome: ${outcome}` }, 500);
      }

      const assignmentId = typeof rpcResult === "object" ? rpcResult.assignment_id : null;

      if (!assignmentId) {
        console.error("[assign-dealer] RPC returned ok but no assignment_id");
        return json({ error: "Assignment created but ID missing" }, 500);
      }

      // Handle idempotent replay — assignment already existed
      const isIdempotent = typeof rpcResult === "object" && rpcResult.idempotent === true;

      await admin.from("audit_logs").insert({
        club_id: table.club_id,
        actor_id: uid,
        action: "assign",
        entity_type: "dealer_assignment",
        entity_id: assignmentId,
        payload: {
          table_id,
          attendance_id: attendance.id,
          mode: "force",
          outcome: "ok",
          idempotent: isIdempotent || undefined,
          orphan_count: typeof rpcResult === "object" ? (rpcResult.orphan_count ?? 0) : 0,
        },
      });

      // Telegram notification.
      // wasEmpty = the table had no active dealer before this assignment, i.e.
      // we are OPENING it (vs swinging/replacing a dealer on an occupied table).
      const wasEmpty = !activeAssignment;
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (botToken) {
        const dealerInfo = (attendance as any)?.dealers ?? {};
        const dealerName: string = dealerInfo.full_name ?? "Unknown";
        const dealerUsername: string | null = dealerInfo.telegram_username ?? null;
        const dealerUserId: number | null = dealerInfo.telegram_user_id ? Number(dealerInfo.telegram_user_id) : null;

        // Tour name for the message (table's dealer_shifts.tour_name) so Telegram
        // shows which tour the table belongs to.
        let tourName: string | null = null;
        if ((table as any).shift_id) {
          const { data: shiftRow } = await admin
            .from("dealer_shifts")
            .select("tour_name")
            .eq("id", (table as any).shift_id)
            .maybeSingle();
          tourName = (shiftRow as any)?.tour_name ?? null;
        }
        const tourInfo = tourName ? ` (${tourName})` : "";
        const dealerMention = mention({ full_name: dealerName, telegram_username: dealerUsername });

        // Distinct message when this assignment OPENS a previously-empty table.
        const groupMsg = wasEmpty
          ? `🆕 Mở bàn: ${dealerMention} - ${table.table_name}${tourInfo}`
          : `🪑 Vào bàn ${table.table_name}${tourInfo}: ${dealerMention}`;

        const chatId = await getClubTelegramChatId(admin, table.club_id);
        // Run the sends as a background task that the runtime keeps alive past
        // the response (EdgeRuntime.waitUntil) so they reliably deliver. The
        // previous fire-and-forget sends were dropped when the function froze on
        // return, so manual opens often sent nothing. Fallback: await locally.
        const sends = Promise.allSettled([
          notifyIncomingDealer(
            botToken,
            { full_name: dealerName, telegram_username: dealerUsername, telegram_user_id: dealerUserId },
            table.table_name,
            swingDuration,
          ),
          chatId ? sendTelegramNotification(botToken, chatId, groupMsg) : Promise.resolve(),
        ]);
        const er = (globalThis as any).EdgeRuntime;
        if (er?.waitUntil) er.waitUntil(sends);
        else await sends;
      }

      return json({ assignment: { id: assignmentId, status: "success" }, status: "success" });
    }

    const { candidates: topDealers, diag } = await pickTopDealersWithDiagnostics(admin, table.club_id, 3, {
      tourTier,
      currentTableId: table_id,
      includeScoreBreakdown: true,
    });

    const formatted = topDealers.map((d) => ({
      attendance_id: d.id,
      dealer_id: d.dealer_id,
      dealer_name: d.full_name,
      tier: d.tier,
      score: d.score ?? 0,
      score_breakdown: d.score_breakdown ?? {} as ScoreBreakdown,
      worked_minutes: d.worked_minutes_since_last_break,
      reason: d.score_breakdown
        ? buildScoreLabel(d.tier, d.score_breakdown)
        : "Sẵn sàng",
    }));

    // diagnostics = exclusion counters (why other dealers were not chosen). Read-only
    // explainability surface for the floor (C1); does not affect selection.
    if (return_suggestions_only) {
      return json({ suggestions: formatted, diagnostics: diag ?? null });
    }

    if (!formatted.length) {
      return json({ error: "NO_DEALERS_AVAILABLE: No dealers checked in and available" });
    }

    return json({ suggestions: formatted, diagnostics: diag ?? null });
  } catch (e) {
    return json({ error: `INTERNAL_ERROR: ${(e as Error).message}` }, 500);
  }
});
