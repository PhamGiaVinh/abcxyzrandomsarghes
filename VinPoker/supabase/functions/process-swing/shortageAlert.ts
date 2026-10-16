import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildRotationSupply,
  type PickDiagnostics,
  type RotationSupplyEntry,
} from "../_shared/pickNextDealer.ts";
import {
  getFeatureTablePoolsByTableWithStatus,
  getReservedDealerIds,
} from "../_shared/featureTableGate.ts";
import { classifyPostgrestError } from "../_shared/postgrestError.ts";
import { solveRotationPlan } from "../_shared/rotationSolver.ts";
import { type DealerTier, type RotationPlanCandidate, type RotationPlanTable } from "../_shared/rotationTypes.ts";
import { SWING_POLICY } from "../_shared/swingPolicy.ts";
import { sendTelegramNotification } from "../_shared/telegram.ts";
import { getDealerOperationalTables } from "../_shared/dealerOperationalTables.ts";

export type ShortageSnapshotStatus = "ok" | "dependency_unavailable" | "query_failed";
export type ShortageClassification =
  | "healthy"
  | "temporary_wait"
  | "reserved_relief_pending"
  | "true_shortage"
  | "critical_shortage"
  | "snapshot_invalid";

export const DEALER_SHORTAGE_ALERT_POLICY = {
  cooldownSeconds: 10 * 60,
  resolutionDebounceSeconds: 2 * 60,
  pendingReliefSlaMinutes: 15,
  criticalOverdueTables: 3,
  criticalOverdueMinutes: 15,
  snapshotMaxBytes: 8_000,
  incidentKey: "dealer_shortage_v1",
  solverVersion: "dealer-shortage-alert-v1",
} as const;

export interface CanonicalShortageSnapshot {
  status: ShortageSnapshotStatus;
  error_code: string | null;
  captured_at: string;
  active_staffed_tables: number;
  active_empty_tables: number;
  tables_due_for_relief: number;
  tables_overdue_for_relief: number;
  tables_without_replacement_total: number;
  replacement_held_tables: number;
  checked_in_active_dealers: number;
  genuinely_available_dealers: number;
  eligible_for_any_uncovered_table_total: number;
  on_break_not_ready_dealers: number;
  on_break_ready_dealers: number;
  pre_assigned_dealers: number;
  reserved_dealers: number;
  active_meal_break_dealers: number;
  feature_reserved_dealers: number;
  pending_durable_mass_open_targets: number;
  excluded_dealers: {
    busy: number;
    fatigue: number;
    rest: number;
    game_type: number;
    tier: number;
    meal_break: number;
  };
}

export interface ShortageAlertFailure {
  status: Exclude<ShortageSnapshotStatus, "ok">;
  stage: string;
  errorCode: string;
}

export interface ShortageAlertOutcome {
  snapshot: CanonicalShortageSnapshot;
  classification: ShortageClassification;
  notification: "none" | "opened" | "reminder" | "escalated" | "resolved" | "failed";
  failure: ShortageAlertFailure | null;
}

export interface ShortageAlertDecision {
  classification: ShortageClassification;
  notifyEnabled: boolean;
  failure: ShortageAlertFailure | null;
}

interface TableRow {
  id: string;
  table_name: string | null;
  game_type: string | null;
  tour_tier: string | null;
}

interface AssignmentRow {
  id: string;
  table_id: string;
  table_session_id: string | null;
  club_id: string;
  attendance_id: string | null;
  pre_assigned_attendance_id: string | null;
  status: string;
  assigned_at: string | null;
  swing_due_at: string | null;
  overtime_started_at: string | null;
  released_at: string | null;
}

interface AttendanceRow {
  id: string;
  dealer_id: string;
  current_state: string;
  status: string;
  check_out_time: string | null;
  check_in_time: string | null;
  last_released_at: string | null;
}

interface BreakRow {
  attendance_id: string | null;
  break_start: string;
}

function snapshotFailure(stage: string, error: unknown): CanonicalShortageSnapshot {
  const failure = classifyPostgrestError(error);
  return emptySnapshot(
    failure.status,
    `shortage_snapshot_${stage}_${failure.status}`,
  );
}

