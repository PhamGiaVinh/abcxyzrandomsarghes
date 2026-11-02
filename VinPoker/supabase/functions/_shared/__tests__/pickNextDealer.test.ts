// Synthetic harness for buildDealerCandidates (A2). Deterministic — mocks the
// admin client so we can assert the hard/soft boundary without a live DB. This is
// the "mode 2" harness from the A0a preflight.
//
// A2 invariant under test: priority_break_flag is a PURE HARD GATE.
//   • under-rested flagged dealer  → excluded (diag.priority_break_excluded++)
//   • rested flagged dealer        → competes with NO residual penalty (no -500)
//   • non-flagged dealers          → unchanged scoring
//   • diag + ScoreBreakdown shape  → preserved for C1
//
// Run: deno test supabase/functions/_shared/__tests__/pickNextDealer.test.ts
import { assertEquals, assertExists, assertMatch, assertNotMatch } from "jsr:@std/assert@1";
import { buildDealerCandidates } from "../pickNextDealer.ts";

type Row = Record<string, unknown>;

// ── Table-routed mock of the Supabase admin client ──────────────────────────
// from(table) → a thenable query builder that records its ops. The router returns
// fixtures by table: `dealers` → ids, `dealer_attendance` WITH `.or(` → the pool
// rows (every other dealer_attendance query — busy/restGuard/poolCooldown — has no
// `.or` → []), `dealer_shift_metrics` → metrics. Everything else (assignments,
// breaks, meal breaks) → [] so dealers flow straight to scoring.
function makeAdmin(fix: {
  dealerIds: string[];
  poolRows: Row[];
  metricsRows: Row[];
  metricsError?: { code?: string; message: string };
  clubMetricsError?: { code?: string; message: string };
  // INV-2 (orphan-aware Step 5b) fixtures — optional, default empty so every
  // pre-existing test is byte-identical (dealer_assignments stays [], the
  // checked-out lookup stays []).
  busyAssignments?: Row[];     // rows the Step-5b dealer_assignments cross-check returns
  checkedOutAttIds?: string[]; // attendance ids whose check_out_time IS NOT NULL (positively gone)
  // Patch 5b/5d (feature/final pool gate + reserved exclusivity) fixtures — optional,
  // default OFF so every pre-existing test is byte-identical (kill-switch off → both
  // getFeatureTablePoolIds and getReservedDealerIds are inert, matching pre-5b/5d).
  killSwitchOn?: boolean;
  specialTableIds?: string[];                    // feature/final tables
  poolMembersByTable?: Record<string, string[]>; // table_id -> dealer_ids in that table's pool
  // P2 hardening (full-system audit, 2026-07-02) fail-safe fixtures — optional, default off
  // so every pre-existing test is byte-identical.
  poolCooldownError?: boolean;         // inject an error into the pool-cooldown query
  reservedPoolMembersError?: boolean;  // inject an error into getReservedDealerIds's own pool_members query
  attendanceBreakRows?: Row[];
  legacyAssignmentBreakRows?: Row[];
  attendanceBreaksError?: { code?: string; message: string; status?: number };
  attendanceBreaksStatus?: number | null;
  assignmentBreaksError?: { code?: string; message: string; status?: number };
  assignmentBreaksStatus?: number | null;
  eligibleAttendanceIds?: string[];
  eligibilityError?: { code?: string; message: string };
  malformedEligibility?: boolean;
  eligibilityRows?: Row[];
}) {
  const CHAIN_METHODS = [
    "select", "eq", "in", "is", "or", "not", "gt", "gte", "lt", "lte", "neq", "order", "limit",
  ];
  function builder(table: string) {
    const ops: { method: string; args: unknown[] }[] = [];
    const sel = () => (ops.find((o) => o.method === "select")?.args[0] as string | undefined) ?? "";
    const eqArg = (col: string) => ops.find((o) => o.method === "eq" && o.args[0] === col)?.args[1] as string | undefined;
    const inArg = (col: string) => ops.find((o) => o.method === "in" && o.args[0] === col)?.args[1] as string[] | undefined;
    const resolve = (): { data: unknown; error: { message: string } | null; status?: number | null } => {
      if (table === "dealers") {
        return { data: fix.dealerIds.map((id) => ({ id })), error: null };
      }
      if (table === "dealer_attendance") {
        // Only the candidate-pool query uses `.or(available/on_break)`.
        if (ops.some((o) => o.method === "or")) {
          // Mirrors the real `.in("dealer_id", dealerIds)` filter so a pool-gate/reserved
          // narrowing of dealerIds (Patch 5b/5d) is actually reflected in the rows returned,
          // not just in the pre-query dealerIds array.
          const allowed = inArg("dealer_id");
          const rows = allowed ? fix.poolRows.filter((r) => allowed.includes(r.dealer_id as string)) : fix.poolRows;
          return { data: rows, error: null };
        }
        // Step-5b checked-out lookup: `.select("id").not("check_out_time","is",null)`.
        // Distinguished from the rest-guard (`.not("last_released_at",…)`) by the .not column.
        if (ops.some((o) => o.method === "not" && o.args[0] === "check_out_time")) {
          return { data: (fix.checkedOutAttIds ?? []).map((id) => ({ id })), error: null };
        }
        // Pool cooldown guard: `.not("pool_entered_at","is",null)`. Optional error injection
        // for the P2 hardening fail-safe test.
        if (fix.poolCooldownError && ops.some((o) => o.method === "not" && o.args[0] === "pool_entered_at")) {
          return { data: null, error: { message: "simulated pool cooldown query error" } };
        }
        return { data: [], error: null }; // busy / restGuard / poolCooldown (no error) / step5c → empty
      }
      if (table === "dealer_shift_metrics") {
        const error = sel().includes("attendance_id")
          ? fix.metricsError
          : fix.clubMetricsError;
        return error
          ? { data: null, error }
          : { data: fix.metricsRows, error: null };
      }
      if (table === "dealer_assignments") {
        // The Step-5b busy cross-check is the ONLY dealer_assignments query that
        // selects dealer_id + status + attendance_id together. Every other one
        // (Step-4 last-2, pre_assigned refs, …) → [] (unchanged).
        const s = sel();
        if (s.includes("dealer_id") && s.includes("status") && s.includes("attendance_id")) {
          return { data: fix.busyAssignments ?? [], error: null };
        }
        return { data: [], error: null };
      }
      if (table === "dealer_breaks") {
        const s = sel();
        if (s.includes("dealer_assignments!inner")) {
          return fix.assignmentBreaksError
            ? { data: null, error: fix.assignmentBreaksError, status: fix.assignmentBreaksStatus }
            : { data: fix.legacyAssignmentBreakRows ?? [], error: null };
        }
        return fix.attendanceBreaksError
          ? { data: null, error: fix.attendanceBreaksError, status: fix.attendanceBreaksStatus }
          : { data: fix.attendanceBreakRows ?? [], error: null };
      }
      if (table === "dealer_table_profiles") {
        // getReservedDealerIds: `.select("table_id").or("table_mode.eq.feature,is_final.eq.true")`
        // (no .maybeSingle() → resolved here, not in maybeSingleImpl).
        return { data: (fix.specialTableIds ?? []).map((id) => ({ table_id: id })), error: null };
      }
      if (table === "dealer_table_pool_members") {
        // getFeatureTablePoolIds: `.select("dealer_id").eq("table_id", tableId)`.
        const eqTid = eqArg("table_id");
        if (eqTid !== undefined) {
          return { data: (fix.poolMembersByTable?.[eqTid] ?? []).map((d) => ({ dealer_id: d })), error: null };
        }
        // getReservedDealerIds: `.select("dealer_id").in("table_id", specialIds)`.
        const inTids = inArg("table_id");
        if (inTids) {
          if (fix.reservedPoolMembersError) {
            return { data: null, error: { message: "simulated reserved-lookup pool_members error" } };
          }
          const all = inTids.flatMap((t) => fix.poolMembersByTable?.[t] ?? []);
          return { data: all.map((d) => ({ dealer_id: d })), error: null };
        }
        return { data: [], error: null };
      }
      return { data: [], error: null }; // dealer_breaks / dealer_meal_breaks / etc.
    };
    const maybeSingleImpl = (): { data: unknown; error: null } => {
      if (table === "app_settings") {
        // `.eq("key","dealer_feature_tables_enabled").maybeSingle()`.
        return { data: fix.killSwitchOn ? { value: true } : null, error: null };
      }
      if (table === "dealer_table_profiles") {
        // getFeatureTablePoolIds: `.eq("table_id", tableId).maybeSingle()` -> {table_mode,is_final}.
        const tid = eqArg("table_id");
        const isSpecial = tid !== undefined && (fix.specialTableIds ?? []).includes(tid);
        return { data: isSpecial ? { table_mode: "feature", is_final: true } : null, error: null };
      }
      return { data: null, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    for (const m of CHAIN_METHODS) {
      chain[m] = (...args: unknown[]) => { ops.push({ method: m, args }); return chain; };
    }
    chain.maybeSingle = () => Promise.resolve(maybeSingleImpl());
    // deno-lint-ignore no-explicit-any
    chain.then = (onF: (v: any) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR);
    return chain;
  }
  return {
    from: (table: string) => builder(table),
    rpc: (name: string, args: { p_attendance_ids: string[] }) => {
      assertEquals(name, 'get_dealer_pool_eligible_attendance_v1');
      if (fix.eligibilityError) return Promise.resolve({data:null,error:fix.eligibilityError});
      if (fix.malformedEligibility) return Promise.resolve({data:null,error:null});
      if (fix.eligibilityRows) return Promise.resolve({data:fix.eligibilityRows,error:null});
      const eligible=new Set(fix.eligibleAttendanceIds??fix.poolRows.map(row=>row.id as string));
      return Promise.resolve({data:args.p_attendance_ids.filter(id=>eligible.has(id)).map(id=>({attendance_id:id})),error:null});
    },
  };
}

// ── Fixture builders ────────────────────────────────────────────────────────
function poolRow(
  id: string,
  dealerId: string,
  opts: { priorityBreak?: boolean; tier?: "A" | "B" | "C"; checkInTime?: string | null } = {},
): Row {
  return {
    id,
    dealer_id: dealerId,
    current_state: "available",
    status: "checked_in",
    worked_minutes_since_last_break: 0,
    priority_break_flag: opts.priorityBreak ?? false,
    last_released_at: null,
    check_in_time: opts.checkInTime === undefined
      ? new Date(Date.now() - 60_000).toISOString()
      : opts.checkInTime,
    dealers: {
      full_name: dealerId.toUpperCase(),
      telegram_username: null,
      telegram_user_id: null,
      tier: opts.tier ?? "C",
      skills: [],
    },
  };
}
function metric(attendanceId: string, minutesSinceRest: number): Row {
  return {
    attendance_id: attendanceId,
    minutes_since_rest: minutesSinceRest,
    total_assignments: 0,
    total_break_minutes: 0,
    total_worked_minutes: 0, // keeps avgBreakRatio null → no break-equity noise
  };
}

function onBreakPoolRow(id: string, dealerId: string): Row {
  return { ...poolRow(id, dealerId), current_state: "on_break" };
}

// restThreshold default = defaultClubBreakDurationMinutes(20) + buffer(5) = 25.
// Expected baseline score for an available tier-C dealer, no tourTier, restMin≥20:
//   rest_bonus(+200, restMin≥20) + tier_bonus(+20, LOW-branch tier C) = 220.
const EXPECTED_BASELINE_SCORE = 220;

Deno.test('operating-day eligibility excludes a fresh but closed/prior-day shift before scoring', async()=>{
 const admin=makeAdmin({dealerIds:['closed','current'],
  poolRows:[poolRow('a-closed','closed'),poolRow('a-current','current')],
  metricsRows:[metric('a-closed',30),metric('a-current',30)],eligibleAttendanceIds:['a-current']});
 const result=await buildDealerCandidates(admin,'club1');
 assertEquals(result.status,'ok');
 assertEquals(result.candidates.map(row=>row.dealer_id),['current']);
});

Deno.test('operating-day eligibility error or malformed result is not a usable pool',async()=>{
 for(const failure of [{eligibilityError:{code:'XX000',message:'backend failure'}},{malformedEligibility:true},
  {eligibilityRows:[{attendance_id:'outside'}]},
  {eligibilityRows:[{attendance_id:'a-current'},{attendance_id:'a-current'}]},
  {eligibilityRows:[{attendance_id:'a-current',unexpected:true}]}]){
  const admin=makeAdmin({dealerIds:['current'],poolRows:[poolRow('a-current','current')],metricsRows:[metric('a-current',30)],...failure});
  const result=await buildDealerCandidates(admin,'club1');
  assertEquals(result.candidates,[]);
  assertEquals(result.status==='ok',false);
 }
});

Deno.test("baseline: a normal rested tier-C dealer scores exactly 220 (mock fidelity check)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].score, EXPECTED_BASELINE_SCORE);
});

Deno.test("A2: under-rested priority-break dealer is EXCLUDED by the hard gate", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1", { priorityBreak: true })],
    metricsRows: [metric("a1", 10)], // 10 < 25 threshold → excluded
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", {});
  assertEquals(candidates.length, 0);
  assertExists(diag);
  assertEquals(diag!.priority_break_excluded, 1);
});

