/**
 * _shared/pickNextDealer.ts
 *
 * Dealer selection with scoring, game-type matching, break equity penalty,
 * intra-cycle exclusion, and high-stakes tier guard.
 *
 * Key scoring components:
 *  - rest_bonus: more rest → higher score
 *  - tier_bonus: preferred tier for the table's tournament tier
 *  - skill_bonus: +20 per matching game type skill
 *  - consecutive_penalty: heavy load penalty
 *  - back_to_back_penalty: avoid same table
 *  - priority_break_penalty: always 0 since A2 — priority_break_flag is a tier-1 HARD gate
 *    (excluded until rested ≥ threshold), not a soft score term; field kept for C1 shape
 *  - heavy_worker_penalty: avoid repeatedly picking same dealer
 *  - break_equity_penalty: dealers with deficit break ratio are penalized
 *  - tier_back_to_back_penalty: returning to same table with same tier
 *  - consecutive_high_penalty: rest from HIGH tables after back-to-back HIGH
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadCandidateActiveBreaks } from "./candidateBreaks.ts";
import { loadEligibleDealerAttendance } from "./dealerPoolEligibility.ts";
import { candidateSnapshotFailureDiagnostic } from "./candidateSnapshotTelemetry.ts";
import {
  isFreshDealerPoolAttendance,
  NORMAL_CHECKOUT_MAX_AGE_HOURS,
} from "./checkoutSafety.ts";
import { getFeatureTablePoolIds, getReservedDealerIds } from "./featureTableGate.ts"; // Patch 5b/5d: feature/final pool gate + reserved exclusivity
import { classifyPostgrestError } from "./postgrestError.ts";
import { SWING_POLICY } from "./swingPolicy.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  rest_bonus: number;
  tier_bonus: number;
  back_to_back_penalty: number;
  consecutive_penalty: number;
  mixed_bonus: number;
  skill_bonus: number;
  priority_break_penalty: number;
  heavy_worker_penalty: number;
  consecutive_high_penalty: number;
  tier_back_to_back_penalty: number;
  break_equity_penalty: number;
  priority_swing_bonus: number;
  fatigue_penalty: number;
}

export interface PickDealerOptions {
  tourTier?: "HIGH" | "MEDIUM" | "LOW";
  swingDurationMinutes?: number;
  requiredGameTypes?: string[];
  currentTableId?: string;
  excludeAttendanceIds?: Set<string>;
  returnTopN?: number;
  includeScoreBreakdown?: boolean;
  /** Known club average break ratio (pre-fetched). Skips batch query. */
  clubAvgBreakRatio?: number;
  /** Emergency: skip priority_break_flag filter. Use when OT dealer has no normal replacement. */
  skipPriorityBreakGuard?: boolean;
  /** Emergency: skip 105-min fatigue hard cap. Use only when OT exceeds escalation threshold. */
  skipFatigueHardCap?: boolean;
  /** Club break duration for rest threshold calculation. Defaults to 20 if not provided. */
  clubBreakDurationMinutes?: number;
  /** Minimum rest minutes between consecutive assignments. Defaults to 10 if not provided.
   *  Used by graduated escalation: Tier 1=5, Tier 2=3, Tier 3=0 to relax rest enforcement. */
  minRestMinutes?: number;
  /** Minimum rest minutes between two swing assignments (inter-swing cooldown).
   *  0 = disabled. Defaults to 10. Based on last_released_at timestamp. */
  minInterSwingRestMinutes?: number;
  /** When set, the cooldown check uses this future timestamp (swing_due_at) instead of
   *  Date.now(). This allows Pass 2 to pre-assign a dealer who will complete their rest
   *  before the swing due time, even if they aren't available at this exact moment.
   *  Clamped to max 15 minutes ahead to prevent forward-looking anomalies. */
  swingDueAt?: string;
  /** Reservation mode relaxes the hard wall-clock rest guard so Pass 2 / post-swing
   *  can reserve a dealer who will be ready by the delayed handoff time.
   *  The pool cooldown guard still applies. */
  reservationMode?: boolean;
  /** Empty-table auto-fill (owner policy 2026-06-15): pick ONLY genuinely-free
   *  dealers — never an on_break dealer (don't pull anyone off break). Defaults
   *  to false so every existing caller is unchanged. */
  availableOnly?: boolean;
}

export interface DealerCandidate {
  id: string;
  dealer_id: string;
  full_name: string;
  telegram_username?: string;
  telegram_user_id?: string;
  tier: "A" | "B" | "C";
  skills: string[];
  worked_minutes_since_last_break: number;
  last_table_id?: string;
  consecutive_assignments: number;
  rest_minutes: number;
  priority_break_flag: boolean;
  current_state: "available" | "on_break";
  last_tour_tier: string;
  /** Last time this dealer was released from a table (rest anchor). Used by the
   *  legacy Pass 2 execute-rest guard to avoid pre-assigning a dealer who won't
   *  meet the execute rest floor by swing time. */
  last_released_at?: string | null;
  score?: number;
  score_breakdown?: ScoreBreakdown;
}

/** Per-pick exclusion counters — why dealers were dropped from the candidate pool.
 *  Computed today for logging; surfaced (C1) so the floor sees "why not chosen". */
export interface PickDiagnostics {
  total_rows: number;
  duplicate_dealer_rows: number;
  busy_excluded: number;
  exclude_set_excluded: number;
  tier_excluded: number;
  fatigue_excluded: number;
  priority_break_excluded: number;
  break_pool_guard_excluded: number;
  min_rest_excluded: number;
  on_break_excluded: number;
  inter_swing_cooldown_excluded: number;
  game_type_excluded: number;
  meal_break_excluded: number;
  step5b_pre_assigned_refs: number;
  step5c_pre_assigned: number;
  candidates_count: number;
}

export interface BuildCandidatesResult {
  candidates: DealerCandidate[];
  avgBreakRatio: number | null;
  status: "ok" | "dependency_unavailable" | "query_failed";
  errorCode?: string;
  /** Present on the normal path; omitted on the early no-dealer/error returns. */
  diag?: PickDiagnostics;
}

export type CandidateSnapshotStatus = Exclude<BuildCandidatesResult["status"], "ok">;

/** A query/dependency failure is never equivalent to a valid empty dealer pool. */
export class CandidateSnapshotFailure extends Error {
  override readonly name = "CandidateSnapshotFailure";

  constructor(
    readonly status: CandidateSnapshotStatus,
    readonly errorCode: string,
  ) {
    super(errorCode);
  }
}

export function isCandidateSnapshotFailure(error: unknown): error is CandidateSnapshotFailure {
  return error instanceof CandidateSnapshotFailure;
}

function requireCandidateSnapshot(result: BuildCandidatesResult): BuildCandidatesResult {
  if (result.status === "ok") return result;
  throw new CandidateSnapshotFailure(
    result.status,
    result.errorCode ?? `candidate_snapshot_${result.status}`,
  );
}

export interface PickNextDealerResult {
  candidate: DealerCandidate | null;
  status: BuildCandidatesResult["status"];
  errorCode?: string;
}

interface CandidateQueryError {
  code?: string | null;
  message?: string | null;
}

function candidateQueryFailure(
  error: unknown,
  stage: string,
  context?: {
    inputCount: number;
    durationMs: number;
    responseStatus?: number | null;
    stableErrorCode?: string;
  },
): BuildCandidatesResult {
  const { status } = classifyPostgrestError(error);
  const errorCode = context?.stableErrorCode ?? `candidate_${stage}_${status}`;
  if (context) {
    // Deliberately structured and sanitized: no provider message, IDs, URL, or headers.
    console.error(JSON.stringify(candidateSnapshotFailureDiagnostic(
      stage,
      error,
      context.responseStatus,
      context.inputCount,
      context.durationMs,
    )));
  } else {
    console.error(`[pickNextDealer] ${errorCode}`);
  }
  return { candidates: [], avgBreakRatio: null, status, errorCode };
}

export type SupabaseAdmin = any;

interface AttendancePoolRow {
  id: string;
  dealer_id: string;
  current_state: string;
  status: string;
  worked_minutes_since_last_break: number | null;
  priority_break_flag: boolean | null;
  last_released_at: string | null;
  check_in_time: string | null;
  dealers: {
    full_name: string;
    telegram_username: string | null;
    telegram_user_id: string | null;
    tier: "A" | "B" | "C" | null;
    skills: string[] | null;
  };
}

