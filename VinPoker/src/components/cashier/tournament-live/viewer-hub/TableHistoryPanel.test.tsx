import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableHistoryPanel } from "./TableHistoryPanel";

const { rpc,signals } = vi.hoisted(() => ({ rpc: vi.fn(),signals:[] as AbortSignal[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc:(...args:unknown[])=>{
  const response=Promise.resolve(rpc(...args));
  return Object.assign(response,{abortSignal:(signal:AbortSignal)=>{signals.push(signal);return response;}});
} } }));
vi.mock("../PokerVisuals", () => ({ PokerCard: ({ card }: { card: string }) => <span>{card}</span> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallback: string, values?: { name?: string }) => values?.name ? fallback.replace("{{name}}", values.name) : fallback }) }));

afterEach(() => {rpc.mockReset();signals.length=0;});

describe("table-specific public history cards", () => {
  it('shows a full refund without a pot winner and removes it when proof becomes pending',async()=>{
    const item={handId:'full-refund',handNumber:2,createdAt:'2026-10-29T01:00:00Z',pot:100,bigBlind:100};
    rpc.mockResolvedValueOnce({data:{access:'public',items:[{...item,result:{status:'refunded',refund:{
      playerId:'bb',entryNumber:2,seatNumber:9,name:'Refunded BB',amount:100,
    }}}],nextCursor:null},error:null});
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()}/>);
    expect(await screen.findByText(/Đã xác minh: hoàn trả toàn bộ cược/)).toHaveTextContent('Refunded BB · 100 (1 BB)');
    expect(screen.getByText('Pot 0 (0 BB)')).toBeInTheDocument();
    expect(screen.queryByText(/Nhận pot/)).not.toBeInTheDocument();
    rpc.mockResolvedValueOnce({data:{access:'public',items:[{...item,result:{status:'pending'}}],nextCursor:null},error:null});
    fireEvent.focus(window);
    await screen.findByText('Kết quả đang được kiểm tra');
    expect(screen.queryByText(/Refunded BB/)).not.toBeInTheDocument();
  });
  it.each(['rpc error','transport rejection'])('invalidates a known corrected winner while a later refresh page waits and then fails: %s',async(failure)=>{
    const hand={handId:'known-corrected',handNumber:18,createdAt:'2026-10-18T01:00:00Z'};
    const verified={...hand,result:{status:'verified',recipients:[{playerId:'w',entryNumber:1,name:'Invalidated winner',potAward:200,netDelta:100,potKinds:['main']}]}};
    const older={handId:'kept-older',handNumber:17,createdAt:'2026-10-18T00:00:00Z',result:{status:'pending'}};
    const page=(items:unknown[],more:boolean)=>({data:{access:'public',items,nextCursor:more?{createdAt:hand.createdAt,id:hand.handId}:null},error:null});
    let finish!:(value:unknown)=>void;let reject!:(reason:Error)=>void;
    const held=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
    rpc.mockResolvedValueOnce(page([verified],true)).mockResolvedValueOnce(page([older],false))
      .mockResolvedValueOnce(page([{...hand,result:{status:'pending'}}],true)).mockReturnValueOnce(held);
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()}/>);
    await screen.findByText('Invalidated winner');fireEvent.click(screen.getByRole('button',{name:'Tải thêm'}));await screen.findByText('Hand #17');
    fireEvent.focus(window);await waitFor(()=>expect(rpc).toHaveBeenCalledTimes(4));
    await waitFor(()=>expect(screen.queryByText('Invalidated winner')).not.toBeInTheDocument());
    await act(async()=>{if(failure==='rpc error')finish({data:null,error:{message:'503'}});else reject(new Error('offline'));});
    await screen.findByText('Không thể tải lịch sử bàn. Dữ liệu đang hiển thị vẫn được giữ nguyên.');
    expect(screen.queryByText('Invalidated winner')).not.toBeInTheDocument();
    expect(screen.getByText('Hand #17')).toBeInTheDocument();
    expect(screen.getAllByText('Hand #18')).toHaveLength(1);
  });
  it('shows verified pot awards rather than gross commitments or winner net delta',async()=>{
    rpc.mockResolvedValue({data:{access:'public',items:[{handId:'refund-pot',handNumber:1,createdAt:'2026-10-18T01:00:00Z',pot:300,bigBlind:200,
      result:{status:'verified',recipients:[{playerId:'winner',entryNumber:1,name:'Refund winner',potAward:200,netDelta:100,potKinds:['main']}]}}],nextCursor:null},error:null});
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()}/>);
    await screen.findByText('Refund winner');expect(screen.getByText('Pot 200 (1 BB)')).toBeInTheDocument();
    expect(screen.queryByText('Pot 300 (1,5 BB)')).not.toBeInTheDocument();
  });
  it('uses the later correction when two pages overlap during a multi-page refresh',async()=>{
    const hand={handId:'refresh-overlap',handNumber:18,createdAt:'2026-10-18T01:00:00Z'};
    const verified={...hand,result:{status:'verified',recipients:[{playerId:'w',entryNumber:1,name:'Old refreshed winner',potAward:200,netDelta:100,potKinds:['main']}]}};
    const older={handId:'refresh-older',handNumber:17,createdAt:'2026-10-18T00:00:00Z',result:{status:'pending'}};
    const page=(items:unknown[],more:boolean)=>({data:{access:'public',items,nextCursor:more?{createdAt:hand.createdAt,id:hand.handId}:null},error:null});
    rpc.mockResolvedValueOnce(page([verified],true)).mockResolvedValueOnce(page([older],false))
      .mockResolvedValueOnce(page([verified],true)).mockResolvedValueOnce(page([{...hand,result:{status:'pending'}},older],false));
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()}/>);
    await screen.findByText('Old refreshed winner');fireEvent.click(screen.getByRole('button',{name:'Tải thêm'}));await screen.findByText('Hand #17');
    fireEvent.focus(window);await waitFor(()=>expect(rpc).toHaveBeenCalledTimes(4));
    await waitFor(()=>expect(screen.queryByText('Old refreshed winner')).not.toBeInTheDocument());
    expect(screen.getAllByText('Hand #18')).toHaveLength(1);
  });
  it('replaces an overlapping hand on append when the later page reports a correction',async()=>{
    const hand={handId:'overlap',handNumber:8,createdAt:'2026-10-18T01:00:00Z'};
    rpc.mockResolvedValueOnce({data:{access:'public',items:[{...hand,result:{status:'verified',recipients:[{
      playerId:'winner',entryNumber:1,seatNumber:1,name:'Stale overlap winner',potAward:200,netDelta:100,potKinds:['main'],holeCards:[]
    }]}}],nextCursor:{createdAt:hand.createdAt,id:hand.handId}},error:null});
    rpc.mockResolvedValueOnce({data:{access:'public',items:[{...hand,result:{status:'pending'}},
      {handId:'older',handNumber:7,createdAt:'2026-10-18T00:00:00Z',result:{status:'pending'}}],nextCursor:null},error:null});
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()}/>);
    await screen.findByText('Stale overlap winner');fireEvent.click(screen.getByRole('button',{name:'Tải thêm'}));
    await screen.findByText('Hand #7');
    expect(screen.queryByText('Stale overlap winner')).not.toBeInTheDocument();
    expect(screen.getAllByText('Hand #8')).toHaveLength(1);
  });
  it("removes the previous verified winner when a correction returns the hand to pending", async () => {
    const item = { handId: "corrected", handNumber: 2, createdAt: "2026-10-18T01:00:00Z",
      pot: 300, smallBlind: 100, bigBlind: 200, ante: 0 };
    rpc.mockResolvedValueOnce({ data: { access: "public", items: [{ ...item,
      result: { status: "verified", recipients: [{ playerId: "winner", entryNumber: 1,
        seatNumber: 1, name: "Previous verified winner", avatarUrl: null, holeCards: [],
        potAward: 200, netDelta: 100, potKinds: ["main"] }] },
    }], nextCursor: null }, error: null });
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    expect(await screen.findByText("Previous verified winner")).toBeInTheDocument();
    rpc.mockResolvedValueOnce({ data: { access: "public", items: [{ ...item,
      result: { status: "pending" },
    }], nextCursor: null }, error: null });
    fireEvent.focus(window);
    expect(await screen.findByText("Kết quả đang được kiểm tra")).toBeInTheDocument();
    expect(screen.queryByText("Previous verified winner")).not.toBeInTheDocument();
    expect(screen.getAllByText("Hand #2")).toHaveLength(1);
  });

  it("distinguishes a hand requiring intervention from a running verification", async () => {
    rpc.mockResolvedValue({data:{access:"public",items:[{handId:"attention",handNumber:98,createdAt:"2026-10-16T00:00:00Z",
      result:{status:"needs_attention"}}],nextCursor:null},error:null});
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    expect(await screen.findByText("Kết quả cần kiểm tra bổ sung; chưa được xác minh")).toBeInTheDocument();
    expect(screen.queryByText("Kết quả đang được kiểm tra")).not.toBeInTheDocument();
  });
  it('offers an explicit reload after the first history read fails',async()=>{
    rpc.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({data:{access:'public',items:[{
      handId:'retry957',handNumber:957,createdAt:'2026-10-27T01:00:00Z',result:{status:'pending'},
    }],nextCursor:null},error:null});
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()}/>);
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button',{name:'Tải lại lịch sử'}));
    await screen.findByText('Hand #957');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it("ends loading after a rejected read and can recover on focus", async () => {
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Không thể tải lịch sử bàn");
    expect(screen.queryByText("Đang tải lịch sử…")).not.toBeInTheDocument();
    expect(screen.queryByText("Bàn này chưa có ván đã hoàn tất.")).not.toBeInTheDocument();
    rpc.mockResolvedValue({ data: { access: "public", items: [], nextCursor: null }, error: null });
    fireEvent.focus(window);
    expect(await screen.findByText("Bàn này chưa có ván đã hoàn tất.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("bounds an unresolved read and ignores its late response after recovery", async () => {
    vi.useFakeTimers();
    let finishLate!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { finishLate = resolve; }));
    rpc.mockResolvedValue({ data: { access: "public", items: [], nextCursor: null }, error: null });
    const view = render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(signals[0]?.aborted).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent("Không thể tải lịch sử bàn");
      expect(screen.queryByText("Đang tải lịch sử…")).not.toBeInTheDocument();
      expect(rpc).toHaveBeenCalledTimes(1);
      await act(async () => { fireEvent.focus(window); });
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Bàn này chưa có ván đã hoàn tất.")).toBeInTheDocument();
      await act(async () => finishLate({ data: { access: "public", items: [
        { handId: "late", handNumber: 99, createdAt: "2026-09-27T01:00:00Z", result: { status: "pending" } },
      ], nextCursor: null }, error: null }));
      expect(screen.queryByText("Hand #99")).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("clears the read deadline and polling timer on unmount", () => {
    vi.useFakeTimers();
    rpc.mockImplementationOnce(() => new Promise(() => {}));
    const view = render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    try {
      expect(vi.getTimerCount()).toBe(2);
      view.unmount();
      expect(signals[0]?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("coalesces focus refreshes during an in-flight read and then fetches fresh state once", async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    rpc.mockResolvedValue({ data: { access: "public", items: [], nextCursor: null }, error: null });
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    fireEvent.focus(window);
    fireEvent.focus(window);
    const callsWhilePending = rpc.mock.calls.length;
    await act(async () => finish({ data: { access: "public", items: [], nextCursor: null }, error: null }));
    expect(callsWhilePending).toBe(1);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Đang tải lịch sử…")).not.toBeInTheDocument();
  });

  it("does not let a rejected old-table request clear the new table's in-flight fence", async () => {
    let rejectOld!: (error: Error) => void;
    let finishNew!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    rpc.mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    const empty = { data: { access: "public", items: [], nextCursor: null }, error: null };
    rpc.mockResolvedValue(empty);
    const props = { tournamentId: "tour", currentSessionId: "session", onSelectHand: vi.fn(), onAccessRevoked: vi.fn() };
    const view = render(<TableHistoryPanel {...props} tableId="old" />);
    view.rerender(<TableHistoryPanel {...props} tableId="new" />);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => rejectOld(new TypeError("old transport failed")));
    expect(signals[1]?.aborted).toBe(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.focus(window);
    expect(rpc).toHaveBeenCalledTimes(2);
    await act(async () => finishNew(empty));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    expect(rpc).toHaveBeenLastCalledWith("get_public_tournament_table_history_v2", expect.objectContaining({ p_tournament_table_id: "new" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("discards a queued refresh when public access is revoked", async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const revoked = vi.fn();
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={revoked} />);
    fireEvent.focus(window);
    await act(async () => finish({ data: { access: "revoked" }, error: null }));
    expect(await screen.findByRole("alert")).toHaveTextContent("không còn được công khai");
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("retains same-table history after a refresh rejects instead of presenting an empty table", async () => {
    rpc.mockResolvedValueOnce({ data: { access: "public", items: [
      { handId: "retained", handNumber: 12, createdAt: "2026-09-27T01:00:00Z", result: { status: "pending" } },
    ], nextCursor: null }, error: null });
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    await screen.findByText("Hand #12");
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.focus(window);
    expect(await screen.findByRole("status")).toHaveTextContent("Dữ liệu đang hiển thị vẫn được giữ nguyên");
    expect(screen.getByText("Hand #12")).toBeInTheDocument();
    expect(screen.queryByText("Bàn này chưa có ván đã hoàn tất.")).not.toBeInTheDocument();
    expect(screen.queryByText("Đang tải lịch sử…")).not.toBeInTheDocument();
  });

  it('rejects an append cursor that returns to the same hand and can retry without losing loaded history',async()=>{
    const row={handId:'retained',handNumber:12,createdAt:'2026-09-27T01:00:00Z',result:{status:'pending'}};
    const repeated={data:{access:'public',items:[row],nextCursor:{createdAt:row.createdAt,id:row.handId}},error:null};
    rpc.mockResolvedValue(repeated);
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()}/>);
    await screen.findByText('Hand #12');
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm'}));
    expect(await screen.findByRole('status')).toHaveTextContent('Dữ liệu lịch sử không hợp lệ');
    expect(screen.getAllByText('Hand #12')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    rpc.mockResolvedValueOnce({data:{access:'public',items:[{...row,handId:'older',handNumber:11,createdAt:'2026-09-27T00:00:00Z'}],nextCursor:null},error:null});
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm'}));
    expect(await screen.findByText('Hand #11')).toBeInTheDocument();
    expect(screen.getByText('Hand #12')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it("keeps loaded hands and pagination when a refresh has a malformed cursor", async () => {
    rpc.mockResolvedValueOnce({ data: { access: "public", items: [
      { handId: "retained", handNumber: 12, createdAt: "2026-09-27T01:00:00Z", result: { status: "pending" } },
    ], nextCursor: { createdAt: "2026-09-27T01:00:00Z", id: "retained" } }, error: null });
    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    await screen.findByText("Hand #12");
    rpc.mockResolvedValueOnce({ data: { access: "public", items: [], nextCursor: 0 }, error: null });
    fireEvent.focus(window);
    expect(await screen.findByRole("status")).toHaveTextContent("Dữ liệu lịch sử không hợp lệ");
    expect(screen.getByText("Hand #12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải thêm" })).toBeEnabled();
    expect(screen.queryByText("Bàn này chưa có ván đã hoàn tất.")).not.toBeInTheDocument();
  });

  it("formats Hand #9 from its frozen 100k/200k/25k blind snapshot", async () => {
    rpc.mockResolvedValue({ data: { access: "public", items: [
      { handId: "hand-9", tableSessionId: "session-9", handNumber: 9, createdAt: "2026-09-27T01:00:00Z", board: ["2c", "7d", "9h", "3s", "Kc"], pot: 4_800_000, smallBlind: 100_000, bigBlind: 200_000, ante: 25_000, result: { status: "verified", recipients: [
        { playerId: "winner", entryNumber: 1, seatNumber: 1, name: "Winner", avatarUrl: null, holeCards: [], potAward: 4_800_000, netDelta: 2_400_000, potKinds: ["main"] },
      ] } },
    ], nextCursor: null }, error: null });
    render(<TableHistoryPanel tournamentId="tour-9" tableId="table-9" currentSessionId="session-9" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    const card = (await screen.findByText("Hand #9")).closest("article")!;
    expect(within(card).getByText("Pot 4.8M (24 BB)")).toBeInTheDocument();
    expect(within(card).getByText("100k/200k · Ante 25k")).toBeInTheDocument();
    expect(within(card).getByText("+2.4M (12 BB)")).toHaveClass("text-emerald-400");
  });

  it("renders verified recipients once with signed net, and keeps unverified hands visible", async () => {
    rpc.mockResolvedValue({ data: { access: "public", items: [
      { handId: "split", tableSessionId: "old-session", handNumber: 26, createdAt: "2026-09-17T01:00:00Z", board: ["AS"], pot: 280_000, smallBlind: 10_000, bigBlind: 20_000, ante: 0, result: { status: "verified", recipients: [
        { playerId: "a", entryNumber: 1, seatNumber: 2, name: "A", avatarUrl: null, holeCards: [], potAward: 240_000, netDelta: 160_000, potKinds: ["main"] },
        { playerId: "b", entryNumber: 1, seatNumber: 3, name: "B", avatarUrl: null, holeCards: [], potAward: 40_000, netDelta: -60_000, potKinds: ["side"] },
      ] } },
      { handId: "pending", tableSessionId: "current-session", handNumber: 25, createdAt: "2026-09-17T00:00:00Z", pot: null, bigBlind: null, result: { status: "pending" } },
    ], nextCursor: null }, error: null });
    const select = vi.fn();
    render(<TableHistoryPanel tournamentId="tour-a" tableId="table-a" currentSessionId="current-session" onSelectHand={select} onAccessRevoked={vi.fn()} />);
    const split = await screen.findByText("Hand #26");
    const card = split.closest("article")!;
    expect(within(card).getByText("Pot 280k (14 BB)")).toBeInTheDocument();
    expect(within(card).getByText("10k/20k · Ante 0")).toBeInTheDocument();
    expect(within(card).getByText("+160k (8 BB)")).toHaveClass("text-emerald-400");
    expect(within(card).getByText("−60k (3 BB)")).toHaveClass("text-rose-400");
    expect(within(card).getByText("Nhận pot phụ")).toBeInTheDocument();
    const pending = screen.getByText("Hand #25").closest("article")!;
    expect(within(pending).getByText("Pot —")).toBeInTheDocument();
    expect(within(pending).getByText("Kết quả đang được kiểm tra")).toBeInTheDocument();
    within(card).getByRole("button", { name: "Xem lại hand" }).click();
    expect(select).toHaveBeenCalledWith({ handId: "split", tableId: "table-a", handNumber: 26 });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_public_tournament_table_history_v2", expect.objectContaining({ p_tournament_id: "tour-a", p_tournament_table_id: "table-a" })));
  });

  it("keeps all loaded pages when focus refreshes history", async () => {
    const page = (handId: string, handNumber: number, nextCursor: { createdAt: string; id: string } | null) => ({
      data: { access: "public", items: [{ handId, tableSessionId: "session", handNumber, createdAt: `2026-09-27T0${handNumber}:00:00Z`, board: [], pot: 100, smallBlind: 50, bigBlind: 100, ante: 0, result: { status: "pending" } }], nextCursor },
      error: null,
    });
    rpc
      .mockResolvedValueOnce(page("hand-2", 2, { createdAt: "2026-09-27T02:00:00Z", id: "hand-2" }))
      .mockResolvedValueOnce(page("hand-1", 1, null))
      .mockResolvedValueOnce(page("hand-2", 2, { createdAt: "2026-09-27T02:00:00Z", id: "hand-2" }))
      .mockResolvedValueOnce(page("hand-1", 1, null));

    render(<TableHistoryPanel tournamentId="tour" tableId="table" currentSessionId="session" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    await screen.findByText("Hand #2");
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    await screen.findByText("Hand #1");

    fireEvent.focus(window);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(4));
    expect(screen.getByText("Hand #2")).toBeInTheDocument();
    expect(screen.getByText("Hand #1")).toBeInTheDocument();
    expect(rpc).toHaveBeenNthCalledWith(4, "get_public_tournament_table_history_v2", expect.objectContaining({
      p_before_created_at: "2026-09-27T02:00:00Z",
      p_before_id: "hand-2",
    }));
  });
});