Deno.test("A2: rested priority-break dealer competes with NO -500 penalty", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1", { priorityBreak: true })],
    metricsRows: [metric("a1", 30)], // 30 ≥ 25 → passes the hard gate
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  assertEquals(candidates.length, 1);
  assertEquals(diag!.priority_break_excluded, 0);
  // No residual soft penalty: field is 0 and score equals the normal baseline.
  assertEquals(candidates[0].score_breakdown!.priority_break_penalty, 0);
  assertEquals(candidates[0].score, EXPECTED_BASELINE_SCORE);
});

Deno.test("A2: rested flagged dealer and identical normal dealer get EQUAL score", async () => {
  const admin = makeAdmin({
    dealerIds: ["dp", "dn"],
    poolRows: [
      poolRow("ap", "dp", { priorityBreak: true }),
      poolRow("an", "dn", { priorityBreak: false }),
    ],
    metricsRows: [metric("ap", 30), metric("an", 30)],
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  assertEquals(candidates.length, 2);
  const flagged = candidates.find((c) => c.dealer_id === "dp")!;
  const normal = candidates.find((c) => c.dealer_id === "dn")!;
  assertExists(flagged);
  assertExists(normal);
  assertEquals(flagged.score, normal.score); // proves no residual penalty
  assertEquals(flagged.score_breakdown!.priority_break_penalty, 0);
});

Deno.test("C1 compatibility: diag returned + ScoreBreakdown shape intact", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  // diag still returned with the reject counters C1 renders.
  assertExists(diag);
  for (const k of ["priority_break_excluded", "busy_excluded", "min_rest_excluded", "candidates_count"]) {
    assertEquals(typeof (diag as unknown as Record<string, number>)[k], "number");
  }
  // ScoreBreakdown shape unchanged (priority_break_penalty field still present = 0).
  const bd = candidates[0].score_breakdown!;
  for (const k of [
    "rest_bonus", "tier_bonus", "back_to_back_penalty", "consecutive_penalty", "mixed_bonus",
    "skill_bonus", "priority_break_penalty", "heavy_worker_penalty", "consecutive_high_penalty",
    "tier_back_to_back_penalty", "break_equity_penalty", "priority_swing_bonus", "fatigue_penalty",
  ]) {
    assertEquals(typeof (bd as unknown as Record<string, number>)[k], "number");
  }
  assertEquals(bd.priority_break_penalty, 0);
});

// ── INV-2 (§7 contract, docs/dealer-swing/ASSIGNMENT_TEARDOWN_ROOT_CAUSE.md) ──
// Orphan-aware Step-5b "busy" predicate. THE regression guard for the club
// 22222222 freeze: an active dealer_assignments row marks a dealer BUSY only if
// its linked attendance is still CHECKED IN. A row tied to a CHECKED-OUT
// attendance is an ORPHAN (the dealer left) and must NOT poison the dealer's new
// pool entry. Only POSITIVELY-confirmed checkouts are skipped; checked-in /
// unknown rows keep the B6 busy defense. (pickNextDealer.ts Step 5b, ~L572–601.)
function busyAssign(dealerId: string, attendanceId: string, opts: { table?: string; status?: string } = {}): Row {
  return {
    dealer_id: dealerId,
    table_id: opts.table ?? "tX",
    status: opts.status ?? "assigned",
    attendance_id: attendanceId,
  };
}

Deno.test("INV-2a: orphan row on a CHECKED-OUT attendance does NOT exclude the dealer (freeze regression)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],                                // d1's NEW, checked-in pool entry
    metricsRows: [metric("a1", 30)],
    busyAssignments: [busyAssign("d1", "a_old", { status: "on_break" })], // stale row, OLD attendance
    checkedOutAttIds: ["a_old"],                                    // a_old is checked OUT → orphan
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", {});
  assertEquals(candidates.length, 1);            // d1 stays eligible (orphan skipped)
  assertEquals(candidates[0].dealer_id, "d1");
  assertEquals(diag!.busy_excluded, 0);
});

