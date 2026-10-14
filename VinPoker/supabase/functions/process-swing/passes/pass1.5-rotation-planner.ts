import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDealerCandidates,
  type BuildCandidatesResult,
} from "../../_shared/pickNextDealer.ts";
import { solveGreedyLazy } from "../../_shared/rotationSolver.ts";
import type { SolverOptions } from "../../_shared/rotationSolver.ts";
import {
  toRotationCandidate,
  normalizeGameTypes,
} from "../../_shared/rotationTypes.ts";
import type {
  RotationTable,
  Pass15Options,
  Pass15Result,
  MissedTableReason,
} from "../../_shared/rotationTypes.ts";

const RPC_TIMEOUT_MS = parseInt(Deno.env.get("PASS15_RPC_TIMEOUT_MS") ?? "5000");
const MAX_PAIRS_PER_RUN = parseInt(Deno.env.get("PASS15_MAX_PAIRS") ?? "10");

export interface Pass15Dependencies {
  candidateBuilder?: typeof buildDealerCandidates;
  solver?: typeof solveGreedyLazy;
}

async function callWithTimeout<T>(
  promise: any,
  ms: number,
  label: string
): Promise<any> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
  );
  return Promise.race([promise, timer]);
}

async function verifyStillUnassigned(
  admin: any,
  tableIds: string[],
  clubId: string
): Promise<{ ids: Set<string>; error: string | null }> {
  if (tableIds.length === 0) return { ids: new Set(), error: null };
  const { data, error } = await admin
    .from("dealer_assignments")
    .select("table_id")
    .eq("club_id", clubId)
    .eq("status", "assigned")
    .is("swing_processed_at", null)
    .is("pre_assigned_attendance_id", null)
    .in("table_id", tableIds);
  if (error) return { ids: new Set(), error: error.message ?? "eligibility_snapshot_failed" };
  if (!Array.isArray(data)) return { ids: new Set(), error: "eligibility_snapshot_invalid" };
  return { ids: new Set(data.map((r: any) => r.table_id)), error: null };
}

