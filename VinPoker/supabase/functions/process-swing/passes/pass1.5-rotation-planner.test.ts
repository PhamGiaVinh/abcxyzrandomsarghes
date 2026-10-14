import { assertEquals } from "jsr:@std/assert@1";
import { pass15RotationPlanner } from "./pass1.5-rotation-planner.ts";

const CLUB_ID = "22222222-2222-2222-2222-222222222222";

Deno.test("40-table planner reports the 30 deferred tables when the run cap is 10", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: `assignment-${i}`, table_id: `table-${i}`, attendance_id: `out-${i}`,
    version: 1, pre_assigned_attendance_id: null,
    game_tables: { table_type: "tournament", game_type: "holdem", tour_tier: "LOW" },
  }));
  let commits = 0;
  const admin = {
    from: () => {
      let tableId: string | null = null;
      const chain: any = {
        select: () => chain, is: () => chain, gte: () => chain, lt: () => chain, in: () => chain,
        eq: (key: string, value: string) => { if (key === "table_id") tableId = value; return chain; },
        maybeSingle: () => Promise.resolve({ data: rows.find(r => r.table_id === tableId), error: null }),
        then: (done: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(done),
      };
      return chain;
    },
    rpc: () => { commits++; return Promise.resolve({ data: { outcome: "pre_assigned" }, error: null }); },
  };
  const result = await pass15RotationPlanner(admin, CLUB_ID, options(), {
    candidateBuilder: async () => ({ candidates: [], avgBreakRatio: null, status: "ok" }),
    solver: (() => ({
      pairs: rows.map((r, i) => ({ tableId: r.table_id, attendanceId: `in-${i}`, candidateName: `TEST ${i}`, score: 1 })),
      unassignedTables: [], solverVersion: "scale-oracle",
    })) as any,
  });
  assertEquals(commits, 10);
  assertEquals(result.assigned, 10);
  assertEquals(result.unassigned, 30, "run cap must not claim all40tables handled");
});

function makeAdmin() {
  let rpcCalls = 0;
  const upcoming = [{
    id: "assignment-1",
    table_id: "table-1",
    attendance_id: "outgoing-attendance",
    version: 1,
    pre_assigned_attendance_id: null,
    game_tables: {
      id: "table-1",
      table_name: "Table 1",
      table_type: "cash",
      game_type: "holdem",
      tour_tier: "LOW",
    },
  }];
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    gte: () => chain,
    lt: () => chain,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: upcoming, error: null }).then(resolve),
  };

  return {
    admin: {
      from: () => chain,
      rpc: () => {
        rpcCalls++;
        return Promise.resolve({ data: null, error: null });
      },
    },
    rpcCalls: () => rpcCalls,
  };
}

Deno.test("40 tables drain over four capped runs without repeated dealer or table commits", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, table_id: `t${i}`, attendance_id: `out${i}`, version: 1,
    pre_assigned_attendance_id: null as string | null, game_tables: { game_type: "holdem", tour_tier: "LOW" } }));
  const committedDealers = new Set<string>();
  const opts = options();
  const admin = {
    from: () => {
      let tableId: string | null = null;
      const chain: any = {
        select: () => chain, is: () => chain, gte: () => chain, lt: () => chain, in: () => chain,
        eq: (key: string, value: string) => { if (key === "table_id") tableId = value; return chain; },
        maybeSingle: () => Promise.resolve({ data: rows.find(r => r.table_id === tableId), error: null }),
        then: (done: (value: unknown) => unknown) => Promise.resolve({ data: rows.filter(r => !r.pre_assigned_attendance_id), error: null }).then(done),
      }; return chain;
    },
    rpc: (_name: string, args: any) => {
      const row = rows.find(r => r.id === args.p_assignment_id)!;
      assertEquals(row.pre_assigned_attendance_id, null);
      assertEquals(committedDealers.has(args.p_next_attendance_id), false);
      committedDealers.add(args.p_next_attendance_id); row.pre_assigned_attendance_id = args.p_next_attendance_id;
      return Promise.resolve({ data: { outcome: "pre_assigned" }, error: null });
    },
  };
  for (let run = 0; run < 4; run++) {
    const result = await pass15RotationPlanner(admin, CLUB_ID, opts, {
      candidateBuilder: async (_admin, _club, candidateOptions) => {
        assertEquals(candidateOptions?.excludeAttendanceIds?.size, run * 10);
        return { candidates: [], avgBreakRatio: null, status: "ok" };
      },
      solver: ((tables: any[]) => ({ pairs: tables.map(t => ({ tableId: t.id, attendanceId: `in-${t.id}`, score: 1 })),
        unassignedTables: [], solverVersion: "scale-oracle" })) as any,
    });
    assertEquals(result.assigned, 10); assertEquals(result.unassigned, 30 - run * 10);
  }
  assertEquals(committedDealers.size, 40);
  assertEquals(rows.filter(r => r.pre_assigned_attendance_id).length, 40);
});

