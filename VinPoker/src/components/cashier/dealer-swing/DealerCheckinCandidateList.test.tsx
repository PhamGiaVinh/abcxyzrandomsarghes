import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DealerCheckinCandidateList } from "./DealerCheckinCandidateList";
import type { CheckinCandidate } from "@/lib/dealerCheckinCandidates";

const rows: CheckinCandidate[] = ["new", "previously_checked_out", "already_checked_in", "ambiguous"].map((status) => ({
  id: status, full_name: `TEST ${status}`, tier: "C", club_id: "club-a", checkinStatus: status as CheckinCandidate["checkinStatus"],
}));
function Harness() {
  const [selectedIds, onSelection] = useState<string[]>([]);
  return <DealerCheckinCandidateList candidates={rows} selectedIds={selectedIds} onSelection={onSelection}
    loading={false} error={null} busy={false} onRetry={() => {}} />;
}
describe("check-in candidate interaction", () => {
  it("selects only new/previously closed dealers, never current or ambiguous attendance", () => {
    render(<Harness />);
    expect(screen.getByRole("checkbox", { name: "TEST already_checked_in" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "TEST ambiguous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả" }));
    expect(screen.getByText("Đã chọn: 2")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "TEST new" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "TEST previously_checked_out" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    expect(screen.getByText("Đã chọn: 0")).toBeInTheDocument();
  });
  it("hides stale candidates and blocks selection after a read error, but allows explicit retry", () => {
    const retry = vi.fn(); const select = vi.fn();
    render(<DealerCheckinCandidateList candidates={rows} selectedIds={[]} onSelection={select}
      loading={false} error="READ_FAILED" busy={false} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("READ_FAILED");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chọn tất cả" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại trạng thái ca" }));
    expect(retry).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
  });
  it("does not classify loading as an empty successful roster", () => {
    render(<DealerCheckinCandidateList candidates={[]} selectedIds={[]} onSelection={vi.fn()}
      loading error={null} busy={false} onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh");
    expect(screen.queryByText(/Không có dealer phù hợp/)).not.toBeInTheDocument();
  });
});
