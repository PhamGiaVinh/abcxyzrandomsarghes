import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/hooks/useClubPayoutLiability", () => ({ useClubPayoutLiability: (query: unknown) => {
  mocks.read(query); return { loading: false, error: null, notApplied: false, data: null };
} }));
vi.mock("@/hooks/useClubFinanceSummary", () => ({ useClubFinanceSummary: (query: unknown) => {
  mocks.read(query); return { loading: false, error: null, summary: null };
} }));
vi.mock("../tabs/PayoutLiabilityTab", () => ({ PayoutLiabilityTab: () => null }));
vi.mock("../tabs/PayrollCostTab", () => ({ PayrollCostTab: () => null }));
vi.mock("../tabs/OverviewTab", () => ({ OverviewTab: () => null }));
import { LivePayoutTab } from "../live/LivePayoutTab";
import { LivePayrollTab } from "../live/LivePayrollTab";
import { LiveOverviewTab } from "../live/LiveOverviewTab";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
describe("payout report Vietnam calendar", () => {
  it.each([
    ["2026-10-17T00:30:00+07:00", "2026-10-01", "2026-10-17"],
    ["2027-01-01T00:00:00+07:00", "2027-01-01", "2027-01-01"],
    ["2026-12-31T23:59:59+07:00", "2026-12-01", "2026-12-31"],
  ])("uses the business month and day at %s", (now, from, to) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    render(<LivePayoutTab />);
    expect(mocks.read).toHaveBeenLastCalledWith({ from, to, clubFilter: "all" });
  });
});

describe.each([
  ["payroll", () => <LivePayrollTab />],
  ["overview", () => <LiveOverviewTab onNavigate={() => {}} />],
] as const)("%s report Vietnam calendar", (_name, element) => {
  it.each([
    ["2026-10-17T00:30:00+07:00", "2026-10-01", "2026-10-17"],
    ["2027-01-01T00:00:00+07:00", "2027-01-01", "2027-01-01"],
    ["2026-12-31T23:59:59+07:00", "2026-12-01", "2026-12-31"],
    ["2024-02-29T00:01:00+07:00", "2024-02-01", "2024-02-29"],
  ])("uses the business month and day at %s", (now, from, to) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    render(element());
    expect(mocks.read).toHaveBeenLastCalledWith({ from, to, clubFilter: "all" });
  });
});
