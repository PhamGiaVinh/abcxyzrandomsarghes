/**
 * _shared/fillEmptyTables.ts
 *
 * Auto-fill tables that have NO active dealer assignment.
 *
 * Process:
 *   1. Find all active tables for the club (optionally filtered by shift).
 *   2. Exclude tables that already have an active assignment.
 *   3. For each empty table, attempt up to 3 rounds to find a dealer via
 *      pickNextDealer, handling RPC conflicts on each attempt.
 *
 * This runs BEFORE pre-assign (Pass 2) so empty tables get priority
 * over upcoming swing windows.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealerWithStatus, type DealerCandidate } from "./pickNextDealer.ts";
import { classifyPostgrestError } from "./postgrestError.ts";
import { SWING_POLICY } from "./swingPolicy.ts";
import { OPEN_TABLE_GRACE_MINUTES, bulkOpenStaggerMs } from "./openTableGrace.ts";
import { getDealerOperationalTables } from "./dealerOperationalTables.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FillResult {
  status: "ok" | "degraded" | "dependency_unavailable" | "query_failed";
  error_code: string | null;
  assignments: Array<{
    table_id: string;
    table_name: string;
    attendance_id: string;
    full_name: string;
    telegram_username?: string | null;
  }>;
  assignedAttendanceIds: Set<string>;
  diagnostics: Array<{
    stage: string;
    code: string;
    table_id?: string;
  }>;
}

export type SupabaseAdmin = any;

interface GameTableRow {
  id: string;
  table_session_id: string;
  tournament_id: string | null;
  table_name: string;
  table_type: string | null;
  shift_id: string | null;
  current_blind_level: number | null;
  opened_at: string | null;
  dealer_open_operation_id: string | null;
}

interface ActiveAssignmentRow {
  table_id: string | null;
  table_session_id: string | null;
}

interface TournamentRow {
  id: string;
  swing_duration_minutes: number;
}

interface TableOverrideRow {
  scope_id: string;
  swing_duration_minutes: number;
}

interface AssignTableRpcResult {
  outcome?: string | null;
}

interface AssignTableRpcError {
  message: string;
  code?: string | null;
}

type FillFailureStatus = Extract<FillResult["status"], "dependency_unavailable" | "query_failed">;

function classifyFillError(error: unknown): FillFailureStatus {
  return classifyPostgrestError(error).status;
}

function markFillFailure(
  result: FillResult,
  status: FillResult["status"],
  stage: string,
  code: string,
  tableId?: string,
): void {
  const priority: Record<FillResult["status"], number> = {
    ok: 0,
    degraded: 1,
    query_failed: 2,
    dependency_unavailable: 3,
  };
  if (priority[status] >= priority[result.status]) {
    result.status = status;
    result.error_code = code;
  }
  result.diagnostics.push({ stage, code, ...(tableId ? { table_id: tableId } : {}) });
}

// ─── fillEmptyTables ──────────────────────────────────────────────────────────

export async function fillEmptyTables(
  admin: SupabaseAdmin,
  clubId: string,
  shiftId: string | undefined,
  botToken: string,
  initialExclude?: Set<string>,
  swingDueAt?: string,
  minInterSwingRestMinutes?: number,
  // Empty-table auto-fill (owner policy 2026-06-15, Step 1): when true, pick
  // ONLY genuinely-free (current_state='available') dealers — never pull an
  // on_break dealer — and DM the chosen dealer directly. Default false keeps
  // every existing manual caller (mass-assign / assign-dealer) unchanged.
  availableOnly = false,
): Promise<FillResult> {
  const result: FillResult = {
    status: "ok",
    error_code: null,
    assignments: [],
    assignedAttendanceIds: new Set(),
    diagnostics: [],
  };

  // Step 1: Same authoritative active-session inventory as Floor, no legacy status fallback.
  let tables: GameTableRow[];
  try {
    tables = await getDealerOperationalTables(admin, clubId);
  } catch (error) {
    const status = classifyFillError(error);
    markFillFailure(result, status, "active_tables", `active_tables_${status}`);
    return result;
  }

  const activeTables = tables ?? [];
  const shiftScopedTables = shiftId
    ? activeTables.filter((t: { shift_id: string | null }) => t.shift_id === shiftId)
    : activeTables;

  // Compatibility fallback:
  // Some clubs keep active tables with shift_id = null even while working a tour.
  // If the requested shift has no rows, fall back to the active pool tables so
  // mass-assign and process-swing still see the room.
  const scopedTables =
    shiftId && shiftScopedTables.length === 0
      ? activeTables.filter((t: { shift_id: string | null }) => t.shift_id == null)
      : shiftScopedTables;

  if (shiftId && shiftScopedTables.length === 0) {
    console.warn(
      `[fillEmptyTables] No active tables matched shift ${shiftId}; falling back to ${scopedTables.length} active null-shift tables`
    );
  }

  if (scopedTables.length === 0) return result;

  // Step 2: Find tables with existing active assignments.
  // 'reserved' = a Step-2 empty-table reservation holds this table for a
  // soon-free dealer → treat it as NOT empty so Step-1 fill doesn't double-staff.
  const { data: activeAssignments, error: activeAssignmentsError } = (await admin
    .from("dealer_assignments")
    .select("table_id, table_session_id")
    .is("released_at", null)
    .in("status", ["assigned", "pre_assigned", "reserved"])
    .in(
      "table_id",
      scopedTables.map((t: { id: string }) => t.id)
    )) as unknown as {
      data: ActiveAssignmentRow[] | null;
      error: AssignTableRpcError | null;
    };
  if (activeAssignmentsError) {
    const status = classifyFillError(activeAssignmentsError);
    markFillFailure(result, status, "active_assignments", `active_assignments_${status}`);
    return result;
  }

  const sessionsByTable = new Map(scopedTables.map(table => [table.id, table.table_session_id]));
  const assignedTableIds = new Set((activeAssignments ?? []).flatMap(a =>
    a.table_id && a.table_session_id === sessionsByTable.get(a.table_id) ? [a.table_id] : []));

  // Step 3: Pre-fetch scoped configs (3 fixed queries, no N+1).
  const [tournamentsResult, tableOverridesResult,clubConfigsResult] = (await Promise.all([
    admin
      .from("tournaments")
      .select("id, swing_duration_minutes")
      .eq("club_id", clubId)
      .in('id',[...new Set(scopedTables.filter(table=>table.table_type==='tournament')
        .map(table=>table.tournament_id).filter((id):id is string=>!!id))]),
    admin
      .from("swing_configs")
      .select("scope_id, swing_duration_minutes")
      .eq("club_id", clubId)
      .eq("scope_type", "table"),
    admin.from('swing_config').select('table_type, swing_duration_minutes').eq('club_id',clubId),
  ])) as [
    { data: TournamentRow[] | null; error: AssignTableRpcError | null },
    { data: TableOverrideRow[] | null; error: AssignTableRpcError | null },
    { data: Array<{table_type:string;swing_duration_minutes:number|null}> | null; error: AssignTableRpcError | null },
  ];

  if (tournamentsResult.error || tableOverridesResult.error || clubConfigsResult.error) {
    const stage = tournamentsResult.error ? "live_tournaments" : tableOverridesResult.error?"table_overrides":"club_configs";
    const error = tournamentsResult.error ?? tableOverridesResult.error ?? clubConfigsResult.error;
    const status = classifyFillError(error);
    markFillFailure(result, status, stage, `${stage}_${status}`);
    return result;
  }

  const tournamentConfig = new Map<string, number>();
  for (const trn of tournamentsResult.data ?? []) {
    tournamentConfig.set(trn.id, trn.swing_duration_minutes);
  }

  const tableOverrideConfig = new Map<string, number>();
  for (const sc of tableOverridesResult.data ?? []) {
    tableOverrideConfig.set(sc.scope_id, sc.swing_duration_minutes);
  }
  const clubDurationConfig=new Map((clubConfigsResult.data??[]).map(row=>[row.table_type,row.swing_duration_minutes]));

  // Step 4: Server excludes ended tournaments and malformed incarnations. Cash/VIP
  // Floor sessions do not require an unrelated legacy shift or mass-open marker.
  const notAssigned = scopedTables.filter((t: { id: string }) => !assignedTableIds.has(t.id));
  const emptyTables = notAssigned
    .sort((a: GameTableRow, b: GameTableRow) =>
      (b.current_blind_level ?? 0) - (a.current_blind_level ?? 0)
    );

  const localExclude = new Set<string>(initialExclude ?? []);

  // Structured audit log (owner req 2026-06-15). One line per event, JSON
  // payload, greppable by `event` key.
  const slog = (event: string, data: Record<string, unknown>) =>
    console.log(`[fillEmptyTables] ${event} ${JSON.stringify({ club_id: clubId, ...data })}`);

  slog("empty_table_fill_started", {
    available_only: availableOnly,
    empty_table_count: emptyTables.length,
    empty_table_ids: emptyTables.map((t) => t.id),
  });

  // Step 5: Assign dealers to each empty table with per-table swing_due_at
  // Priority: table override > tournament config > club default (swingDueAt param)
  const now = new Date();
  const hhmm = (d: Date) =>
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

  // Wall-clock budget per invocation (2026-07-09 bugfix): a manual "mở 50 bàn" burst runs
  // this loop over every empty table with up to 3 pickNextDealer rebuilds each — hundreds
  // of serial round-trips that can blow the edge timeout and get killed mid-loop (some
  // tables committed, the rest left "Chưa gán · Thiếu dealer", and the post-loop Telegram
  // never runs). Stop CLEANLY when the budget is hit and return what committed; the client
  // re-invokes in bounded passes and the per-minute cron backfills the remainder.
  const fillDeadline = Date.now() + 20_000;
  for (const [index, table] of emptyTables.entries()) {
    if (Date.now() > fillDeadline) {
      markFillFailure(result, "degraded", "budget", "fill_budget_exceeded");
      slog("empty_table_fill_budget_exceeded", {
        assigned_so_far: result.assignments.length,
        remaining_tables: emptyTables.length - index,
      });
      break;
    }
    // Per-table fault isolation: one rejected query / RPC (or a slow pickNextDealer) must
    // skip THIS table only, never throw out of the whole batch (root of "some tables never
    // filled + no Telegram" — a single reject used to abort every remaining table).
    try {
    let assigned = false;

    if(table.table_type==='tournament'&&(!table.tournament_id||!tournamentConfig.has(table.tournament_id))){
      markFillFailure(result,'degraded','duration','swing_duration_unverified',table.id);
      continue;
    }

    const effectiveDuration = tableOverrideConfig.get(table.id)
      ?? (table.tournament_id ? tournamentConfig.get(table.tournament_id) : undefined)
      ?? (table.table_type ? clubDurationConfig.get(table.table_type) : undefined)
      ?? null;
    if(effectiveDuration!==null&&(!Number.isInteger(effectiveDuration)||effectiveDuration<=0)){
      markFillFailure(result,'degraded','duration','swing_duration_invalid',table.id);
      continue;
    }

    // Centered per-table stagger (F1 2026-07-08): spread the TARGET swing_due_at
    // so a manual "Gán loạt" of N tables doesn't come due as one wave (root of the
    // OT spiral). offset = (i − (n−1)/2) * step, clamped (bulkOpenStaggerMs). This
    // only moves the moment the engine STARTS trying to swap — it NEVER force-
    // releases anyone. NOT on the AUTO path (availableOnly): auto re-fill must show
    // no warmup/drift (owner 2026-07-06) — kept at 0.
    const stagger = availableOnly ? 0 : bulkOpenStaggerMs(index, emptyTables.length);

    // Open-table grace: OPENING a table (manual "Gán" / "Gán loạt", availableOnly=false)
    // gives the incoming dealer an OPEN_TABLE_GRACE_MINUTES warmup before the swing
    // clock starts. The AUTO cron re-fill (availableOnly=true) is NOT an open — it
    // re-seats a table mid-session after a dealer swings/breaks out — so it applies
    // NO grace and shows NO warmup, exactly like a rotation. (Owner 2026-07-06:
    // "warmup chỉ dành cho mở bàn"; before this, every post-swing auto re-fill
    // re-flashed a fresh 5-min WARMUP → tables looked like they kept re-opening.)
    const graceMs = availableOnly ? 0 : OPEN_TABLE_GRACE_MINUTES * 60_000;
    // Floor: a negative (earlier) stagger offset must never pull the first stint
    // below grace + minFirstStint — protects short-duration / large-batch corners.
    const minDueMs = now.getTime() + graceMs + SWING_POLICY.bulkOpen.minFirstStintMinutes * 60_000;
    const tableSwingDueAt = effectiveDuration != null
      ? new Date(Math.max(now.getTime() + graceMs + effectiveDuration * 60_000 + stagger, minDueMs)).toISOString()
      : swingDueAt
        ? new Date(Math.max(new Date(swingDueAt).getTime() + graceMs + stagger, minDueMs)).toISOString()
        : undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      // Build progressive exclusion: previously assigned + conflicted
      const excludeSet = new Set([
        ...localExclude,
        ...result.assignedAttendanceIds,
      ]);

      const pickResult = await pickNextDealerWithStatus(admin, clubId, {
        currentTableId: table.id,
        excludeAttendanceIds: excludeSet,
        minInterSwingRestMinutes: minInterSwingRestMinutes ?? SWING_POLICY.rest.minInterSwingRestMinutes,
        availableOnly,
      });

      if (pickResult.status !== "ok") {
        markFillFailure(
          result,
          pickResult.status,
          "candidate_snapshot",
          pickResult.errorCode ?? `candidate_snapshot_${pickResult.status}`,
          table.id,
        );
        return result;
      }

      const dealer: DealerCandidate | null = pickResult.candidate;

      if (!dealer) break;

      slog("empty_table_fill_candidate_selected", {
        table_id: table.id,
        table_name: table.table_name,
        attendance_id: dealer.id,
        dealer_name: dealer.full_name,
        current_state: dealer.current_state,
        attempt: attempt + 1,
      });

      const rpcClient = admin as unknown as {
        rpc: (
          name: string,
          args?: Record<string, unknown>,
        ) => Promise<{ data: AssignTableRpcResult | string | null; error: AssignTableRpcError | null }>;
      };
      const { data: rpcResult, error: rpcErr } = await rpcClient.rpc(
        "worker_assign_dealer_to_session_v1",
        {
          p_table_id: table.id,
          p_table_session_id: table.table_session_id,
          p_club_id: clubId,
          p_attendance_id: dealer.id,
          p_swing_due_at: tableSwingDueAt,
          // Explicit assignment-origin marker (2026-07-07). "open_manual_*" =
          // operator opened/staffed the table (Gán / Gán loạt) and the row carries
          // the 5-min open-table grace → the floor card shows WARMUP for it.
          // "autostaff_*" = the cron auto re-fill (no grace since #722) → no WARMUP.
          // The card previously INFERRED warmup from (swing_due_at − assigned_at) >
          // swing_duration, which false-fired on every backend timing nuance
          // (rest-deficit compensation, sync-window rounding, config-fallback
          // mismatches). The marker makes it exact. Key is deterministic per
          // table+due so the RPC's replay-dedupe still works across retry attempts.
          p_idempotency_key: `${availableOnly ? "autostaff" : "open_manual"}_${table.table_session_id}_${tableSwingDueAt ?? now.toISOString()}`,
        }
      );

      if (rpcErr) {
        markFillFailure(result, "degraded", "assign_rpc", "assign_rpc_conflict", table.id);
        console.warn(
          `[fillEmptyTables] assign conflict attempt ${attempt + 1} for table ${table.id}:`,
          rpcErr.message
        );
        // Add conflicted dealer to local exclude for next attempt
        localExclude.add(dealer.id);
        continue;
      }

      const outcome = typeof rpcResult === "string" ? rpcResult : rpcResult?.outcome;
      if (outcome === "ok") {
        localExclude.add(dealer.id);
        result.assignedAttendanceIds.add(dealer.id);
        result.assignments.push({
          table_id: table.id,
          table_name: table.table_name,
          attendance_id: dealer.id,
          full_name: dealer.full_name,
          telegram_username: dealer.telegram_username ?? null,
        });
        assigned = true;
        slog("empty_table_fill_assigned", {
          table_id: table.id,
          table_name: table.table_name,
          attendance_id: dealer.id,
          dealer_name: dealer.full_name,
          current_state: dealer.current_state,
        });

        // Direct DM to the staffed dealer (owner req 2026-06-15): which table,
        // why (mở bàn trống), and when they take it. Only in the auto-fill path
        // (availableOnly) so manual mass-assign / assign-dealer behavior is
        // unchanged.
        if (availableOnly && botToken) {
          if (dealer.telegram_user_id) {
            const dmText =
              `🆕 Bạn được gọi vào <b>${table.table_name}</b>.\n` +
              `Lý do: mở bàn trống.\n` +
              `Giờ nhận bàn: ${hhmm(now)}.`;
            try {
              const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: String(dealer.telegram_user_id), text: dmText, parse_mode: "HTML" }),
              });
              if (res.ok) slog("empty_table_fill_dm_sent", { table_id: table.id, attendance_id: dealer.id });
              else slog("empty_table_fill_dm_failed", { table_id: table.id, attendance_id: dealer.id, http_status: res.status });
            } catch (e) {
              slog("empty_table_fill_dm_failed", { table_id: table.id, attendance_id: dealer.id, error: e instanceof Error ? e.message : String(e) });
            }
          } else {
            slog("empty_table_fill_dm_failed", { table_id: table.id, attendance_id: dealer.id, reason: "no_telegram_user_id" });
          }
        }
        break;
      }

      if (outcome === "table_occupied") {
        console.warn(`[fillEmptyTables] Table ${table.table_name} (${table.id}) already occupied, skipping`);
        break;
      }

      if (outcome === "conflict") {
        localExclude.add(dealer.id);
        continue;
      }

      // Unknown result → treat as conflict
      console.warn(`[fillEmptyTables] Unknown RPC outcome '${outcome}' for table ${table.id}, dealer ${dealer.id}`);
      markFillFailure(result, "degraded", "assign_rpc", "assign_unknown_outcome", table.id);
      localExclude.add(dealer.id);
    }

    if (!assigned) {
      console.warn(
        `[fillEmptyTables] Could not assign dealer to table ${table.table_name} after 3 attempts`
      );
      slog("empty_table_fill_skipped_no_dealer", {
        table_id: table.id,
        table_name: table.table_name,
        available_only: availableOnly,
      });
    }
    } catch (e) {
      const status = classifyFillError(e);
      markFillFailure(result, status, "table_fill", `table_fill_${status}`, table.id);
      console.warn(`[fillEmptyTables] table ${table.id} errored, skipping:`, e instanceof Error ? e.message : String(e));
      slog("empty_table_fill_error", {
        table_id: table.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
