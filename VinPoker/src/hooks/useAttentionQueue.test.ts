import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAttentionQueue } from "./useAttentionQueue";
import type { DealerAssignment, DealerAttendance, NextDealerPrediction } from "./useDealerSwing";

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

describe("closed-table priority alerts", () => {
  const nowMs = Date.parse("2026-11-16T12:00:00Z");
  const current = assignment({ attendance_id: "dealer-1", assigned_at: "2026-11-16T10:00:00Z",
    overtime_started_at: "2026-11-16T11:30:00Z" });
  const props = {
    assignments: [current], tables: [table],
    dealers: [{ id: "dealer-1", worked_minutes_since_last_break: 0, priority_break_flag: false } as DealerAttendance],
    tableAssignmentMap: { [table.id]: current },
    timelineByTableId: { [table.id]: { minutesLeft: -30, showNextDealerSoon: true, isOverdue: true } },
    nextDealerMap: {} as Record<string, NextDealerPrediction>,
    scheduleByTableId: { [table.id]: { slot0: { id: "slot-old", assignment_id: current.id, is_shortage: true } } } as any,
    nowMs,
  };
  it("removes alerts after close even while assignment and schedule reads are stale", () => {
    const { result, rerender } = renderHook(({ tables }) => useAttentionQueue({ ...props, tables }),
      { initialProps: { tables: [table] } });
    expect(result.current.items.map((item) => item.type).sort()).toEqual(["break_due", "ot", "shortage"]);
    rerender({ tables: [{ ...table, status: "inactive", table_session_id: "" }] });
    expect(result.current.items).toEqual([]);
    rerender({ tables: [] });
    expect(result.current.items).toEqual([]);
    rerender({ tables: [{ ...table, table_session_id: "session-reopened" }] });
    expect(result.current.items.map((item) => item.type)).toEqual(["empty_table"]);
  });
  it.each([
    { released_at: "2026-11-16T11:45:00Z" },
    { status: "completed" as const },
    { table_session_id: "session-old" },
    { table_session_id: null },
  ])("does not turn ended assignments into OT/break/next-dealer alerts: %j", (override) => {
    const { result } = renderHook(() => useAttentionQueue({ ...props, assignments: [{ ...current, ...override }] }));
    expect(result.current.items.map((item) => item.type)).toEqual(["empty_table"]);
  });
  it("retains a genuine stored break request independently of table alerts", () => {
    const { result } = renderHook(() => useAttentionQueue({ ...props, tables: [],
      dealers: [{ ...props.dealers[0], priority_break_flag: true }] }));
    expect(result.current.items.map((item) => item.type)).toEqual(["break_due"]);
  });
  it("ignores the previous assignment's schedule without hiding the new assignment's warnings", () => {
    const replacement = { ...current, id: "replacement" };
    const { result } = renderHook(() => useAttentionQueue({ ...props, assignments: [replacement] }));
    expect(result.current.items.map((item) => item.type).sort()).toEqual(["break_due", "missing_next_dealer", "ot"]);
  });
});
