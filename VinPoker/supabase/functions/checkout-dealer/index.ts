import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { manualDealerIntentHeaders } from "../_shared/dealerMutationIntent.ts";
import { corsHeaders, jsonResponse, pickNextDealer } from "../_shared/dealer-utils.ts";
import {
  sendTelegramNotification, getClubTelegramChatId, mention, notifyDealerDM,
} from "../_shared/telegram.ts";
import { authenticateUser } from "../_shared/staking-common.ts";
import { mapWithConcurrency } from "../_shared/mapWithConcurrency.ts";

const CHECKOUT_BATCH_CONCURRENCY = 3;

interface AttendanceRow {
  id: string;
  dealer_id: string;
  status: string;
  current_state: string;
  shift_id: string | null;
  check_in_time: string | null;
  pre_assigned_table_id: string | null;
}

interface DealerRow {
  id: string;
  club_id: string;
  full_name: string;
  telegram_username: string | null;
  telegram_user_id: string | null;
}

interface TxResultRow {
  ok?: boolean;
  error?: string;
  outcome?: string;
  assignment_id?: string | null;
  idempotent?: boolean;
  orphan_count?: number;
}

interface ClubSettingsRow {
  floor_manager_chat_id: string | null;
}

interface TableTypeRow {
  table_type: string | null;
}

interface SwingConfigRow {
  swing_duration_minutes: number | null;
}

interface CheckoutCore {
  success: true;
  core_version: 1;
  attendance_id: string;
  club_id: string;
  dealer_name: string;
  check_in_time: string;
  check_out_time: string;
  total_hours: number;
  released_pre_assigned: boolean;
  pre_assigned_table: string | null;
  replacement_table_id: string | null;
  replacement_session_id: string | null;
  replacement_assignment_id: string | null;
  released_assignment_ids: string[];
  cleared_preassignment_assignment_ids: string[];
  idempotent: boolean;
}

function checkoutCore(value: unknown, attendanceId: string, clubId: string): CheckoutCore | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const textOrNull = (v: unknown) => v === null || (typeof v === "string" && v.length > 0);
  const ids = [row.replacement_table_id, row.replacement_session_id, row.replacement_assignment_id];
  if (row.success !== true || row.core_version !== 1 || row.attendance_id !== attendanceId || row.club_id !== clubId ||
      typeof row.dealer_name !== "string" || typeof row.check_in_time !== "string" || typeof row.check_out_time !== "string" ||
      !Number.isFinite(Date.parse(row.check_in_time)) || !Number.isFinite(Date.parse(row.check_out_time)) ||
      Date.parse(row.check_out_time) < Date.parse(row.check_in_time) ||
      typeof row.total_hours !== "number" || !Number.isFinite(row.total_hours) || row.total_hours < 0 || row.total_hours > 24 ||
      typeof row.released_pre_assigned !== "boolean" || !(row.pre_assigned_table === null || typeof row.pre_assigned_table === "string") ||
      typeof row.idempotent !== "boolean" || !ids.every(textOrNull) ||
      !(ids.every(v => v === null) || ids.every(v => typeof v === "string")) ||
      ![row.released_assignment_ids, row.cleared_preassignment_assignment_ids].every(
        list => Array.isArray(list) && list.every(id => typeof id === "string" && id.length > 0))) return null;
  return row as unknown as CheckoutCore;
}

