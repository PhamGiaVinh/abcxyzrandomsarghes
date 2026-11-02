import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFinanceSummary, parseFinanceSummary } from "@/ops/finance/financeReadAdapter";
import { FinanceWorkspaceView } from "@/ops/finance/FinanceWorkspaceView";

// Reproduced with existing native TEST sale/cancellation timestamps, unchanged:
// report window 2026-10-18 21:43:00.000–.500 UTC+7 excludes the original sale
// and includes its refund. No synthetic payment or rewritten timestamp needed.
const refundOnly = {
  revenue: { total: -5000, rake: 0, serviceFee: 0, stakingFees: 0, payoutFees: 0, fnb: -5000 },
  cost: { payrollNet: 0, ptWagePaid: 0, fnbCogs: -2000, compCogs: 0, clubExpenses: 0 },
  net: -3000,
};
afterEach(cleanup);
describe("owner finance signed F&B reversal contract", () => {
  it("accepts the real refund-only server response through the RPC loader", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: refundOnly, error: null });
    const summary = await loadFinanceSummary({ rpc } as never, "local-club", { from: "2026-10-18T14:43:00.000Z", to: "2026-10-18T14:43:00.500Z" });
    expect(summary).toEqual(refundOnly);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_club_finance_summary", { p_club_id: "local-club", p_from: "2026-10-18T14:43:00.000Z", p_to: "2026-10-18T14:43:00.500Z" });
  });
  it("renders a refund as negative revenue and reversed cost rather than blocking the report", () => {
    const summary = parseFinanceSummary(refundOnly);
    render(<FinanceWorkspaceView clubName="Local TEST" range={{ from: "2026-10-18T14:43:00.000Z", to: "2026-10-18T14:43:00.500Z" }} summary={summary} loading={false} blockedReason={null} onRefresh={() => {}} />);
    expect(screen.queryByText("Tài chính tạm khóa")).not.toBeInTheDocument();
    expect(screen.getAllByText(/-5\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/-2\.000/)).toBeInTheDocument();
    expect(screen.getByText(/-3\.000/)).toBeInTheDocument();
  });
  it("accepts reversal of comp cost without manufacturing revenue", () => {
    const response = { revenue: { ...refundOnly.revenue, total: 0, fnb: 0 }, cost: { ...refundOnly.cost, fnbCogs: 0, compCogs: -2000 }, net: 2000 };
    expect(parseFinanceSummary(response)).toEqual(response);
  });
  it.each([NaN, Infinity, -Infinity, "-5000"])("rejects malformed signed amount %s", (value) => {
    expect(() => parseFinanceSummary({ ...refundOnly, revenue: { ...refundOnly.revenue, fnb: value } } as never)).toThrow("FINANCE_SUMMARY_MALFORMED");
  });
  it("still rejects negative rake instead of accepting every financial field as signed", () => {
    expect(() => parseFinanceSummary({ ...refundOnly, revenue: { ...refundOnly.revenue, rake: -1 } })).toThrow("FINANCE_SUMMARY_MALFORMED");
  });
  it('retains a signed operating-expense correction in its own reporting window',()=>{
    const credit={revenue:{...refundOnly.revenue,total:0,fnb:0},cost:{...refundOnly.cost,fnbCogs:0,clubExpenses:-10000},net:10000};
    expect(parseFinanceSummary(credit)).toEqual(credit);
  });});
