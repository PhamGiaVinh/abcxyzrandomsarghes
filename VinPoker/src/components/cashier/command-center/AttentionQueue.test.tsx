import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AttentionQueue from "./AttentionQueue";

describe("empty live-table priority lane", () => {
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