interface DealerIdRow {
  id: string;
}

interface PrioritySwingAssignmentRow {
  priority_swing_at: string | null;
}

interface AssignmentMetricRow {
  attendance_id: string;
  minutes_since_rest: number | null;
  total_assignments: number | null;
  total_break_minutes: number | null;
  total_worked_minutes: number | null;
}

interface LastAssignmentRow {
  attendance_id: string;
  table_id: string | null;
  game_tables: { tour_tier: string | null } | null;
}

interface BusyDealerRow {
  dealer_id: string;
}

interface RestingDealerRow {
  id: string;
}

interface BusyAssignmentRow {
  dealer_id: string;
  table_id: string | null;
  status: string | null;
  attendance_id: string | null;
}

interface PreAssignedRefRow {
  pre_assigned_attendance_id: string | null;
}

interface PreAssignedDealerRow {
  dealer_id: string;
  id: string;
  pre_assigned_table_id: string | null;
}

interface ClubMetricRow {
  total_worked_minutes: number | null;
  total_break_minutes: number | null;
}

interface ActiveMealBreakRow {
  attendance_id: string;
  break_start: string;
  total_duration_minutes: number | null;
}

function pickPreferredAttendanceRow(
  current: AttendancePoolRow | undefined,
  candidate: AttendancePoolRow
): AttendancePoolRow {
  if (!current) return candidate;

  const currentCheckIn = current.check_in_time ? new Date(current.check_in_time).getTime() : 0;
  const candidateCheckIn = candidate.check_in_time ? new Date(candidate.check_in_time).getTime() : 0;
  if (candidateCheckIn !== currentCheckIn) {
    return candidateCheckIn > currentCheckIn ? candidate : current;
  }

  const currentReleased = current.last_released_at ? new Date(current.last_released_at).getTime() : 0;
  const candidateReleased = candidate.last_released_at ? new Date(candidate.last_released_at).getTime() : 0;
  if (candidateReleased !== currentReleased) {
    return candidateReleased > currentReleased ? candidate : current;
  }

  const currentAvailable = current.current_state === "available" ? 1 : 0;
  const candidateAvailable = candidate.current_state === "available" ? 1 : 0;
  if (candidateAvailable !== currentAvailable) {
    return candidateAvailable > currentAvailable ? candidate : current;
  }

  return candidate.id.localeCompare(current.id) > 0 ? candidate : current;
}

// ─── buildDealerCandidates ────────────────────────────────────────────────────

