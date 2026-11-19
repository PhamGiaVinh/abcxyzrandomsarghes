import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AttentionQueue from "@/components/cashier/command-center/AttentionQueue";

vi.mock("@/hooks/useAttentionQueue", () => ({
  useAttentionQueue: () => ({ items: [], criticalItems: [], warningItems: [], totalCount: 0 }),
}));

afterEach(cleanup);

describe("Swing attention coverage uses the same exact-session denominator", () => {
  it.each([true, false])("does not count inventory or stale assignments (horizontal=%s)", (horizontal) => {
    const tables = [
      { id: "table-a", status: "active", table_session_id: "session-a" },
      { id: "table-b", status: "active", table_session_id: "session-b" },
      ...Array.from({ length: 99 }, (_, n) => ({ id: `closed-${n}`, status: "inactive" })),
    ];
    const assignments = [
      { table_id: "table-a", table_session_id: "session-a", status: "assigned", released_at: null },
      { table_id: "table-b", table_session_id: "session-b", status: "assigned", released_at: null },
      { table_id: "table-a", table_session_id: "old-session", status: "assigned", released_at: null },
    ];
    render(<AttentionQueue horizontal={horizontal} tables={tables} assignments={assignments as any}
      dealers={[]} tableAssignmentMap={{}} timelineByTableId={{}} nextDealerMap={null}
      nowMs={0} autoSwingEnabled={false} onSwing={() => {}} onAssign={() => {}} onSendToBreak={() => {}} />);
    expect(screen.getByText(/^2\/2 bàn có dealer/)).toBeTruthy();
    expect(screen.queryByText(/101 bàn/)).toBeNull();
  });
});