const options = () => ({
  dryRun: false,
  preAnnounceMinutes: 5,
  requiredGameTypes: [],
  cycleExcludedIds: new Set<string>(),
  clubId: CLUB_ID,
});

Deno.test("Pass 1.5 fails closed before solver or pre-assignment when metrics dependency is absent", async () => {
  const { admin, rpcCalls } = makeAdmin();
  let solverCalls = 0;

  const result = await pass15RotationPlanner(admin, CLUB_ID, options(), {
    candidateBuilder: async () => ({
      candidates: [],
      avgBreakRatio: null,
      status: "dependency_unavailable",
      errorCode: "candidate_assignment_metrics_dependency_unavailable",
    }),
    solver: (() => {
      solverCalls++;
      throw new Error("solver must not run");
    }) as any,
  });

  assertEquals(result.candidateStatus, "dependency_unavailable");
  assertEquals(result.candidateErrorCode, "candidate_assignment_metrics_dependency_unavailable");
  assertEquals(solverCalls, 0);
  assertEquals(rpcCalls(), 0);
});

Deno.test("Pass 1.5 propagates a candidate runtime query failure instead of a clean shortage", async () => {
  const { admin, rpcCalls } = makeAdmin();
  let solverCalls = 0;

  const result = await pass15RotationPlanner(admin, CLUB_ID, options(), {
    candidateBuilder: async () => ({
      candidates: [],
      avgBreakRatio: null,
      status: "query_failed",
      errorCode: "candidate_assignment_metrics_query_failed",
    }),
    solver: (() => {
      solverCalls++;
      throw new Error("solver must not run");
    }) as any,
  });

  assertEquals(result.candidateStatus, "query_failed");
  assertEquals(result.candidateErrorCode, "candidate_assignment_metrics_query_failed");
  assertEquals(result.unassigned, 0);
  assertEquals(solverCalls, 0);
  assertEquals(rpcCalls(), 0);
});

Deno.test("Pass 1.5 keeps a valid zero-candidate snapshot as an honest shortage", async () => {
  const { admin, rpcCalls } = makeAdmin();
  let solverCalls = 0;

  const result = await pass15RotationPlanner(admin, CLUB_ID, options(), {
    candidateBuilder: async () => ({
      candidates: [],
      avgBreakRatio: null,
      status: "ok",
    }),
    solver: (() => {
      solverCalls++;
      return {
        pairs: [],
        unassignedTables: [{ tableId: "table-1", reason: "no_candidates" }],
        solverVersion: "test",
      };
    }) as any,
  });

  assertEquals(result.candidateStatus, undefined);
  assertEquals(result.unassigned, 1);
  assertEquals(result.missReasons, { no_candidates: 1 });
  assertEquals(solverCalls, 1);
  assertEquals(rpcCalls(), 0);
});