export async function buildDealerCandidates(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<BuildCandidatesResult> {
  const {
    tourTier,
    requiredGameTypes,
    currentTableId,
    excludeAttendanceIds = new Set(),
    includeScoreBreakdown,
    clubAvgBreakRatio,
    skipPriorityBreakGuard = false,
    skipFatigueHardCap = false,
    clubBreakDurationMinutes = SWING_POLICY.fatigue.defaultClubBreakDurationMinutes,
    minRestMinutes = SWING_POLICY.rest.minRestMinutes,
    minInterSwingRestMinutes: rawMinInterSwingRestMinutes = SWING_POLICY.rest.minInterSwingRestMinutes,
    swingDueAt,
    reservationMode = false,
    availableOnly = false,
  } = options;
  const minInterSwingRestMinutes = Math.max(0, rawMinInterSwingRestMinutes ?? SWING_POLICY.rest.minInterSwingRestMinutes);

  // Step 1: Get active dealer IDs for this club
  const { data: clubDealers, error: clubDealersError } = (await admin
    .from("dealers")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "active")
    .is("deleted_at", null)) as unknown as {
      data: DealerIdRow[] | null;
      error: CandidateQueryError | null;
    };  // Patch 5b A6: exclude soft-deleted dealers
  if (clubDealersError) return candidateQueryFailure(clubDealersError, "club_dealers");
  const dealerIds = (clubDealers ?? []).map((d: { id: string }) => d.id);
  // Step 1 edge case: no dealers → return empty with null avgBreakRatio
  if (dealerIds.length === 0) return { candidates: [], avgBreakRatio: null, status: "ok" };

  // Patch 5b — feature/final pool gate (app_settings-gated; INERT when kill-switch off).
  // When the gate is active (kill-switch ON + currentTableId is feature/final), restrict the
  // candidate dealer set to that table's pool BEFORE the attendance query → the picker can only
  // return a pool dealer (or null → caller's existing no_dealer keep-seat = CLEAN shortage, OT
  // accrual preserved). Shared helper mirrors the SQL trigger/_assert + WRAPPER self-pick so the
  // picker and DB enforcement never disagree. Gated on app_settings, NOT on FEATURES (UI-only).
  {
    let poolIds: Set<string> | null;
    try {
      poolIds = currentTableId ? await getFeatureTablePoolIds(admin, currentTableId) : null;
    } catch (error) {
      return candidateQueryFailure(error, "feature_pool");
    }
    if (poolIds) { // non-null = gate active (kill-switch on + special table)
      const restricted = dealerIds.filter((id) => poolIds.has(id));
      if (restricted.length === 0) {
        // Special table with no eligible pool dealer → no candidate. The caller's existing
        // null→no_dealer path keeps the seat (OT) — a CLEAN shortage, never a trigger-rollback.
        console.warn(`[pickNextDealer] feature/final table ${currentTableId}: pool empty/none eligible → clean shortage (no candidate)`);
        return { candidates: [], avgBreakRatio: null, status: "ok" };
      }
      dealerIds.length = 0;
      dealerIds.push(...restricted); // restrict candidate set to the pool (mutate in place; Step 2 reads dealerIds)
    } else if (currentTableId) {
      // Patch 5d — picking for a REAL NORMAL table (poolIds resolved to null because the
      // table isn't special): exclude dealers reserved to ANY feature/final pool. They are
      // exclusive to their special table and must not be pulled to a normal table (else the
      // in-pool A↔B rotation breaks). Gate-aware: empty Set when kill-switch off → no effect.
      try {
        const reserved = await getReservedDealerIds(admin);
        if (reserved.size > 0) {
          const kept = dealerIds.filter((id) => !reserved.has(id));
          if (kept.length !== dealerIds.length) {
            console.log(`[pickNextDealer] excluded ${dealerIds.length - kept.length} reserved feature/final pool dealer(s) from non-pool pick (table=${currentTableId})`);
            dealerIds.length = 0;
            dealerIds.push(...kept);
          }
        }
      } catch (reservedErr) {
        // Fail-SAFE (P2 hardening, audit 2026-07-02): getReservedDealerIds throws on a query
        // error — it has no data-only way to signal "reserved set unknown" without risking a
        // false-empty Set, which would let a special-pool dealer leak onto this normal table
        // (the exact leak Patch 5d closed). Mirror Step 2 above: bail with no candidates for
        // this pick rather than proceed with an unverifiable reserved-dealer set.
        console.error(
          `[pickNextDealer] Reserved-dealer lookup failed — failing safe (no candidates) for table=${currentTableId}:`,
          reservedErr instanceof Error ? reservedErr.message : reservedErr
        );
        return candidateQueryFailure(reservedErr, "reserved_dealers");
      }
    }
    // else: currentTableId is undefined — this is a GLOBAL/shared candidate build (e.g.
    // buildRotationSupply for Pass R, which computes ONE supply for ALL tables — special
    // AND normal — at once). Do NOT reserved-exclude here: that would strip a special
    // table's own pool dealers out of the supply BEFORE the per-table solver ever sees
    // them, so the special table could never be relieved by its own pool (the exact
    // regression this fixes — a feature/final table's pool dealer, once released, vanished
    // from Pass R's candidate list entirely and the table sat in indefinite shortage/OT).
    // The authoritative per-table gate for this path is solveRotationPlan's allowedByPool
    // (poolDealerIds / reservedDealerIds), applied downstream once each table is known.
  }

  // Step 1b: Check if requesting table has priority_swing_at set

  // Step 1b: Check if requesting table has priority_swing_at set
  // +300 bonus ensures the priority table gets next available dealer.
  let isPrioritySwing = false;
  if (currentTableId) {
    const { data: currentAssignment, error: currentAssignmentError } = (await admin
      .from("dealer_assignments")
      .select("priority_swing_at")
      .eq("table_id", currentTableId)
      .eq("status", "assigned")
      .is("swing_processed_at", null)
      .maybeSingle()) as unknown as {
        data: PrioritySwingAssignmentRow | null;
        error: CandidateQueryError | null;
      };
    if (currentAssignmentError) return candidateQueryFailure(currentAssignmentError, "priority_swing");
    isPrioritySwing = !!(currentAssignment as any)?.priority_swing_at;
  }

  // Step 2: Query dealer_attendance
  // Dealers on_break must rest the full configured break duration before
  // they can be pulled back for swing. This protects lunch breaks (e.g. 30min).
  // Available dealers always pass this guard since they're not on_break.
  const minBreakMinutes = options.clubBreakDurationMinutes ?? SWING_POLICY.fatigue.minBreakGuardFallbackMinutes;
  const candidateNowMs = Date.now();
  const attendanceFreshnessCutoff = new Date(
    candidateNowMs - NORMAL_CHECKOUT_MAX_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: rawRows, error } = (await admin
    .from("dealer_attendance")
    .select(
      `id, dealer_id, current_state, status,
        worked_minutes_since_last_break, priority_break_flag,
        check_in_time, last_released_at,
        dealers!inner(
          full_name, telegram_username, telegram_user_id,
          tier, skills
        )`
    )
    .eq("status", "checked_in")
    .is("check_out_time", null)
    .gt("check_in_time", attendanceFreshnessCutoff)
    .in("dealer_id", dealerIds)
    .or(`current_state.eq.available,current_state.eq.on_break`)) as unknown as {
      data: AttendancePoolRow[] | null;
      error: CandidateQueryError | null;
    };

  // Step 2 edge case: query error or empty rows
  if (error) return candidateQueryFailure(error, "attendance_pool");

  const ageFilteredRows = ((rawRows ?? []) as AttendancePoolRow[]).filter((row) =>
    isFreshDealerPoolAttendance(row.check_in_time, candidateNowMs)
  );
  const eligibility=await loadEligibleDealerAttendance(admin,clubId,ageFilteredRows.map(row=>row.id));
  if(eligibility.error)return candidateQueryFailure(eligibility.error,'operating_day');
  const freshRows=ageFilteredRows.filter(row=>eligibility.ids.has(row.id));
  const rowsByDealer = new Map<string, AttendancePoolRow>();
  let duplicateDealerRows = 0;
  for (const row of freshRows) {
    const current = rowsByDealer.get(row.dealer_id);
    if (!current) {
      rowsByDealer.set(row.dealer_id, row);
      continue;
    }
    const preferred = pickPreferredAttendanceRow(current, row);
    if (preferred !== current) {
      rowsByDealer.set(row.dealer_id, preferred);
    }
    duplicateDealerRows++;
  }
  const rows = [...rowsByDealer.values()];
  if (duplicateDealerRows > 0) {
    console.warn(
      `[pickNextDealer] Club ${clubId}: deduped ${duplicateDealerRows} duplicate active attendance row(s) ` +
      `across ${rows.length} dealer(s)`
    );
  }

  // Step 3: Query dealer_shift_metrics separately
  const attendanceIds = rows.map((r) => r.id);
  const nowMs = Date.now();
  const { data: metricsRows, error: metricsError } = (await admin
    .from("dealer_shift_metrics")
    .select("attendance_id, minutes_since_rest, total_assignments, total_break_minutes, total_worked_minutes")
    .in("attendance_id", attendanceIds)) as unknown as {
      data: AssignmentMetricRow[] | null;
      error: CandidateQueryError | null;
    };
  if (metricsError) return candidateQueryFailure(metricsError, "shift_metrics");
  const metricsMap = new Map(
    (metricsRows ?? []).map((m) => [m.attendance_id, m])
  );

  // Step 4: Query last 2 assignments per attendance for back-to-back detection
  const { data: lastAssignments, error: lastAssignmentsError } = (await admin
    .from("dealer_assignments")
    .select("attendance_id, table_id, game_tables!inner(tour_tier)")
    .in("attendance_id", attendanceIds)
    .order("assigned_at", { ascending: false })) as unknown as {
      data: LastAssignmentRow[] | null;
      error: CandidateQueryError | null;
    };
  if (lastAssignmentsError) return candidateQueryFailure(lastAssignmentsError, "last_assignments");
  const lastTableMap = new Map<string, string>();
  const lastTourTierMap = new Map<string, string>();
  for (const a of lastAssignments ?? []) {
    if (!lastTableMap.has(a.attendance_id)) {
      if (a.table_id) {
        lastTableMap.set(a.attendance_id, a.table_id);
      }
      lastTourTierMap.set(a.attendance_id, (a.game_tables as any)?.tour_tier ?? "");
    }
  }

  let activeBreakMap = new Map<string, string>();
  if (attendanceIds.length > 0) {
    const activeBreakResult = await loadCandidateActiveBreaks(attendanceIds, {
      loadAttendanceLinked: async (attendanceIdChunk) => {
        const response = await admin
          .from("dealer_breaks")
          .select("attendance_id, break_start")
          .is("break_end", null)
          .in("attendance_id", attendanceIdChunk) as {
            data: { attendance_id: string | null; break_start: string }[] | null;
            error: CandidateQueryError | null;
            status?: number | null;
          };
        return { data: response.data, error: response.error, status: response.status };
      },
      // Legacy break rows predate attendance_id. Filtering through the FK keeps
      // the lookup exact without expanding a current attendance into all history.
      loadLegacyAssignmentLinked: async (attendanceIdChunk) => {
        const response = await admin
          .from("dealer_breaks")
          .select("assignment_id, break_start, dealer_assignments!inner(attendance_id)")
          .is("break_end", null)
          .is("attendance_id", null)
          .in("dealer_assignments.attendance_id", attendanceIdChunk) as {
            data: {
              assignment_id: string | null;
              break_start: string;
              dealer_assignments: { attendance_id: string | null } | null;
            }[] | null;
            error: CandidateQueryError | null;
            status?: number | null;
          };
        return { data: response.data, error: response.error, status: response.status };
      },
    });
    if (!activeBreakResult.ok) {
      const { failure } = activeBreakResult;
      return candidateQueryFailure(failure.error, failure.stage, {
        inputCount: failure.inputCount,
        durationMs: failure.durationMs,
        responseStatus: failure.responseStatus,
        stableErrorCode: failure.stage === "assignment_breaks"
          ? "candidate_assignment_breaks_query_failed"
          : undefined,
      });
    }
    activeBreakMap = activeBreakResult.activeBreakByAttendanceId;
  }

  // Step 5: Exclude dealers who are ALREADY BUSY at any table.
  // BUG FIX: Query by dealer_id across ALL attendance records (not just the
  // available list) to catch dealers with duplicate attendance records or
  // orphaned 'assigned'/'pre_assigned'/'in_transition' state from prior shifts.
  // Also excludes dealers who haven't checked out yet regardless of which
  // attendance record shows them busy.
  //
  // 🚨 CRITICAL FIX: Use rolling 24h window to prevent stale records (>1 day old)
  // from poisoning the pool. In tournament poker, shifts cross midnight, so
  // "today" is wrong — 24h rolling window is safe for any shift length.
  const busyDealerIds = new Set<string>();
  const busyWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: busyDealers, error: busyDealersError } = (await admin
    .from("dealer_attendance")
    .select("dealer_id")
    .in("dealer_id", dealerIds)
    .in("current_state", ["assigned", "pre_assigned", "in_transition"])
    .is("check_out_time", null)
    .gte("check_in_time", busyWindow)) as unknown as {
      data: BusyDealerRow[] | null;
      error: CandidateQueryError | null;
    };
  if (busyDealersError) return candidateQueryFailure(busyDealersError, "busy_attendance");
  for (const bd of busyDealers ?? []) {
    busyDealerIds.add(bd.dealer_id);
  }

  if (busyDealerIds.size > 0) {
    console.log(`[pickNextDealer] Club ${clubId}: ${busyDealerIds.size} dealers excluded as busy (24h window)`);
  }

  // ── Break pool guard (independent check, runs BEFORE OR logic) ──
  // Hard wall-clock check using NOW(): excludes dealers still within the
  // inter-swing rest period. This is a HARD requirement that cannot be
  // bypassed by the OR logic (passedMinutesSinceRest via swingDueAt) NOR
  // by escalation tiers — always enforces minimum 10 minutes of rest.
  const restGuardExcludedIds = new Set<string>();
  const guardMinutes = Math.max(minInterSwingRestMinutes, SWING_POLICY.rest.hardRestFloorMinutes);
  if (!reservationMode && guardMinutes > 0) {
    const restCutoff = new Date(Date.now() - guardMinutes * 60_000).toISOString();
    const { data: restingDealers, error: restingDealersError } = (await admin
      .from("dealer_attendance")
      .select("id")
      .in("id", attendanceIds)
      .not("last_released_at", "is", null)
      .gt("last_released_at", restCutoff)) as unknown as {
        data: RestingDealerRow[] | null;
        error: CandidateQueryError | null;
      };
    if (restingDealersError) return candidateQueryFailure(restingDealersError, "rest_guard");
    for (const rd of restingDealers ?? []) {
      restGuardExcludedIds.add(rd.id);
    }
    if (restingDealers && restingDealers.length > 0) {
      console.log(
        `[pickNextDealer] Break pool guard: ${restingDealers.length} dealers excluded ` +
        `(rest not completed, cutoff=${restCutoff})`
      );
    }
  }

  // ── Pool cooldown guard (1 phút cho Telegram kịp gửi pre-assign) ──
  // Dealer vừa vào pool (vừa release hoặc break vừa kết thúc) cần tối
  // thiểu 1 phút để Telegram kịp gửi thông báo pre-assigned trước khi
  // bị pick lại. pool_entered_at được set = NOW() khi:
  //   - perform_swing release dealer
  //   - execute_pre_assigned_swing release dealer
  //   - end_expired_breaks kết thúc break
  // NULL → dealer chưa từng release (new hire) → skip.
  const poolCooldownMinutes = SWING_POLICY.rest.poolCooldownMinutes;
  if (poolCooldownMinutes > 0) {
    try {
      const poolCutoff = new Date(Date.now() - poolCooldownMinutes * 60_000).toISOString();
      const { data: poolDealers, error: poolErr } = (await admin
        .from("dealer_attendance")
        .select("id")
        .in("id", attendanceIds)
        .in("current_state", ["available", "on_break"])
        .not("pool_entered_at", "is", null)
        .gt("pool_entered_at", poolCutoff)) as unknown as {
          data: RestingDealerRow[] | null;
          error: CandidateQueryError | null;
        };
      if (poolErr) {
        // Fail-SAFE (P2 hardening, audit 2026-07-02): this used to just log and continue,
        // silently skipping the cooldown exclusion — a dealer still inside their 1-min
        // pool-entry grace (before Telegram can send the pre-assign notice) could then be
        // picked. Mirror Step 2's error handling above: bail with no candidates rather than
        // proceed on data this guard couldn't verify.
        console.error(`[pickNextDealer] Pool cooldown query error — failing safe (no candidates): ${poolErr.message}`);
        return candidateQueryFailure(poolErr, "pool_cooldown");
      }
      if (poolDealers && poolDealers.length > 0) {
        for (const pd of poolDealers) {
          restGuardExcludedIds.add(pd.id);
        }
        console.log(
          `[pickNextDealer] Pool cooldown guard: ${poolDealers.length} dealers excluded ` +
          `(entered pool < ${poolCooldownMinutes}min ago, cutoff=${poolCutoff})`
        );
      }
    } catch (poolCatchErr) {
      // Same fail-safe as above — an exception here must not silently skip the exclusion.
      console.error(`[pickNextDealer] Pool cooldown exception — failing safe (no candidates):`, poolCatchErr);
      return candidateQueryFailure(poolCatchErr, "pool_cooldown");
    }
  }

  const diag: PickDiagnostics = {
    total_rows: rows.length,
    duplicate_dealer_rows: duplicateDealerRows,
    busy_excluded: 0,
    exclude_set_excluded: 0,
    tier_excluded: 0,
    fatigue_excluded: 0,
    priority_break_excluded: 0,
    break_pool_guard_excluded: 0,
    min_rest_excluded: 0,
    on_break_excluded: 0,
    inter_swing_cooldown_excluded: 0,
    game_type_excluded: 0,
    meal_break_excluded: 0,
    step5b_pre_assigned_refs: 0,
    step5c_pre_assigned: 0,
    candidates_count: 0,
  };


  // Step 5b: Cross-check dealer_assignments for dealers that appear available
  // or on_break in dealer_attendance but actually have active assignments at a
  // different table (B6 defense). Includes on_break and pre_assigned statuses.
  // Table-aware: excludes assignments at currentTableId since dealer on_break
  // at the table being picked for is valid (they'll be replaced).
  // TODO: Add advisory lock per-dealer to prevent race condition when 2 tables
  // pick the same dealer concurrently (Bug A — club-level lock is sufficient for now).
  if (dealerIds.length > 0) {
    let busyAssignmentsQuery = admin
      .from("dealer_assignments")
      .select("dealer_id, table_id, status, attendance_id")
      .in("dealer_id", dealerIds)
      // 'reserved' = Step-2 empty-table reservation: the dealer is held for an
      // empty table, so they must NOT be picked for another table.
      .in("status", ["assigned", "pre_assigned", "on_break", "reserved"])
      .is("released_at", null);

    if (currentTableId) {
      busyAssignmentsQuery = busyAssignmentsQuery.neq("table_id", currentTableId);
    } else {
      console.warn(
        `[pickNextDealer] Club ${clubId}: currentTableId not provided — ` +
        `table-aware guard disabled. Verify excludeAttendanceIds covers current table dealers.`
      );
    }

    const { data: busyAssignments, error: busyAssignmentsError } = (await busyAssignmentsQuery) as unknown as {
      data: BusyAssignmentRow[] | null;
      error: CandidateQueryError | null;
    };
    if (busyAssignmentsError) return candidateQueryFailure(busyAssignmentsError, "busy_assignments");

    // Shared "busy" predicate: an active assignment only marks a dealer BUSY if
    // its linked attendance is still CHECKED IN. An assignment tied to a
    // checked-out attendance is an ORPHAN (the dealer left) — counting it as busy
    // is exactly what froze club 22222222 (Step 5b matches by dealer_id, so an old
    // checked-out attendance's orphan poisoned the dealer's NEW pool entry).
    // Only SKIP rows we can POSITIVELY confirm are orphaned (attendance
    // check_out_time IS NOT NULL); unknown/null attendance keeps the B6 defense.
    const busyAttIds = [
      ...new Set((busyAssignments ?? []).map((b) => b.attendance_id).filter(Boolean) as string[]),
    ];
    const checkedOutAttIds = new Set<string>();
    if (busyAttIds.length > 0) {
      const { data: goneAtt, error: goneAttError } = (await admin
        .from("dealer_attendance")
        .select("id")
        .in("id", busyAttIds)
        .not("check_out_time", "is", null)) as unknown as {
          data: { id: string }[] | null;
          error: CandidateQueryError | null;
        };
      if (goneAttError) return candidateQueryFailure(goneAttError, "checked_out_busy_attendance");
      for (const a of goneAtt ?? []) checkedOutAttIds.add(a.id);
    }

    let step5bBusy = 0;
    let step5bOrphansSkipped = 0;
    for (const ba of busyAssignments ?? []) {
      if (ba.attendance_id && checkedOutAttIds.has(ba.attendance_id)) {
        step5bOrphansSkipped++; // checked-out orphan — do NOT exclude the dealer
        continue;
      }
      busyDealerIds.add(ba.dealer_id);
      step5bBusy++;
    }

    if (step5bBusy > 0 || step5bOrphansSkipped > 0) {
      console.log(
        `[pickNextDealer] Club ${clubId}: ${step5bBusy} dealers excluded by assignment cross-check (Step 5b)` +
        (step5bOrphansSkipped > 0 ? `, ${step5bOrphansSkipped} checked-out orphan row(s) skipped` : "") +
        (currentTableId ? ` [table-aware: excluding table ${currentTableId}]` : " [no table-aware filter]")
      );
    }

    // ── Step 5b-ext: Check pre_assigned_attendance_id references ──
    // A dealer's attendance_id may be referenced as pre_assigned_attendance_id
    // in another active assignment. This catches the gap where pre-assign RPC
    // sets dealer_attendance.state='pre_assigned' but doesn't create an assignment
    // record for the incoming dealer.
    const { data: preAssignedRefs, error: preAssignedRefsError } = (await admin
      .from("dealer_assignments")
      .select("pre_assigned_attendance_id")
      .in("pre_assigned_attendance_id", attendanceIds)
      .in("status", ["assigned", "on_break"])
      .is("released_at", null)) as unknown as {
        data: PreAssignedRefRow[] | null;
        error: CandidateQueryError | null;
      };
    if (preAssignedRefsError) return candidateQueryFailure(preAssignedRefsError, "pre_assigned_references");

    const preAssignedRefIds = new Set(
      (preAssignedRefs ?? []).map((r) => r.pre_assigned_attendance_id)
    );

    for (const row of rows) {
      if (preAssignedRefIds.has(row.id)) {
        if (!busyDealerIds.has(row.dealer_id)) {
          diag.step5b_pre_assigned_refs++;
          console.warn(
            `[pickNextDealer] Step 5b-ext: Dealer ${row.dealer_id} excluded ` +
            `(attendance ${row.id} referenced as pre_assigned_attendance_id in another active assignment)`
          );
        }
        busyDealerIds.add(row.dealer_id);
      }
    }

    if (diag.step5b_pre_assigned_refs > 0) {
      console.log(
        `[pickNextDealer] Club ${clubId}: ${diag.step5b_pre_assigned_refs} dealers ` +
        `excluded by Step 5b-ext (pre_assigned_attendance_id reference)`
      );
    }
  }

  // ── Step 5c: Safety net — catch pre_assigned dealers without assignment record ──
  // Pre-assign RPC sets dealer_attendance.current_state='pre_assigned' but does NOT
  // create a dealer_assignments record. Step 5b misses them. This catches the gap.
    const { data: preAssignedDealers, error: preAssignedDealersError } = (await admin
      .from("dealer_attendance")
    .select("dealer_id, id, pre_assigned_table_id")
    .in("dealer_id", dealerIds)
    .eq("current_state", "pre_assigned")
    .is("check_out_time", null)) as unknown as {
      data: PreAssignedDealerRow[] | null;
      error: CandidateQueryError | null;
    };
  if (preAssignedDealersError) return candidateQueryFailure(preAssignedDealersError, "pre_assigned_attendance");

  for (const pad of preAssignedDealers ?? []) {
    if (!busyDealerIds.has(pad.dealer_id)) {
      diag.step5c_pre_assigned++;
      console.warn(
        `[pickNextDealer] Step 5c: Dealer ${pad.dealer_id} excluded ` +
        `(attendance ${pad.id} pre_assigned to table ${pad.pre_assigned_table_id}, ` +
        `no assignment record yet)`
      );
    }
    busyDealerIds.add(pad.dealer_id);
  }

  if (diag.step5c_pre_assigned > 0) {
    console.log(
      `[pickNextDealer] Club ${clubId}: ${diag.step5c_pre_assigned} dealers ` +
      `excluded by Step 5c (pre_assigned without assignment record)`
    );
  }

  // Step 6: Fetch club average break ratio once if needed for equity scoring
  // null = insufficient data → skip break equity penalty entirely
  let avgBreakRatio: number | null = clubAvgBreakRatio ?? null;
  if (includeScoreBreakdown && avgBreakRatio === null && clubId) {
    const { data: allMetricsRaw, error: allMetricsError } = (await admin
      .from("dealer_shift_metrics")
      .select("total_worked_minutes, total_break_minutes")
      .eq("club_id", clubId)) as unknown as {
        data: ClubMetricRow[] | null;
        error: CandidateQueryError | null;
      };
    if (allMetricsError) return candidateQueryFailure(allMetricsError, "club_shift_metrics");
    const totalW = (allMetricsRaw ?? []).reduce(
      (s: number, m) => s + (m.total_worked_minutes ?? 0), 0
    );
    const totalB = (allMetricsRaw ?? []).reduce(
      (s: number, m) => s + (m.total_break_minutes ?? 0), 0
    );
    if (totalW > 0) avgBreakRatio = totalB / totalW;
  }

  // ── Meal break exclusion (defense-in-depth) ──────────────────────────────
  // Dealers currently in an active meal break must NOT be picked, even if
  // state transition hasn't happened yet (cron delay).
  const { data: activeMealBreaks, error: activeMealBreaksError } = (await admin
    .from("dealer_meal_breaks")
    .select("attendance_id, break_start, total_duration_minutes")
    .in("attendance_id", attendanceIds)
    .eq("status", "active")) as unknown as {
      data: ActiveMealBreakRow[] | null;
      error: CandidateQueryError | null;
    };
  if (activeMealBreaksError) return candidateQueryFailure(activeMealBreaksError, "meal_breaks");

  const now = Date.now();
  const mealBreakExcludedIds = new Set<string>();
  for (const mb of activeMealBreaks ?? []) {
    const elapsed = (now - new Date(mb.break_start).getTime()) / 60_000;
    const durationMinutes = mb.total_duration_minutes ?? 0;
    if (elapsed < durationMinutes) {
      mealBreakExcludedIds.add(mb.attendance_id);
    }
  }


  const candidates: DealerCandidate[] = [];

  // ════════════════════════════════════════════════════════════════════════
  // Per-dealer evaluation runs in two EXPLICIT phases (A2):
  //   PHASE 1 — HARD ELIGIBILITY FILTERS (tier-1: safety / impossibility).
  //     A dealer who fails ANY hard filter is `continue`d out of the pool
  //     entirely (recorded via a diag.*_excluded counter). priority_break_flag
  //     is a HARD gate here (excluded until rested ≥ restThreshold), NOT a soft
  //     score term — there is no residual score penalty for a flagged dealer
  //     who passed the gate.
  //   PHASE 2 — SOFT PREFERENCE SCORING (tiers 2–5: SLA / fatigue / fairness /
  //     preference). A single weighted score that only REORDERS the dealers who
  //     survived PHASE 1; soft terms never exclude.
  // ════════════════════════════════════════════════════════════════════════
  for (const row of rows) {
    // ── Intra-cycle exclusion ────────────────────────────────────────────────
    // Accumulative exclusion: dealers picked in earlier phases (Fill, Pass 2)
    // are excluded from later phases (Pass 3). The caller manages the set.
    if (busyDealerIds.has(row.dealer_id)) { diag.busy_excluded++; continue; }
    if (excludeAttendanceIds.has(row.id)) { diag.exclude_set_excluded++; continue; }

    // ── Meal break exclusion (defense-in-depth) ─────────────────────────────
    if (mealBreakExcludedIds.has(row.id)) { diag.meal_break_excluded++; continue; }

    // ── Break pool guard ────────────────────────────────────────────────────
    // Dealer still within inter-swing rest period → hard exclude.
    // Runs before every other check (tier, fatigue, rest cooldown, etc).
    if (restGuardExcludedIds.has(row.id)) { diag.break_pool_guard_excluded++; continue; }

    // ── Emergency pre-assign guard (defense-in-depth) ─────────────────────────
    // Dealers already emergency-pre-assigned to another table must NOT be picked.
    // This is redundant with busyDealerIds (Step 5 queries pre_assigned) but
    // protects against race conditions if state hasn't propagated yet.
    if (row.current_state === "pre_assigned") {
      diag.busy_excluded++;
      console.warn(`[pickNextDealer] Dealer ${row.dealer_id} skipped: current_state=pre_assigned`);
      continue;
    }

    // ── availableOnly (empty-table auto-fill, owner policy 2026-06-15) ──────────
    // Pick ONLY genuinely-free dealers — never pull an on_break dealer off break.
    if (availableOnly && row.current_state !== "available") {
      diag.on_break_excluded++;
      continue;
    }

    const d = row.dealers;
    const tier: "A" | "B" | "C" = d.tier ?? "C";
    const skills: string[] = d.skills ?? [];
    const workedMin = row.worked_minutes_since_last_break ?? 0;
    const metric = metricsMap.get(row.id);
    const restMin = metric?.minutes_since_rest ?? 999;
    const consecutive = metric?.total_assignments ?? 0;
    const lastTableId = lastTableMap.get(row.id) ?? null;
    const lastTourTier = lastTourTierMap.get(row.id) ?? "";
    const priorityBreak = row.priority_break_flag ?? false;

    // ── On-break minimum rest guard ──────────────────────────────────────────────
    // Dealers on_break are NOT eligible while they still have an active break
    // record (break_end IS NULL) � the break must be explicitly ended first,
    // regardless of how long it has been running.
    // Fallback: if the break record is missing/stale, use computed restMin.
    if (row.current_state === "on_break") {
      const activeBreakTimestamp = activeBreakMap.get(row.id) ?? null;

      if (activeBreakTimestamp !== null) {
        diag.on_break_excluded++;
        continue;
      }

      if (restMin < minBreakMinutes) {
        console.warn(
          `[ANOMALY] Dealer ${row.id}: state=on_break, no break record. ` +
          `Excluded (restMin=${restMin.toFixed(1)}m < minBreak=${minBreakMinutes}m)`
        );
        diag.min_rest_excluded++;
        continue;
      }
    }

    // ── High-stakes tier guard ─────────────────────────────────────────────
    // HIGH tournaments require A+ tier dealers. Exclude C tier entirely.
    // MEDIUM tournaments prefer B tier but accept A/C.
    if (tourTier === "HIGH" && tier === "C") { diag.tier_excluded++; continue; }

    // ── Fatigue hard cap ────────────────────────────────────────────────────
    // Dealer who hasn't rested enough after a long session needs mandatory rest.
    // Uses restMin (computed from timestamps, never stale) instead of the
    // worked_minutes_since_last_break column. Excluded UNLESS skipFatigueHardCap
    // is set (Level 3 emergency only). When skipped, heavy score penalty applies.
    const fatigueHardCap = consecutive >= SWING_POLICY.fatigue.fatigueHardCapConsecutive && restMin < SWING_POLICY.fatigue.fatigueHardCapRestMinutes;
    if (!skipFatigueHardCap && fatigueHardCap) { diag.fatigue_excluded++; continue; }

    // ── Priority break — TIER-1 HARD GATE (A2) ──────────────────────────────
    // priority_break_flag is a HARD eligibility gate, NOT a soft score term.
    // A flagged dealer is excluded until rested ≥ restThreshold. The emergency
    // skipPriorityBreakGuard bypass (Tier-2/3 OT escalation) is the ONLY override
    // and MUST stay — removing it would break emergency escalation under shortage.
    // A2 removed the old -500 soft penalty (see PHASE 2): a flagged dealer who
    // passes this gate is "rested enough" and competes on equal footing.
    // Rest threshold = break_duration_minutes + 5 buffer (default 20+5=25).
    const restThreshold = (clubBreakDurationMinutes ?? SWING_POLICY.fatigue.defaultClubBreakDurationMinutes) + SWING_POLICY.fatigue.priorityBreakRestBufferMinutes;
    if (!skipPriorityBreakGuard && priorityBreak && restMin < restThreshold) { diag.priority_break_excluded++; continue; }

    // ── Rest cooldown (OR logic) ────────────────────────────────────────────
    // Two checks — dealer passes if EITHER is satisfied:
    //   1. minutes_since_rest ≥ minRestMinutes (shift fatigue — can be
    //      lowered by escalation: Tier 1=5, Tier 2=3, Tier 3=0)
    //   2. last_released_at ≥ minInterSwingRestMinutes ago (inter-swing gap
    //      — uses swingDueAt for predictive pre-assignment)
    // NULL last_released_at → treated as "very old" → passes check #2.
    if (minInterSwingRestMinutes > 0 && (row.current_state === "available" || row.current_state === "on_break")) {
      const passedMinutesSinceRest = restMin >= minRestMinutes;

      let referenceTime = Date.now();
      if (swingDueAt) {
        referenceTime = Math.min(
          new Date(swingDueAt).getTime(),
          Date.now() + SWING_POLICY.rest.predictiveHorizonMinutes * 60_000,
        );
      }
      const releasedAt = (row as any).last_released_at;
      const minutesSinceRelease = releasedAt
        ? (referenceTime - new Date(releasedAt).getTime()) / 60_000
        : Infinity;
      const EPSILON_SEC = SWING_POLICY.rest.restEpsilonMinutes; // 1-second grace for millisecond timing edge cases
      const passedLastReleased = minutesSinceRelease >= minInterSwingRestMinutes - EPSILON_SEC;

      if (!passedMinutesSinceRest && !passedLastReleased) {
        console.log(
          `[pickNextDealer] Rest: dealer ${row.dealer_id} excluded — ` +
          `minutes_since_rest=${restMin.toFixed(1)}m (need ${minRestMinutes}m), ` +
          `last_released=${releasedAt ? minutesSinceRelease.toFixed(1) + 'm' : 'NULL'} (need ${minInterSwingRestMinutes}m)`
        );
        diag.min_rest_excluded++;
        continue;
      }
      if (passedMinutesSinceRest && !passedLastReleased) {
        console.log(
          `[PREDICTIVE] Dealer ${row.dealer_id}: minutes_since_rest=${restMin.toFixed(1)}m ≥ ${minRestMinutes}m, ` +
          `last_released=${minutesSinceRelease.toFixed(1)}m < ${minInterSwingRestMinutes}m. Allowing via shift rest.`
        );
      }
    }

    // ── Soft cap warning (log only, do not block) ────────────────────────────
    // Issue 6: track high-consecutive dealers for admin review. Fire-and-forget
    // so the scoring loop isn't blocked by an insert. clubId is in scope from
    // buildDealerCandidates param (line 87). Warning only, no hard cap (P2).
    if (consecutive >= SWING_POLICY.fatigue.softCapWarningConsecutive) {
      void (admin as unknown as {
        from: (table: string) => {
          insert: (values: Record<string, unknown>) => Promise<unknown>;
        };
      }).from("diagnostic_logs").insert({
        club_id: clubId,
        diagnostic_type: "high_consecutive_warning",
        result: {
          attendance_id: row.id,
          dealer_id: row.dealer_id,
          dealer_name: d.full_name,
          consecutive_swings: consecutive,
          rest_minutes: restMin,
        },
        metadata: {
          table_id: currentTableId,
          tournament_tier: tourTier,
        },
      }).then((result) => {
        const { error } = result as { error?: { message: string } };
        if (error) console.warn("[soft-cap] log failed:", error.message);
      });
    }

    // ── Game type hard-exclude ──────────────────────────────────────────────
    // If the table requires specific game types (e.g., "Omaha", "Mixed"),
    // and the dealer has NONE of those skills → hard exclude.
    if (
      requiredGameTypes &&
      requiredGameTypes.length > 0 &&
      !requiredGameTypes.some((g) => skills.includes(g))
    ) {
      diag.game_type_excluded++;
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2 — SOFT PREFERENCE SCORING (tiers 2–5). Only dealers that survived
    // every PHASE-1 hard filter reach here. These terms REORDER; never exclude.
    // ════════════════════════════════════════════════════════════════════════
    let score = 0;

    // ── On-break penalty ────────────────────────────────────────────────────────
    // Dealers on_break are eligible but deprioritized vs available dealers.
    // They've rested enough but are currently pulled out of rotation.
    if (row.current_state === "on_break") { score += SWING_POLICY.scoring.onBreakPenalty; }
    const breakdown: ScoreBreakdown = {
      rest_bonus: 0, tier_bonus: 0,
      back_to_back_penalty: 0, consecutive_penalty: 0,
      mixed_bonus: 0, skill_bonus: 0,
      priority_break_penalty: 0,
      heavy_worker_penalty: 0, consecutive_high_penalty: 0,
      tier_back_to_back_penalty: 0, break_equity_penalty: 0,
      priority_swing_bonus: 0,
      fatigue_penalty: 0,
    };

    // Rest bonus — prefer well-rested dealers
    if (restMin >= SWING_POLICY.scoring.restBonusHighMinutes) { breakdown.rest_bonus = SWING_POLICY.scoring.restBonusHigh; score += SWING_POLICY.scoring.restBonusHigh; }
    else if (restMin >= SWING_POLICY.scoring.restBonusMidMinutes) { breakdown.rest_bonus = SWING_POLICY.scoring.restBonusMid; score += SWING_POLICY.scoring.restBonusMid; }
    else if (restMin >= SWING_POLICY.scoring.restBonusLowMinutes) { breakdown.rest_bonus = SWING_POLICY.scoring.restBonusLow; score += SWING_POLICY.scoring.restBonusLow; }

    // Tier bonus — prefer dealers whose tier matches the table
    if (tourTier === "HIGH") {
      if (tier === "A") { breakdown.tier_bonus = SWING_POLICY.scoring.tierBonusHighA; score += SWING_POLICY.scoring.tierBonusHighA; }
      else if (tier === "B") { breakdown.tier_bonus = SWING_POLICY.scoring.tierBonusHighB; score += SWING_POLICY.scoring.tierBonusHighB; }
    } else if (tourTier === "MEDIUM") {
      if (tier === "B") { breakdown.tier_bonus = SWING_POLICY.scoring.tierBonusMediumB; score += SWING_POLICY.scoring.tierBonusMediumB; }
    } else {
      if (tier === "C") { breakdown.tier_bonus = SWING_POLICY.scoring.tierBonusLowC; score += SWING_POLICY.scoring.tierBonusLowC; }
    }

    // Consecutive penalty — heavy load is tiring
    if (consecutive >= SWING_POLICY.fatigue.consecutivePenaltyThreshold) {
      breakdown.consecutive_penalty = consecutive * SWING_POLICY.scoring.consecutivePenaltyPerSwing;
      score += breakdown.consecutive_penalty;
    }

    // Mixed bonus
    if (skills.includes("Mixed")) { breakdown.mixed_bonus = SWING_POLICY.scoring.mixedBonus; score += SWING_POLICY.scoring.mixedBonus; }

    // Skill bonus — +20 per matching game type
    if (requiredGameTypes) {
      for (const g of requiredGameTypes) {
        if (skills.includes(g)) { breakdown.skill_bonus += SWING_POLICY.scoring.skillBonusPerMatch; score += SWING_POLICY.scoring.skillBonusPerMatch; }
      }
    }

    // Priority break: handled as a TIER-1 HARD GATE in PHASE 1 (excluded until
    // rested ≥ threshold). A2 removed the old -500 soft penalty — a flagged
    // dealer who passed the gate competes normally. breakdown.priority_break_penalty
    // stays 0 (field kept for C1 diagnostics shape).

    // Heavy worker penalty — avoid repeatedly picking the same dealer
    if (consecutive >= SWING_POLICY.fatigue.consecutivePenaltyThreshold) {
      breakdown.heavy_worker_penalty = SWING_POLICY.scoring.heavyWorkerPenaltyPerSwing * (consecutive - SWING_POLICY.scoring.heavyWorkerBaselineSwings);
      score += breakdown.heavy_worker_penalty;
    }

    // Consecutive HIGH penalty — rest after HIGH table assignments
    if (tourTier === "HIGH" && lastTourTier === "HIGH") {
      breakdown.consecutive_high_penalty = SWING_POLICY.scoring.consecutiveHighPenalty;
      score += breakdown.consecutive_high_penalty;
    }

    // Tier-aware back-to-back penalty — reduced penalty if switching tiers
    if (lastTableId && lastTableId === currentTableId) {
      const sameTier = lastTourTier === tourTier;
      breakdown.tier_back_to_back_penalty = sameTier ? SWING_POLICY.scoring.backToBackSameTierPenalty : SWING_POLICY.scoring.backToBackDiffTierPenalty;
      score += breakdown.tier_back_to_back_penalty;
    }

    // ── Break equity penalty ───────────────────────────────────────────────
    // Dealers with below-average break ratio get a small score penalty,
    // making them less likely to be picked for another full swing.
    // avgBreakRatio === null means insufficient data → skip entirely.
    if (avgBreakRatio !== null && avgBreakRatio > 0 && metric) {
      const dealerBreak = metric.total_break_minutes ?? 0;
      const dealerWorked = metric.total_worked_minutes ?? 0;
      const totalDealerTime = dealerBreak + dealerWorked;
      const dealerRatio = totalDealerTime > 0 ? dealerBreak / totalDealerTime : 0;

      if (dealerRatio < avgBreakRatio * SWING_POLICY.scoring.breakEquitySevereRatio) {
        // Significant break deficit: -80 penalty
        breakdown.break_equity_penalty = SWING_POLICY.scoring.breakEquitySeverePenalty;
        score += breakdown.break_equity_penalty;
      } else if (dealerRatio < avgBreakRatio * SWING_POLICY.scoring.breakEquityModerateRatio) {
        // Moderate break deficit: -30 penalty (gentle nudge)
        breakdown.break_equity_penalty = SWING_POLICY.scoring.breakEquityModeratePenalty;
        score += breakdown.break_equity_penalty;
      }
    }

    // Priority swing bonus — +300 ensures the priority table gets next available dealer
    if (isPrioritySwing) {
      breakdown.priority_swing_bonus = SWING_POLICY.scoring.prioritySwingBonus;
      score += SWING_POLICY.scoring.prioritySwingBonus;
    }

    // ── Fatigue penalty (Level 3 emergency override) ────────────────────────
    // When skipFatigueHardCap is active, dealers who haven't rested enough
    // after 4+ consecutive assignments get a -300 score penalty.
    if (skipFatigueHardCap && fatigueHardCap) {
      breakdown.fatigue_penalty = SWING_POLICY.scoring.fatiguePenalty;
      score += breakdown.fatigue_penalty;
    }

    const candidate: DealerCandidate = {
      id: row.id,
      dealer_id: row.dealer_id,
      full_name: d.full_name,
      telegram_username: d.telegram_username ?? undefined,
      telegram_user_id: d.telegram_user_id ?? undefined,
      tier,
      skills,
      worked_minutes_since_last_break: workedMin,
      last_table_id: lastTableId ?? undefined,
      consecutive_assignments: consecutive,
      rest_minutes: restMin,
      priority_break_flag: priorityBreak,
      current_state: row.current_state as "available" | "on_break",
      last_tour_tier: lastTourTier,
      last_released_at: (row as any).last_released_at ?? null,
      score,
    };

    if (includeScoreBreakdown) {
      candidate.score_breakdown = breakdown;
    }

    candidates.push(candidate);
  }

  diag.candidates_count = candidates.length;

  // Log detailed diagnostics when zero or very few candidates — circuit breaker debugging
  if (candidates.length === 0) {
    console.warn(`[pickNextDealer] ⚠️ Club ${clubId}: ZERO candidates — diagnostics:`, {
      ...diag,
      tourTier: options.tourTier || "(not set)",
      requiredGameTypes: options.requiredGameTypes || "(none)",
      skipPriorityBreakGuard: options.skipPriorityBreakGuard,
      skipFatigueHardCap: options.skipFatigueHardCap,
      minRestMinutes: options.minRestMinutes ?? 10,
      minInterSwingRestMinutes: options.minInterSwingRestMinutes ?? 10,
      busyDealerTotal: busyDealerIds.size,
      busyDealerIds: [...busyDealerIds],
    });
  } else if (candidates.length <= 2) {
    console.log(`[pickNextDealer] ℹ️ Club ${clubId}: ${candidates.length} candidates — diagnostics:`, diag);
  }

  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { candidates, avgBreakRatio, diag, status: "ok" };
}

