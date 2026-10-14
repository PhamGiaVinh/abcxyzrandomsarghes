// Deterministic pure-function tests for solveRotationPlan (Forward Rotation Scheduler).
// HARD GATE: all cases must be green before any DB/edge integration goes live.
// Run: deno test supabase/functions/_shared/__tests__/rotationSolver.test.ts

import { solveRotationPlan } from "../rotationSolver.ts";
import type {
  RotationPlanCandidate,
  RotationPlanOptions,
  RotationPlanTable,
} from "../rotationTypes.ts";

const MIN = 60_000;
const NOW = 1_750_000_000_000; // fixed epoch — the solver never reads Date.now()

const OPTS: RotationPlanOptions = {
  nowMs: NOW,
  announceLeadMs: 3 * MIN,
  preAnnounceMs: 6 * MIN,
  restMs: 10 * MIN,
  forecastSlots: 0,
  solverVersion: "rotation-v1-test",
};

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT FAILED: ${msg} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

function mkTable(p: Partial<RotationPlanTable> & { tableId: string }): RotationPlanTable {
  return {
    tableName: p.tableId,
    assignmentId: `asg-${p.tableId}`,
    outAttendanceId: `out-${p.tableId}`,
    outDealerName: `Out ${p.tableId}`,
    assignedAtMs: NOW - 30 * MIN,
    swingDueAtMs: NOW,
    swingDurationMs: 30 * MIN,
    requiredTier: null,
    tournamentId: null,
    tournamentName: null,
    gameTypes: [],
    ...p,
  };
}

function mkDealer(p: Partial<RotationPlanCandidate> & { attendanceId: string }): RotationPlanCandidate {
  return {
    dealerId: `dlr-${p.attendanceId}`,
    fullName: `Dealer ${p.attendanceId}`,
    tier: "B",
    skills: [],
    prevSessionMinutes: 0,
    eligibleAtMs: NOW - 20 * MIN, // fully rested by default
    score: 0,
    ...p,
  };
}

for (const count of [30, 40]) Deno.test(`${count} tables: actual forward solver assigns unique slot0 dealers with15minute rest`, () => {
  const tables = Array.from({ length: count }, (_, i) => mkTable({ tableId: `SCALE${i}`, assignedAtMs: NOW - (60 + i) * MIN }));
  const dealers = Array.from({ length: count }, (_, i) => mkDealer({ attendanceId: `RESTED${i}`, eligibleAtMs: NOW }));
  const plan = solveRotationPlan(tables, dealers, { ...OPTS, restMs: 15 * MIN, forecastSlots: 2 });
  const current = plan.rows.filter(r => r.slotIndex === 0);
  assertEq(current.length, count, "every table represented");
  assertEq(new Set(current.map(r => r.tableId)).size, count, "no repeated table");
  assertEq(new Set(current.map(r => r.inAttendanceId)).size, count, "no duplicate incoming dealer");
  for (const row of current) {
    assert(row.inAttendanceId !== null && !row.isShortage, "adequate rested supply must cover slot0");
    assert(row.plannedReliefAtMs >= NOW + 3 * MIN, "announce lead retained");
  }
});

Deno.test("1. 3 OT tables + 2 rested dealers → 2 longest-dealt CHỐT at now+3m, third honest shortage", () => {
  const tables = [
    mkTable({ tableId: "T3", assignedAtMs: NOW - 40 * MIN, swingDueAtMs: NOW - 5 * MIN }),
    mkTable({ tableId: "T1", assignedAtMs: NOW - 80 * MIN, swingDueAtMs: NOW - 13 * MIN }),
    mkTable({ tableId: "T2", assignedAtMs: NOW - 70 * MIN, swingDueAtMs: NOW - 8 * MIN }),
  ];
  const dealers = [mkDealer({ attendanceId: "d1" }), mkDealer({ attendanceId: "d2" })];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const bySlot0 = new Map(plan.rows.filter((r) => r.slotIndex === 0).map((r) => [r.tableId, r]));

  const t1 = bySlot0.get("T1")!;
  const t2 = bySlot0.get("T2")!;
  const t3 = bySlot0.get("T3")!;

  // R4: longest-dealt tables relieved first, at the 3-min emergency lead.
  assert(t1.inAttendanceId !== null, "T1 (longest dealt) must get a dealer");
  assert(t2.inAttendanceId !== null, "T2 (second longest) must get a dealer");
  assertEq(t1.plannedReliefAtMs, NOW + 3 * MIN, "T1 relief = now+3m");
  assertEq(t2.plannedReliefAtMs, NOW + 3 * MIN, "T2 relief = now+3m");
  assert(t1.isEmergency && t2.isEmergency, "overdue tables are emergency");

  // Shortage table: honest future relief = first out-dealer back from rest (+3m+10m+3m).
  assertEq(t3.inAttendanceId, null, "T3 has no dealer yet");
  assertEq(t3.isShortage, true, "T3 is shortage");
  assertEq(t3.plannedReliefAtMs, NOW + 16 * MIN, "T3 honest relief = now+3m relief +10m rest +3m announce");
});

