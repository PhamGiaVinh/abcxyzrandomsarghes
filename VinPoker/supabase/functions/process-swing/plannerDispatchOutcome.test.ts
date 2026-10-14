import { assertEquals } from "jsr:@std/assert@1";
import { assessCoreQueryFailure, type DispatchSafetyOutcome } from "./executionSafety.ts";

const source = (await Deno.readTextFile(new URL("./index.ts", import.meta.url))).replaceAll("\r", "");
const start = source.indexOf("            if (p15Result.errors.length > 0) {");
const end = source.indexOf("          } catch (err: any)", start);
if (start < 0 || end <= start) throw new Error("actual planner parent seam missing");
const body = source.slice(start, end);

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