function emptySnapshot(
  status: ShortageSnapshotStatus,
  errorCode: string | null,
): CanonicalShortageSnapshot {
  return {
    status,
    error_code: errorCode,
    captured_at: new Date().toISOString(),
    active_staffed_tables: 0,
    active_empty_tables: 0,
    tables_due_for_relief: 0,
    tables_overdue_for_relief: 0,
    tables_without_replacement_total: 0,
    replacement_held_tables: 0,
    checked_in_active_dealers: 0,
    genuinely_available_dealers: 0,
    eligible_for_any_uncovered_table_total: 0,
    on_break_not_ready_dealers: 0,
    on_break_ready_dealers: 0,
    pre_assigned_dealers: 0,
    reserved_dealers: 0,
    active_meal_break_dealers: 0,
    feature_reserved_dealers: 0,
    pending_durable_mass_open_targets: 0,
    excluded_dealers: {
      busy: 0,
      fatigue: 0,
      rest: 0,
      game_type: 0,
      tier: 0,
      meal_break: 0,
    },
  };
}

export function dedupeActiveAttendance(rows: AttendanceRow[]): AttendanceRow[] {
  const latest = new Map<string, AttendanceRow>();
  for (const row of rows) {
    if (row.status !== "checked_in" || row.check_out_time !== null) continue;
    const previous = latest.get(row.dealer_id);
    if (!previous) {
      latest.set(row.dealer_id, row);
      continue;
    }
    const previousMs = Date.parse(previous.check_in_time ?? "") || 0;
    const rowMs = Date.parse(row.check_in_time ?? "") || 0;
    if (rowMs > previousMs || (rowMs === previousMs && row.id > previous.id)) {
      latest.set(row.dealer_id, row);
    }
  }
  return [...latest.values()];
}

function tierForTable(tier: string | null): DealerTier | null {
  switch ((tier ?? "").toUpperCase()) {
    case "HIGH": return "A";
    case "MEDIUM": return "B";
    case "LOW": return "C";
    default: return null;
  }
}

function toPlanCandidate(entry: RotationSupplyEntry): RotationPlanCandidate {
  return {
    attendanceId: entry.id,
    dealerId: entry.dealer_id,
    fullName: entry.full_name,
    tier: entry.tier,
    skills: entry.skills,
    prevSessionMinutes: entry.prev_session_minutes,
    eligibleAtMs: entry.eligible_at_ms,
    score: entry.score ?? 0,
  };
}

function toPlanTable(
  table: TableRow,
  assignment: AssignmentRow | undefined,
  nowMs: number,
  poolDealerIds: Set<string> | undefined,
): RotationPlanTable {
  return {
    tableId: table.id,
    tableName: table.table_name ?? table.id,
    assignmentId: assignment?.id ?? `empty:${table.id}`,
    outAttendanceId: assignment?.attendance_id ?? "",
    outDealerName: "Dealer",
    assignedAtMs: assignment?.assigned_at ? Date.parse(assignment.assigned_at) : nowMs,
    swingDueAtMs: assignment?.swing_due_at ? Date.parse(assignment.swing_due_at) : nowMs,
    swingDurationMs: SWING_POLICY.defaults.swingDurationMinutes * 60_000,
    requiredTier: tierForTable(table.tour_tier),
    tournamentId: null,
    tournamentName: null,
    gameTypes: table.game_type ? [table.game_type] : [],
    poolDealerIds: poolDealerIds ? [...poolDealerIds] : null,
  };
}

function excludedCounts(diag: PickDiagnostics | undefined): CanonicalShortageSnapshot["excluded_dealers"] {
  return {
    busy: (diag?.busy_excluded ?? 0) + (diag?.exclude_set_excluded ?? 0)
      + (diag?.step5b_pre_assigned_refs ?? 0) + (diag?.step5c_pre_assigned ?? 0),
    fatigue: diag?.fatigue_excluded ?? 0,
    rest: (diag?.break_pool_guard_excluded ?? 0) + (diag?.min_rest_excluded ?? 0)
      + (diag?.inter_swing_cooldown_excluded ?? 0),
    game_type: diag?.game_type_excluded ?? 0,
    tier: diag?.tier_excluded ?? 0,
    meal_break: diag?.meal_break_excluded ?? 0,
  };
}