// ─── pickNextDealer ───────────────────────────────────────────────────────────

export async function pickNextDealer(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<DealerCandidate | null> {
  const { candidates } = requireCandidateSnapshot(
    await buildDealerCandidates(admin, clubId, options),
  );
  return candidates[0] ?? null;
}

export async function pickNextDealerWithStatus(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {},
): Promise<PickNextDealerResult> {
  const result = await buildDealerCandidates(admin, clubId, options);
  return {
    candidate: result.candidates[0] ?? null,
    status: result.status,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  };
}

// ─── pickTopDealers ───────────────────────────────────────────────────────────

export async function pickTopDealers(
  admin: SupabaseAdmin,
  clubId: string,
  topN: number,
  options: Omit<PickDealerOptions, "returnTopN"> = {}
): Promise<DealerCandidate[]> {
  const { candidates } = requireCandidateSnapshot(
    await buildDealerCandidates(admin, clubId, options),
  );
  return candidates.slice(0, topN);
}

// ─── pickTopDealersWithDiagnostics ──────────────────────────────────────────
// Same as pickTopDealers but also returns the exclusion `diag` so callers (the
// assign-suggestions path) can surface "why other dealers were not chosen".
// Additive — existing pickTopDealers callers are unaffected.
export async function pickTopDealersWithDiagnostics(
  admin: SupabaseAdmin,
  clubId: string,
  topN: number,
  options: Omit<PickDealerOptions, "returnTopN"> = {}
): Promise<{ candidates: DealerCandidate[]; diag?: PickDiagnostics; avgBreakRatio: number | null }> {
  const { candidates, avgBreakRatio, diag } = requireCandidateSnapshot(
    await buildDealerCandidates(admin, clubId, options),
  );
  return { candidates: candidates.slice(0, topN), diag, avgBreakRatio };
}

// ─── buildRotationSupply (Forward Rotation Scheduler) ─────────────────────────
// Wraps buildDealerCandidates (reservation mode: still-resting dealers are
// admitted) and augments each candidate with the two solver timing fields:
//   prev_session_minutes — R3 fairness key (previous dealing session length)
//   eligible_at_ms       — R1: earliest moment the dealer may ENTER a table
//                          = max(last_released_at + rest, pool_entered_at + 1min)
// Existing exports are untouched; legacy callers are unaffected.

export interface RotationSupplyEntry extends DealerCandidate {
  prev_session_minutes: number;
  eligible_at_ms: number;
}

export type RotationSupplyResult = {
  supply: RotationSupplyEntry[];
  avgBreakRatio: number | null;
  status: BuildCandidatesResult["status"];
  errorCode?: string;
  /** Canonical exclusion counters from the candidate snapshot used by the solver. */
  diag?: PickDiagnostics;
};

export async function buildRotationSupply(
  admin: SupabaseAdmin,
  clubId: string,
  options: {
    excludeAttendanceIds?: Set<string>;
    minInterSwingRestMinutes?: number;
    clubBreakDurationMinutes?: number;
    requiredGameTypes?: string[];
  } = {}
): Promise<RotationSupplyResult> {
  // Plan-time eligibility floor MUST match the execute-time gate
  // (SWING_POLICY.rest.executeMinRestFloorMinutes), else the planner locks a dealer
  // who cannot pass the execute rest gate → the table stays stuck on OT while rested
  // dealers idle. Aligned 2026-07-06 (was a bare 10).
  const restMinutes = Math.max(
    options.minInterSwingRestMinutes ?? 10,
    SWING_POLICY.rest.executeMinRestFloorMinutes,
  );
  const poolCooldownMs = 60_000;

  const candidateResult = await buildDealerCandidates(admin, clubId, {
    excludeAttendanceIds: options.excludeAttendanceIds,
    clubBreakDurationMinutes: options.clubBreakDurationMinutes ?? 20,
    minInterSwingRestMinutes: restMinutes,
    requiredGameTypes: options.requiredGameTypes,
    reservationMode: true,
    // Admit dealers whose rest completes within the planning horizon. Horizon must
    // be >= the rest floor so a dealer who reaches the floor is still admitted.
    swingDueAt: new Date(
      Date.now() +
        Math.max(SWING_POLICY.rest.predictiveHorizonMinutes, SWING_POLICY.rest.executeMinRestFloorMinutes) * 60_000,
    ).toISOString(),
  });

  if (candidateResult.status !== "ok") {
    return {
      supply: [],
      avgBreakRatio: candidateResult.avgBreakRatio,
      status: candidateResult.status,
      ...(candidateResult.errorCode ? { errorCode: candidateResult.errorCode } : {}),
      ...(candidateResult.diag ? { diag: candidateResult.diag } : {}),
    };
  }

  const { candidates, avgBreakRatio, diag } = candidateResult;

  if (candidates.length === 0) return { supply: [], avgBreakRatio, status: "ok", ...(diag ? { diag } : {}) };

  const attendanceIds = candidates.map((c) => c.id);

  // Latest released session per candidate → prev session length + rest anchor.
  const { data: releasedRows, error: releasedRowsError } = await admin
    .from("dealer_assignments")
    .select("attendance_id, assigned_at, released_at")
    .in("attendance_id", attendanceIds)
    .not("released_at", "is", null)
    .order("released_at", { ascending: false })
    // Global ordering means a prolific dealer's rows could crowd others out;
    // ~25 sessions/dealer/day is well above any real shift.
    .limit(Math.min(1000, attendanceIds.length * 25));
  if (releasedRowsError) {
    const failure = classifyPostgrestError(releasedRowsError);
    return {
      supply: [],
      avgBreakRatio,
      status: failure.status,
      errorCode: `rotation_supply_released_sessions_${failure.status}`,
      ...(diag ? { diag } : {}),
    };
  }

  const lastSession = new Map<string, { assignedAtMs: number; releasedAtMs: number }>();
  for (const row of (releasedRows ?? []) as Array<{ attendance_id: string; assigned_at: string | null; released_at: string }>) {
    if (lastSession.has(row.attendance_id)) continue;
    lastSession.set(row.attendance_id, {
      assignedAtMs: row.assigned_at ? new Date(row.assigned_at).getTime() : new Date(row.released_at).getTime(),
      releasedAtMs: new Date(row.released_at).getTime(),
    });
  }

  const { data: poolRows, error: poolRowsError } = await admin
    .from("dealer_attendance")
    .select("id, pool_entered_at")
    .in("id", attendanceIds);
  if (poolRowsError) {
    const failure = classifyPostgrestError(poolRowsError);
    return {
      supply: [],
      avgBreakRatio,
      status: failure.status,
      errorCode: `rotation_supply_pool_timestamps_${failure.status}`,
      ...(diag ? { diag } : {}),
    };
  }

  const poolEnteredAt = new Map<string, number>();
  for (const row of (poolRows ?? []) as Array<{ id: string; pool_entered_at: string | null }>) {
    if (row.pool_entered_at) poolEnteredAt.set(row.id, new Date(row.pool_entered_at).getTime());
  }

  const supply: RotationSupplyEntry[] = candidates.map((c) => {
    const session = lastSession.get(c.id);
    const prevSessionMinutes = session
      ? Math.max(0, Math.round((session.releasedAtMs - session.assignedAtMs) / 60_000))
      : 0;
    const restEligible = session ? session.releasedAtMs + restMinutes * 60_000 : 0;
    const poolEligible = (poolEnteredAt.get(c.id) ?? 0) + poolCooldownMs;
    return {
      ...c,
      prev_session_minutes: prevSessionMinutes,
      eligible_at_ms: Math.max(restEligible, poolEligible),
    };
  });

  return { supply, avgBreakRatio, status: "ok", ...(diag ? { diag } : {}) };
}

// ─── buildScoreLabel ──────────────────────────────────────────────────────────

export function buildScoreLabel(tier: string, scoreBreakdown: ScoreBreakdown): string {
  const parts: string[] = [];
  if (tier === "A") parts.push("Dealer hạng A ưu tiên");
  else if (tier === "B") parts.push("Hạng B – phù hợp");
  if (scoreBreakdown.rest_bonus >= 200) parts.push("Thời gian nghỉ dài");
  else if (scoreBreakdown.rest_bonus >= 100) parts.push("Nghỉ ngơi đủ");
  if (scoreBreakdown.skill_bonus > 0) parts.push("Có kỹ năng phù hợp");
  if (scoreBreakdown.tier_back_to_back_penalty < 0) parts.push("Tránh bàn cũ");
  if (scoreBreakdown.heavy_worker_penalty < 0) parts.push("Đã làm nhiều swing");
  if (scoreBreakdown.consecutive_high_penalty < 0) parts.push("Nghỉ bàn HIGH");
  // priority_break removed from scoring in A2 (now a tier-1 HARD gate). No sign-keyed label.
  if (scoreBreakdown.break_equity_penalty < 0) parts.push("Cần cân bằng nghỉ");
  if (scoreBreakdown.priority_swing_bonus > 0) parts.push("Bàn ưu tiên");
  if (scoreBreakdown.fatigue_penalty < 0) parts.push("Khẩn cấp – mệt nhiều");
  return parts.length ? parts.join(" · ") : "Sẵn sàng";
}