Deno.test("INV-2b: active assignment on a CHECKED-IN attendance still excludes the dealer (B6 preserved)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    busyAssignments: [busyAssign("d1", "a_live")], // genuine active table
    checkedOutAttIds: [],                           // a_live NOT checked out
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", {});
  assertEquals(candidates.length, 0);            // d1 excluded as busy
  assertEquals(diag!.busy_excluded, 1);
});

Deno.test("INV-2c: orphan + real row together → dealer STILL excluded (skip is per-row, not per-dealer)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    busyAssignments: [
      busyAssign("d1", "a_old", { status: "on_break" }), // stale orphan → skipped
      busyAssign("d1", "a_live"),                        // genuine active table → counts
    ],
    checkedOutAttIds: ["a_old"],                          // only the orphan is gone
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", {});
  assertEquals(candidates.length, 0);            // the real row keeps d1 busy
  assertEquals(diag!.busy_excluded, 1);
});

// ── PN (regression fix, root cause of the 2026-07-02 Bàn 1 stall) ────────────
// Patch 5d's reserved-exclusion wrongly fired whenever currentTableId was omitted,
// which is exactly how Pass R's buildRotationSupply calls buildDealerCandidates (it
// builds ONE shared candidate list for ALL tables — special AND normal — before the
// per-table solver runs). That silently stripped a special table's OWN pool dealers
// out of Pass R's supply, so the table could never be relieved (indefinite shortage/
// OT) even though its pool member was checked-in and available. Fix: only reserved-
// exclude when currentTableId is a REAL table that resolves to non-special (poolIds
// null AND currentTableId truthy) — never when currentTableId is simply omitted.