/**
 * Builds the only alert snapshot used by process-swing. Eligibility comes from
 * the production rotation supply and solver; the remaining queries only provide
 * state breakdowns and active session scope. Every required query is fail-closed.
 */
export async function buildCanonicalShortageSnapshot(
  admin: any,
  clubId: string,
  opts: {
    minInterSwingRestMinutes: number;
    clubBreakDurationMinutes: number;
    preAnnounceMinutes: number;
  },
): Promise<CanonicalShortageSnapshot> {
  const capturedAt = new Date().toISOString();
  const nowMs = Date.now();
  let operationalTables;
  try {
    operationalTables = await getDealerOperationalTables(admin, clubId);
  } catch (error) {
    return snapshotFailure("operational_inventory", error);
  }
  const sessionsByTable = new Map(operationalTables.map((table) => [table.id, table.table_session_id]));
  const [tablesResult, operationsResult, attendanceResult] = await Promise.all([
    operationalTables.length > 0 ? admin.from("game_tables")
      .select("id, table_name, game_type, tour_tier")
      .eq("club_id", clubId)
      .in("id", [...sessionsByTable.keys()]) : Promise.resolve({ data: [], error: null }),
    admin.from("dealer_open_operations")
      .select("id")
      .eq("club_id", clubId)
      .in("status", ["pending", "running", "waiting_for_dealer"])
      .gt("expires_at", capturedAt),
    admin.from("dealer_attendance")
      .select("id, dealer_id, current_state, status, check_out_time, check_in_time, last_released_at, dealers!inner(club_id, status, deleted_at)")
      .eq("status", "checked_in")
      .is("check_out_time", null)
      .eq("dealers.club_id", clubId)
      .eq("dealers.status", "active")
      .is("dealers.deleted_at", null),
  ]);
  for (const [stage, result] of [
    ["active_tables", tablesResult],
    ["open_operations", operationsResult],
    ["active_attendance", attendanceResult],
  ] as Array<[string, { data: unknown; error: unknown | null }]>) {
    if (result.error) return snapshotFailure(stage, result.error);
    if (!Array.isArray(result.data)) return snapshotFailure(stage, new Error("unverified response"));
  }

  const tables = tablesResult.data as TableRow[];
  if (tables.some((table) => !table || typeof table.id !== "string")
    || tables.length !== operationalTables.length || new Set(tables.map((table) => table.id)).size !== tables.length
    || tables.some((table) => !sessionsByTable.has(table.id))) {
    return snapshotFailure("table_metadata", new Error("operational table metadata changed"));
  }
  const operationIds = (operationsResult.data ?? []).map((row: { id: string }) => row.id);
  let pendingOperationTableIds = new Set<string>();
  if (operationIds.length > 0) {
    const targetsResult = await admin.from("dealer_open_operation_targets")
      .select("table_id")
      .in("operation_id", operationIds)
      .eq("target_state", "pending");
    if (targetsResult.error) return snapshotFailure("open_operation_targets", targetsResult.error);
    if (!Array.isArray(targetsResult.data)) return snapshotFailure("open_operation_targets", new Error("unverified response"));
    pendingOperationTableIds = new Set((targetsResult.data ?? []).map((row: { table_id: string }) => row.table_id));
  }

  const allTableIds = tables.map((table) => table.id);
  const assignmentsResult = allTableIds.length > 0 ? await admin.from("dealer_assignments")
    .select("id, club_id, table_id, table_session_id, attendance_id, pre_assigned_attendance_id, status, assigned_at, swing_due_at, overtime_started_at, released_at")
    .eq("club_id", clubId)
    .in("table_id", allTableIds)
    .in("status", ["assigned", "pre_assigned", "on_break", "reserved"])
    .is("released_at", null) : { data: [], error: null };
  if (assignmentsResult.error) return snapshotFailure("active_assignments", assignmentsResult.error);
  if (!Array.isArray(assignmentsResult.data)) return snapshotFailure("active_assignments", new Error("unverified response"));
  const activeAssignments = assignmentsResult.data as AssignmentRow[];
  const assignmentByTable = new Map<string, AssignmentRow>();
  for (const assignment of activeAssignments) {
    if (!assignment || assignment.club_id !== clubId || !sessionsByTable.has(assignment.table_id)
      || assignment.table_session_id !== sessionsByTable.get(assignment.table_id)
      || assignmentByTable.has(assignment.table_id)) {
      return snapshotFailure("assignment_scope", new Error("ambiguous or stale session assignment"));
    }
    assignmentByTable.set(assignment.table_id, assignment);
  }

  const scopedTables = tables;
  const emptyTables = scopedTables.filter((table) => !assignmentByTable.has(table.id));
  const heldTableIds = new Set(
    activeAssignments
      .filter((assignment) => assignment.pre_assigned_attendance_id != null || assignment.status === "reserved")
      .map((assignment) => assignment.table_id),
  );
  const dueAssignments = scopedTables
    .map((table) => assignmentByTable.get(table.id))
    .filter((assignment): assignment is AssignmentRow => Boolean(assignment))
    .filter((assignment) => assignment.status === "assigned" && assignment.swing_due_at != null)
    .filter((assignment) => Date.parse(assignment.swing_due_at as string) <= nowMs);
  const overdueAssignments = dueAssignments.filter((assignment) =>
    assignment.overtime_started_at != null
    && nowMs - Date.parse(assignment.overtime_started_at) >= DEALER_SHORTAGE_ALERT_POLICY.criticalOverdueMinutes * 60_000,
  );
  const uncoveredTables = [
    ...emptyTables,
    ...dueAssignments
      .filter((assignment) => !heldTableIds.has(assignment.table_id))
      .map((assignment) => scopedTables.find((table) => table.id === assignment.table_id))
      .filter((table): table is TableRow => Boolean(table)),
  ];
  const uniqueUncoveredTables = [...new Map(uncoveredTables.map((table) => [table.id, table])).values()];

  const attendance = dedupeActiveAttendance((attendanceResult.data ?? []) as AttendanceRow[]);
  const attendanceIds = attendance.map((row) => row.id);
  const [mealBreaksResult, activeBreaksResult] = attendanceIds.length > 0
    ? await Promise.all([
      admin.from("dealer_meal_breaks")
        .select("attendance_id")
        .in("attendance_id", attendanceIds)
        .eq("status", "active"),
      admin.from("dealer_breaks")
        .select("attendance_id, break_start")
        .in("attendance_id", attendanceIds)
        .is("break_end", null),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (mealBreaksResult.error) return snapshotFailure("meal_breaks", mealBreaksResult.error);
  if (activeBreaksResult.error) return snapshotFailure("active_breaks", activeBreaksResult.error);
  const mealAttendanceIds = new Set((mealBreaksResult.data ?? []).map((row: { attendance_id: string }) => row.attendance_id));
  const breakAttendanceIds = new Set(
    (activeBreaksResult.data ?? [])
      .map((row: BreakRow) => row.attendance_id)
      .filter((id: string | null): id is string => Boolean(id)),
  );

  const supplyResult = await buildRotationSupply(admin, clubId, {
    minInterSwingRestMinutes: opts.minInterSwingRestMinutes,
    clubBreakDurationMinutes: opts.clubBreakDurationMinutes,
  });
  if (supplyResult.status !== "ok") {
    return emptySnapshot(supplyResult.status, supplyResult.errorCode ?? `shortage_snapshot_supply_${supplyResult.status}`);
  }
  const featurePools = await getFeatureTablePoolsByTableWithStatus(
    admin,
    uniqueUncoveredTables.map((table) => table.id),
  );
  if (featurePools.status !== "ok") {
    return emptySnapshot(featurePools.status, featurePools.errorCode ?? `shortage_snapshot_feature_pools_${featurePools.status}`);
  }
  let reservedDealerIds: Set<string>;
  try {
    reservedDealerIds = await getReservedDealerIds(admin);
  } catch (error) {
    return snapshotFailure("reserved_dealers", error);
  }

  const candidateSupply = supplyResult.supply.map(toPlanCandidate);
  const plan = solveRotationPlan(
    uniqueUncoveredTables.map((table) => toPlanTable(
      table,
      assignmentByTable.get(table.id),
      nowMs,
      featurePools.pools.get(table.id),
    )),
    candidateSupply,
    {
      nowMs,
      announceLeadMs: 3 * 60_000,
      preAnnounceMs: Math.max(opts.preAnnounceMinutes, 3) * 60_000,
      restMs: Math.max(opts.minInterSwingRestMinutes, SWING_POLICY.rest.executeMinRestFloorMinutes) * 60_000,
      forecastSlots: 0,
      reservedDealerIds: [...reservedDealerIds],
      solverVersion: DEALER_SHORTAGE_ALERT_POLICY.solverVersion,
    },
  );
  const matchedNow = new Set(
    plan.rows
      .filter((row) => row.slotIndex === 0 && row.inAttendanceId != null && !row.isShortage)
      .map((row) => row.inAttendanceId as string),
  );
  const availableNow = supplyResult.supply.filter((entry) =>
    entry.current_state === "available" && entry.eligible_at_ms <= nowMs,
  );
  const restFloorMs = Math.max(opts.minInterSwingRestMinutes, SWING_POLICY.rest.executeMinRestFloorMinutes) * 60_000;
  const onBreak = attendance.filter((row) => row.current_state === "on_break");
  const onBreakReady = onBreak.filter((row) =>
    !mealAttendanceIds.has(row.id)
    && !breakAttendanceIds.has(row.id)
    && (!row.last_released_at || nowMs - Date.parse(row.last_released_at) >= restFloorMs),
  );
  const onBreakNotReady = onBreak.filter((row) => !onBreakReady.some((ready) => ready.id === row.id));
  const preAssignedAttendanceIds = new Set(
    activeAssignments
      .map((assignment) => assignment.pre_assigned_attendance_id)
      .filter((id): id is string => Boolean(id)),
  );
  const reservedDealerCount = attendance.filter((row) => reservedDealerIds.has(row.dealer_id)).length;

  // Multi-query read: a close/reopen observed during collection invalidates the
  // snapshot; never publish old-session counts as a healthy current scope.
  try {
    const currentTables = await getDealerOperationalTables(admin, clubId);
    if (currentTables.length !== sessionsByTable.size
      || currentTables.some((table) => sessionsByTable.get(table.id) !== table.table_session_id)) {
      return snapshotFailure("operational_scope_changed", new Error("table session changed during snapshot"));
    }
  } catch (error) {
    return snapshotFailure("operational_inventory", error);
  }

  return {
    status: "ok",
    error_code: null,
    captured_at: capturedAt,
    active_staffed_tables: scopedTables.length - emptyTables.length,
    active_empty_tables: emptyTables.length,
    tables_due_for_relief: dueAssignments.length,
    tables_overdue_for_relief: overdueAssignments.length,
    tables_without_replacement_total: uniqueUncoveredTables.length,
    replacement_held_tables: heldTableIds.size,
    checked_in_active_dealers: attendance.length,
    genuinely_available_dealers: availableNow.length,
    eligible_for_any_uncovered_table_total: matchedNow.size,
    on_break_not_ready_dealers: onBreakNotReady.length,
    on_break_ready_dealers: onBreakReady.length,
    pre_assigned_dealers: preAssignedAttendanceIds.size,
    reserved_dealers: activeAssignments.filter((assignment) => assignment.status === "reserved").length,
    active_meal_break_dealers: mealAttendanceIds.size,
    feature_reserved_dealers: reservedDealerCount,
    pending_durable_mass_open_targets: pendingOperationTableIds.size,
    excluded_dealers: excludedCounts(supplyResult.diag),
  };
}

export function classifyShortage(snapshot: CanonicalShortageSnapshot): ShortageClassification {
  if (snapshot.status !== "ok") return "snapshot_invalid";
  if (snapshot.tables_without_replacement_total === 0) {
    return snapshot.replacement_held_tables > 0 ? "reserved_relief_pending" : "healthy";
  }
  if (snapshot.eligible_for_any_uncovered_table_total > 0) return "healthy";
  if (snapshot.on_break_ready_dealers > 0) return "temporary_wait";
  if (snapshot.pending_durable_mass_open_targets > 0 || snapshot.replacement_held_tables > 0) {
    return "reserved_relief_pending";
  }
  if (
    snapshot.tables_overdue_for_relief >= DEALER_SHORTAGE_ALERT_POLICY.criticalOverdueTables
    || snapshot.tables_without_replacement_total >= DEALER_SHORTAGE_ALERT_POLICY.criticalOverdueTables
  ) return "critical_shortage";
  return "true_shortage";
}

export function shortageSeverity(classification: ShortageClassification): number {
  if (classification === "critical_shortage") return 2;
  if (classification === "true_shortage") return 1;
  return 0;
}

export function decideShortageAlert(
  snapshot: CanonicalShortageSnapshot,
  settings: {
    row: { shortage_notify_telegram?: boolean | null } | null;
    error: unknown | null;
  },
): ShortageAlertDecision {
  if (snapshot.status !== "ok") {
    return {
      classification: "snapshot_invalid",
      notifyEnabled: false,
      failure: {
        status: snapshot.status,
        stage: "canonical_snapshot",
        errorCode: snapshot.error_code ?? `shortage_snapshot_${snapshot.status}`,
      },
    };
  }
  const classification = classifyShortage(snapshot);
  if (settings.error) {
    return {
      classification,
      notifyEnabled: false,
      failure: alertFailure("notification_setting", settings.error),
    };
  }
  return {
    classification,
    notifyEnabled: settings.row?.shortage_notify_telegram === true,
    failure: null,
  };
}

export function sanitizeShortageSnapshot(snapshot: CanonicalShortageSnapshot): Record<string, unknown> {
  const safeErrorCode = snapshot.error_code && /^[A-Za-z0-9_]{1,96}$/.test(snapshot.error_code)
    ? snapshot.error_code
    : null;
  const sanitized = {
    status: snapshot.status,
    error_code: safeErrorCode,
    captured_at: snapshot.captured_at,
    active_staffed_tables: snapshot.active_staffed_tables,
    active_empty_tables: snapshot.active_empty_tables,
    tables_due_for_relief: snapshot.tables_due_for_relief,
    tables_overdue_for_relief: snapshot.tables_overdue_for_relief,
    tables_without_replacement_total: snapshot.tables_without_replacement_total,
    replacement_held_tables: snapshot.replacement_held_tables,
    checked_in_active_dealers: snapshot.checked_in_active_dealers,
    genuinely_available_dealers: snapshot.genuinely_available_dealers,
    eligible_for_any_uncovered_table_total: snapshot.eligible_for_any_uncovered_table_total,
    on_break_not_ready_dealers: snapshot.on_break_not_ready_dealers,
    on_break_ready_dealers: snapshot.on_break_ready_dealers,
    pre_assigned_dealers: snapshot.pre_assigned_dealers,
    reserved_dealers: snapshot.reserved_dealers,
    active_meal_break_dealers: snapshot.active_meal_break_dealers,
    feature_reserved_dealers: snapshot.feature_reserved_dealers,
    pending_durable_mass_open_targets: snapshot.pending_durable_mass_open_targets,
    excluded_dealers: snapshot.excluded_dealers,
  };
  const json = JSON.stringify(sanitized);
  if (new TextEncoder().encode(json).byteLength > DEALER_SHORTAGE_ALERT_POLICY.snapshotMaxBytes) {
    return { status: snapshot.status, error_code: "snapshot_too_large" };
  }
  return sanitized;
}

export function formatShortageTelegram(
  classification: ShortageClassification,
  snapshot: CanonicalShortageSnapshot,
): string | null {
  if (classification === "healthy" || classification === "temporary_wait" || classification === "reserved_relief_pending") {
    return null;
  }
  if (classification === "snapshot_invalid") return null;
  const critical = classification === "critical_shortage";
  return [
    critical ? "CANH BAO THIEU DEALER NGHIEM TRONG" : "CANH BAO THIEU DEALER",
    `Ban can nguoi thay: ${snapshot.tables_without_replacement_total}`,
    `Ban qua han: ${snapshot.tables_overdue_for_relief}`,
    `Dealer co the vao ngay: ${snapshot.eligible_for_any_uncovered_table_total}`,
    `Dealer da giu cho: ${snapshot.replacement_held_tables + snapshot.pre_assigned_dealers + snapshot.reserved_dealers}`,
    `Dealer co the du nghi som: ${snapshot.on_break_ready_dealers}`,
    "Xu ly: check-in dealer phu hop hoac dong bot ban.",
  ].join("\n");
}

function alertFailure(stage: string, error: unknown): ShortageAlertFailure {
  const classified = classifyPostgrestError(error);
  return {
    status: classified.status,
    stage,
    errorCode: `shortage_alert_${stage}_${classified.status}`,
  };
}

export async function runDealerShortageAlert(
  admin: SupabaseClient,
  args: {
    clubId: string;
    botToken: string | null;
    minInterSwingRestMinutes: number;
    clubBreakDurationMinutes: number;
    preAnnounceMinutes: number;
  },
): Promise<ShortageAlertOutcome> {
  const snapshot = await buildCanonicalShortageSnapshot(admin, args.clubId, args);
  if (snapshot.status !== "ok") {
    const decision = decideShortageAlert(snapshot, { row: null, error: null });
    return {
      snapshot,
      classification: decision.classification,
      notification: "none",
      failure: decision.failure,
    };
  }
  const { data: settings, error: settingsError } = await admin
    .from("club_settings")
    .select("shortage_notify_telegram, telegram_chat_id")
    .eq("club_id", args.clubId)
    .maybeSingle();
  const decision = decideShortageAlert(snapshot, {
    row: settings as { shortage_notify_telegram?: boolean | null } | null,
    error: settingsError,
  });
  if (decision.failure) {
    return {
      snapshot,
      classification: decision.classification,
      notification: "none",
      failure: decision.failure,
    };
  }
  const classification = decision.classification;
  const notifyEnabled = decision.notifyEnabled;
  const { data: ledgerData, error: ledgerError } = await admin.rpc("advance_dealer_shortage_alert_incident", {
    p_club_id: args.clubId,
    p_incident_key: DEALER_SHORTAGE_ALERT_POLICY.incidentKey,
    p_classification: classification,
    p_severity: shortageSeverity(classification),
    p_snapshot: sanitizeShortageSnapshot(snapshot),
    p_error_code: null,
    p_notify_enabled: notifyEnabled,
    p_cooldown_seconds: DEALER_SHORTAGE_ALERT_POLICY.cooldownSeconds,
    p_resolution_debounce_seconds: DEALER_SHORTAGE_ALERT_POLICY.resolutionDebounceSeconds,
  });
  if (ledgerError || !ledgerData || typeof ledgerData !== "object") {
    return { snapshot, classification, notification: "none", failure: alertFailure("incident_ledger", ledgerError ?? new Error("invalid ledger result")) };
  }
  const ledger = ledgerData as {
    outcome?: string | null;
    notification?: string | null;
    incident_id?: string;
    claim_id?: string | null;
  };
  if (ledger.outcome !== "recorded" && ledger.outcome !== "no_open_incident") {
    return {
      snapshot,
      classification,
      notification: "none",
      failure: alertFailure("incident_ledger", new Error("unexpected ledger outcome")),
    };
  }
  const notification = (ledger.notification ?? "none") as ShortageAlertOutcome["notification"];
  if (notification === "none" || !ledger.claim_id || !ledger.incident_id || !notifyEnabled) {
    return { snapshot, classification, notification, failure: null };
  }
  const message = notification === "resolved"
    ? "DA ON DINH: Dealer Swing da co phuong an thay nguoi."
    : formatShortageTelegram(classification, snapshot);
  if (!message) return { snapshot, classification, notification: "none", failure: null };
  let delivered = false;
  try {
    const chatId = (settings as { telegram_chat_id?: string | null } | null)?.telegram_chat_id ?? null;
    if (!args.botToken || !chatId) throw new Error("telegram_delivery_not_configured");
    delivered = await sendTelegramNotification(args.botToken, chatId, message);
    if (!delivered) throw new Error("telegram_delivery_failed");
  } catch (error) {
    console.warn("[shortage-alert] telegram_delivery_failed", {
      club_id: args.clubId,
      code: classifyPostgrestError(error).sanitizedCode,
    });
  }
  const { error: completeError } = await admin.rpc("complete_dealer_shortage_alert_notification", {
    p_incident_id: ledger.incident_id,
    p_claim_id: ledger.claim_id,
    p_delivered: delivered,
  });
  if (completeError) {
    return { snapshot, classification, notification: "failed", failure: alertFailure("notification_complete", completeError) };
  }
  return { snapshot, classification, notification: delivered ? notification : "failed", failure: null };
}