Deno.test("2. dealer released 5 min ago → entry only after full rest (release+13m), never early despite OT", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW - 10 * MIN })]; // overdue 10m
  // Released 5 min ago → eligibleAt = release + 10m = now + 5m.
  const dealers = [mkDealer({ attendanceId: "d1", eligibleAtMs: NOW + 5 * MIN })];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;

  // entry = eligibleAt + 3m announce = now+8m → release-to-entry = 13m total (R2).
  assertEq(row.inAttendanceId, "d1", "dealer is planned (honestly, in the future)");
  assertEq(row.plannedReliefAtMs, NOW + 8 * MIN, "relief = eligibleAt + 3m, NOT now+3m");
  assertEq(row.isShortage, true, "later than ideal → flagged shortage");
});

Deno.test("3. rested dealer, table due in 1m → planned relief still >= now+3m (announce lead enforced)", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW + 1 * MIN })];
  const dealers = [mkDealer({ attendanceId: "d1", eligibleAtMs: NOW - 2 * MIN })];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;

  assert(row.plannedReliefAtMs >= NOW + 3 * MIN, "relief >= now+3m");
  assert(row.announceAtMs !== null, "announce scheduled");
  assert(
    row.plannedReliefAtMs - (row.announceAtMs as number) >= 3 * MIN,
    "announce→entry gap >= 3 min"
  );
  assertEq(row.isEmergency, false, "due in future → not emergency");
});

Deno.test("4. prev sessions 20/35/50 → shortest previous session called first (R3)", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW - 1 * MIN })];
  const dealers = [
    mkDealer({ attendanceId: "d50", prevSessionMinutes: 50 }),
    mkDealer({ attendanceId: "d20", prevSessionMinutes: 20 }),
    mkDealer({ attendanceId: "d35", prevSessionMinutes: 35 }),
  ];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, "d20", "20-min dealer wins");
});

Deno.test("5. high buy-in table prefers tier A; without A, B/C still staff it (flagged unmatched)", () => {
  const tableA = [mkTable({ tableId: "TH", swingDueAtMs: NOW - 1 * MIN, requiredTier: "A" })];

  // A available (longer prev session) vs C (shorter): tier fit outranks fairness on tiered tables.
  const withA = solveRotationPlan(
    tableA,
    [
      mkDealer({ attendanceId: "dA", tier: "A", prevSessionMinutes: 35 }),
      mkDealer({ attendanceId: "dC", tier: "C", prevSessionMinutes: 10 }),
    ],
    OPTS
  );
  const rowA = withA.rows.find((r) => r.tableId === "TH" && r.slotIndex === 0)!;
  assertEq(rowA.inAttendanceId, "dA", "tier A preferred on >10M table");
  assertEq(rowA.tierMatched, true, "tier matched");

  // No A in pool → closest tier still staffs the table (shortage flexibility).
  const withoutA = solveRotationPlan(
    tableA,
    [
      mkDealer({ attendanceId: "dB", tier: "B", prevSessionMinutes: 40 }),
      mkDealer({ attendanceId: "dC", tier: "C", prevSessionMinutes: 5 }),
    ],
    OPTS
  );
  const rowB = withoutA.rows.find((r) => r.tableId === "TH" && r.slotIndex === 0)!;
  assertEq(rowB.inAttendanceId, "dB", "B (adjacent) beats C (distant) when no A");
  assertEq(rowB.tierMatched, false, "flagged as tier-unmatched (penalty visible)");
});

