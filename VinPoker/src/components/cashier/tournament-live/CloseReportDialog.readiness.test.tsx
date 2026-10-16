import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCloseReport } from "@/lib/closeReport";

const { useReport, reload, closeTournament } = vi.hoisted(() => ({
  useReport: vi.fn(), reload: vi.fn(), closeTournament: vi.fn(),
}));
vi.mock("@/hooks/useCloseReport", () => ({ useCloseReport: useReport }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import CloseReportDialog from "./CloseReportDialog";

const props = { open: true, onOpenChange: vi.fn(), tournamentId: "tour-test", tournamentName: "Close TEST" };
const state = (blockers: string[]) => ({
  report: computeCloseReport({ entries: [], payouts: [] }), loading: false,
  error: null, alreadyClosed: false, reload, closeTournament,
  readiness: { ok: true, ready: blockers.length === 0, alreadyClosed: false, blockers },
});

describe("CloseReportDialog official-result blockers", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    ["official_results_not_finished", "Chưa xác định được duy nhất một người thắng"],
    ["official_results_incomplete", "Thứ hạng đã ghi chưa đầy đủ hoặc không nhất quán"],
    ["official_results_evidence_missing", "Thiếu lịch sử thứ tự bust"],
  ])("explains %s and cannot enter confirmation", (code, message) => {
    useReport.mockReturnValue(state([code]));
    render(<CloseReportDialog {...props} />);
    expect(screen.getByRole("status").textContent).toContain(message);
    const next = screen.getByRole("button", { name: "Tiếp tục" });
    expect(next).toBeDisabled(); fireEvent.click(next);
    expect(screen.queryByPlaceholderText("CHOT GIAI")).toBeNull();
    expect(closeTournament).not.toHaveBeenCalled();
  });

  it("a previously typed phrase cannot override newly blocked server readiness", () => {
    useReport.mockReturnValue(state([]));
    const { rerender } = render(<CloseReportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.change(screen.getByPlaceholderText("CHOT GIAI"), { target: { value: "CHOT GIAI" } });
    expect(screen.getByRole("button", { name: "Chốt giải" })).toBeEnabled();
    useReport.mockReturnValue(state(["official_results_evidence_missing"]));
    rerender(<CloseReportDialog {...props} />);
    expect(screen.getByRole("status").textContent).toContain("Thiếu lịch sử thứ tự bust");
    const confirm = screen.getByRole("button", { name: "Chốt giải" });
    expect(confirm).toBeDisabled(); fireEvent.click(confirm);
    expect(closeTournament).not.toHaveBeenCalled();
  });
});
