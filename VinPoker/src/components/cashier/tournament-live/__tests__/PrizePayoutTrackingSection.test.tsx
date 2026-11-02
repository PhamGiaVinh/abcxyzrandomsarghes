import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TournamentPayoutRecipients } from "@/hooks/useTournamentPayoutRecipients";

afterEach(cleanup);

// Mutable hook stub — tests drive loading / notApplied / data per scenario.
const REC: { loading: boolean; error: string | null; notApplied: boolean; data: TournamentPayoutRecipients | null; reload: () => void } = {
  loading: false, error: null, notApplied: false, data: null, reload: vi.fn(),
};
vi.mock("@/hooks/useTournamentPayoutRecipients", () => ({
  useTournamentPayoutRecipients: () => REC,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({
  user: { id: "owner-test" }, session: null,
}) }));

// supabase.rpc for the write path (record_tournament_prize_payment).
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const client = { rpc: function (...args: unknown[]) {
    if (this !== client) throw new Error("SDK_RPC_RECEIVER_LOST");
    return rpc(...args);
  } };
  return { supabase: client };
});

// toast spies.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PrizePayoutTrackingSection } from "../PrizePayoutTrackingSection";
import { toast } from "sonner";

const nfc = (s: string) => s.normalize("NFC");
const bodyText = () => document.body.textContent!.normalize("NFC");
const has = (s: string) => bodyText().includes(nfc(s));
const clickBtn = (label: string) => {
  const btns = Array.from(document.body.querySelectorAll("button"));
  const btn = btns.find((b) => (b.textContent ?? "").normalize("NFC").includes(nfc(label)));
  if (!btn) throw new Error("button not found: " + label);
  fireEvent.click(btn);
};

const DATA = {
  tournamentId: "t1", itmPlaces: 3, owedTotal: 6_000_000, paidTotal: 2_000_000,
  paidCount: 1, totalCount: 2,
  places: [
    { finishedPlace: 1, recipientName: "Nguyễn Văn A", prizeAmount: 4_000_000, isPaid: false, paidAt: null, method: null,
      entryId: "10000000-0000-4000-8000-000000000001", recipientRef: "10000000-0000-4000-8000-000000000002", confirmationToken: "a".repeat(32) },
    { finishedPlace: 2, recipientName: "Trần B", prizeAmount: 2_000_000, isPaid: true, paidAt: "2026-07-04T10:00:00Z", method: "cash",
      entryId: "10000000-0000-4000-8000-000000000003", recipientRef: "10000000-0000-4000-8000-000000000004", confirmationToken: "b".repeat(32) },
  ],
};
const RECEIPT = { ok: true, outcome: "recorded", prize_amount: 4_000_000,
  payment_id: "10000000-0000-4000-8000-000000000005", paid_at: "2026-10-17T00:00:00Z",
  tournament_id: "t1", finished_place: 1, entry_id: DATA.places[0].entryId, recipient_ref: DATA.places[0].recipientRef };