Deno.test("6. no-show locked dealer excluded → replacement planned, swing_due_at input untouched", () => {
  const table = mkTable({ tableId: "T1", swingDueAtMs: NOW - 4 * MIN });
  const originalDue = table.swingDueAtMs;
  // Caller excluded the no-show dealer from candidates (planner re-plan after no_show).
  const dealers = [mkDealer({ attendanceId: "replacement", prevSessionMinutes: 15 })];

  const plan = solveRotationPlan([table], dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;

  assertEq(row.inAttendanceId, "replacement", "replacement locked in");
  assertEq(row.plannedReliefAtMs, NOW + 3 * MIN, "replacement at emergency 3-min lead");
  assertEq(table.swingDueAtMs, originalDue, "solver never mutates swing_due_at");
});

Deno.test("7. sticky CHỐT: locked table is skipped for slot 0 and its dealer is consumed from the pool", () => {
  const tables = [
    mkTable({
      tableId: "TL",
      swingDueAtMs: NOW + 2 * MIN,
      lockedInAttendanceId: "dLocked",
      lockedPlannedReliefAtMs: NOW + 5 * MIN,
    }),
    mkTable({ tableId: "T2", swingDueAtMs: NOW - 1 * MIN }),
  ];
  const dealers = [
    mkDealer({ attendanceId: "dLocked" }),
    mkDealer({ attendanceId: "dFree", prevSessionMinutes: 25 }),
  ];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const slot0 = plan.rows.filter((r) => r.slotIndex === 0);

  assert(!slot0.some((r) => r.tableId === "TL"), "locked table gets no new slot-0 row");
  assert(plan.lockedTableIds.includes("TL"), "locked table reported");
  const t2 = slot0.find((r) => r.tableId === "T2")!;
  assertEq(t2.inAttendanceId, "dFree", "locked dealer not reused for another table");
});

Deno.test("8. forecast slots are emitted and never carry an assignmentId (predicted-never-locks contract)", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW + 5 * MIN })];
  const dealers = [
    mkDealer({ attendanceId: "d1", prevSessionMinutes: 10 }),
    mkDealer({ attendanceId: "d2", prevSessionMinutes: 20 }),
  ];

  const plan = solveRotationPlan(tables, dealers, { ...OPTS, forecastSlots: 2 });
  const slots = plan.rows.filter((r) => r.tableId === "T1").map((r) => r.slotIndex).sort();
  assertEq(JSON.stringify(slots), JSON.stringify([0, 1, 2]), "slots 0..2 emitted");
  for (const r of plan.rows.filter((x) => x.slotIndex > 0)) {
    assertEq(r.assignmentId, null, `forecast slot ${r.slotIndex} carries no assignmentId`);
  }
});

Deno.test("9. game-type table + generalist dealers (empty skills) → matched, NOT false shortage", () => {
  // Regression guard: every active table carries a default game_type ("NLH")
  // and clubs that don't track dealer skills leave skills empty. A generalist
  // must still be picked — skills are an additive specialty whitelist, never a
  // hard requirement. Bug symptom: 100% shortage on every tick.
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW - 5 * MIN, gameTypes: ["NLH"] })];
  const dealers = [mkDealer({ attendanceId: "gen", skills: [] })];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, "gen", "generalist dealer is matched to a game-typed table");
  assertEq(row.isShortage, false, "no false shortage when a generalist is available");

  // Specialty constraint preserved: a dealer who HAS skills but matches none
  // of the table's game types is still excluded (→ honest shortage).
  const specialistOnly = solveRotationPlan(
    [mkTable({ tableId: "T2", swingDueAtMs: NOW - 5 * MIN, gameTypes: ["PLO"] })],
    [mkDealer({ attendanceId: "nlhOnly", skills: ["NLH"] })],
    OPTS
  );
  const r2 = specialistOnly.rows.find((r) => r.tableId === "T2" && r.slotIndex === 0)!;
  assertEq(r2.inAttendanceId, null, "specialist with non-matching skill is excluded");
  assertEq(r2.isShortage, true, "PLO table with only an NLH-skilled dealer → shortage");
});

Deno.test("10. shortage relief estimate never sourced from a skill-incapable dealer (phantom supply)", () => {
  // Regression guard: the shortage branch's futureSupply must apply the same
  // skillsMatch as the eligible filter. A resting NLH-only dealer must not
  // become the relief promise for a PLO table — skill-incapable supply has to
  // produce the SAME estimate as no supply at all (idealReliefMs fallback).
  const ploTable = () => mkTable({ tableId: "T1", swingDueAtMs: NOW - 5 * MIN, gameTypes: ["PLO"] });
  const restingMismatch = mkDealer({
    attendanceId: "nlhOnly",
    skills: ["NLH"],
    eligibleAtMs: NOW + 20 * MIN, // resting — phantom would promise relief at +23m
  });

  const withMismatch = solveRotationPlan([ploTable()], [restingMismatch], OPTS);
  const withNoSupply = solveRotationPlan([ploTable()], [], OPTS);
  const rowMismatch = withMismatch.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  const rowEmpty = withNoSupply.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;

  assertEq(rowMismatch.isShortage, true, "still an honest shortage");
  assertEq(rowMismatch.inAttendanceId, null, "incapable dealer never planned in");
  assertEq(
    rowMismatch.plannedReliefAtMs,
    rowEmpty.plannedReliefAtMs,
    "skill-incapable supply must yield the same relief estimate as no supply (no phantom promise)"
  );
  assert(
    rowMismatch.plannedReliefAtMs !== NOW + 23 * MIN,
    "relief must not anchor to the incapable dealer's rest completion (+20m rest +3m lead)"
  );
});

