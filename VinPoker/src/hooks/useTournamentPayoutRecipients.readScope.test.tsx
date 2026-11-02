import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ rpc: vi.fn(),
  auth: { user: { id: "owner-a" } as { id: string } | null,
    session: { access_token: "TEST_A" } as { access_token: string } | null, loading: false } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: fixtures.rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => fixtures.auth }));
import { useTournamentPayoutRecipients } from "./useTournamentPayoutRecipients";
const packet = (tournamentId = "A") => ({ tournamentId, itmPlaces: 1, owedTotal: 100, paidTotal: 0,
  paidCount: 0, totalCount: 1, places: [{ finishedPlace: 1, recipientName: "TEST", prizeAmount: 100,
    isPaid: false, paidAt: null, method: null, entryId: "10000000-0000-4000-8000-000000000001",
    recipientRef: "10000000-0000-4000-8000-000000000002", confirmationToken: "a".repeat(32) }] });
function deferred() { let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { fixtures.rpc.mockReset(); fixtures.auth = {
  user: { id: "owner-a" }, session: { access_token: "TEST_A" }, loading: false };
  fixtures.rpc.mockResolvedValue({ data: packet(), error: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("payout recipients read scope", () => {
  const scopedPacket = (metadata: Record<string, unknown>) => {
    const eventId = '10000000-0000-4000-8000-000000000010';
    return {...packet(), mode: 'multi_day', eventId, ...metadata, places: [{...packet().places[0],
      multiDayEventId: eventId, multiDayParticipationId: '10000000-0000-4000-8000-000000000011',
      obligationAmount: 100, paidAmount: 0}]};
  };
  it.each([
    {liabilityScope:'INDIVIDUAL',isPartial:false},
    {liabilityScope:'GLOBAL',isPartial:true},
    {liabilityScope:'INDIVIDUAL'},
    {isPartial:true},
    {liabilityScope:'UNKNOWN',isPartial:false},
  ])('rejects contradictory or incomplete liability scope %#', async metadata => {
    fixtures.rpc.mockResolvedValueOnce({data:scopedPacket(metadata),error:null});
    const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('PAYOUT_RECIPIENTS_INVALID');
  });
  it('rejects individual scope on an ordinary tournament', async()=>{
    fixtures.rpc.mockResolvedValueOnce({data:{...packet(),liabilityScope:'INDIVIDUAL',isPartial:true},error:null});
    const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('PAYOUT_RECIPIENTS_INVALID');
  });
  it.each([{liabilityScope:'INDIVIDUAL',isPartial:true},{liabilityScope:'GLOBAL',isPartial:false},{}])(
    'accepts coherent multi-day scope and existing legacy contract %#',async metadata=>{
      const data=scopedPacket(metadata);fixtures.rpc.mockResolvedValueOnce({data,error:null});
      const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
      await waitFor(()=>expect(result.current.loading).toBe(false));
      expect(result.current.error).toBeNull();expect(result.current.data).toEqual(data);
    });
  it.each([
    {owedTotal:101},
    {paidTotal:1},
    {paidCount:1},
    {places:[{...packet().places[0],isPaid:true}],paidTotal:100,paidCount:0},
    {places:[{...packet().places[0],isPaid:true}],paidTotal:0,paidCount:1},
  ])('rejects inconsistent single-day payout aggregates %#',async(changes)=>{
    fixtures.rpc.mockResolvedValueOnce({data:{...packet(),...changes},error:null});
    const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('PAYOUT_RECIPIENTS_INVALID');
  });
  it('rejects the same single-day entry at two different ranks',async()=>{
    const first=packet().places[0];
    fixtures.rpc.mockResolvedValueOnce({data:{...packet(),itmPlaces:2,totalCount:2,owedTotal:200,
      places:[first,{...first,finishedPlace:2}]},error:null});
    const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('PAYOUT_RECIPIENTS_INVALID');
  });
  it('accepts a coherent mixed paid and unpaid single-day summary',async()=>{
    const first={...packet().places[0],isPaid:true,paidAt:'2026-10-21T02:00:00Z',method:'cash'};
    const second={...packet().places[0],finishedPlace:2,prizeAmount:50,entryId:'10000000-0000-4000-8000-000000000003'};
    fixtures.rpc.mockResolvedValueOnce({data:{...packet(),itmPlaces:2,totalCount:2,owedTotal:150,
      paidCount:1,paidTotal:100,places:[first,second]},error:null});
    const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data?.paidTotal).toBe(100);
  });
  it.each([1.5,Number.MAX_SAFE_INTEGER+1])('rejects nonrepresentable VND in single-day payout %s',async(amount)=>{
    fixtures.rpc.mockResolvedValueOnce({data:{...packet(),owedTotal:amount,places:[{...packet().places[0],prizeAmount:amount}]},error:null});
    const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeTruthy();
  });
  it('accepts equal ranks only with distinct qualified participation identities',async()=>{
    const event='10000000-0000-4000-8000-000000000010';
    const first={...packet().places[0],multiDayEventId:event,multiDayParticipationId:'10000000-0000-4000-8000-000000000011',obligationAmount:100,paidAmount:0};
    const second={...first,entryId:'10000000-0000-4000-8000-000000000012',recipientRef:'10000000-0000-4000-8000-000000000013',multiDayParticipationId:'10000000-0000-4000-8000-000000000014'};
    fixtures.rpc.mockResolvedValueOnce({data:{...packet(),mode:'multi_day',eventId:event,owedTotal:200,totalCount:2,places:[first,second]},error:null});
    const {result}=renderHook(()=>useTournamentPayoutRecipients('A'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();expect(result.current.data?.places).toHaveLength(2);
  });
  it("ignores A after a newer B response", async () => {
    const old = deferred(); fixtures.rpc.mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ data: packet("B"), error: null });
    const { result, rerender } = renderHook(({ id }) => useTournamentPayoutRecipients(id), { initialProps: { id: "A" } });
    rerender({ id: "B" });
    await waitFor(() => expect(result.current.data?.tournamentId).toBe("B"));
    await act(async () => { old.resolve({ data: packet("A"), error: null }); });
    expect(result.current.data?.tournamentId).toBe("B");
  });
  it("hides data and refuses a retained reload after logout", async () => {
    const { result, rerender } = renderHook(() => useTournamentPayoutRecipients("A"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldReload = result.current.reload;
    fixtures.auth = { user: null, session: null, loading: false }; rerender();
    expect(result.current.data).toBeNull();
    await act(async () => { await oldReload(); });
    expect(fixtures.rpc).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("AUTH_REQUIRED");
  });
  it("invalidates the same tournament on a new session", async () => {
    const { result, rerender } = renderHook(() => useTournamentPayoutRecipients("A"));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    fixtures.rpc.mockReturnValueOnce(new Promise(() => {}));
    fixtures.auth.session = { access_token: "TEST_B" }; rerender();
    expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(true);
    expect(fixtures.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([null, { ...packet(), tournamentId: "OTHER" },
    { ...packet(), places: [{ ...packet().places[0], confirmationToken: undefined }] },
    { ...packet(), owedTotal: null }, { ...packet(), places: [{ ...packet().places[0], prizeAmount: NaN }] },
    { ...packet(), places: [packet().places[0], packet().places[0]], totalCount: 2 }])(
    "rejects invalid payload %# instead of authorizing a confirmation", async (data) => {
      fixtures.rpc.mockResolvedValue({ data, error: null });
      const { result } = renderHook(() => useTournamentPayoutRecipients("A"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBeNull(); expect(result.current.error).toBeTruthy();
    });
  it("classifies missing schema-cache RPC separately from network failure", async () => {
    fixtures.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } });
    const { result } = renderHook(() => useTournamentPayoutRecipients("A"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notApplied).toBe(true);
    fixtures.rpc.mockResolvedValueOnce({ data: null, error: { message: "503" } });
    await act(async () => { await result.current.reload(); });
    expect(result.current.notApplied).toBe(false); expect(result.current.error).toBe("503");
  });
  it("bounds a hung read and ignores its late payload", async () => {
    vi.useFakeTimers(); const pending = deferred(); fixtures.rpc.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useTournamentPayoutRecipients("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(result.current.loading).toBe(false); expect(result.current.error).toBeTruthy();
    await act(async () => { pending.resolve({ data: packet(), error: null }); });
    expect(result.current.data).toBeNull();
  });
});
// Explicit native-payload qualification only. Default test runs skip these cases;
// fixtures are generated by the guarded READ ONLY runner and remain outside Git.
const native1011=process.env.VINPOKER_PAYOUT1011_PAYLOAD==='1';
describe.skipIf(!native1011)('captured original journey native payload compatibility (modeled transport)',()=>{
  it.each([
    ['single244','c367013a-3ed3-48af-ad48-3915acadc50e',2,900000],
    ['main167Final','4cd3af4d-7e1d-4042-855f-04fb6777e580',15,2500000],
  ])('parses the actual %s response without losing identity or paid accounting',async(key,tour,count,total)=>{
    const {readFileSync}=await import('node:fs');
    const evidence=JSON.parse(readFileSync('D:/Quy trình/output/reports/payout1011-original-payloads-native-local-20261027.json','utf8'));
    expect(evidence.guard).toMatchObject({db:'vinpoker_ops_cash115_qualified_c',host:'127.0.0.1',port:55441,external:0});
    expect(evidence.unchanged).toBe(true);expect(evidence.before).toBe(evidence.after);
    const captured=evidence.journeys.find((row:{key:string})=>row.key===key);expect(captured.tour).toBe(tour);
    fixtures.auth={user:{id:captured.actor},session:{access_token:'LOCAL_NATIVE_PAYLOAD_TEST'},loading:false};
    fixtures.rpc.mockImplementation((name,args)=>{expect(name).toBe('get_tournament_payout_recipients');expect(args).toEqual({p_tournament_id:tour});return Promise.resolve({data:captured.nativeResponse,error:null});});
    const {result}=renderHook(()=>useTournamentPayoutRecipients(String(tour)));await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();expect(result.current.notApplied).toBe(false);expect(result.current.data).toEqual(captured.nativeResponse);
    expect(result.current.data).toMatchObject({totalCount:count,paidCount:count,paidTotal:total,owedTotal:total});expect(result.current.data?.places.every(place=>place.isPaid)).toBe(true);
    expect(fixtures.rpc).toHaveBeenCalledOnce();
  });
});
