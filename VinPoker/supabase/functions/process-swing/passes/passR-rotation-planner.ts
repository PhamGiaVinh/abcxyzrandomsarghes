// ═══════════════════════════════════════════════════════════
// PASS R — Forward Rotation Scheduler (replaces Pass 1.5 + Pass 2)
//
// Phases per club tick:
//   A. Reconcile + old→new adoption — repair the schedule against reality.
//   B. Snapshot — demand (active assignments + tournament tier) and supply
//      (buildRotationSupply: candidates + fairness/eligibility timing).
//   B2. Honest OT marking — overdue tables get overtime_started_at stamped
//      (execution no longer does this implicitly via perform_swing).
//   C. Solve — solveRotationPlan pure function (R1-R6 by construction).
//   D. Persist — upsert_rotation_plan (supersede predicted, CHỐT sticky).
//   E. Announce/lock — lock_rotation_slot for due slot-0 rows + batched
//      per-tournament Telegram with pre_announce_jobs fallback.
//
// swing_due_at is NEVER written here. Shortage = honest later
// planned_relief_at, visible OT — not a due-date push.
// ═══════════════════════════════════════════════════════════

import {
  buildRotationSupply,
  CandidateSnapshotFailure,
  isCandidateSnapshotFailure,
} from "../../_shared/pickNextDealer.ts";
import { solveRotationPlan } from "../../_shared/rotationSolver.ts";
import { SWING_POLICY } from "../../_shared/swingPolicy.ts";
import {
  getFeatureTablePoolsByTable,
  getFeatureTablePoolsByTableWithStatus,
  getReservedDealerIds,
} from "../../_shared/featureTableGate.ts"; // Patch 5c/5d: planner pool gate + reserved exclusivity
import { tierForBuyIn } from "../../_shared/rotationTypes.ts";
import type {
  DealerTier,
  RotationPlanCandidate,
  RotationPlanRow,
  RotationPlanTable,
} from "../../_shared/rotationTypes.ts";
import {
  sendBatchPreAssignWithFallback,
  type PreAssignNotificationPayload,
} from "../../_shared/preAssignTelegram.ts";

const SOLVER_VERSION = "rotation-v1";
const ANNOUNCE_LEAD_MS = 3 * 60_000; // R2 hard minimum announce→entry lead

export interface PassRContext {
  clubId: string;
  clubZone: string | null;
  chatId: string | null;
  botToken: string | null;
  cycleExcludedIds: Set<string>;
  preAnnounceMinutes: number;
  minInterSwingRestMinutes: number;
  clubBreakDurationMinutes: number;
  swingDurationMinutes: number;
  tierAMinBuyin: number;
  tierBMinBuyin: number;
  requiredGameTypes: string[];
}

export interface PassRResult {
  planned: number;
  locked: number;
  adopted: number;
  reconciledCancels: number;
  shortageTables: number;
  otMarked: number;
  /** F2: dealers whose comp break was ended early this tick because supply was short. */
  earlyBreakEnds: number;
  errors: Array<{ scope: string; error: string }>;
  solverDurationMs: number;
  /** A failed candidate snapshot is never represented as an honest shortage. */
  candidateStatus?: "dependency_unavailable" | "query_failed";
  candidateErrorCode?: string;
}

interface ActiveAssignmentRow {
  id: string;
  table_id: string;
  attendance_id: string;
  assigned_at: string;
  swing_due_at: string;
  overtime_started_at: string | null;
  pre_assigned_attendance_id: string | null;
  planned_relief_at: string | null;
  version: number;
  game_tables: {
    id: string;
    table_name: string;
    tour_tier: string | null;
    game_type: string | null;
  } | null;
  dealer_attendance: {
    dealers: {
      full_name: string;
      telegram_username: string | null;
      telegram_user_id: string | number | null;
    } | null;
  } | null;
}

interface ScheduleRow {
  id: string;
  table_id: string;
  assignment_id: string | null;
  slot_index: number;
  in_attendance_id: string | null;
  out_attendance_id: string | null;
  planned_relief_at: string;
  announce_at: string | null;
  status: string;
  version: number;
}

function tourTierFallback(tourTier: string | null | undefined): DealerTier | null {
  switch ((tourTier ?? "").toUpperCase()) {
    case "HIGH": return "A";
    case "MEDIUM": return "B";
    case "LOW": return "C";
    default: return null;
  }
}