async function processOneCheckout(
  admin: Pick<ReturnType<typeof createClient>, "from" | "rpc">,
  botToken: string,
  uid: string,
  attendanceId: string,
): Promise<Record<string, unknown>> {
  // Metadata is only for notification/display. The canonical RPC rechecks the
  // actor, club, attendance, session and breaks under locks before any write.
  const { data: att, error: attErr } = await admin.from("dealer_attendance")
    .select("id, dealer_id").eq("id", attendanceId).single() as {
      data: AttendanceRow | null; error: { message: string } | null;
    };
  if (attErr || !att) return { attendance_id: attendanceId, success: false, error: "Cannot load checkout attendance" };
  const { data: dealer, error: dealerErr } = await admin.from("dealers")
    .select("id, full_name, club_id, telegram_username, telegram_user_id").eq("id", att.dealer_id).single() as {
      data: DealerRow | null; error: { message: string } | null;
    };
  if (dealerErr || !dealer) return { attendance_id: attendanceId, success: false, error: "Cannot load checkout dealer" };
  const clubId = dealer.club_id;
  let data: unknown;
  let uncertain = false;
  try {
    const response = await admin.rpc("operator_checkout_dealer_attendance_v1", {
      p_actor_id: uid, p_attendance_id: attendanceId,
    });
    data = response.data;
    uncertain = Boolean(response.error);
  } catch { uncertain = true; }
  if (!uncertain && data && typeof data === "object" && !Array.isArray(data)) {
    const denied = data as Record<string, unknown>;
    if (denied.success === false && denied.attendance_id === attendanceId &&
        ["STALE_ATTENDANCE_REQUIRES_CLEANUP", "LEGACY_CHECKOUT_REVIEW_REQUIRED"].includes(String(denied.code))) {
      return { attendance_id: attendanceId, success: false, code: denied.code,
        error: denied.code === "STALE_ATTENDANCE_REQUIRES_CLEANUP"
          ? "Ca check-in quá 24 giờ hoặc thiếu giờ vào; hãy dùng chế độ dọn ca treo để không tính lại lương/OT"
          : "Ca đã đóng nhưng thiếu receipt chuẩn; cần kiểm tra lịch sử trước khi xử lý" };
    }
  }
  let core = uncertain ? null : checkoutCore(data, attendanceId, clubId);
  let recovered = false;
  if (!core) {
    // A lost/invalid response never authorizes the legacy multi-write path.
    // Read the same attendance receipt once; do not send another mutation.
    try {
      const receipt = await admin.rpc("get_dealer_checkout_receipt_v1", {
        p_actor_id: uid, p_attendance_id: attendanceId,
      });
      if (!receipt.error && receipt.data?.status === "receipt_found") {
        core = checkoutCore(receipt.data.result, attendanceId, clubId);
        recovered = Boolean(core);
      }
    } catch { /* Outcome remains explicitly unconfirmed. */ }
  }
  if (!core) return { attendance_id: attendanceId, success: false, code: "CHECKOUT_OUTCOME_UNCONFIRMED",
    error: "Chưa xác minh được kết quả check-out; tải lại trạng thái và kiểm tra receipt trước khi thử lại" };
  const saved = { attendance_id: attendanceId, success: true, dealer_name: core.dealer_name,
    check_in_time: core.check_in_time, check_out_time: core.check_out_time, total_hours: core.total_hours,
    released_pre_assigned: core.released_pre_assigned, pre_assigned_table: core.pre_assigned_table,
    needs_replacement_table: core.replacement_table_id, auto_assigned_dealer: null };
  // Never repeat notifications/staffing after recovery or explicit replay.
  if (core.idempotent || recovered) return { ...saved, idempotent: true, recovered };
  const dealerName = core.dealer_name;
  const dealerMention = mention({ full_name: dealerName, telegram_username: dealer.telegram_username,
    telegram_user_id: dealer.telegram_user_id ? Number(dealer.telegram_user_id) : null });
  const checkInTime = core.check_in_time;
  const nowISO = core.check_out_time;
  const totalHours = core.total_hours;
  const releasedPreAssigned = core.released_pre_assigned;
  const preAssignedTableName = core.pre_assigned_table;
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

  try {
  // 4. Telegram: gửi thông báo checkout tới group chat
  if (botToken) {
    try {
      const groupChatId = await getClubTelegramChatId(admin, clubId);
      if (groupChatId) {
        const checkInStr = checkInTime ? fmtTime(new Date(checkInTime)) : "?";
        const checkOutStr = fmtTime(new Date(nowISO));
        const msg = `${dealerMention} check out - thời gian làm việc ${checkInStr}-${checkOutStr}: ${totalHours} tiếng`;
        await sendTelegramNotification(botToken, groupChatId, msg).catch(() => {});
      }
    } catch { /* non-critical */ }

    // 4b. Private DM to the dealer (owner rule: notify the dealer on check-out).
    // Uses notifyDealerDM (HTML parse mode, same as the working break/meal DM flows) so the
    // bold renders correctly. A DM REQUIRES the dealer's numeric telegram_user_id, which Telegram
    // only exposes once the dealer has messaged the bot (/checkin or /start) — a bot cannot DM a
    // user it has only as an @username. We log exactly why a DM did/didn't go so the gap is visible.
    if (dealer?.telegram_user_id) {
      const ci = checkInTime ? fmtTime(new Date(checkInTime)) : "?";
      const co = fmtTime(new Date(nowISO));
      const dm =
        `✅ Bạn đã được <b>check-out</b> lúc ${co}.\n` +
        `🕒 Thời gian làm việc: ${ci}–${co} (${totalHours} tiếng).\n` +
        `Cảm ơn ca làm việc của bạn!`;
      const ok = await notifyDealerDM(
        botToken,
        { telegram_user_id: Number(dealer.telegram_user_id), full_name: dealerName },
        dm,
      );
      console.log(
        `[checkout-dealer] DM ${dealerName} (uid=${dealer.telegram_user_id}): ` +
        (ok ? "sent" : "FAILED (dealer likely has not started the bot / blocked it)"),
      );
    } else {
      console.warn(
        `[checkout-dealer] DM skipped — dealer ${dealerName} (id=${dealer?.id}) has no telegram_user_id. ` +
        `They must message the bot once (/checkin or /start) so Telegram exposes their chat id; ` +
        `an operator-linked @username alone cannot receive a DM.`,
      );
    }

    // If pre_assigned → also send alerts (existing behavior)
    if (releasedPreAssigned) {
      const { data: cs } = (await admin
        .from("club_settings")
        .select("floor_manager_chat_id")
        .eq("club_id", clubId)
        .maybeSingle()) as unknown as { data: ClubSettingsRow | null };

      const fmChatId = cs?.floor_manager_chat_id;
      if (fmChatId) {
        await sendTelegramNotification(botToken, fmChatId,
          `🚨 *Check-out đột ngột!*\n\n${dealerMention} (đang pre_assigned cho bàn ${preAssignedTableName ?? "N/A"}) vừa check-out.\nCần gán dealer mới cho bàn này!`,
          { logError: (err) => console.error("checkout FM alert error:", err) }
        ).catch(() => {});
      }

      const groupChatId2 = await getClubTelegramChatId(admin, clubId);
      if (groupChatId2) {
        await sendTelegramNotification(botToken, groupChatId2,
          `⚠️ ${dealerMention} vừa check-out (đang pre_assigned cho bàn ${preAssignedTableName ?? "N/A"}).`
        ).catch(() => {});
      }
    }
  }

  } catch {
    console.warn("[checkout-dealer] checkout committed; notification unavailable");
  }

  // Assignment release and audit already committed in the canonical RPC.
  const needsReplacementTableId = core.replacement_table_id;
  const replacementSessionId = core.replacement_session_id;
  const replacementAssignmentId = core.replacement_assignment_id;

  // 6. BUG 3: Best-effort auto-replacement for the affected table.
  // If a dealer is available, assign immediately. If not, cron will
  // handle it through fillEmptyTables on the next cycle.
  let autoAssigned: { dealer_name: string } | null = null;
  if (needsReplacementTableId && replacementSessionId && replacementAssignmentId) {
    try {
      // Checkout does not waive the replacement dealer's existing rest policy.
      // Notification availability must not decide whether an eligible table is staffed.
      const dealer = await pickNextDealer(admin, clubId, {
        currentTableId: needsReplacementTableId,
      });
      if (dealer) {
        // Compute swing_due_at from swing_config (table_type-aware fallback chain)
        let swingMinutes: number | null = null;
        const { data: tableInfo } = (await admin
          .from("game_tables")
          .select("table_type")
          .eq("id", needsReplacementTableId)
          .maybeSingle()) as unknown as { data: TableTypeRow | null };

        if (tableInfo?.table_type) {
          const { data: swingConfig } = (await admin
            .from("swing_config")
            .select("swing_duration_minutes")
            .eq("club_id", clubId)
            .eq("table_type", tableInfo.table_type)
            .maybeSingle()) as unknown as { data: SwingConfigRow | null };
          swingMinutes = swingConfig?.swing_duration_minutes ?? null;
        }

        if (swingMinutes == null) {
          const { data: fallbackConfig } = (await admin
            .from("swing_config")
            .select("swing_duration_minutes")
            .eq("club_id", clubId)
            .limit(1)
            .maybeSingle()) as unknown as { data: SwingConfigRow | null };
          swingMinutes = fallbackConfig?.swing_duration_minutes ?? null;
        }

        const replacementSwingDueAt = new Date(
          Date.now() + (swingMinutes ?? 45) * 60_000
        ).toISOString();

        const { data: assignResult, error: assignErr } = (await admin.rpc(
          "worker_assign_dealer_to_session_v1",
          {
            p_club_id: clubId,
            p_attendance_id: dealer.id,
            p_table_id: needsReplacementTableId,
            p_table_session_id: replacementSessionId,
            p_swing_due_at: replacementSwingDueAt,
            p_idempotency_key: `checkout_replace_${replacementAssignmentId}_${replacementSessionId}_${dealer.id}`,
          }
        )) as unknown as { data: TxResultRow | string | null; error: { message: string } | null };
        if (assignErr) {
          console.error(`[checkout-dealer] Auto-replace RPC error: ${assignErr.message}`);
        } else {
          const assignOutcome = typeof assignResult === "string" ? assignResult : assignResult?.outcome;
          if (assignOutcome === "ok") {
            autoAssigned = { dealer_name: dealer.full_name };
            console.log(
              `[checkout-dealer] Auto-assigned ${dealer.full_name} to table ${needsReplacementTableId}`
            );
          } else {
            console.warn(`[checkout-dealer] Auto-replace outcome: ${assignOutcome}`);
          }
        }
      }
    } catch (err) {
      console.error(
        `[checkout-dealer] Auto-replace failed for table ${needsReplacementTableId}:`,
        err instanceof Error ? err.message : "Unknown error"
      );
    }

    // If auto-assign failed, notify floor manager
    if (!autoAssigned) {
      try {
        const { data: cs } = (await admin
          .from("club_settings")
          .select("floor_manager_chat_id")
          .eq("club_id", clubId)
          .maybeSingle()) as unknown as { data: ClubSettingsRow | null };
        const fmChatId = cs?.floor_manager_chat_id;
        if (fmChatId) {
          await sendTelegramNotification(
            botToken,
            fmChatId,
            `⚠️ Bàn vừa mất dealer (check-out) — chưa có người thay. Hệ thống sẽ tự động xoay vòng.`,
            {}
          ).catch(() => {});
        }
      } catch {
        /* non-critical */
      }
    }
  }

  return {
    attendance_id: attendanceId,
    success: true,
    dealer_name: dealerName,
    check_in_time: checkInTime,
    check_out_time: nowISO,
    total_hours: totalHours,
    released_pre_assigned: releasedPreAssigned,
    pre_assigned_table: preAssignedTableName,
    needs_replacement_table: needsReplacementTableId,
    auto_assigned_dealer: autoAssigned?.dealer_name ?? null,
  };
}

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

    const body = await req.json();
    const mode = body.mode === "stale_cleanup" ? "stale_cleanup" : "normal";
    const ids: string[] = Array.from(new Set<string>(
      (body.attendance_ids || (body.attendance_id ? [body.attendance_id] : []))
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    ));
    if (!ids.length) return jsonResponse({ error: "attendance_id or attendance_ids required" }, 400);
    if (ids.length > 100) return jsonResponse({ error: "Too many attendance_ids" }, 400);

    // Resolve and validate every dealer's club before any checkout mutation.
    // Checking only ids[0] allowed a mixed-club batch to cross the caller's scope.
    const { data: rows, error: attendanceErr } = await admin
      .from("dealer_attendance")
      .select("id, dealer_id, dealers!inner(club_id)")
      .in("id", ids) as unknown as {
        data: Array<{ id: string; dealer_id: string; dealers: { club_id: string } | Array<{ club_id: string }> }> | null;
        error: { message: string } | null;
      };
    if (attendanceErr) return jsonResponse({ error: `Cannot determine attendance scope: ${attendanceErr.message}` }, 500);
    if (!rows || rows.length !== ids.length) return jsonResponse({ error: "One or more attendance records not found" }, 404);

    const clubIds = new Set(rows.map((row) => {
      const dealer = Array.isArray(row.dealers) ? row.dealers[0] : row.dealers;
      return dealer?.club_id;
    }).filter((clubId): clubId is string => Boolean(clubId)));
    if (clubIds.size !== 1) return jsonResponse({ error: "Mixed-club checkout batches are not allowed" }, 403);
    const clubId = [...clubIds][0];

    const { data: isControl, error: controlErr } = await admin
      .rpc("is_club_dealer_control", { _user_id: uid, _club_id: clubId });
    if (controlErr) return jsonResponse({ error: `Cannot verify dealer-control scope: ${controlErr.message}` }, 500);
    if (!isControl) return jsonResponse({ error: "Forbidden" }, 403);

    if (mode === "stale_cleanup") {
      const { data: cleanupResults, error: cleanupErr } = (await admin.rpc(
        "administrative_close_stale_dealer_attendance",
        { p_attendance_ids: ids, p_actor_id: uid },
      )) as unknown as { data: unknown; error: { message: string } | null };

      if (cleanupErr) {
        console.error("[checkout-dealer] stale cleanup RPC failed", cleanupErr.message);
        return jsonResponse({ error: `Stale cleanup failed: ${cleanupErr.message}` }, 500);
      }

      const results = Array.isArray(cleanupResults) ? cleanupResults : [];
      const failedResults = results.filter((result) => (result as { success?: boolean })?.success !== true);
      if (failedResults.length > 0) {
        console.warn(
          `[checkout-dealer] stale cleanup held ${failedResults.length}/${ids.length} rows`,
          failedResults,
        );
      }
      return jsonResponse({ mode, results });
    }

    // A checkout performs several PostgREST/RPC calls. Running up to 100 dealers
    // with Promise.allSettled creates an unbounded request fan-out and can make an
    // otherwise valid batch fail together. Keep pressure bounded and preserve order.
    const mappedResults = await mapWithConcurrency(
      ids,
      CHECKOUT_BATCH_CONCURRENCY,
      async (id: string) => {
        try {
          return await processOneCheckout(admin, botToken, uid, id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error(`[checkout-dealer] unhandled item failure attendance=${id}: ${message}`);
          return { attendance_id: id, success: false, error: message };
        }
      },
    );

    const failedResults = mappedResults.filter((result) => result.success !== true);
    if (failedResults.length > 0) {
      console.error(
        `[checkout-dealer] batch failed ${failedResults.length}/${ids.length}`,
        failedResults.map((result) => ({
          attendance_id: result.attendance_id,
          error: result.error ?? "Unknown error",
        })),
      );
    }

    return jsonResponse({ results: mappedResults });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