Deno.test("PN-1 (regression): reserved pool dealer STAYS in the candidate list when currentTableId is omitted (Pass R global-supply build)", async () => {
  const admin = makeAdmin({
    dealerIds: ["dR"],
    poolRows: [poolRow("aR", "dR")],
    metricsRows: [metric("aR", 30)],
    killSwitchOn: true,
    specialTableIds: ["T1"],
    poolMembersByTable: { T1: ["dR"] },
  });
  const { candidates } = await buildDealerCandidates(admin, "club", {}); // no currentTableId
  assertEquals(candidates.length, 1, "reserved dealer must NOT be stripped from the global/shared supply");
  assertEquals(candidates[0].dealer_id, "dR");
});

Deno.test("PN-2: reserved pool dealer is EXCLUDED when picking for a REAL normal table", async () => {
  const admin = makeAdmin({
    dealerIds: ["dR"],
    poolRows: [poolRow("aR", "dR")],
    metricsRows: [metric("aR", 30)],
    killSwitchOn: true,
    specialTableIds: ["T1"],
    poolMembersByTable: { T1: ["dR"] },
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { currentTableId: "T2" }); // T2 = ordinary table
  assertEquals(candidates.length, 0, "reserved dealer must not be pulled onto a normal table");
});

Deno.test("PN-3: the pool dealer is still selectable for ITS OWN special table (Patch 5c unaffected)", async () => {
  const admin = makeAdmin({
    dealerIds: ["dR"],
    poolRows: [poolRow("aR", "dR")],
    metricsRows: [metric("aR", 30)],
    killSwitchOn: true,
    specialTableIds: ["T1"],
    poolMembersByTable: { T1: ["dR"] },
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { currentTableId: "T1" }); // T1 = its own special table
  assertEquals(candidates.length, 1, "the pool dealer stays selectable for the special table it belongs to");
  assertEquals(candidates[0].dealer_id, "dR");
});

// ── P2 hardening (full-system audit, 2026-07-02) — fail-safe on a transient DB error ─────
// A query error inside a guard used to just log and silently skip the exclusion, risking a
// dealer being picked the guard couldn't actually verify. Both guards now mirror Step 2's
// existing pattern: bail with { candidates: [], avgBreakRatio: null } rather than proceed.

Deno.test("P2 fix: pool-cooldown query error → fails safe (no candidates), not silently skipped", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    poolCooldownError: true,
  });
  const { candidates } = await buildDealerCandidates(admin, "club", {});
  assertEquals(candidates.length, 0, "a pool-cooldown query error must bail, not silently admit d1");
});