// ── Patch 5c — feature/final pool gate in the proactive planner ──────────────
// Mirrors the SQL trigger _assert_dealer_allowed_for_table: a special table
// (poolDealerIds non-null) may be relieved ONLY by a pool dealer; a non-pool
// dealer must NEVER be planned in (it would later fail the seat trigger DT006 and
// strand the table — the exact pgv/Bàn 1 incident). dealerId convention = dlr-<att>.

Deno.test("PG-1: single-dealer pool (the seated dealer) → honest shortage, NEVER a non-pool substitute (pgv case)", () => {
  // Pool = [dlr-d1], but d1 is the SEATED dealer (out), so not in the available supply.
  // The only available dealer is non-pool d2 → must NOT be picked.
  const tables = [mkTable({ tableId: "T1", poolDealerIds: ["dlr-d1"], swingDueAtMs: NOW - 10 * MIN })];
  const dealers = [mkDealer({ attendanceId: "d2" })]; // dlr-d2, non-pool, rested+available
  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, null, "no non-pool dealer may relieve a special table");
  assertEq(row.isShortage, true, "single-available-pool-member table is an honest shortage (keep-seat)");
});

Deno.test("PG-2: relief comes from the 2nd POOL dealer, never the higher non-pool dealer", () => {
  // Pool = [d1, d2]; d2 available (pool) + d3 available (non-pool, higher score).
  const tables = [mkTable({ tableId: "T1", poolDealerIds: ["dlr-d1", "dlr-d2"], swingDueAtMs: NOW - 10 * MIN })];
  const dealers = [
    mkDealer({ attendanceId: "d3", score: 999 }), // non-pool, best score — must be ignored
    mkDealer({ attendanceId: "d2", score: 0 }),   // pool member
  ];
  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, "d2", "only the pool dealer is eligible (non-pool d3 excluded despite higher score)");
});

Deno.test("PG-3: ungated table (poolDealerIds null) keeps today's behavior — any dealer eligible", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW - 10 * MIN })]; // no poolDealerIds → ungated
  const dealers = [mkDealer({ attendanceId: "d3" })]; // non-pool but table isn't special
  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, "d3", "ungated table planned normally");
});

Deno.test("PG-4: empty pool (special table, no members) → shortage, never a non-pool substitute", () => {
  const tables = [mkTable({ tableId: "T1", poolDealerIds: [], swingDueAtMs: NOW - 10 * MIN })];
  const dealers = [mkDealer({ attendanceId: "d2" }), mkDealer({ attendanceId: "d3" })];
  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, null, "empty-pool special table never substitutes a non-pool dealer");
  assertEq(row.isShortage, true, "empty-pool special table is an honest shortage");
});

// ── Patch 5d — reserved pool dealers are EXCLUSIVE to their special table ─────
// A dealer in any feature/final pool (reservedDealerIds) must never be planned onto a
// NORMAL table, so the in-pool A↔B rotation can't leak. dealerId convention = dlr-<att>.

Deno.test("PG-5: a reserved pool dealer is EXCLUDED from a normal table", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW - 10 * MIN })]; // normal (ungated)
  const dealers = [
    mkDealer({ attendanceId: "dR", score: 999 }), // reserved (dlr-dR) — highest score, must be skipped
    mkDealer({ attendanceId: "dN", score: 0 }),   // not reserved
  ];
  const plan = solveRotationPlan(tables, dealers, { ...OPTS, reservedDealerIds: ["dlr-dR"] });
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, "dN", "normal table must NOT take a reserved feature/final dealer (even higher-scored)");
});

Deno.test("PG-6: reserved dealer only goes to its OWN special table; the normal table gets a non-reserved dealer", () => {
  const tables = [
    // special X (pool A,B) — more overdue so it's planned first
    mkTable({ tableId: "X", poolDealerIds: ["dlr-A", "dlr-B"], assignedAtMs: NOW - 80 * MIN, swingDueAtMs: NOW - 20 * MIN }),
    // normal Y
    mkTable({ tableId: "Y", assignedAtMs: NOW - 50 * MIN, swingDueAtMs: NOW - 8 * MIN }),
  ];
  const dealers = [
    mkDealer({ attendanceId: "A" }), // reserved to X
    mkDealer({ attendanceId: "B" }), // reserved to X
    mkDealer({ attendanceId: "C" }), // free
  ];
  const plan = solveRotationPlan(tables, dealers, { ...OPTS, reservedDealerIds: ["dlr-A", "dlr-B"] });
  const x = plan.rows.find((r) => r.tableId === "X" && r.slotIndex === 0)!;
  const y = plan.rows.find((r) => r.tableId === "Y" && r.slotIndex === 0)!;
  assert(x.inAttendanceId === "A" || x.inAttendanceId === "B", "special table X must be relieved by one of its pool dealers");
  assertEq(y.inAttendanceId, "C", "normal table Y must get the non-reserved dealer, never A/B");
});
