import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  selectedClubId: "club-a",
  client: {},
  loadFinanceSummary: vi.fn(),
  capabilitiesLoading:false,
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => mock.client,
}));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({
    loading: mock.capabilitiesLoading, scopeError: null, isSuperAdmin: false,
    moduleClubIds: () => ["club-a", "club-b"],
    clubs: [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }],
  }),
}));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({
  useOpsWorkspace: () => ({ selectedClubId: mock.selectedClubId }),
}));
vi.mock("@/ops/opsMutations", () => ({ OPS_CASHIER_MUTATIONS_ENABLED: false }));
vi.mock("./CashierCashflowPanel", () => ({ default: () => null }));
vi.mock("./TourRevenuePanel", () => ({ default: () => null }));
vi.mock("./financeReadAdapter", () => ({
  currentMonthFinanceRange: () => ({ from: "2026-09-01", to: new Date().toISOString() }),
  loadFinanceSummary: mock.loadFinanceSummary,
}));
vi.mock("./FinanceWorkspaceView", () => ({
  FinanceWorkspaceView: ({ clubName, summary, loading, onRefresh, blockedReason }: {
    clubName: string; summary: { revenue: { total: number } } | null; loading: boolean;
    onRefresh:()=>void;
    blockedReason:string|null;
  }) => <div>{clubName}: {loading ? "loading" : summary?.revenue.total ?? "empty"}<span data-testid="verified-summary">{summary?.revenue.total??'none'}</span><button onClick={onRefresh}>Refresh</button>{blockedReason&&<span>{blockedReason}</span>}</div>,
}));

import OpsFinanceWorkspace from "./OpsFinanceWorkspace";

describe("Finance club scope", () => {
  afterEach(()=>{cleanup();vi.useRealTimers();});
  beforeEach(() => {
    mock.selectedClubId = "club-a";
    mock.loadFinanceSummary.mockReset();
    mock.capabilitiesLoading=false;
  });

  it('keeps verified totals during a background read but removes them if that read fails',async()=>{
    vi.useFakeTimers();let reject!: (error:Error)=>void;
    mock.loadFinanceSummary.mockResolvedValueOnce({revenue:{total:100}}).mockImplementationOnce(()=>new Promise((_resolve,no)=>{reject=no;}));
    render(<OpsFinanceWorkspace/>);await act(async()=>{});expect(screen.getByTestId('verified-summary').textContent).toBe('100');
    await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(screen.getByTestId('verified-summary').textContent).toBe('100');
    await act(async()=>reject(Error('FINANCE_SUMMARY_RPC_UNAVAILABLE')));expect(screen.getByTestId('verified-summary').textContent).toBe('none');
    expect(screen.getByText('FINANCE_SUMMARY_RPC_UNAVAILABLE')).toBeTruthy();
  });

  it('clears previously verified totals across capability reauthentication for the same club',async()=>{
    mock.loadFinanceSummary.mockResolvedValueOnce({revenue:{total:100}}).mockReturnValueOnce(new Promise(()=>{}));
    const view=render(<OpsFinanceWorkspace/>);await screen.findByText('Club A: 100');
    mock.capabilitiesLoading=true;view.rerender(<OpsFinanceWorkspace/>);expect(screen.getByTestId('verified-summary').textContent).toBe('none');
    mock.capabilitiesLoading=false;view.rerender(<OpsFinanceWorkspace/>);await waitFor(()=>expect(mock.loadFinanceSummary).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('verified-summary').textContent).toBe('none');
  });

  it('does not claim missing club authority while capabilities are still loading',()=>{
    mock.capabilitiesLoading=true;mock.selectedClubId='club-unverified';
    render(<OpsFinanceWorkspace/>);
    expect(screen.queryByText('FINANCE_CLUB_SCOPE_REQUIRED')).toBeNull();
    expect(mock.loadFinanceSummary).not.toHaveBeenCalled();
    expect(screen.getByText('CLB đã chọn: loading')).toBeTruthy();
  });

  it('observes the mount time instead of the module import time',async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2035-10-01T00:30:00+07:00'));
    mock.loadFinanceSummary.mockResolvedValue({revenue:{total:100}});
    render(<OpsFinanceWorkspace/>);
    await waitFor(()=>expect(mock.loadFinanceSummary).toHaveBeenCalled());
    expect(mock.loadFinanceSummary.mock.calls[0][2].to).toBe('2035-09-30T17:30:00.000Z');
  });

  it('refreshes the as-of cutoff instead of repeating the old range',async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2035-10-01T00:30:00+07:00'));
    mock.loadFinanceSummary.mockResolvedValue({revenue:{total:100}});
    render(<OpsFinanceWorkspace/>);
    await screen.findByText('Club A: 100');
    vi.setSystemTime(new Date('2035-10-02T03:15:22.123+07:00'));
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
    await waitFor(()=>expect(mock.loadFinanceSummary).toHaveBeenCalledTimes(2));
    expect(mock.loadFinanceSummary.mock.calls[1][2].to).toBe('2035-10-01T20:15:22.123Z');
  });

  it("hides the previous club immediately and ignores its late response", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    mock.loadFinanceSummary.mockImplementation((_client: unknown, clubId: string) =>
      new Promise((resolve) => { pending.set(clubId, resolve); }));

    const view = render(<OpsFinanceWorkspace />);
    await waitFor(() => expect(pending.has("club-a")).toBe(true));
    mock.selectedClubId = "club-b";
    view.rerender(<OpsFinanceWorkspace />);
    expect(screen.getByText("Club B: loading")).toBeTruthy();
    await waitFor(() => expect(pending.has("club-b")).toBe(true));

    await act(async () => { pending.get("club-b")?.({ revenue: { total: 200 } }); });
    expect(screen.getByText("Club B: 200")).toBeTruthy();
    await act(async () => { pending.get("club-a")?.({ revenue: { total: 100 } }); });
    expect(screen.getByText("Club B: 200")).toBeTruthy();
    expect(screen.queryByText("Club B: 100")).toBeNull();
  });

  it("does not show already-loaded Club A totals under Club B while B loads", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    mock.loadFinanceSummary.mockImplementation((_client: unknown, clubId: string) =>
      new Promise((resolve) => { pending.set(clubId, resolve); }));

    const view = render(<OpsFinanceWorkspace />);
    await waitFor(() => expect(pending.has("club-a")).toBe(true));
    await act(async () => { pending.get("club-a")?.({ revenue: { total: 100 } }); });
    expect(screen.getByText("Club A: 100")).toBeTruthy();

    mock.selectedClubId = "club-b";
    view.rerender(<OpsFinanceWorkspace />);
    expect(screen.getByText("Club B: loading")).toBeTruthy();
    expect(screen.queryByText("Club B: 100")).toBeNull();
  });

 it('automatically reads new revenue with a moving as-of cutoff while Owner stays on the page',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2035-10-01T00:30:00+07:00'));
  mock.loadFinanceSummary.mockResolvedValue({revenue:{total:100}});
  render(<OpsFinanceWorkspace/>);await act(async()=>{});
  expect(screen.getByText('Club A: 100')).toBeTruthy();
  mock.loadFinanceSummary.mockResolvedValue({revenue:{total:200}});
  await act(async()=>vi.advanceTimersByTimeAsync(5000));
  expect(mock.loadFinanceSummary).toHaveBeenCalledTimes(2);
  expect(mock.loadFinanceSummary.mock.calls[1][2].to).toBe('2035-09-30T17:30:05.000Z');
  expect(screen.getByText('Club A: 200')).toBeTruthy();
 });
});
