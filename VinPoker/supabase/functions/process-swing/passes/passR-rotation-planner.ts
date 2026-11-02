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
  table_session_id: string | null;
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
      id, table_id, table_session_id, attendance_id, assigned_at, swing_due_at, overtime_started_at,
      pre_assigned_attendance_id, planned_relief_at, version,
      game_tables!inner(id, table_name, tour_tier, game_type),
      dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))
    `)
    .eq("club_id", clubId)
    .eq("status", "assigned")
    .is("released_at", null)
    .is("swing_processed_at", null);
  if (error || !Array.isArray(data)) throw new Error("rotation_assignment_snapshot_unavailable");
  return data as ActiveAssignmentRow[];
}

async function fetchLiveScheduleRows(admin: any, clubId: string): Promise<ScheduleRow[]> {
  const { data, error } = await admin
    .from("dealer_rotation_schedule")
    .select("id, table_id, assignment_id, slot_index, in_attendance_id, out_attendance_id, planned_relief_at, announce_at, status, version")
    .eq("club_id", clubId)
    .in("status", ["predicted", "announced", "executing"]);
  if (error || !Array.isArray(data)) throw new Error("rotation_schedule_snapshot_unavailable");
  return data as ScheduleRow[];
}

async function fetchTournamentInfo(
  admin: any,
  clubId: string,
  assignments: Pick<ActiveAssignmentRow, "table_id" | "table_session_id">[],
): Promise<{
  tournamentInfo: Map<string, { tournamentId: string; tournamentName: string | null; buyIn: number | null }>;
  rejectedTables: Map<string, string>;
}> {
  const result = new Map<string, { tournamentId: string; tournamentName: string | null; buyIn: number | null }>();
  const rejectedTables = new Map<string, string>();
  const snapshot = { tournamentInfo: result, rejectedTables };
  for (const a of assignments) {
    if (!a.table_session_id) rejectedTables.set(a.table_id, "rotation_assignment_session_missing");
    else if (assignments.filter((other) => other.table_id === a.table_id
      || other.table_session_id === a.table_session_id).length !== 1) {
      rejectedTables.set(a.table_id, "rotation_assignment_session_ambiguous");
    }
  }
  const sessionIds = [...new Set(assignments.filter((a) => !rejectedTables.has(a.table_id)).map((a) => a.table_session_id))];
  if (sessionIds.length === 0) return snapshot;
  const { data: sessions, error: sessionError } = await admin
    .from("table_sessions")
    .select("id, club_id, game_table_id, tournament_id, session_type, closed_at")
    .eq("club_id", clubId)
    .in("id", sessionIds);
  if (sessionError || !Array.isArray(sessions)) throw new Error("rotation_session_snapshot_unavailable");
  const { data, error } = await admin
    .from("tournament_tables")
    .select("id, table_id, game_table_id, table_session_id, status, tournament_id, tournaments!inner(id, club_id, name, buy_in)")
    .eq("tournaments.club_id", clubId)
    .eq("status", "active")
    .in("table_session_id", sessionIds);
  if (error || !Array.isArray(data)) throw new Error("rotation_tournament_snapshot_unavailable");
  for (const assignment of assignments) {
    if (rejectedTables.has(assignment.table_id)) continue;
    const matchingSessions = (sessions ?? []).filter((s: any) => s.id === assignment.table_session_id);
    const session = matchingSessions[0];
    if (matchingSessions.length !== 1 || session.club_id !== clubId
      || session.game_table_id !== assignment.table_id || session.closed_at != null) {
      rejectedTables.set(assignment.table_id, "rotation_assignment_session_invalid");
      continue;
    }
    if ((session.session_type === "cash" || session.session_type === "vip") && !session.tournament_id) continue;
    if (session.session_type !== "tournament" || !session.tournament_id) {
      rejectedTables.set(assignment.table_id, "rotation_session_type_invalid");
      continue;
    }
    const matches = (data ?? []).filter((row: any) => row.table_session_id === session.id);
    const row = matches[0];
    const t = row?.tournaments;
    if (matches.length !== 1 || row.status !== "active" || row.game_table_id !== assignment.table_id
      || (row.table_id && row.table_id !== row.game_table_id)
      || row.tournament_id !== session.tournament_id || !t || t.id !== row.tournament_id || t.club_id !== clubId) {
      rejectedTables.set(assignment.table_id, "rotation_tournament_mapping_invalid");
      continue;
    }
    result.set(assignment.table_id, {
      tournamentId: t.id,
      tournamentName: t.name ?? null,
      buyIn: typeof t.buy_in === "number" ? t.buy_in : null,
    });
  }
  return snapshot;
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
    const { data, error } = await admin
      .from("dealer_attendance")
      .select("id, current_state, status")
      .in("id", [...lockDealerIds]);
    if (error || !Array.isArray(data)) throw new Error("rotation_lock_dealer_snapshot_unavailable");
    for (const row of data) {
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
      const { data, error } = await admin.rpc("cancel_rotation_slot", {
        p_schedule_id: s.id,
        p_reason: "reconcile_lock_lost",
      });
      if (error || data?.outcome !== "cancelled" || data?.schedule_id !== s.id) {
        throw new Error("rotation_cancel_unverified");
      }
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
      // One server transaction owns both assignment and attendance changes.
      const { data: cleared, error: clearError } = await admin.rpc("worker_clear_legacy_preassignment_v1", {
        p_club_id: ctx.clubId, p_table_id: a.table_id, p_table_session_id: a.table_session_id,
        p_assignment_id: a.id, p_expected_version: a.version,
        p_incoming_attendance_id: a.pre_assigned_attendance_id,
      });
      if (clearError || cleared?.outcome !== "cleared" || cleared?.club_id !== ctx.clubId
        || cleared?.table_id !== a.table_id || cleared?.table_session_id !== a.table_session_id
        || cleared?.assignment_id !== a.id || cleared?.expected_version !== a.version
        || cleared?.incoming_attendance_id !== a.pre_assigned_attendance_id) {
        throw new Error("rotation_legacy_cleanup_unverified");
      }
      a.pre_assigned_attendance_id = null;
      a.planned_relief_at = null;
      cancelled++;
      continue;
    }

    // Valid legacy pre-assign → adopt as an announced row (the lock already
    // exists; this is the adoption arm of the single-writer rule).
    const { data: adoption, error: adoptionError } = await admin.rpc("worker_adopt_legacy_preassignment_v1", {
      p_club_id: ctx.clubId, p_table_id: a.table_id, p_table_session_id: a.table_session_id,
      p_assignment_id: a.id, p_expected_version: a.version,
      p_incoming_attendance_id: a.pre_assigned_attendance_id, p_plan_run_id: planRunId,
    });
    if (adoptionError || !["adopted", "already_adopted"].includes(adoption?.outcome)
      || adoption?.club_id !== ctx.clubId || adoption?.table_id !== a.table_id
      || adoption?.table_session_id !== a.table_session_id || adoption?.assignment_id !== a.id
      || adoption?.expected_version !== a.version || adoption?.incoming_attendance_id !== a.pre_assigned_attendance_id
      || typeof adoption?.schedule_id !== "string" || adoption.schedule_id.length === 0
      || typeof adoption?.planned_relief_at !== "string" || !Number.isFinite(Date.parse(adoption.planned_relief_at))) {
      throw new Error("rotation_legacy_adoption_unverified");
    }
    a.planned_relief_at = adoption.planned_relief_at;
    if (adoption.outcome === "adopted") adopted++;
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
  supplyByAttendance: Map<string, RotationPlanCandidate & { telegram_username?: string | null; telegram_user_id?: string | number | null }>,
  tournamentInfo: Map<string, { tournamentId: string; tournamentName: string | null; buyIn: number | null }>,
): Promise<{ locked: number; errors: Array<{ scope: string; error: string }> }> {
  const errors: Array<{ scope: string; error: string }> = [];
  const nowIso = new Date().toISOString();

  const { data: dueRows, error } = await admin
    .from("dealer_rotation_schedule")
    .select("id, table_id, assignment_id, slot_index, in_attendance_id, planned_relief_at, announce_at, status, version, is_emergency, reason")
    .eq("club_id", ctx.clubId)
    // Set-diff persist retains run IDs for unchanged predictions. Current
    // verified table/assignment scope, not the newest run ID, controls locking.
    .in("table_id", assignments.map((a) => a.table_id))
    .eq("slot_index", 0)
    .eq("status", "predicted")
    .not("in_attendance_id", "is", null)
    .lte("announce_at", nowIso);
  if (error || !Array.isArray(dueRows)) {
    errors.push({ scope: "announce_query", error: error?.message ?? "rotation_announce_snapshot_unavailable" });
    return { locked: 0, errors };
  }

  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  let locked = 0;
  const telegramPayloads: PreAssignNotificationPayload[] = [];

  for (const row of (dueRows ?? []) as Array<ScheduleRow & { is_emergency: boolean; reason: any }>) {
    const assignment = row.assignment_id ? assignmentById.get(row.assignment_id) : undefined;
    if (!assignment || assignment.table_id !== row.table_id) {
      errors.push({ scope: `lock:${row.table_id}`, error: "rotation_schedule_assignment_changed" });
      continue;
    }
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
        errors.push({ scope: `lock:${row.table_id}`, error: outcome === "error" ? "Rotation lock returned error" : "Invalid rotation lock response" });
      }
      console.log(`[Pass R] lock_rotation_slot ${row.table_id}: ${outcome} — re-plan next tick`);
      continue;
    }

    locked++;
    ctx.cycleExcludedIds.add(row.in_attendance_id as string);

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
    const [assignmentSnapshot, scheduleRows] = await Promise.all([
      fetchActiveAssignments(admin, ctx.clubId),
      fetchLiveScheduleRows(admin, ctx.clubId),
    ]);
    if (assignmentSnapshot.length === 0) {
      result.solverDurationMs = Date.now() - started;
      return result;
    }

    // Validate the whole snapshot before reconciliation, OT or rest-state writes.
    const { tournamentInfo, rejectedTables } = await fetchTournamentInfo(admin, ctx.clubId, assignmentSnapshot);
    for (const [tableId, error] of rejectedTables) result.errors.push({ scope: `table:${tableId}`, error });
    const assignments = assignmentSnapshot.filter((a) => !rejectedTables.has(a.table_id));
    if (assignments.length === 0) {
      result.solverDurationMs = Date.now() - started;
      return result;
    }
    const validTableIds = new Set(assignments.map((a) => a.table_id));
    const excludedAttendanceIds = new Set(ctx.cycleExcludedIds);
    for (const a of assignmentSnapshot) {
      if (!rejectedTables.has(a.table_id)) continue;
      excludedAttendanceIds.add(a.attendance_id);
      if (a.pre_assigned_attendance_id) excludedAttendanceIds.add(a.pre_assigned_attendance_id);
    }

    // Phase A — reconcile + adoption
    const { adopted, cancelled } = await reconcileAndAdopt(
      admin, ctx, assignments, scheduleRows.filter((row) => validTableIds.has(row.table_id)), planRunId,
    );
    result.adopted = adopted;
    result.reconciledCancels = cancelled;

    // Phase B2 — honest OT marking
    result.otMarked = await markOvertime(admin, assignments);

    // Phase B2.5 — F2 demand-driven early break end (owner 2026-07-08).
    // "khi cần người thì không cần nghỉ bù — nghỉ TỔNG 15' là đủ": when tables are
    // due (or overdue) without a live pre-assign and raw available supply is below
    // that demand, free up to `shortage` dealers whose AUTO comp break already has
    // ≥15' rest. Runs BEFORE buildRotationSupply so the freed dealers join THIS
    // tick's plan. NEVER force-releases a seated dealer. A failed supply read is
    // not zero supply; optional release failures remain visible in dispatch.
    try {
      const horizonMs = Date.now() + Math.max(ctx.preAnnounceMinutes, 3) * 60_000;
      const demand = assignments.filter((a) =>
        !a.pre_assigned_attendance_id && new Date(a.swing_due_at).getTime() <= horizonMs
      ).length;
      if (demand > 0) {
        const { data: availData, error: availError } = await admin.rpc("count_available_dealers", { p_club_id: ctx.clubId });
        if (availError || typeof availData !== "number" || !Number.isInteger(availData) || availData < 0) {
          result.errors.push({ scope: "early_break_supply", error: "rotation_available_count_unverified" });
        } else {
        const available = availData;
        const requestedRelease = Math.max(0, Math.min(demand - available, 20));
        if (requestedRelease > 0) {
          const { data: ended, error: endErr } = await admin.rpc("end_breaks_on_demand", {
            p_club_id: ctx.clubId,
            p_min_rest_minutes: SWING_POLICY.rest.executeMinRestFloorMinutes,
            p_max_count: requestedRelease,
          });
          if (endErr) {
            result.errors.push({ scope: "early_break_release", error: "rotation_early_break_release_unavailable" });
            // Planning may continue, but the dispatch must not report all-green.
            console.warn(`[Pass R] F2 end_breaks_on_demand unavailable; skipping (${endErr.message})`);
          } else if (!Array.isArray(ended)) {
            result.errors.push({ scope: "early_break_release", error: "rotation_early_break_result_unverified" });
          } else {
            const releasedCount = ended.length;
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
      }
    } catch (err) {
      result.errors.push({ scope: "early_break_supply", error: "rotation_early_break_unavailable" });
      console.warn(`[Pass R] F2 end_breaks_on_demand skipped (non-fatal): ${(err as Error)?.message ?? err}`);
    }

    // Phase B — snapshot
    const supplyResult = await buildRotationSupply(admin, ctx.clubId, {
      excludeAttendanceIds: excludedAttendanceIds,
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

    // Phase D — persist. The solver deliberately omits sticky locked slot0.
    // Forecast rows still need an exact assignment/session anchor for the DB
    // fence. Refetch schedule after reconciliation (legacy adoption can create
    // it), but never substitute a newer assignment for the solver's snapshot.
    const persistRows = plan.rows.map(rowToJson);
    if (assignments.some((a) => a.pre_assigned_attendance_id)) {
      const currentLocks = await fetchLiveScheduleRows(admin, ctx.clubId);
      for (const a of assignments) {
        if (!a.pre_assigned_attendance_id) continue;
        const locks = currentLocks.filter((s) => s.table_id === a.table_id && s.slot_index === 0);
        const locked = locks[0];
        if (locks.length !== 1 || locked.status !== "announced" || locked.assignment_id !== a.id
          || locked.in_attendance_id !== a.pre_assigned_attendance_id
          || locked.out_attendance_id !== a.attendance_id || !a.table_session_id
          || Date.parse(locked.planned_relief_at) !== Date.parse(a.planned_relief_at ?? "")
          || !Number.isInteger(locked.version)) {
          validTableIds.delete(a.table_id);
          result.errors.push({ scope: `table:${a.table_id}`, error: "rotation_locked_anchor_unverified" });
          continue;
        }
        persistRows.push({
          table_id: a.table_id, table_session_id: a.table_session_id,
          assignment_id: a.id, slot_index: 0,
          out_attendance_id: a.attendance_id, in_attendance_id: a.pre_assigned_attendance_id,
          planned_relief_at: locked.planned_relief_at, announce_at: locked.announce_at,
          locked_anchor: true, locked_schedule_id: locked.id, locked_schedule_version: locked.version,
          is_shortage: false, is_emergency: false, solver_version: SOLVER_VERSION,
        });
      }
    }
    const { data: upsertResult, error: upsertErr } = await admin.rpc("upsert_rotation_plan", {
      p_club_id: ctx.clubId,
      p_plan_run_id: planRunId,
      p_rows: persistRows.filter((r) => validTableIds.has(r.table_id as string)),
      p_table_ids: [...validTableIds],
    });
    if (upsertErr || (upsertResult as any)?.outcome !== "ok") {
      result.errors.push({
        scope: "upsert_rotation_plan",
        error: upsertErr?.message ?? JSON.stringify(upsertResult),
      });
      result.solverDurationMs = Date.now() - started;
      return result;
    }

    const rejectedScope = (upsertResult as { rejected_table_ids?: unknown }).rejected_table_ids;
    if (rejectedScope !== undefined && (!Array.isArray(rejectedScope)
      || rejectedScope.some((id: unknown) => typeof id !== "string"))) {
      result.errors.push({ scope: "upsert_rotation_plan", error: "rotation_persist_receipt_invalid" });
      result.solverDurationMs = Date.now() - started;
      return result;
    }
    const commitRejectedTables = new Set<string>(rejectedScope ?? []);
    for (const tableId of commitRejectedTables) {
      result.errors.push({ scope: `table:${tableId}`, error: "rotation_persist_session_rejected" });
    }
    // Phase E — announce only tables admitted by the commit-time session fence.
    const announce = await announceDueSlots(
      admin, ctx, assignments.filter((a) => validTableIds.has(a.table_id) && !commitRejectedTables.has(a.table_id)), supplyByAttendance, tournamentInfo,
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
    const { data: liveSlots, error: liveSlotsError } = await admin
      .from("dealer_rotation_schedule")
      .select("id, status")
      .eq("assignment_id", assignmentId)
      .eq("club_id", ctx.clubId)
      .in("status", ["predicted", "announced", "executing"]);
    if (liveSlotsError || !Array.isArray(liveSlots)) throw new Error("rotation_schedule_snapshot_unavailable");

    // Defensive: clear legacy pre-assign fields even without a schedule row.
    const { data: a, error: assignmentError } = await admin
      .from("dealer_assignments")
      .select(`
        id, table_id, table_session_id, attendance_id, assigned_at, swing_due_at, version,
        pre_assigned_attendance_id, status, released_at, swing_processed_at,
        game_tables!inner(id, table_name, tour_tier, game_type),
        dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))
      `)
      .eq("id", assignmentId)
      .eq("club_id", ctx.clubId)
      .maybeSingle();
    if (assignmentError) throw new Error("rotation_assignment_snapshot_unavailable");
    if (!a || a.status !== "assigned" || a.released_at || a.swing_processed_at) {
      return { relocked: false, detail: "assignment_no_longer_active" };
    }
    const { tournamentInfo, rejectedTables } = await fetchTournamentInfo(admin, ctx.clubId, [a]);
    if (rejectedTables.size) throw new CandidateSnapshotFailure("query_failed", "rotation_emergency_replan_unverified");
    if (liveSlots.length > 0 || a.pre_assigned_attendance_id) {
      const scheduleIds = liveSlots.map((slot: { id: string }) => slot.id).sort();
      const { data: prepared, error: prepareError } = await admin.rpc("worker_prepare_emergency_replan_v1", {
        p_club_id: ctx.clubId, p_table_id: a.table_id, p_table_session_id: a.table_session_id,
        p_assignment_id: a.id, p_expected_version: a.version,
        p_incoming_attendance_id: a.pre_assigned_attendance_id, p_schedule_ids: scheduleIds,
        p_cancel_reason: cancelReason,
      });
      if (prepareError || prepared?.outcome !== "prepared" || prepared?.club_id !== ctx.clubId
        || prepared?.table_id !== a.table_id || prepared?.table_session_id !== a.table_session_id
        || prepared?.assignment_id !== a.id || prepared?.expected_version !== a.version
        || prepared?.incoming_attendance_id !== a.pre_assigned_attendance_id
        || !Array.isArray(prepared?.schedule_ids) || prepared.schedule_ids.length !== scheduleIds.length
        || !prepared.schedule_ids.every((id: unknown, i: number) => id === scheduleIds[i])
        || prepared?.cancelled_count !== scheduleIds.length
        || !Number.isInteger(prepared?.assignment_version) || prepared.assignment_version < a.version) {
        throw new Error("rotation_emergency_prepare_unverified");
      }
      a.version = prepared.assignment_version;
      a.pre_assigned_attendance_id = null;
      a.planned_relief_at = null;
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
      throw new CandidateSnapshotFailure("query_failed", "rotation_emergency_persist_unverified");
    }
    const rejectedScope = (upsertResult as { rejected_table_ids?: unknown }).rejected_table_ids;
    if (rejectedScope !== undefined && (!Array.isArray(rejectedScope)
      || rejectedScope.some((id: unknown) => typeof id !== "string"))) {
      throw new CandidateSnapshotFailure("query_failed", "rotation_persist_receipt_invalid");
    }
    if (rejectedScope?.includes(a.table_id)) {
      throw new CandidateSnapshotFailure("query_failed", "rotation_persist_session_rejected");
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
      admin, ctx, [a as ActiveAssignmentRow], supplyByAttendance, tournamentInfo,
    );
    if (announce.errors.length > 0) {
      throw new CandidateSnapshotFailure("query_failed", "rotation_emergency_announce_unverified");
    }
    return announce.locked > 0
      ? { relocked: true, detail: `relocked:${slot0.inDealerName ?? slot0.inAttendanceId}` }
      : { relocked: false, detail: "lock_pending_announce_time" };
  } catch (err: any) {
    if (isCandidateSnapshotFailure(err)) throw err;
    // The dispatch already aborts/degrades on this typed failure. Returning an
    // ordinary no-replacement outcome would permit false shortage/OT alerts.
    throw new CandidateSnapshotFailure("query_failed", "rotation_emergency_replan_unverified");
  }
}