// ─── Phase B2: honest OT marking ─────────────────────────────────────────────
// Under the scheduler, perform_swing(null) no longer runs on dealer-less
// overdue tables, so overtime_started_at must be stamped explicitly. OT is
// defined as now > swing_due_at; the stamp anchors the UI's +mm:ss counter.
async function markOvertime(admin: any, rows: ActiveAssignmentRow[]): Promise<number> {
  const nowMs = Date.now();
  const overdueUnmarked = rows.filter(
    (r) => !r.overtime_started_at && new Date(r.swing_due_at).getTime() <= nowMs
  );
  let marked = 0;
  for (const r of overdueUnmarked) {
    const { error } = await admin
      .from("dealer_assignments")
      .update({ overtime_started_at: r.swing_due_at })
      .eq("id", r.id)
      .is("overtime_started_at", null);
    if (!error) marked++;
  }
  return marked;
}

// ─── Snapshot helpers ────────────────────────────────────────────────────────

async function fetchActiveAssignments(admin: any, clubId: string): Promise<ActiveAssignmentRow[]> {
  const { data, error } = await admin
    .from("dealer_assignments")
    .select(`
      id, table_id, attendance_id, assigned_at, swing_due_at, overtime_started_at,
      pre_assigned_attendance_id, planned_relief_at, version,
      game_tables!inner(id, table_name, tour_tier, game_type),
      dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))
    `)
    .eq("club_id", clubId)
    .eq("status", "assigned")
    .is("released_at", null)
    .is("swing_processed_at", null);
  if (error) {
    console.error("[Pass R] active assignments query error:", error.message);
    return [];
  }
  return (data ?? []) as ActiveAssignmentRow[];
}

async function fetchLiveScheduleRows(admin: any, clubId: string): Promise<ScheduleRow[]> {
  const { data, error } = await admin
    .from("dealer_rotation_schedule")
    .select("id, table_id, assignment_id, slot_index, in_attendance_id, out_attendance_id, planned_relief_at, announce_at, status, version")
    .eq("club_id", clubId)
    .in("status", ["predicted", "announced", "executing"]);
  if (error) {
    console.error("[Pass R] schedule query error:", error.message);
    return [];
  }
  return (data ?? []) as ScheduleRow[];
}

async function fetchTournamentInfo(
  admin: any,
  tableIds: string[],
): Promise<Map<string, { tournamentId: string; tournamentName: string | null; buyIn: number | null }>> {
  const result = new Map<string, { tournamentId: string; tournamentName: string | null; buyIn: number | null }>();
  if (tableIds.length === 0) return result;
  const { data, error } = await admin
    .from("tournament_tables")
    .select("table_id, tournament_id, tournaments(id, name, buy_in)")
    .in("table_id", tableIds);
  if (error) {
    console.warn("[Pass R] tournament join error (tour_tier fallback in effect):", error.message);
    return result;
  }
  for (const row of data ?? []) {
    const t = (row as any).tournaments;
    if (!t) continue;
    result.set((row as any).table_id, {
      tournamentId: t.id,
      tournamentName: t.name ?? null,
      buyIn: typeof t.buy_in === "number" ? t.buy_in : null,
    });
  }
  return result;
}

// ─── Phase A: reconcile announced rows + adopt legacy pre-assigns ────────────

