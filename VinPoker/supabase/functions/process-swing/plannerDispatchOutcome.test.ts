import { assertEquals } from "jsr:@std/assert@1";
import { assessCoreQueryFailure, type DispatchSafetyOutcome } from "./executionSafety.ts";

const source = (await Deno.readTextFile(new URL("./index.ts", import.meta.url))).replaceAll("\r", "");
const start = source.indexOf("            if (p15Result.errors.length > 0) {");
const end = source.indexOf("          } catch (err: any)", start);
if (start < 0 || end <= start) throw new Error("actual planner parent seam missing");
const body = source.slice(start, end);

for (const errors of [[], [{ table_id: "", error: "assignment read unavailable" }]]) {
  Deno.test(`actual preassignment parent records ${errors.length ? "failed" : "healthy"} result honestly`, () => {
    const begin = source.indexOf("          if (pass2Result.errors.length > 0) {");
    const finish = source.indexOf("          if (pass2Result.pre_assigned_count > 0)", begin);
    if (begin < 0 || finish <= begin) throw new Error("actual Pass 2 parent seam missing");
    const recorded: DispatchSafetyOutcome[] = [];
    new Function("pass2Result", "cid", "recordDispatchSafetyOutcome", "assessCoreQueryFailure", source.slice(begin, finish))(
      { errors }, "club", (_club: string, result: DispatchSafetyOutcome) => recorded.push(result), assessCoreQueryFailure,
    );
    assertEquals(recorded.length, errors.length ? 1 : 0);
    if (errors.length) assertEquals(recorded[0].dispatchState, "partial");
  });
}

Deno.test("actual planner parent records a thrown transport error as partial", () => {
  const genericStart = source.indexOf("            }\n", end) + "            }\n".length;
  const genericEnd = source.indexOf("\n          }", genericStart);
  const recorded: DispatchSafetyOutcome[] = [];
  new Function("err", "cid", "recordDispatchSafetyOutcome", "assessCoreQueryFailure", "console", source.slice(genericStart, genericEnd))(
    new TypeError("Failed to fetch"), "club", (_club: string, result: DispatchSafetyOutcome) => recorded.push(result),
    assessCoreQueryFailure, { error() {} },
  );
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0].dispatchState, "partial");
});

for (const errors of [[], [{ tableId: "table1", error: "rpc503" }]]) {
  Deno.test(`actual planner parent records ${errors.length ? "failed" : "healthy"} result honestly`, () => {
    const recorded: DispatchSafetyOutcome[] = [];
    new Function("p15Result", "cid", "recordDispatchSafetyOutcome", "assessCoreQueryFailure", "console", body)(
      { errors }, "club", (_club: string, result: DispatchSafetyOutcome) => recorded.push(result),
      assessCoreQueryFailure, { error() {} },
    );
    assertEquals(recorded.length, errors.length ? 1 : 0);
    if (errors.length) {
      assertEquals(recorded[0].dispatchState, "partial");
      assertEquals(recorded[0].dispatchErrorCode, "pass15_planner_query_failed");
    }
  });
}