export async function pass15RotationPlanner(
  admin: any,
  clubId: string,
  options: Pass15Options,
  dependencies: Pass15Dependencies = {},
): Promise<Pass15Result> {
  const { dryRun, preAnnounceMinutes, requiredGameTypes, cycleExcludedIds } = options;
  const solverStart = Date.now();
  console.log(`[Pass 1.5] 🔄 Starting rotation planner for club ${clubId}${dryRun ? " (dryRun)" : ""}`);

  // Step 1: Query tables in upcoming rotation window
  const windowStart = new Date(Date.now() + 60_000).toISOString();
  const windowEnd = new Date(Date.now() + (preAnnounceMinutes - 2) * 60_000).toISOString();

  const { data: upcomingAssignments, error: queryErr } = await admin
    .from("dealer_assignments")
    .select(`
      id, table_id, attendance_id, version, pre_assigned_attendance_id,
      game_tables!inner(id, table_name, table_type, game_type, tour_tier)
    `)
    .eq("club_id", clubId)
    .eq("status", "assigned")
    .is("released_at", null)
    .is("swing_processed_at", null)
    .gte("swing_due_at", windowStart)
    .lt("swing_due_at", windowEnd);

  if (queryErr) {
    console.error("[Pass 1.5] Query error:", queryErr.message);
    return {
      assigned: 0, unassigned: 0, raceLost: 0, errors: [{ tableId: "query", error: queryErr.message }],
      missReasons: {}, solverDurationMs: Date.now() - solverStart,
    };
  }

  if (!upcomingAssignments || upcomingAssignments.length === 0) {
    console.log("[Pass 1.5] No tables in rotation window");
    return {
      assigned: 0, unassigned: 0, raceLost: 0, errors: [],
      missReasons: {}, solverDurationMs: Date.now() - solverStart,
    };
  }

  // Step 2: Filter to tables not already pre-assigned and not in cycleExcludedIds
  const tables: RotationTable[] = [];
  for (const a of upcomingAssignments) {
    if (a.pre_assigned_attendance_id) continue;
    const gt = a.game_tables as any;
    tables.push({
      id: a.table_id,
      tourTier: gt?.tour_tier ?? "LOW",
      gameTypes: normalizeGameTypes(
        gt?.game_type ? [gt.game_type] : []
      ),
      currentAttendanceId: a.attendance_id ?? null,
    });
  }

  if (tables.length === 0) {
    console.log("[Pass 1.5] All tables already pre-assigned, nothing to do");
    return {
      assigned: 0, unassigned: 0, raceLost: 0, errors: [],
      missReasons: {}, solverDurationMs: Date.now() - solverStart,
    };
  }

  // Step 3: A failed snapshot is not a valid empty dealer pool. Stop before the
  // solver or any pre-assignment RPC; process-swing maps this explicitly.
  const candidateResult: BuildCandidatesResult = await (
    dependencies.candidateBuilder ?? buildDealerCandidates
  )(
    admin, clubId, {
      excludeAttendanceIds: cycleExcludedIds,
      includeScoreBreakdown: true,
      clubBreakDurationMinutes: 20,
    }
  );
  if (candidateResult.status !== "ok") {
    return {
      assigned: 0,
      unassigned: 0,
      raceLost: 0,
      errors: [],
      missReasons: {},
      solverDurationMs: Date.now() - solverStart,
      candidateStatus: candidateResult.status,
      candidateErrorCode: candidateResult.errorCode ?? `candidate_snapshot_${candidateResult.status}`,
    };
  }
  const { candidates: rawCandidates, avgBreakRatio } = candidateResult;

  // Dedup + convert to RotationCandidate
  const rotationCandidates = [];
  const seenAttendanceIds = new Set<string>();
  for (const c of rawCandidates) {
    if (seenAttendanceIds.has(c.id)) continue;
    seenAttendanceIds.add(c.id);
    rotationCandidates.push(toRotationCandidate(c, avgBreakRatio));
  }

  // Step 4: Solve greedy
  const solverOpts: SolverOptions = {
    avgBreakRatio,
    clubBreakDurationMinutes: 20,
  };

  const result = (dependencies.solver ?? solveGreedyLazy)(tables, rotationCandidates, solverOpts);

  const missReasons: Partial<Record<MissedTableReason, number>> = {};
  for (const { reason } of result.unassignedTables) {
    missReasons[reason] = (missReasons[reason] ?? 0) + 1;
  }

  // Early return if no pairs
  if (result.pairs.length === 0) {
    console.log(
      `[Pass 1.5] No pairs to assign (${result.unassignedTables.length} unassigned)`
    );
    return {
      assigned: 0,
      unassigned: result.unassignedTables.length,
      raceLost: 0,
      errors: [],
      missReasons,
      solverDurationMs: Date.now() - solverStart,
      ...(dryRun && { dryRun: true, diff: [] }),
    };
  }

  // Step 5: dryRun path — verify DB but skip writes
  if (dryRun) {
    const snapshot = await verifyStillUnassigned(
      admin, result.pairs.map(p => p.tableId), clubId
    );
    if (snapshot.error) return {
      assigned: 0, unassigned: 0, raceLost: 0,
      errors: [{ tableId: "eligibility_snapshot", error: snapshot.error }],
      missReasons: {}, solverDurationMs: Date.now() - solverStart, dryRun: true, diff: [],
    };
    const stillFree = snapshot.ids;
    const accurateDiff = result.pairs
      .filter(p => stillFree.has(p.tableId))
      .map(p => {
        const table = tables.find(t => t.id === p.tableId);
        return {
          tableId: p.tableId,
          tourTier: table?.tourTier ?? "?",
          wouldAssignAttendanceId: p.attendanceId,
          wouldAssignName: p.candidateName,
          score: p.score,
        };
      });

    return {
      assigned: 0,
      unassigned: result.unassignedTables.length,
      raceLost: 0,
      errors: [],
      missReasons,
      solverDurationMs: Date.now() - solverStart,
      dryRun: true,
      diff: accurateDiff,
    };
  }

  // Step 6: Write path — verify + sequential RPC calls with timeout
  const tableIdsToVerify = result.pairs.map(p => p.tableId);
  const snapshot = await verifyStillUnassigned(admin, tableIdsToVerify, clubId);
  if (snapshot.error) return {
    assigned: 0, unassigned: 0, raceLost: 0,
    errors: [{ tableId: "eligibility_snapshot", error: snapshot.error }],
    missReasons: {}, solverDurationMs: Date.now() - solverStart,
  };
  const stillFree = snapshot.ids;
  const eligiblePairs = result.pairs.filter(p => stillFree.has(p.tableId));
  const writablePairs = eligiblePairs.slice(0, MAX_PAIRS_PER_RUN);
  const deferredCount = eligiblePairs.length - writablePairs.length;

  if (writablePairs.length < result.pairs.length) {
    const capped = result.pairs.length - writablePairs.length;
    if (capped > 0) {
      console.warn(
        `[Pass 1.5] Capped pairs: ${result.pairs.length} → ${writablePairs.length}. ` +
        `Increase PASS15_MAX_PAIRS if needed.`
      );
    }
  }

  let assignedCount = 0;
  let raceLostCount = 0;
  const errors: Array<{ tableId: string; error: string }> = [];

  for (const pair of writablePairs) {
    // Re-verify right before write
    const { data: freshAssign } = await admin
      .from("dealer_assignments")
      .select("id, version, pre_assigned_attendance_id")
      .eq("table_id", pair.tableId)
      .eq("club_id", clubId)
      .eq("status", "assigned")
      .is("swing_processed_at", null)
      .maybeSingle();

    if (!freshAssign || freshAssign.pre_assigned_attendance_id !== null) {
      console.warn(`[Pass 1.5] Table ${pair.tableId} already pre-assigned, skipping`);
      continue;
    }

    let rpcResult: any;
    try {
      const { data } = await callWithTimeout(
        admin.rpc("pre_assign_next_dealer_for_table", {
          p_assignment_id: freshAssign.id,
          p_club_id: clubId,
          p_next_attendance_id: pair.attendanceId,
          p_version: freshAssign.version,
        }),
        RPC_TIMEOUT_MS,
        `pre_assign table ${pair.tableId}`
      );
      rpcResult = data;
    } catch (err: any) {
      errors.push({ tableId: pair.tableId, error: err.message });
      console.error(`[Pass 1.5] RPC timeout/error for table ${pair.tableId}:`, err.message);
      continue;
    }

    const outcome = rpcResult?.outcome;
    switch (outcome) {
      case "pre_assigned":
        cycleExcludedIds.add(pair.attendanceId);
        assignedCount++;
        break;
      case "race_lost":
        console.warn(`[Pass 1.5] race_lost table=${pair.tableId} dealer=${pair.attendanceId}`);
        raceLostCount++;
        break;
      case "dealer_unavailable":
        console.warn(`[Pass 1.5] dealer_unavailable dealer=${pair.attendanceId}`);
        break;
      case "error":
        errors.push({ tableId: pair.tableId, error: rpcResult?.detail ?? "rpc error" });
        break;
      default:
        errors.push({ tableId: pair.tableId, error: `unexpected outcome: ${outcome}` });
    }
  }

  const solverDurationMs = Date.now() - solverStart;
  console.log(
    `[Pass 1.5] solver=${result.solverVersion} assigned=${assignedCount} ` +
    `unassigned=${result.unassignedTables.length + deferredCount} deferred=${deferredCount} raceLost=${raceLostCount} ` +
    `durationMs=${solverDurationMs}${dryRun ? " (dryRun)" : ""}`
  );

  return {
    assigned: assignedCount,
    unassigned: result.unassignedTables.length + deferredCount,
    raceLost: raceLostCount,
    errors,
    missReasons,
    solverDurationMs,
  };
}
