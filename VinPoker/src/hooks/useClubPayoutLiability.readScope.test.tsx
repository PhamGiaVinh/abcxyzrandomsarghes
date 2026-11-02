import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), auth: { user: { id: "owner" } as { id: string } | null,
  session: { access_token: "TEST_SESSION" } as { access_token: string } | null, loading: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => fixture.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: fixture.rpc } }));
import { useClubPayoutLiability } from "./useClubPayoutLiability";
const scope = { from: "2026-10-01", to: "2026-10-17", clubFilter: "all" };
const packet = (changes = {}) => ({ periodFrom: "2026-09-30T17:00:00Z", periodTo: "2026-10-17T17:00:00Z",
  periodEndExclusive: true, fromDate: scope.from, toDate: scope.to, timeZone: "Asia/Ho_Chi_Minh", clubId: null,
  owedTotal: 100, paidTotal: 20, outstandingTotal: 80, perTournament: [], aging: { d0_1: 80, d2_7: 0, d8p: 0 }, ...changes });
const deferred = () => { let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { fixture.rpc.mockReset(); fixture.rpc.mockResolvedValue({ data: packet(), error: null });
  fixture.auth = { user: { id: "owner" }, session: { access_token: "TEST_SESSION" }, loading: false }; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("liability business-period read", () => {
  it('retains individual liability scope for the Finance consumer',async()=>{
    fixture.rpc.mockResolvedValue({data:packet({paidTotal:0,outstandingTotal:100,aging:{d0_1:100,d2_7:0,d8p:0},perTournament:[{tournamentId:'t',name:'TEST',closeDate:null,isClosed:false,hasFinishedPlace:true,
      owed:100,paid:0,outstanding:100,finishersCount:1,liabilityScope:'INDIVIDUAL',isPartial:true}]}),error:null});
    const {result}=renderHook(()=>useClubPayoutLiability(scope));await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.data?.perTournament[0]).toMatchObject({liabilityScope:'INDIVIDUAL',isPartial:true});
  });
  it.each([{liabilityScope:'GLOBAL',isPartial:true},{liabilityScope:'INDIVIDUAL',isPartial:false},{liabilityScope:'UNKNOWN',isPartial:false},{isPartial:true}])('rejects inconsistent individual liability metadata %j',async(metadata)=>{
    fixture.rpc.mockResolvedValue({data:packet({paidTotal:0,outstandingTotal:100,aging:{d0_1:100,d2_7:0,d8p:0},perTournament:[{tournamentId:'t',name:'TEST',closeDate:null,isClosed:false,hasFinishedPlace:true,
      owed:100,paid:0,outstanding:100,finishersCount:1,...metadata}]}),error:null});
    const {result}=renderHook(()=>useClubPayoutLiability(scope));await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();expect(result.current.error).toBeTruthy();
  });
  it("sends calendar dates to the server rather than browser-zone timestamp limits", async () => {
    const { result } = renderHook(() => useClubPayoutLiability(scope));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fixture.rpc).toHaveBeenCalledWith("get_club_payout_liability_v2", { p_from_date: scope.from, p_to_date: scope.to, p_club_id: null });
  });
  it("fences delayed club A after B and refuses an old reload", async () => {
    const old = deferred(); fixture.rpc.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: packet({ clubId: "B", paidTotal: 25 }), error: null });
    const { result, rerender } = renderHook((props) => useClubPayoutLiability(props), { initialProps: scope });
    const oldReload = result.current.reload;
    rerender({ ...scope, clubFilter: "B" });
    await waitFor(() => expect(result.current.data?.paidTotal).toBe(25));
    await act(async () => { old.resolve({ data: packet(), error: null }); await oldReload(); });
    expect(result.current.data?.paidTotal).toBe(25); expect(fixture.rpc).toHaveBeenCalledTimes(2);
  });
  it("hides values immediately on logout without issuing another RPC", async () => {
    const { result, rerender } = renderHook(() => useClubPayoutLiability(scope));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    fixture.auth = { user: null, session: null, loading: false }; rerender();
    expect(result.current.data).toBeNull(); expect(result.current.error).toBeTruthy();
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not accept an old A response after A to B to A", async () => {
    const old = deferred(), middle = deferred();
    fixture.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(middle.promise)
      .mockResolvedValueOnce({ data: packet({ paidTotal: 45 }), error: null });
    const { result, rerender } = renderHook((props) => useClubPayoutLiability(props), { initialProps: scope });
    rerender({ ...scope, clubFilter: "B" }); rerender(scope);
    await waitFor(() => expect(result.current.data?.paidTotal).toBe(45));
    await act(async () => { old.resolve({ data: packet(), error: null }); middle.resolve({ data: null, error: { message: "old" } }); });
    expect(result.current.data?.paidTotal).toBe(45); expect(result.current.error).toBeNull();
  });
  it("invalidates values on token refresh in the same account", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: packet(), error: null }).mockReturnValueOnce(new Promise(() => {}));
    const { result, rerender } = renderHook(() => useClubPayoutLiability(scope));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    fixture.auth.session = { access_token: "REFRESHED_TEST_SESSION" }; rerender();
    expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(true);
    expect(JSON.stringify(result.current)).not.toContain("TEST_SESSION");
  });
  it.each([null, packet({ owedTotal: null }), packet({ clubId: "OTHER" }), packet({ periodEndExclusive: false }),
    packet({ perTournament: [{ tournamentId: "t", name: "T", closeDate: null, isClosed: false, hasFinishedPlace: false,
      owed: null, paid: 0, outstanding: null, finishersCount: -1 }] }),
    packet({ perTournament: [{ tournamentId: "t", name: "T", closeDate: null, isClosed: true, hasFinishedPlace: true,
      owed: null, paid: 0, outstanding: null, finishersCount: 1 }] })])("rejects invalid/scope-mismatched response %#", async (data) => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    const { result } = renderHook(() => useClubPayoutLiability(scope));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull(); expect(result.current.error).toBeTruthy();
  });
  it("handles invalid dates without a stuck loading state or network call", async () => {
    const { result } = renderHook(() => useClubPayoutLiability({ ...scope, from: "2026-02-30" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy(); expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("bounds a hanging read and ignores late data", async () => {
    vi.useFakeTimers(); const pending = deferred(); fixture.rpc.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useClubPayoutLiability(scope));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(result.current.loading).toBe(false); expect(result.current.error).toBeTruthy();
    await act(async () => { pending.resolve({ data: packet(), error: null }); });
    expect(result.current.data).toBeNull();
  });
  it("classifies schema-cache absence without misreporting network errors as missing backend", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } });
    const { result } = renderHook(() => useClubPayoutLiability(scope));
    await waitFor(() => expect(result.current.loading).toBe(false)); expect(result.current.notApplied).toBe(true);
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: "503" } });
    await act(async () => { await result.current.reload(); });
    expect(result.current.notApplied).toBe(false); expect(result.current.error).toBe("503");
  });
});