Deno.test("P2 fix: happy path unaffected when the pool-cooldown query succeeds (no error flag)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
  });
  const { candidates } = await buildDealerCandidates(admin, "club", {});
  assertEquals(candidates.length, 1, "normal path is unchanged when there is no query error");
});

Deno.test("P2 fix: reserved-dealer lookup query error (normal-table pick) → fails safe (no candidates)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    killSwitchOn: true,
    specialTableIds: ["T1"],           // some OTHER table is special (T1), d1 is not its member
    poolMembersByTable: { T1: ["dOther"] },
    reservedPoolMembersError: true,    // getReservedDealerIds's own pool_members query fails
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { currentTableId: "T2" }); // T2 = normal table
  assertEquals(candidates.length, 0, "an unverifiable reserved-dealer set must bail, not silently admit d1");
});

Deno.test("P2 fix: normal-table pick unaffected when the reserved-dealer lookup succeeds (no error flag)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    killSwitchOn: true,
    specialTableIds: ["T1"],
    poolMembersByTable: { T1: ["dOther"] }, // d1 is NOT reserved
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { currentTableId: "T2" });
  assertEquals(candidates.length, 1, "normal path is unchanged when the reserved-dealer lookup succeeds");
});

Deno.test("metrics relation missing fails closed instead of becoming an empty metrics snapshot", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [],
    metricsError: { code: "42P01", message: "relation dealer_shift_metrics does not exist" },
  });
  const result = await buildDealerCandidates(admin, "club", {});
  assertEquals(result.candidates, []);
  assertEquals(result.status, "dependency_unavailable");
  assertEquals(result.errorCode, "candidate_shift_metrics_dependency_unavailable");
});

