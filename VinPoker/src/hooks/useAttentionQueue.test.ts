import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAttentionQueue } from "./useAttentionQueue";
import type { DealerAssignment } from "./useDealerSwing";

const table = { id: "physical-23", table_name: "Bàn 23", status: "active", table_session_id: "session-new" };
function read(assignments: DealerAssignment[] = [], tables = [table]) {
  return renderHook(() => useAttentionQueue({
    assignments, tables, dealers: [], tableAssignmentMap: {}, timelineByTableId: {},
    nextDealerMap: null, scheduleByTableId: null, nowMs: 1_000,
  })).result.current;
}
const assignment = (overrides: Partial<DealerAssignment> = {}) => ({
  id: "assignment-new", table_id: table.id, table_session_id: table.table_session_id,
  status: "assigned", released_at: null, ...overrides,
} as DealerAssignment);

describe("Swing attention uses exact live session coverage", () => {
  it("warns about an empty open table even without a rotation schedule or prediction", () => {
    expect(read().warningItems).toEqual([expect.objectContaining({
      type: "empty_table", tableId: table.id, tableName: "Bàn 23",
    })]);
  });
  it("does not warn when an unreleased assignment covers the exact session", () => {
    expect(read([assignment()]).totalCount).toBe(0);
  });
  it.each<Partial<DealerAssignment>>([
    { table_session_id: "session-old" },
    { table_session_id: null },
    { released_at: "2026-10-14T10:00:00Z" },
    { status: "completed" },
  ])("does not count stale/released assignment as coverage: %j", (overrides) => {
    expect(read([assignment(overrides)]).items).toEqual([
      expect.objectContaining({ type: "empty_table", tableId: table.id }),
    ]);
  });
  it("never offers assignment attention for closed or unfenced physical inventory", () => {
    expect(read([], [{ ...table, status: "inactive" }]).totalCount).toBe(0);
    expect(read([], [{ ...table, table_session_id: "" }]).totalCount).toBe(0);
  });
});