beforeEach(() => {
  sessionStorage.clear();
  REC.loading = false; REC.error = null; REC.notApplied = false; REC.data = null;
  REC.reload = vi.fn();
  rpc.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("PrizePayoutTrackingSection (W3-B2)", () => {
  it.each([false,true])('labels individual obligations as partial even when every known recipient is paid: %s',paid=>{
    const event='10000000-0000-4000-8000-000000000010';
    REC.data={...DATA,mode:'multi_day',eventId:event,liabilityScope:'INDIVIDUAL',isPartial:true,
      owedTotal:100000,paidTotal:paid?100000:0,paidCount:paid?1:0,totalCount:1,
      places:[{...DATA.places[0],finishedPlace:8,prizeAmount:paid?0:100000,isPaid:paid,
        multiDayEventId:event,multiDayParticipationId:'10000000-0000-4000-8000-000000000011',
        obligationAmount:100000,paidAmount:paid?100000:0}]};
    render(<PrizePayoutTrackingSection tournamentId="t1"/>);
    expect(has('Một phần Main Event')).toBe(true);
    expect(has('Chỉ gồm nghĩa vụ cá nhân đã chốt; chưa phải tổng nghĩa vụ toàn Main Event.')).toBe(true);
    expect(has('suất đã chốt')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(has('Ghi nhận đã trả')).toBe(!paid);
  });
  it('does not show the partial warning for a global obligation list',()=>{
    REC.data={...DATA,liabilityScope:'GLOBAL',isPartial:false};
    render(<PrizePayoutTrackingSection tournamentId="t1"/>);
    expect(has('Một phần Main Event')).toBe(false);
    expect(has('Chỉ gồm nghĩa vụ cá nhân đã chốt')).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not discard a lost-response intent after an unrecognized retry rejection',async()=>{
    REC.data=DATA;rpc.mockRejectedValueOnce(new Error('lost response'));
    render(<PrizePayoutTrackingSection tournamentId="t1"/>);clickBtn('Ghi nhận đã trả');clickBtn('Xác nhận đã trả');
    await waitFor(()=>expect(has('Kiểm tra kết quả')).toBe(true));const retained=sessionStorage.getItem('vinpoker:prize-payment:v2:owner-test:t1');const original=rpc.mock.calls[0];
    rpc.mockResolvedValueOnce({data:{ok:false,error:'upstream_unavailable'},error:null});clickBtn('Gửi lại yêu cầu cũ');
    await waitFor(()=>expect(rpc).toHaveBeenCalledTimes(2));await waitFor(()=>expect(toast.error).toHaveBeenCalledTimes(2));
    expect(sessionStorage.getItem('vinpoker:prize-payment:v2:owner-test:t1')).toBe(retained);expect(has('Kiểm tra kết quả')).toBe(true);
    expect(rpc.mock.calls[1]).toEqual(original);expect(toast.success).not.toHaveBeenCalled();expect(REC.reload).not.toHaveBeenCalled();
    const args=original[1];rpc.mockResolvedValueOnce({data:{found:true,actor_id:'owner-test',request_id:args.p_request_id,
      payload:{tournament_id:'t1',finished_place:1,method:args.p_method,expected_token:args.p_expected_token},result:RECEIPT},error:null});
    clickBtn('Kiểm tra kết quả');await waitFor(()=>expect(toast.success).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[2]).toEqual(['get_tournament_prize_payment_receipt_v2',{p_request_id:args.p_request_id}]);
    expect(sessionStorage.getItem('vinpoker:prize-payment:v2:owner-test:t1')).toBeNull();expect(REC.reload).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.filter(([name])=>name==='record_tournament_prize_payment_v2')).toHaveLength(2);

  });

  it.each([
    ['2026-10-26T17:30:00Z','27/10/2026'],
    ['2026-09-30T17:00:00.001Z','1/10/2026'],
    ['2026-12-31T17:00:00Z','1/1/2027'],
  ])('shows paid date in business UTC+7 for %s', (paidAt,expected)=>{
    REC.data={...DATA,places:[{...DATA.places[1],paidAt}],paidCount:1,totalCount:1};
    render(<PrizePayoutTrackingSection tournamentId="t1"/>);
    expect(bodyText()).toContain('Đã trả · '+expected);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('offers explicit read recovery after a transport error without sending a payment',()=>{
    REC.error='TEST 503 unavailable';
    const view=render(<PrizePayoutTrackingSection tournamentId="t1"/>);
    expect(has('TEST 503 unavailable')).toBe(true);
    expect(has('Ghi nhận đã trả')).toBe(false);
    clickBtn('Tải lại danh sách trả thưởng');
    expect(document.querySelector('[role="alert"]')).toHaveTextContent('TEST 503 unavailable');
    expect(REC.reload).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    REC.error=null;REC.loading=true;view.rerender(<PrizePayoutTrackingSection tournamentId="t1"/>);
    expect(has('Tải lại danh sách trả thưởng')).toBe(false);
    REC.loading=false;REC.data=DATA;view.rerender(<PrizePayoutTrackingSection tournamentId="t1"/>);
    expect(has('Nguyễn Văn A')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('routes a qualified payment by participation and retains its recovery identity',async()=>{
    const event='10000000-0000-4000-8000-000000000010',participation='10000000-0000-4000-8000-000000000011';
    REC.data={...DATA,mode:'multi_day',eventId:event,places:[{...DATA.places[0],multiDayEventId:event,
      multiDayParticipationId:participation,obligationAmount:4000000,paidAmount:0}],totalCount:1,paidCount:0};
    rpc.mockRejectedValueOnce(new Error('lost response'));
    render(<PrizePayoutTrackingSection tournamentId="t1"/>);
    clickBtn('Ghi nhận đã trả');clickBtn('Xác nhận đã trả');
    await waitFor(()=>expect(rpc).toHaveBeenCalled());
    const [name,args]=rpc.mock.calls[0];expect(name).toBe('record_multi_day_prize_payment_v1');
    expect(args).toMatchObject({p_event_id:event,p_participation_id:participation,p_expected_token:'a'.repeat(32)});
    await waitFor(()=>expect(has('Kiểm tra kết quả')).toBe(true));
    expect(sessionStorage.getItem('vinpoker:prize-payment:v2:owner-test:t1')).toContain(participation);
    expect(rpc.mock.calls.some(([called])=>called==='record_tournament_prize_payment_v2')).toBe(false);
  });
  it("recovers a committed lost response after remount using only a receipt read", async () => {
    REC.data = DATA; rpc.mockRejectedValueOnce(new Error("response lost"));
    const first = render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả"); clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(has("Kiểm tra kết quả")).toBe(true));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const payload = rpc.mock.calls[0][1];
    const raw = sessionStorage.getItem("vinpoker:prize-payment:v2:owner-test:t1");
    expect(raw).toContain(payload.p_request_id);
    first.unmount();
    rpc.mockResolvedValueOnce({ data: { found: true, actor_id: "owner-test", request_id: payload.p_request_id,
      payload: { tournament_id: "t1", finished_place: 1, method: "cash", expected_token: payload.p_expected_token },
      result: RECEIPT }, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("Yêu cầu đang chờ xác minh")).toBe(true);
    clickBtn("Kiểm tra kết quả");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(rpc).toHaveBeenLastCalledWith("get_tournament_prize_payment_receipt_v2", { p_request_id: payload.p_request_id });
    expect(rpc.mock.calls.filter(([name]) => name === "record_tournament_prize_payment_v2")).toHaveLength(1);
    expect(sessionStorage.getItem("vinpoker:prize-payment:v2:owner-test:t1")).toBeNull();
  });

  it.each(['loading', 'error', 'notApplied'] as const)("recovers on the first click while the recipient read is %s, without duplicate requests", async (readState) => {
    REC.data = DATA;
    rpc.mockRejectedValueOnce(new Error('response lost'));
    const first = render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn('Ghi nhận đã trả'); clickBtn('Xác nhận đã trả');
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    const payload = rpc.mock.calls[0][1];
    const journal = sessionStorage.getItem('vinpoker:prize-payment:v2:owner-test:t1');
    first.unmount();
    REC.data = null;
    REC.loading = readState === 'loading';
    REC.error = readState === 'error' ? 'recipient read unavailable' : null;
    REC.notApplied = readState === 'notApplied';
    let finishReceipt!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(resolve => { finishReceipt = resolve; }));
    const restored = render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn('Kiểm tra kết quả');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual(['get_tournament_prize_payment_receipt_v2', { p_request_id: payload.p_request_id }]);
    expect(sessionStorage.getItem('vinpoker:prize-payment:v2:owner-test:t1')).toBe(journal);
    REC.loading = true; REC.error = null; REC.notApplied = false;
    restored.rerender(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn('Kiểm tra kết quả'); clickBtn('Gửi lại yêu cầu cũ');
    expect(rpc).toHaveBeenCalledTimes(2);
    await act(async () => finishReceipt({ data: { found: true, actor_id: 'owner-test', request_id: payload.p_request_id,
      payload: { tournament_id: 't1', finished_place: 1, method: 'cash', expected_token: payload.p_expected_token },
      result: RECEIPT }, error: null }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
    expect(REC.reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('vinpoker:prize-payment:v2:owner-test:t1')).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(has('Đang tải danh sách')).toBe(true);
  });

  it("retries the original payload/key explicitly and never generates a replacement after response loss", async () => {
    REC.data = DATA; rpc.mockRejectedValueOnce(new Error("response lost"));
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả"); clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const original = rpc.mock.calls[0];
    rpc.mockResolvedValueOnce({ data: RECEIPT, error: null });
    clickBtn("Gửi lại yêu cầu cũ");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(rpc.mock.calls[1]).toEqual(original);
  });

  it("keeps an unverified receipt pending instead of accepting another actor's result", async () => {
    REC.data = DATA; rpc.mockRejectedValueOnce(new Error("response lost"));
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả"); clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    rpc.mockResolvedValueOnce({ data: { found: true, actor_id: "OTHER", result: RECEIPT }, error: null });
    clickBtn("Kiểm tra kết quả");
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(toast.success).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("vinpoker:prize-payment:v2:owner-test:t1")).not.toBeNull();
    expect(has("Yêu cầu đang chờ xác minh")).toBe(true);
  });

  it("blocks new writes when the existing journal is malformed", () => {
    REC.data = DATA;
    sessionStorage.setItem("vinpoker:prize-payment:v2:owner-test:t1", "{broken");
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    expect(has("Xác nhận đã trả thưởng")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(has("Tạm khóa ghi nhận mới")).toBe(true);
  });

  it("retains the same intent after timeout and ignores a late transport success", async () => {
    vi.useFakeTimers();
    try {
      REC.data = DATA; let finish!: (value: unknown) => void;
      rpc.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      render(<PrizePayoutTrackingSection tournamentId="t1" />);
      clickBtn("Ghi nhận đã trả"); clickBtn("Xác nhận đã trả");
      const pending = sessionStorage.getItem("vinpoker:prize-payment:v2:owner-test:t1");
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(has("Yêu cầu đang chờ xác minh")).toBe(true);
      await act(async () => { finish({ data: RECEIPT, error: null }); });
      expect(toast.success).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("vinpoker:prize-payment:v2:owner-test:t1")).toBe(pending);
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("ignores a payment completion after changing tournaments", async () => {
    let finish!: (value: unknown) => void;
    rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    REC.data = DATA;
    const { rerender } = render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả"); clickBtn("Xác nhận đã trả");
    REC.data = { ...DATA, tournamentId: "t2" };
    rerender(<PrizePayoutTrackingSection tournamentId="t2" />);
    await act(async () => { finish({ data: RECEIPT, error: null }); });
    expect(toast.success).not.toHaveBeenCalled(); expect(REC.reload).not.toHaveBeenCalled();
  });

  it("does not revive a confirmation after an invalidating read error recovers", () => {
    REC.data = DATA;
    const { rerender } = render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    REC.error = "503"; rerender(<PrizePayoutTrackingSection tournamentId="t1" />);
    REC.error = null; rerender(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("Xác nhận đã trả thưởng")).toBe(false);
  });

  it("invalidates an open confirmation when changing tournaments", () => {
    REC.data = DATA;
    const { rerender } = render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    expect(has("Xác nhận đã trả thưởng")).toBe(true);
    REC.data = { ...DATA, tournamentId: "t2" };
    rerender(<PrizePayoutTrackingSection tournamentId="t2" />);
    expect(has("Xác nhận đã trả thưởng")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not report an unknown success outcome as a recorded payment", async () => {
    REC.data = DATA;
    rpc.mockResolvedValue({ data: { ok: true, outcome: "queued", prize_amount: 4_000_000 }, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả"); clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("invalidates confirmation when a refresh changes the recipient", () => {
    REC.data = DATA;
    const { rerender } = render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    REC.data = { ...DATA, places: [{ ...DATA.places[0], recipientName: "OTHER" }] };
    rerender(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("Xác nhận đã trả thưởng")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lists payable places: paid badge for paid, record button for unpaid", () => {
    REC.data = DATA;
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("Đã trả thưởng")).toBe(true);
    expect(has("Nguyễn Văn A")).toBe(true);
    expect(has("Trần B")).toBe(true);
    expect(has("#1")).toBe(true);
    expect(has("#2")).toBe(true);
    // paid place → badge; unpaid place → record button
    const btns = Array.from(document.body.querySelectorAll("button")).map((b) => (b.textContent ?? "").normalize("NFC"));
    expect(btns.some((t) => t.includes(nfc("Ghi nhận đã trả")))).toBe(true);
    // summary "1/2 suất"
    expect(has("1/2")).toBe(true);
  });

  it("notApplied → 'Cần áp dụng', no record button (RPC never reachable)", () => {
    REC.notApplied = true;
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("Cần áp dụng")).toBe(true);
    const btns = Array.from(document.body.querySelectorAll("button")).map((b) => (b.textContent ?? "").normalize("NFC"));
    expect(btns.some((t) => t.includes(nfc("Ghi nhận đã trả")))).toBe(false);
  });

  it("empty finalized places → honest 'chưa thể ghi nhận trả', not a 0", () => {
    REC.data = { ...DATA, places: [], totalCount: 0, paidCount: 0, owedTotal: 0, paidTotal: 0 };
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("chưa thể ghi nhận trả")).toBe(true);
  });

  it("record → confirm → success toast; RPC sends only place + method (server derives amount)", async () => {
    REC.data = DATA;
    rpc.mockResolvedValue({ data: RECEIPT, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    expect(has("Xác nhận đã trả thưởng")).toBe(true); // dialog restates the money-action
    clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("record_tournament_prize_payment_v2", {
      p_tournament_id: "t1", p_finished_place: 1, p_method: "cash", p_expected_token: "a".repeat(32),
      p_request_id: expect.any(String),
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("already_paid → idempotent SUCCESS (never a red error)", async () => {
    REC.data = DATA;
    rpc.mockResolvedValue({ data: { ...RECEIPT, outcome: "already_paid" }, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain(nfc("trước đó"));
  });

  it("business error (place_not_finalized) → mapped VI error toast, no success", async () => {
    REC.data = DATA;
    rpc.mockResolvedValue({ data: { ok: false, error: "place_not_finalized" }, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(nfc("chưa chốt"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