Deno.test("metrics runtime query failure fails closed instead of changing scoring inputs", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [],
    metricsError: { code: "XX000", message: "connection reset" },
  });
  const result = await buildDealerCandidates(admin, "club", {});
  assertEquals(result.candidates, []);
  assertEquals(result.status, "query_failed");
  assertEquals(result.errorCode, "candidate_shift_metrics_query_failed");
});

Deno.test("club break-equity metrics failure fails closed when score breakdown is requested", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    clubMetricsError: { code: "XX000", message: "connection reset" },
  });
  const result = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  assertEquals(result.candidates, []);
  assertEquals(result.status, "query_failed");
  assertEquals(result.errorCode, "candidate_club_shift_metrics_query_failed");
});

Deno.test("attendance-linked active break keeps an on-break dealer out of the candidate pool", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [onBreakPoolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    attendanceBreakRows: [{ attendance_id: "a1", break_start: "2026-07-24T10:00:00.000Z" }],
  });
  const result = await buildDealerCandidates(admin, "club", {});
  assertEquals(result.status, "ok");
  assertEquals(result.candidates.length, 0);
  assertEquals(result.diag?.on_break_excluded, 1);
});

Deno.test("candidate pool excludes attendance older than 24 hours before scoring", async () => {
  const admin = makeAdmin({
    dealerIds: ["fresh", "stale"],
    poolRows: [
      poolRow("a-fresh", "fresh", { checkInTime: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString() }),
      poolRow("a-stale", "stale", { checkInTime: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }),
    ],
    metricsRows: [metric("a-fresh", 30), metric("a-stale", 30)],
  });

  const result = await buildDealerCandidates(admin, "club", {});
  assertEquals(result.status, "ok");
  assertEquals(result.candidates.map((candidate) => candidate.dealer_id), ["fresh"]);
});

