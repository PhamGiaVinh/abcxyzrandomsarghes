import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, jsonResponse, fillEmptyTables, computeSwingDuration } from "../_shared/dealer-utils.ts";
import { formatMassAssignMessage, sendTelegramNotification, getClubTelegramChatId } from "../_shared/telegram.ts";
import { idempotentResponse } from "../_shared/idempotency.ts";
import { authenticateUser } from "../_shared/staking-common.ts";
import { manualDealerIntentHeaders } from "../_shared/dealerMutationIntent.ts";
import { fillOpenOperation } from "../_shared/fillOpenOperation.ts";
import {
  legacyFillFailureContract,
  operationFailureContract,
  queryFailureContract,
} from "./failureContract.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const authResult = await authenticateUser(req);
    if (authResult instanceof Response) return authResult;
    const uid = authResult.uid;
    const admin = createClient(supabaseUrl, serviceKey, { global: { headers: manualDealerIntentHeaders(uid) } });

    const body = await req.json().catch(() => ({}));
    const { club_id, shift_id, operation_id } = body ?? {};
    if (!club_id) return jsonResponse({ error: "club_id required" }, 400);
    if (operation_id != null && (typeof operation_id !== "string" || !UUID_RE.test(operation_id))) {
      return jsonResponse({ error: "operation_id must be a UUID" }, 400);
    }

    const { data: isControl } = await admin.rpc("is_club_dealer_control", { _user_id: uid, _club_id: club_id });
    if (!isControl) return jsonResponse({ error: "Forbidden" }, 403);

    // B1.2 — idempotent on an optional client key: dedups double-click / retry, returns the
    // cached aggregate ("N assigned", not 0) on replay, 409 on a concurrent duplicate. Degrades
    // to a plain run until the B1.1 RPCs are applied (zero regression).
    const runMassAssign = async () => {
    // ── Compute swing duration (batch-consistent) ──────────────────────────
    const { data: swingConfig, error: swingConfigError } = await admin
      .from("swing_config")
      .select("*")
      .eq("club_id", club_id)
      .eq("table_type", "tournament")
      .maybeSingle();
    if (swingConfigError) {
      const failure = queryFailureContract(swingConfigError, "swing_config");
      return jsonResponse(failure.body, failure.httpStatus);
    }

    const durResult = await computeSwingDuration(admin, club_id, {
      swing_duration_minutes: swingConfig?.swing_duration_minutes ?? 45,
      auto_adjust_duration: swingConfig?.auto_adjust_duration ?? false,
      min_duration: Math.max(30, swingConfig?.min_duration_minutes ?? 30),
    });

    const swingDueAt = new Date(Date.now() + durResult.durationMinutes * 60 * 1000).toISOString();

    console.log(
      `[mass-assign] Swing duration: ${durResult.durationMinutes}min ` +
      `(${durResult.durationRationale}), dueAt=${swingDueAt}`
    );

    let operationResult: Awaited<ReturnType<typeof fillOpenOperation>> | null = null;
    let assignments;
    if (operation_id) {
      try {
        operationResult = await fillOpenOperation(admin, operation_id, {
          expectedClubId: club_id,
          actorId: uid,
          swingDueAt,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        const failure = operationFailureContract(code);
        return jsonResponse(failure.body, failure.httpStatus);
      }
      assignments = operationResult.assignments;
    } else {
      // Legacy fallback is unchanged while the durable rollout is dark.
      const legacyResult = await fillEmptyTables(
        admin, club_id, shift_id ?? null, botToken,
        undefined, swingDueAt
      );
      const legacyFailure = legacyFillFailureContract(legacyResult);
      if (legacyFailure) return jsonResponse(legacyFailure.body, legacyFailure.httpStatus);
      assignments = legacyResult.assignments;
    }

    // Audit logs
    for (const a of assignments) {
      try { await admin.from("audit_logs").insert({
        club_id,
        actor_id: uid,
        action: "mass_assign",
        entity_type: "dealer_assignment",
        payload: {
          table_name: a.table_name,
          dealer_name: a.full_name,
          mode: operation_id ? "open_operation" : "mass_assign",
          operation_id: operation_id ?? null,
          tier: "tournament",
        },
      }); } catch {}
    }

    // Telegram
    const assignedEntries = assignments.map(a => ({
      tableName: a.table_name,
      dealer: {
        full_name: a.full_name,
        telegram_username: a.telegram_username ?? null,
      },
    }));

    try {
      const chatId = await getClubTelegramChatId(admin, club_id);
      if (botToken && chatId && assignedEntries.length > 0) {
        const sends: Promise<unknown>[] = [];
        const notificationAudits: Promise<unknown>[] = [];

        // Group notification: summary of all assignments
        const msg = formatMassAssignMessage(assignedEntries);
        sends.push(
          sendTelegramNotification(botToken, chatId, msg, {
            logError: (errMsg) => {
              notificationAudits.push(Promise.resolve(admin.from("swing_audit_logs").insert({
                club_id, action: "mass_assign_telegram_failed",
                error_message: errMsg, triggered_by: uid,
              })).then(({ error }) => {
                if (error) console.warn("[mass-assign] notification failure audit unavailable");
              }).catch(() => {
                console.warn("[mass-assign] notification failure audit unavailable");
              }));
            },
          })
        );

        // Individual dealer notifications: each dealer gets a personal message
        for (const a of assignments) {
          if (a.telegram_username) {
            const dealerMsg = `🎲 Bạn được gán vào *${a.table_name}*. Xoay vòng sau ${durResult.durationMinutes} phút.`;
            sends.push(sendTelegramNotification(botToken, chatId, dealerMsg));
          }
        }

        // Keep the sends alive past the response (EdgeRuntime.waitUntil): the
        // previous fire-and-forget `.catch(() => {})` promises were dropped when
        // the function froze on return, so bulk opens (owner: "mở 20 bàn") often
        // delivered NOTHING. Same fix as assign-dealer's manual-open sends.
        // Failure callbacks run while sends settle and may enqueue lazy DB
        // audits. Keep those requests inside the same background lifetime.
        const settled = Promise.allSettled(sends).then(() => Promise.allSettled(notificationAudits));
        const er = (globalThis as any).EdgeRuntime;
        if (er?.waitUntil) er.waitUntil(settled);
        else await settled;
      } else if (assignedEntries.length > 0 && !chatId) {
        // Make "no messages arrived" diagnosable: the club simply has no group
        // chat configured (club_settings.telegram_chat_id).
        console.warn(`[mass-assign] telegram skipped: club ${club_id} has no telegram_chat_id`);
      }
    } catch { /* non-critical */ }

    return jsonResponse({
      success: true,
      requested: operationResult?.requested ?? assignments.length,
      assigned: operationResult?.assigned ?? assignments.length,
      assigned_this_run: assignments.length,
      remaining: operationResult?.remaining ?? 0,
      operation_status: operationResult?.operation_status ?? "completed",
      operation_id: operation_id ?? null,
      outcomes: operationResult?.outcomes ?? [],
      candidate_snapshot_builds: operationResult?.candidate_snapshot_builds ?? null,
      swingConfig: {
        durationMinutes: durResult.durationMinutes,
        isDynamic: durResult.isDynamic,
        rationale: durResult.durationRationale,
      },
      assignments: assignments.map(a => ({
        table_id: a.table_id,
        table_name: a.table_name,
        dealer_name: a.full_name,
        tier: "tournament",
      })),
    });
    };

    if (operation_id) return await runMassAssign();

    const idemKey = (body?.idempotency_key as string | undefined) ?? null;
    return await idempotentResponse(admin, {
      key: idemKey,
      scope: "mass-assign",
      clubId: club_id,
      actorId: uid,
      fingerprint: { action: "mass-assign", club_id, shift_id: shift_id ?? null },
      json: (b, s) => jsonResponse(b, s),
      run: runMassAssign,
    });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
