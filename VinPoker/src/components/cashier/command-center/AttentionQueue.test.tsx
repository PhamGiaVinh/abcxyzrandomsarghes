import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AttentionQueue from "./AttentionQueue";
import type { DealerAssignment, NextDealerPrediction } from "@/hooks/useDealerSwing";
import DealerSwingSummaryStrip from "../dealer-swing/DealerSwingSummaryStrip";

describe("empty live-table priority lane", () => {
  it.each([false, true])("known replacement does not hide overdue state; healthy current session stays green (overdue=%s)", (overdue) => {
    const onSwing = vi.fn();
    const assignment = { id: "assignment", table_id: "physical-23", table_session_id: "session-23", status: "assigned", overtime_started_at: null } as DealerAssignment;
    render(<AttentionQueue horizontal assignments={[assignment]} dealers={[]}
      tables={[{ id: "physical-23", table_name: "Bàn 23", status: "active", table_session_id: "session-23" }]}
      tableAssignmentMap={{ "physical-23": assignment }} timelineByTableId={{ "physical-23": { minutesLeft: overdue ? -10 : 10, isOverdue: overdue, showNextDealerSoon: true } }}
      nextDealerMap={{ "physical-23": { nextDealerName: "TEST next" } as NextDealerPrediction }}
      nowMs={1000} autoSwingEnabled={false} onAssign={vi.fn()} onSwing={onSwing} onSendToBreak={vi.fn()} />);
    if (overdue) expect(screen.getByRole("alert")).toHaveTextContent("quá hạn");
    else expect(screen.getByText("Sàn đang ổn định")).toBeInTheDocument();
    expect(onSwing).not.toHaveBeenCalled();
  });
  it.each(["old-session", "released"])("does not turn %s assignment into current overdue evidence", (kind) => {
    const assignment = { id: "assignment", table_id: "physical-23", table_session_id: kind === "old-session" ? "session-old" : "session-23",
      status: "assigned", released_at: kind === "released" ? "2026-10-14T10:00:00Z" : null, overtime_started_at: null } as DealerAssignment;
    render(<AttentionQueue horizontal assignments={[assignment]} dealers={[]}
      tables={[{ id: "physical-23", table_name: "Bàn 23", status: "active", table_session_id: "session-23" }]}
      tableAssignmentMap={{ "physical-23": assignment }} timelineByTableId={{ "physical-23": { minutesLeft: -10, isOverdue: true, showNextDealerSoon: true } }}
      nextDealerMap={null} nowMs={1000} autoSwingEnabled={false} onAssign={vi.fn()} onSwing={vi.fn()} onSendToBreak={vi.fn()} />);
    expect(screen.queryByText(/1 bàn quá hạn/)).not.toBeInTheDocument();
    expect(screen.getByText("Bàn 23 • Thiếu dealer")).toBeInTheDocument();
  });
  it.each([true, false])("never renders green stability for an overdue exact session without prediction (horizontal=%s)", (horizontal) => {
    const assignment = { id: "assignment", table_id: "physical-23", table_session_id: "session-23", status: "assigned", overtime_started_at: null } as DealerAssignment;
    render(<AttentionQueue horizontal={horizontal} assignments={[assignment]} dealers={[]}
      tables={[{ id: "physical-23", table_name: "Bàn 23", status: "active", table_session_id: "session-23" }]}
      tableAssignmentMap={{ "physical-23": assignment }} timelineByTableId={{ "physical-23": { minutesLeft: -10, isOverdue: true, showNextDealerSoon: true } }}
      nextDealerMap={null} nowMs={1000} autoSwingEnabled={false} onAssign={vi.fn()} onSwing={vi.fn()} onSendToBreak={vi.fn()} />);
    expect(screen.queryByText(/Sàn đang ổn định|Hệ thống ổn định/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("quá hạn");
  });
  it("does not label an overdue count as confirmed OT", () => {
    render(<DealerSwingSummaryStrip activeTables={2} assignedTables={2} onBreak={0} predictedPending={0}
      overdue={2} warnings={0} stabilityPct={null} earliestShortageLabel={null} nowMs={1000} />);
    expect(screen.queryByText(/2 OT/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 quá hạn/)).toBeInTheDocument();
  });
  it.each([true, false])("does not render green stability for an uncovered session (horizontal=%s)", (horizontal) => {
    const onAssign = vi.fn();
    const onSwing = vi.fn();
    const onSendToBreak = vi.fn();
    render(<AttentionQueue horizontal={horizontal} assignments={[]} dealers={[]}
      tables={[{ id: "physical-23", table_name: "Bàn 23", status: "active", table_session_id: "session-23" }]}
      tableAssignmentMap={{}} timelineByTableId={{}} nextDealerMap={null}
      nowMs={1000} autoSwingEnabled={false} onAssign={onAssign}
      onSwing={onSwing} onSendToBreak={onSendToBreak} />);
    expect(screen.queryByText(/Sàn đang ổn định|Hệ thống ổn định/)).not.toBeInTheDocument();
    expect(screen.getByText("Bàn 23 • Thiếu dealer")).toBeInTheDocument();
    expect(onAssign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gán dealer" }));
    expect(onAssign).toHaveBeenCalledExactlyOnceWith("physical-23");
    expect(onSwing).not.toHaveBeenCalled();
    expect(onSendToBreak).not.toHaveBeenCalled();
  });
});