Deno.test("candidate pool fails closed for future or invalid check-in timestamps", async () => {
  const admin = makeAdmin({
    dealerIds: ["future", "invalid"],
    poolRows: [
      poolRow("a-future", "future", { checkInTime: new Date(Date.now() + 60_000).toISOString() }),
      poolRow("a-invalid", "invalid", { checkInTime: "not-a-date" }),
    ],
    metricsRows: [metric("a-future", 30), metric("a-invalid", 30)],
  });

  const result = await buildDealerCandidates(admin, "club", {});
  assertEquals(result.status, "ok");
  assertEquals(result.candidates, []);
});

Deno.test("legacy assignment-linked active break keeps an on-break dealer out of the candidate pool", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [onBreakPoolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    legacyAssignmentBreakRows: [{
      assignment_id: "legacy-assignment",
      break_start: "2026-07-24T10:00:00.000Z",
      dealer_assignments: { attendance_id: "a1" },
    }],
  });
  const result = await buildDealerCandidates(admin, "club", {});
  assertEquals(result.status, "ok");
  assertEquals(result.candidates.length, 0);
  assertEquals(result.diag?.on_break_excluded, 1);
});

Deno.test("assignment-break query failure is fail-closed with sanitized structured telemetry", async () => {
  const rawUuid = "11111111-2222-3333-4444-555555555555";
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    assignmentBreaksError: { code: "XX000", message: `private URI for ${rawUuid}` },
    assignmentBreaksStatus: 414,
  });
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    const result = await buildDealerCandidates(admin, "club", {});
    assertEquals(result.status, "query_failed");
    assertEquals(result.errorCode, "candidate_assignment_breaks_query_failed");
  } finally {
    console.error = originalError;
  }

  const output = logs.join("\n");
  assertMatch(output, /"provider_code":"XX000"/);
  assertMatch(output, /"http_status":414/);
  assertMatch(output, /"input_count_bucket":"one"/);
  assertNotMatch(output, new RegExp(rawUuid));
  assertNotMatch(output, /private URI/);
});

Deno.test("attendance-break query failure retains top-level status and does not build candidates", async () => {
  const rawUuid = "11111111-2222-3333-4444-555555555555";
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
    attendanceBreaksError: { code: "XX000", message: `private URL/${rawUuid}` },
    attendanceBreaksStatus: 502,
  });
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    const result = await buildDealerCandidates(admin, "club", {});
    assertEquals(result.status, "query_failed");
    assertEquals(result.errorCode, "candidate_attendance_breaks_query_failed");
    assertEquals(result.candidates, []);
  } finally {
    console.error = originalError;
  }

  const output = logs.join("\n");
  assertMatch(output, /"http_status":502/);
  assertNotMatch(output, new RegExp(rawUuid));
  assertNotMatch(output, /private URL/);
});
