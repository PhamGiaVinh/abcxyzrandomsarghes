import { pass2PreAssignNext } from "../../supabase/functions/process-swing/passes/pass2-pre-assign.ts";

for (const failedRead of ["manual", "normal", "ot"]) {
  Deno.test(`preassignment ${failedRead} read failure is not an empty successful pass`, async () => {
    let reads = 0;
    let mutations = 0;
    const admin = {
      from() {
        const query: any = {
          then(resolve: (value: unknown) => void) {
            reads++;
            resolve({ data: [], error: failedRead === "ot" && reads === 1 ? null : { message: "read unavailable" } });
          },
        };
        for (const method of ["select", "eq", "is", "gte", "lt", "lte", "not"]) query[method] = () => query;
        return query;
      },
      rpc() { mutations++; throw new Error("must not mutate"); },
    };
    const result = await pass2PreAssignNext(admin, "test-club", 5, {
      clubZone: null, chatId: null, cycleExcludedIds: new Set(),
      ...(failedRead === "manual" ? { manualWindowMinutes: 15 } : {}),
    });
    if (result.errors.length !== 1 || mutations !== 0) throw new Error(`errors=${result.errors.length}, mutations=${mutations}`);
  });
}

for (const throws of [false, true]) {
  Deno.test(`preassignment ${throws ? "thrown transport failure" : "verified empty snapshot"} is classified honestly`, async () => {
    let mutations = 0;
    const admin = {
      from() {
        const query: any = {
          then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
            if (throws) reject(new TypeError("Failed to fetch"));
            else resolve({ data: [], error: null });
          },
        };
        for (const method of ["select", "eq", "is", "gte", "lt", "lte", "not"]) query[method] = () => query;
        return query;
      },
      rpc() { mutations++; throw new Error("must not mutate"); },
    };
    const result = await pass2PreAssignNext(admin, "test-club", 5, {
      clubZone: null, chatId: null, cycleExcludedIds: new Set(),
    });
    if (result.errors.length !== (throws ? 1 : 0) || mutations !== 0 || result.pre_assigned_count !== 0) {
      throw new Error("empty and unavailable snapshots must not be conflated");
    }
  });
}