async function reconcileAndAdopt(
  admin: any,
  ctx: PassRContext,
  assignments: ActiveAssignmentRow[],
  scheduleRows: ScheduleRow[],
  planRunId: string,
): Promise<{ adopted: number; cancelled: number }> {
  let adopted = 0;
  let cancelled = 0;
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));

  // Dealer states for every lock participant, one query.
  const lockDealerIds = new Set<string>();
  for (const s of scheduleRows) {
    if (s.status === "announced" && s.in_attendance_id) lockDealerIds.add(s.in_attendance_id);
  }
  for (const a of assignments) {
    if (a.pre_assigned_attendance_id) lockDealerIds.add(a.pre_assigned_attendance_id);
  }
  const dealerState = new Map<string, { current_state: string; status: string }>();
  if (lockDealerIds.size > 0) {
    const { data } = await admin
      .from("dealer_attendance")
      .select("id, current_state, status")
      .in("id", [...lockDealerIds]);
    for (const row of data ?? []) {
      dealerState.set(row.id, { current_state: row.current_state, status: row.status });
    }
  }

  // A1 — every announced row must still describe a real lock.
  for (const s of scheduleRows) {
    if (s.status !== "announced") continue;
    const assignment = s.assignment_id ? assignmentById.get(s.assignment_id) : undefined;
    const dealer = s.in_attendance_id ? dealerState.get(s.in_attendance_id) : undefined;
    const lockReal =
      !!assignment &&
      assignment.pre_assigned_attendance_id === s.in_attendance_id &&
      dealer?.current_state === "pre_assigned" &&
      dealer?.status !== "checked_out";
    if (!lockReal) {
      const { data } = await admin.rpc("cancel_rotation_slot", {
        p_schedule_id: s.id,
        p_reason: "reconcile_lock_lost",
      });
      // cancel_rotation_slot cleared the assignment's pre-assign fields in
      // the DB (WHERE pre_assigned_attendance_id = in_attendance_id). Mirror
      // that in the in-memory snapshot — phase C consumes this same array,
      // and a stale lockedInAttendanceId makes the solver treat the table as
      // sticky CHỐT (no slot-0 re-plan) AND drops the just-freed dealer from
      // the pool for the whole tick. Same symmetry as the A2 invalid branch.
      if (assignment && assignment.pre_assigned_attendance_id === s.in_attendance_id) {
        assignment.pre_assigned_attendance_id = null;
        assignment.planned_relief_at = null;
      }
      cancelled++;
      console.warn("[Pass R] reconcile: cancelled stale announced slot", {
        schedule_id: s.id,
        table_id: s.table_id,
        outcome: (data as any)?.outcome,
      });
    }
  }

  // A2 — adoption: legacy pre-assign without a schedule row.
  const announcedByAssignment = new Set(
    scheduleRows.filter((s) => s.status === "announced" && s.assignment_id).map((s) => s.assignment_id as string)
  );
  for (const a of assignments) {
    if (!a.pre_assigned_attendance_id || announcedByAssignment.has(a.id)) continue;
    const dealer = dealerState.get(a.pre_assigned_attendance_id);
    const valid = dealer?.current_state === "pre_assigned" && dealer?.status !== "checked_out";

    if (!valid) {
      // Invalid legacy pre-assign: clear it so phase C can re-plan this tick.
      await admin
        .from("dealer_assignments")
        .update({
          pre_assigned_attendance_id: null,
          pre_assigned_at: null,
          planned_relief_at: null,
          is_emergency_pre_assign: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", a.id)
        .eq("pre_assigned_attendance_id", a.pre_assigned_attendance_id);
      if (dealer && dealer.current_state === "pre_assigned") {
        await admin
          .from("dealer_attendance")
          .update({ current_state: "available", pre_assigned_table_id: null, pre_assigned_at: null })
          .eq("id", a.pre_assigned_attendance_id)
          .eq("current_state", "pre_assigned")
          .eq("pre_assigned_table_id", a.table_id);
      }
      a.pre_assigned_attendance_id = null;
      a.planned_relief_at = null;
      cancelled++;
      continue;
    }

    // Valid legacy pre-assign → adopt as an announced row (the lock already
    // exists; this is the adoption arm of the single-writer rule).
    const reliefIso = new Date(
      Math.max(new Date(a.swing_due_at).getTime(), Date.now() + ANNOUNCE_LEAD_MS)
    ).toISOString();
    const { error: insErr } = await admin.from("dealer_rotation_schedule").insert({
      club_id: ctx.clubId,
      table_id: a.table_id,
      assignment_id: a.id,
      slot_index: 0,
      out_attendance_id: a.attendance_id,
      in_attendance_id: a.pre_assigned_attendance_id,
      planned_relief_at: reliefIso,
      announce_at: new Date().toISOString(),
      status: "announced",
      is_shortage: false,
      is_emergency: new Date(a.swing_due_at).getTime() <= Date.now(),
      plan_run_id: planRunId,
      solver_version: "adopted-legacy",
      reason: { adopted_from: "pre_assigned_attendance_id" },
    });
    if (!insErr) {
      await admin
        .from("dealer_assignments")
        .update({ planned_relief_at: reliefIso, updated_at: new Date().toISOString() })
        .eq("id", a.id);
      a.planned_relief_at = reliefIso;
      adopted++;
    } else if (!String(insErr.message ?? "").includes("uq_rotation")) {
      console.warn("[Pass R] adoption insert failed:", insErr.message);
    }
  }

  return { adopted, cancelled };
}

// ─── Build solver inputs ─────────────────────────────────────────────────────

function buildSolverTables(
  assignments: ActiveAssignmentRow[],
  tournamentInfo: Map<string, { tournamentId: string; tournamentName: string | null; buyIn: number | null }>,
  ctx: PassRContext,
  featurePoolMap?: Map<string, Set<string>>,
): RotationPlanTable[] {
  return assignments.map((a) => {
    const tinfo = tournamentInfo.get(a.table_id);
    const requiredTier =
      tierForBuyIn(tinfo?.buyIn, ctx.tierAMinBuyin, ctx.tierBMinBuyin) ??
      tourTierFallback(a.game_tables?.tour_tier);
    // Patch 5c — feature/final pool gate: only present for special tables when the
    // kill-switch is ON (the map is empty otherwise) → ungated (null) for normal tables.
    const pool = featurePoolMap?.get(a.table_id);
    return {
      tableId: a.table_id,
      tableName: a.game_tables?.table_name ?? a.table_id,
      assignmentId: a.id,
      outAttendanceId: a.attendance_id,
      outDealerName: a.dealer_attendance?.dealers?.full_name ?? "Unknown",
      assignedAtMs: new Date(a.assigned_at).getTime(),
      swingDueAtMs: new Date(a.swing_due_at).getTime(),
      swingDurationMs: Math.max(1, ctx.swingDurationMinutes) * 60_000,
      requiredTier,
      tournamentId: tinfo?.tournamentId ?? null,
      tournamentName: tinfo?.tournamentName ?? null,
      gameTypes: a.game_tables?.game_type ? [a.game_tables.game_type] : [],
      lockedInAttendanceId: a.pre_assigned_attendance_id,
      lockedPlannedReliefAtMs: a.planned_relief_at ? new Date(a.planned_relief_at).getTime() : null,
      poolDealerIds: pool ? [...pool] : null,
    };
  });
}

function rowToJson(r: RotationPlanRow): Record<string, unknown> {
  return {
    table_id: r.tableId,
    assignment_id: r.assignmentId,
    slot_index: r.slotIndex,
    out_attendance_id: r.outAttendanceId,
    in_attendance_id: r.inAttendanceId,
    planned_relief_at: new Date(r.plannedReliefAtMs).toISOString(),
    announce_at: r.announceAtMs ? new Date(r.announceAtMs).toISOString() : null,
    is_shortage: r.isShortage,
    is_emergency: r.isEmergency,
    score: r.score,
    solver_version: SOLVER_VERSION,
    reason: { ...r.reason, in_dealer_name: r.inDealerName, required_tier: r.requiredTier, tier_matched: r.tierMatched },
  };
}

// ─── Phase E: lock due slot-0 rows + batched Telegram ────────────────────────

async function announceDueSlots(
  admin: any,
  ctx: PassRContext,
  assignments: ActiveAssignmentRow[],
  planRunId: string,
  supplyByAttendance: Map<string, RotationPlanCandidate & { telegram_username?: string | null; telegram_user_id?: string | number | null }>,
  tournamentInfo: Map<string, { tournamentId: string; tournamentName: string | null; buyIn: number | null }>,
): Promise<{ locked: number; errors: Array<{ scope: string; error: string }> }> {
  const errors: Array<{ scope: string; error: string }> = [];
  const nowIso = new Date().toISOString();

  const { data: dueRows, error } = await admin
    .from("dealer_rotation_schedule")
    .select("id, table_id, assignment_id, slot_index, in_attendance_id, planned_relief_at, announce_at, status, version, is_emergency, reason")
    .eq("club_id", ctx.clubId)
    .eq("plan_run_id", planRunId)
    .eq("slot_index", 0)
    .eq("status", "predicted")
    .not("in_attendance_id", "is", null)
    .lte("announce_at", nowIso);
  if (error) {
    errors.push({ scope: "announce_query", error: error.message });
    return { locked: 0, errors };
  }

  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  let locked = 0;
  const telegramPayloads: PreAssignNotificationPayload[] = [];

  for (const row of (dueRows ?? []) as Array<ScheduleRow & { is_emergency: boolean; reason: any }>) {
    const { data: lockResult, error: lockErr } = await admin.rpc("lock_rotation_slot", {
      p_schedule_id: row.id,
      p_schedule_version: row.version,
    });
    if (lockErr) {
      errors.push({ scope: `lock:${row.table_id}`, error: lockErr.message });
      continue;
    }
    const outcome = (lockResult as any)?.outcome;
    if (outcome !== "locked") {
      if (!["race_lost", "dealer_unavailable", "rest_guard"].includes(outcome)) {
        errors.push({ scope: `lock:${row.table_id}`, error: typeof lockResult?.detail === "string" ? lockResult.detail : `Invalid lock outcome: ${String(outcome)}` });
      }
      console.log(`[Pass R] lock_rotation_slot ${row.table_id}: ${outcome} — re-plan next tick`);
      continue;
    }

    locked++;
    ctx.cycleExcludedIds.add(row.in_attendance_id as string);

    const assignment = row.assignment_id ? assignmentById.get(row.assignment_id) : undefined;
    const inDealer = supplyByAttendance.get(row.in_attendance_id as string);
    const outDealer = assignment?.dealer_attendance?.dealers ?? null;
    const reliefAt = new Date(row.planned_relief_at);
    const minutesLeft = Math.max(0, Math.round((reliefAt.getTime() - Date.now()) / 60_000));
    const tName = assignment ? tournamentInfo.get(assignment.table_id)?.tournamentName ?? null : null;

    console.log("[Pass R] ✅ CHỐT", {
      club_id: ctx.clubId,
      table_id: row.table_id,
      assignment_id: row.assignment_id,
      in_attendance_id: row.in_attendance_id,
      in_dealer_name: inDealer?.fullName ?? (row.reason as any)?.in_dealer_name ?? "?",
      planned_relief_at: row.planned_relief_at,
      is_emergency: row.is_emergency,
    });

    if (ctx.chatId && assignment) {
      telegramPayloads.push({
        clubId: ctx.clubId,
        tableId: assignment.table_id,
        assignmentId: assignment.id,
        attendanceId: row.in_attendance_id as string,
        outAttendanceId: assignment.attendance_id,
        tableName: assignment.game_tables?.table_name ?? assignment.table_id,
        zone: ctx.clubZone,
        tournamentName: tName,
        outName: outDealer?.full_name ?? "Unknown",
        outUsername: outDealer?.telegram_username ?? null,
        outTelegramUserId: outDealer?.telegram_user_id ?? null,
        inName: inDealer?.fullName ?? (row.reason as any)?.in_dealer_name ?? "Dealer",
        inUsername: (inDealer as any)?.telegram_username ?? null,
        inTelegramUserId: (inDealer as any)?.telegram_user_id ?? null,
        swingAt: reliefAt,
        minutesLeft,
        chatId: ctx.chatId,
      });
    }
  }

  if (telegramPayloads.length > 0) {
    const sendSummary = await sendBatchPreAssignWithFallback(
      admin,
      telegramPayloads,
      ctx.botToken,
      "[Pass R]"
    );
    console.log("[Pass R] Telegram batch:", sendSummary);
  }

  return { locked, errors };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function passRRotationPlanner(
  admin: any,
  ctx: PassRContext,
): Promise<PassRResult> {
  const started = Date.now();
  const result: PassRResult = {
    planned: 0, locked: 0, adopted: 0, reconciledCancels: 0,
    shortageTables: 0, otMarked: 0, earlyBreakEnds: 0, errors: [], solverDurationMs: 0,
  };
  const planRunId = crypto.randomUUID();

  try {
    // Phase A inputs
    const [assignments, scheduleRows] = await Promise.all([
      fetchActiveAssignments(admin, ctx.clubId),
      fetchLiveScheduleRows(admin, ctx.clubId),
    ]);
    if (assignments.length === 0) {
      result.solverDurationMs = Date.now() - started;
      return result;
    }

    // Phase A — reconcile + adoption
    const { adopted, cancelled } = await reconcileAndAdopt(admin, ctx, assignments, scheduleRows, planRunId);
    result.adopted = adopted;
    result.reconciledCancels = cancelled;

    // Phase B2 — honest OT marking
    result.otMarked = await markOvertime(admin, assignments);

    // Phase B2.5 — F2 demand-driven early break end (owner 2026-07-08).
    // "khi cần người thì không cần nghỉ bù — nghỉ TỔNG 15' là đủ": when tables are
    // due (or overdue) without a live pre-assign and raw available supply is below
    // that demand, free up to `shortage` dealers whose AUTO comp break already has
    // ≥15' rest. Runs BEFORE buildRotationSupply so the freed dealers join THIS
    // tick's plan. NEVER force-releases a seated dealer. Non-fatal if the RPC isn't
    // applied yet (apply order is free).
    try {
      const horizonMs = Date.now() + Math.max(ctx.preAnnounceMinutes, 3) * 60_000;
      const demand = assignments.filter((a) =>
        !a.pre_assigned_attendance_id && new Date(a.swing_due_at).getTime() <= horizonMs
      ).length;
      if (demand > 0) {
        const { data: availData } = await admin.rpc("count_available_dealers", { p_club_id: ctx.clubId });
        const available = typeof availData === "number" ? availData : 0;
        const requestedRelease = Math.max(0, Math.min(demand - available, 20));
        if (requestedRelease > 0) {
          const { data: ended, error: endErr } = await admin.rpc("end_breaks_on_demand", {
            p_club_id: ctx.clubId,
            p_min_rest_minutes: SWING_POLICY.rest.executeMinRestFloorMinutes,
            p_max_count: requestedRelease,
          });
          if (endErr) {
            // Merge-order safety: RPC not applied yet → non-fatal, quiet one-liner.
            console.warn(`[Pass R] F2 end_breaks_on_demand unavailable; skipping (${endErr.message})`);
          } else {
            const releasedCount = (ended ?? []).length;
            result.earlyBreakEnds = releasedCount;
            if (releasedCount > 0) {
              console.log(
                `[Pass R] F2 early break end: demand=${demand} available=${available} ` +
                `requestedRelease=${requestedRelease} releasedCount=${releasedCount} — ` +
                (ended as Array<{ dealer_name: string; rested_minutes: number }>)
                  .map((b) => `${b.dealer_name}(${b.rested_minutes}p)`).join(", ")
              );
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[Pass R] F2 end_breaks_on_demand skipped (non-fatal): ${(err as Error)?.message ?? err}`);
    }

    // Phase B — snapshot
    const tournamentInfo = await fetchTournamentInfo(admin, assignments.map((a) => a.table_id));
    const supplyResult = await buildRotationSupply(admin, ctx.clubId, {
      excludeAttendanceIds: ctx.cycleExcludedIds,
      minInterSwingRestMinutes: ctx.minInterSwingRestMinutes,
      clubBreakDurationMinutes: ctx.clubBreakDurationMinutes,
      requiredGameTypes: ctx.requiredGameTypes,
    });
    if (supplyResult.status !== "ok") {
      result.candidateStatus = supplyResult.status;
      result.candidateErrorCode = supplyResult.errorCode ?? `candidate_snapshot_${supplyResult.status}`;
      result.errors.push({
        scope: "candidate_snapshot",
        error: result.candidateErrorCode,
      });
      result.solverDurationMs = Date.now() - started;
      return result;
    }
    const { supply } = supplyResult;

    const candidates: RotationPlanCandidate[] = supply.map((s) => ({
      attendanceId: s.id,
      dealerId: s.dealer_id,
      fullName: s.full_name,
      tier: s.tier,
      skills: s.skills,
      prevSessionMinutes: s.prev_session_minutes,
      eligibleAtMs: s.eligible_at_ms,
      score: s.score ?? 0,
    }));
    const supplyByAttendance = new Map(
      supply.map((s) => [s.id, {
        attendanceId: s.id, dealerId: s.dealer_id, fullName: s.full_name, tier: s.tier,
        skills: s.skills, prevSessionMinutes: s.prev_session_minutes,
        eligibleAtMs: s.eligible_at_ms, score: s.score ?? 0,
        telegram_username: s.telegram_username ?? null,
        telegram_user_id: s.telegram_user_id ?? null,
      }])
    );

    // Phase C — solve (pure). Patch 5c: gate the planner to each special table's pool
    // (parity with pickNextDealer's reactive gate) so it never announces a non-pool
    // dealer that the seat trigger would reject (DT006) → stuck table.
    const featurePoolSnapshot = await getFeatureTablePoolsByTableWithStatus(
      admin,
      assignments.map((a) => a.table_id),
    );
    if (featurePoolSnapshot.status !== "ok") {
      result.candidateStatus = featurePoolSnapshot.status;
      result.candidateErrorCode = featurePoolSnapshot.errorCode
        ?? `feature_table_pools_${featurePoolSnapshot.status}`;
      result.errors.push({ scope: "feature_table_pools", error: result.candidateErrorCode });
      result.solverDurationMs = Date.now() - started;
      return result;
    }
    const featurePoolMap = featurePoolSnapshot.pools;
    // Patch 5d — reserved feature/final pool dealers are excluded from NORMAL tables.
    let reservedDealerIds: string[];
    try {
      reservedDealerIds = [...await getReservedDealerIds(admin)];
    } catch {
      result.candidateStatus = "query_failed";
      result.candidateErrorCode = "reserved_dealers_query_failed";
      result.errors.push({ scope: "reserved_dealers", error: result.candidateErrorCode });
      result.solverDurationMs = Date.now() - started;
      return result;
    }
    const plan = solveRotationPlan(
      buildSolverTables(assignments, tournamentInfo, ctx, featurePoolMap),
      candidates,
      {
        nowMs: Date.now(),
        announceLeadMs: ANNOUNCE_LEAD_MS,
        preAnnounceMs: Math.max(ctx.preAnnounceMinutes, 3) * 60_000,
        restMs: Math.max(ctx.minInterSwingRestMinutes, SWING_POLICY.rest.executeMinRestFloorMinutes) * 60_000,
        forecastSlots: 2,
        reservedDealerIds,
        solverVersion: SOLVER_VERSION,
      },
    );
    result.planned = plan.rows.length;
    result.shortageTables = plan.rows.filter((r) => r.slotIndex === 0 && r.isShortage).length;

    // Phase D — persist
    const { data: upsertResult, error: upsertErr } = await admin.rpc("upsert_rotation_plan", {
      p_club_id: ctx.clubId,
      p_plan_run_id: planRunId,
      p_rows: plan.rows.map(rowToJson),
    });
    if (upsertErr || (upsertResult as any)?.outcome !== "ok") {
      result.errors.push({
        scope: "upsert_rotation_plan",
        error: upsertErr?.message ?? JSON.stringify(upsertResult),
      });
      result.solverDurationMs = Date.now() - started;
      return result;
    }

    // Phase E — announce/lock + Telegram
    const announce = await announceDueSlots(
      admin, ctx, assignments, planRunId, supplyByAttendance, tournamentInfo,
    );
    result.locked = announce.locked;
    result.errors.push(...announce.errors);

    result.solverDurationMs = Date.now() - started;
    console.log(
      `[Pass R] ✅ planned=${result.planned} locked=${result.locked} adopted=${result.adopted} ` +
      `reconciled=${result.reconciledCancels} shortage=${result.shortageTables} ` +
      `otMarked=${result.otMarked} earlyBreakEnds=${result.earlyBreakEnds} durationMs=${result.solverDurationMs}`
    );
    return result;
  } catch (err: any) {
    result.errors.push({ scope: "passR", error: err?.message ?? String(err) });
    result.solverDurationMs = Date.now() - started;
    console.error("[Pass R] ❌ fatal:", err?.message ?? err);
    return result;
  }
}

// ─── replanSingleTable — same-tick recovery for Pass 3 failures ──────────────
// Used when an announced lock turns out to be dead at execution time
// (preflight invalid, no-show, race_lost). Cancels the dead slot, then plans
// and LOCKS a replacement immediately with the 3-minute emergency lead.
// swing_due_at is never touched.
export async function replanSingleTable(
  admin: any,
  ctx: PassRContext,
  assignmentId: string,
  excludeAttendanceIds: Set<string>,
  cancelReason: string,
): Promise<{ relocked: boolean; detail: string }> {
  try {
    // 1. Cancel any live slot-0 row for this assignment (clears the dead lock).
    const { data: liveSlots } = await admin
      .from("dealer_rotation_schedule")
      .select("id, status")
      .eq("assignment_id", assignmentId)
      .in("status", ["predicted", "announced", "executing"]);
    for (const slot of liveSlots ?? []) {
      await admin.rpc("cancel_rotation_slot", { p_schedule_id: slot.id, p_reason: cancelReason });
    }

    // Defensive: clear legacy pre-assign fields even without a schedule row.
    const { data: a } = await admin
      .from("dealer_assignments")
      .select(`
        id, table_id, attendance_id, assigned_at, swing_due_at, version,
        pre_assigned_attendance_id, status, released_at, swing_processed_at,
        game_tables!inner(id, table_name, tour_tier, game_type),
        dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))
      `)
      .eq("id", assignmentId)
      .maybeSingle();
    if (!a || a.status !== "assigned" || a.released_at || a.swing_processed_at) {
      return { relocked: false, detail: "assignment_no_longer_active" };
    }
    if (a.pre_assigned_attendance_id) {
      await admin
        .from("dealer_assignments")
        .update({
          pre_assigned_attendance_id: null,
          pre_assigned_at: null,
          planned_relief_at: null,
          is_emergency_pre_assign: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", assignmentId);
    }

    // 2. Pick the replacement with full planner semantics (single-table solve).
    const supplyResult = await buildRotationSupply(admin, ctx.clubId, {
      excludeAttendanceIds,
      minInterSwingRestMinutes: ctx.minInterSwingRestMinutes,
      clubBreakDurationMinutes: ctx.clubBreakDurationMinutes,
      requiredGameTypes: ctx.requiredGameTypes,
    });
    if (supplyResult.status !== "ok") {
      throw new CandidateSnapshotFailure(
        supplyResult.status,
        supplyResult.errorCode ?? `candidate_snapshot_${supplyResult.status}`,
      );
    }
    const { supply } = supplyResult;
    const candidates: RotationPlanCandidate[] = supply
      .filter((s) => !excludeAttendanceIds.has(s.id))
      .map((s) => ({
        attendanceId: s.id, dealerId: s.dealer_id, fullName: s.full_name, tier: s.tier,
        skills: s.skills, prevSessionMinutes: s.prev_session_minutes,
        eligibleAtMs: s.eligible_at_ms, score: s.score ?? 0,
      }));

    const tournamentInfo = await fetchTournamentInfo(admin, [a.table_id]);
    const featurePoolMap = await getFeatureTablePoolsByTable(admin, [a.table_id]); // Patch 5c
    const reservedDealerIds = [...await getReservedDealerIds(admin)]; // Patch 5d
    const plan = solveRotationPlan(
      buildSolverTables([a as ActiveAssignmentRow], tournamentInfo, ctx, featurePoolMap),
      candidates,
      {
        nowMs: Date.now(),
        announceLeadMs: ANNOUNCE_LEAD_MS,
        preAnnounceMs: ANNOUNCE_LEAD_MS, // emergency: 3-min lead
        restMs: Math.max(ctx.minInterSwingRestMinutes, SWING_POLICY.rest.executeMinRestFloorMinutes) * 60_000,
        forecastSlots: 0,
        reservedDealerIds,
        solverVersion: SOLVER_VERSION,
      },
    );
    const slot0 = plan.rows.find((r) => r.slotIndex === 0);
    if (!slot0) return { relocked: false, detail: "no_plan_row" };

    const planRunId = crypto.randomUUID();
    const { data: upsertResult, error: upsertErr } = await admin.rpc("upsert_rotation_plan", {
      p_club_id: ctx.clubId,
      p_plan_run_id: planRunId,
      p_rows: [rowToJson(slot0)],
      p_table_ids: [a.table_id],
    });
    if (upsertErr || (upsertResult as any)?.outcome !== "ok") {
      return { relocked: false, detail: `upsert_failed: ${upsertErr?.message ?? "?"}` };
    }

    if (!slot0.inAttendanceId) {
      // Honest shortage: predicted row persisted, no lock possible yet.
      return { relocked: false, detail: "shortage_predicted_only" };
    }

    const supplyByAttendance = new Map(
      supply.map((s) => [s.id, {
        attendanceId: s.id, dealerId: s.dealer_id, fullName: s.full_name, tier: s.tier,
        skills: s.skills, prevSessionMinutes: s.prev_session_minutes,
        eligibleAtMs: s.eligible_at_ms, score: s.score ?? 0,
        telegram_username: s.telegram_username ?? null,
        telegram_user_id: s.telegram_user_id ?? null,
      }])
    );
    const announce = await announceDueSlots(
      admin, ctx, [a as ActiveAssignmentRow], planRunId, supplyByAttendance, tournamentInfo,
    );
    return announce.locked > 0
      ? { relocked: true, detail: `relocked:${slot0.inDealerName ?? slot0.inAttendanceId}` }
      : { relocked: false, detail: "lock_pending_announce_time" };
  } catch (err: any) {
    if (isCandidateSnapshotFailure(err)) throw err;
    return { relocked: false, detail: `error: ${err?.message ?? String(err)}` };
  }
}
