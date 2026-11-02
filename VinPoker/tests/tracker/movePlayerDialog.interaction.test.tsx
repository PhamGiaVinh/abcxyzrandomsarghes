import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MovePlayerDialog } from "@/components/cashier/tournament-live/MovePlayerDialog";

const fixture = vi.hoisted(() => ({ actor: "owner-a", move: vi.fn(), legacyMove: vi.fn(), deferred: true, pending: vi.fn(), roster: vi.fn(), client: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: fixture.client }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => fixture.client }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => ({
  getTournamentTableRoster: fixture.roster, getPendingTrackerMoves: fixture.pending, movePlayerSeatExact: fixture.legacyMove,
  movePlayerSeatOrQueueExact: fixture.move, deferredTrackerMoveEnabled: fixture.deferred,
}) }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));

const sourceTable = () => ({ tournamentId: "tour-1", tournamentTableId: "table-1", gameTableId: "physical-1",
  tableSessionId: "session-1", sessionRevision: 7, controlEpoch: 4, tableName: "Canonical B1", tableNumber: 1,
  maxSeats: 9, seatLocks: [], seats: [{ entryId: "entry-1", seatNumber: 1, playerId: "player-1", displayName: "TEST Player",
    chipCount: 20000, integrityStatus: "valid", isActive: true }] });
const destinationTable = () => ({ ...sourceTable(), tournamentTableId: "table-2", gameTableId: "physical-2",
  tableSessionId: "session-2", sessionRevision: 8, controlEpoch: 5, tableName: "Canonical B2", tableNumber: 2, seats: [] });
const dialogProps = () => ({ actorId: fixture.actor, open: true, onOpenChange: vi.fn(), tournamentId: "tour-1", entryId: "entry-1",
  playerName: "TEST Player", currentTournamentTableId: "table-1", currentSeatNumber: 1, onMoved: vi.fn() });
const moveAck = (requestId: string) => ({ ok: true, entry_id: "entry-1", from_tournament_table_id: "table-1",
  from_table_session_id: "session-1", from_seat_number: 1, to_tournament_table_id: "table-2", to_table_session_id: "session-2",
  to_seat_number: 1, to_table_number: 2, from_table_number: 1, receipt_code: "SERVER-TICKET", current_stack: 20000,
  player_name: "TEST Player", reason: "Cân bàn", request_id: requestId });

describe("move dialog exact-session read model", () => {
  it.each([null,{name:{bad:true},start_time:null},{name:' ',start_time:null},{name:'TEST',start_time:'invalid-date'}])('blocks an unverified tournament metadata response: %j',async(data)=>{
    fixture.client.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,abortSignal:()=>q,single:()=>Promise.resolve({data,error:null})};return q;});
    const view=render(<MovePlayerDialog {...dialogProps()}/>);
    try{
      await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/Không xác minh được/));
      expect(screen.getByRole('button',{name:'Tiếp tục'})).toBeDisabled();
      expect(fixture.move).not.toHaveBeenCalled();expect(fixture.legacyMove).not.toHaveBeenCalled();
    }finally{view.unmount();}
  });
  it.each(['roster','reservations','metadata'])('bounds a hanging %s read and permits explicit recovery',async(part)=>{
    vi.useFakeTimers();
    let resolveLate!:(value:unknown)=>void;
    const pending=new Promise(resolve=>{resolveLate=resolve;});
    const defaultFrom=fixture.client.from.getMockImplementation();
    if(part==='roster')fixture.roster.mockReturnValueOnce(pending);
    else if(part==='reservations')fixture.pending.mockReturnValueOnce(pending);
    else fixture.client.from.mockImplementationOnce(()=>{const q={select:()=>q,eq:()=>q,abortSignal:()=>q,single:()=>pending};return q;});
    const view=render(<MovePlayerDialog {...dialogProps()}/>);
    try{
      await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
      expect(screen.getByRole('alert')).toHaveTextContent(/Không xác minh được phiên bàn/);
      expect(fixture.move).not.toHaveBeenCalled();expect(fixture.legacyMove).not.toHaveBeenCalled();
      await act(async()=>{resolveLate(part==='roster'?{ok:true,data:[{...sourceTable(),tableName:'Late obsolete table'},destinationTable()]}:part==='reservations'?{ok:true,data:[]}:{data:{name:'Late metadata',start_time:null},error:null});});
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByText('Late obsolete table')).not.toBeInTheDocument();
      if(defaultFrom)fixture.client.from.mockImplementation(defaultFrom);
      fireEvent.click(screen.getByRole('button',{name:'Tải lại phiên bàn'}));
      await act(async()=>{});
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button',{name:'Tiếp tục'})).not.toBeDisabled();
      expect(fixture.roster).toHaveBeenCalledTimes(2);
      expect(fixture.move).not.toHaveBeenCalled();
    }finally{view.unmount();vi.useRealTimers();}
  });
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    fixture.actor = "owner-a";
    fixture.deferred = true;
    fixture.pending.mockResolvedValue({ ok: true, data: [] });
    fixture.roster.mockResolvedValue({ ok: true, data: [sourceTable(), destinationTable()] });
    fixture.client.rpc.mockResolvedValue({ data: null, error: null });
    fixture.client.from.mockImplementation(() => {
      const query = { select: () => query, eq: () => query, abortSignal: () => query,
        single: () => Promise.resolve({ data: { name: "TEST", start_time: null }, error: null }) };
      return query;
    });
  });
  it("replays a legacy journal through v4, never reinterpreting it as deferred v5", async () => {
    fixture.move.mockResolvedValueOnce({ ok: false, error: "Failed to fetch" });
    const props = dialogProps();
    const first = render(<MovePlayerDialog {...props} />);
    await screen.findByText(/Canonical B1/);
    fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
    await screen.findByRole("alert");
    const intent = fixture.move.mock.calls[0][0];
    first.unmount();
    const key = `vp:floor-move-intent:v1:${encodeURIComponent("owner-a:tour-1:entry-1")}`;
    const stored = JSON.parse(sessionStorage.getItem(key)!);
    delete stored.operation;
    sessionStorage.setItem(key, JSON.stringify(stored));
    fixture.legacyMove.mockResolvedValue({ ok: true, data: moveAck(intent.requestId) });
    const recovered = render(<MovePlayerDialog {...props} />);
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Xác nhận chuyển" }));
      expect(await screen.findByText("SERVER-TICKET")).toBeInTheDocument();
      expect(fixture.legacyMove).toHaveBeenCalledWith(intent);
      expect(fixture.move).toHaveBeenCalledTimes(1);
    } finally { recovered.unmount(); }
  });
  it("keeps the v4 immediate path when deferred production is OFF", async () => {
    fixture.deferred = false;
    fixture.legacyMove.mockImplementation(async (intent) => ({ ok: true, data: moveAck(intent.requestId) }));
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      expect(await screen.findByText("SERVER-TICKET")).toBeInTheDocument();
      expect(fixture.legacyMove).toHaveBeenCalledTimes(1);
      expect(fixture.move).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("acknowledges an exact queued intent without inventing a completed move ticket", async () => {
    fixture.move.mockImplementation(async (intent) => ({ ok: true, data: {
      ok: true, queued: true, pending_move_id: "pending-1", entry_id: intent.entryId,
      request_id: intent.requestId, reason: intent.reason,
      from_tournament_table_id: intent.fromTournamentTableId, from_table_session_id: intent.fromTableSessionId,
      to_tournament_table_id: intent.toTournamentTableId, to_table_session_id: intent.toTableSessionId,
      from_seat_number: 1, to_seat_number: intent.toSeatNumber,
    } }));
    const props = dialogProps();
    const view = render(<MovePlayerDialog {...props} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      expect(await screen.findByText(/Đã đặt chờ chuyển/)).toBeInTheDocument();
      expect(screen.queryByText("SERVER-TICKET")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Xem phiếu mới" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(props.onMoved).toHaveBeenCalledTimes(1);
      expect(fixture.move).toHaveBeenCalledTimes(1);
      expect(sessionStorage.length).toBe(0);
    } finally { view.unmount(); }
  });
  it.each([
    { to_table_session_id: "old-session" },
    { request_id: "other-request" },
    { receipt_code: "UNISSUED-TICKET" },
    { pending_move_id: "" },
  ])("rejects mismatched or printable queued acknowledgements: %j", async (invalid) => {
    fixture.move.mockImplementation(async (intent) => ({ ok: true, data: {
      ok: true, queued: true, pending_move_id: "pending-1", entry_id: intent.entryId,
      request_id: intent.requestId, reason: intent.reason,
      from_tournament_table_id: intent.fromTournamentTableId, from_table_session_id: intent.fromTableSessionId,
      to_tournament_table_id: intent.toTournamentTableId, to_table_session_id: intent.toTableSessionId,
      from_seat_number: 1, to_seat_number: intent.toSeatNumber, ...invalid,
    } }));
    const props = dialogProps();
    const view = render(<MovePlayerDialog {...props} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác minh");
      expect(props.onMoved).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Xem phiếu mới" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sửa lại" })).toBeDisabled();
      expect(sessionStorage.length).toBe(1);
    } finally { view.unmount(); }
  });
  it("writes a reasoned exact-session intent and shows only the returned server ticket", async () => {
    fixture.move.mockImplementation(async (args: { requestId: string }) => ({ ok: true, data: moveAck(args.requestId) }));
    const props = dialogProps();
    const view = render(<MovePlayerDialog {...props} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      await waitFor(() => expect(fixture.move).toHaveBeenCalledTimes(1));
      expect(fixture.move).toHaveBeenCalledWith({ entryId: "entry-1", fromTournamentTableId: "table-1",
        fromTableSessionId: "session-1", toTournamentTableId: "table-2", toTableSessionId: "session-2", toSeatNumber: 1,
        expectedSourceRevision: 7, expectedDestinationRevision: 8, expectedSourceEpoch: 4, expectedDestinationEpoch: 5,
        reason: "Cân bàn", requestId: expect.any(String) });
      expect(await screen.findByText("SERVER-TICKET")).toBeInTheDocument();
      expect(props.onMoved).toHaveBeenCalledTimes(1);
      expect(fixture.client.rpc).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("keeps one frozen key after an unknown response and never double submits", async () => {
    let resolve!: (value: unknown) => void;
    fixture.move.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      const confirm = screen.getByRole("button", { name: "Xác nhận chuyển" });
      act(() => { confirm.click(); confirm.click(); });
      await waitFor(() => expect(fixture.move).toHaveBeenCalledTimes(1));
      const first = fixture.move.mock.calls[0][0];
      await act(async () => { resolve({ ok: false, error: "Failed to fetch" }); });
      expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác minh");
      fixture.move.mockResolvedValueOnce({ ok: true, data: moveAck(first.requestId) });
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      await waitFor(() => expect(fixture.move).toHaveBeenCalledTimes(2));
      expect(fixture.move.mock.calls[1][0]).toEqual(first);
      expect(await screen.findByText("SERVER-TICKET")).toBeInTheDocument();
    } finally { view.unmount(); }
  });
  it("recovers an unknown exact intent after remount without inventing a new request", async () => {
    fixture.move.mockResolvedValueOnce({ ok: false, error: "Failed to fetch" });
    const props = dialogProps();
    const firstView = render(<MovePlayerDialog {...props} />);
    await screen.findByText(/Canonical B1/);
    fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác minh");
    const frozen = fixture.move.mock.calls[0][0];
    firstView.unmount();
    fixture.move.mockResolvedValueOnce({ ok: true, data: moveAck(frozen.requestId) });
    const recoveredView = render(<MovePlayerDialog {...props} />);
    try {
      const confirm = await screen.findByRole("button", { name: "Xác nhận chuyển" });
      expect(screen.getByRole("alert")).toHaveTextContent("Chưa xác minh");
      expect(fixture.move).toHaveBeenCalledTimes(1);
      fireEvent.click(confirm);
      await waitFor(() => expect(fixture.move).toHaveBeenCalledTimes(2));
      expect(fixture.move.mock.calls[1][0]).toEqual(frozen);
      expect(await screen.findByText("SERVER-TICKET")).toBeInTheDocument();
    } finally { recoveredView.unmount(); }
  });
  it("recovers a lost queued response through v5 after remount even when the flag changes", async () => {
    fixture.move.mockResolvedValueOnce({ ok: false, error: "Failed to fetch" });
    const props = dialogProps();
    const first = render(<MovePlayerDialog {...props} />);
    await screen.findByText(/Canonical B1/);
    fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác minh");
    const frozen = fixture.move.mock.calls[0][0];
    first.unmount();
    fixture.deferred = false;
    fixture.move.mockResolvedValueOnce({ ok: true, data: {
      ok: true, queued: true, pending_move_id: "pending-1", entry_id: frozen.entryId,
      request_id: frozen.requestId, reason: frozen.reason,
      from_tournament_table_id: frozen.fromTournamentTableId, from_table_session_id: frozen.fromTableSessionId,
      to_tournament_table_id: frozen.toTournamentTableId, to_table_session_id: frozen.toTableSessionId,
      from_seat_number: 1, to_seat_number: frozen.toSeatNumber,
    } });
    const recovered = render(<MovePlayerDialog {...props} />);
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Xác nhận chuyển" }));
      expect(await screen.findByText(/Đã đặt chờ chuyển/)).toBeInTheDocument();
      expect(fixture.move).toHaveBeenCalledTimes(2);
      expect(fixture.move.mock.calls[1][0]).toEqual(frozen);
      expect(fixture.legacyMove).not.toHaveBeenCalled();
      expect(props.onMoved).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Xem phiếu mới" })).not.toBeInTheDocument();
      expect(sessionStorage.length).toBe(0);
    } finally { recovered.unmount(); }
  });
  it("shows the frozen destination on recovery even when fresh roster is unavailable", async () => {
    fixture.move.mockResolvedValueOnce({ ok: false, error: "Failed to fetch" });
    const props = dialogProps();
    const old = render(<MovePlayerDialog {...props} />);
    await screen.findByText(/Canonical B1/);
    fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
    await screen.findByRole("alert");
    old.unmount();
    fixture.roster.mockResolvedValueOnce({ ok: false, error: "503" });
    const recovered = render(<MovePlayerDialog {...props} />);
    try {
      await screen.findByText(/Ghế 1 → Bàn 2 · Ghế 1/);
      await waitFor(() => expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("503"))).toBe(true));
      expect(fixture.move).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Sửa lại" })).toBeDisabled();
    } finally { recovered.unmount(); }
  });
  it("never sends a mutation if browser storage cannot retain the request", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("storage unavailable");
      expect(fixture.move).not.toHaveBeenCalled();
    } finally { write.mockRestore(); view.unmount(); }
  });
  it("blocks a malformed recovery journal rather than silently creating another key", async () => {
    sessionStorage.setItem(`vp:floor-move-intent:v1:${encodeURIComponent("owner-a:tour-1:entry-1")}`, "{invalid");
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
      expect(fixture.move).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("does not expose another actor's unresolved intent after remount", async () => {
    fixture.move.mockResolvedValueOnce({ ok: false, error: "Failed to fetch" });
    const props = dialogProps();
    const old = render(<MovePlayerDialog {...props} />);
    await screen.findByText(/Canonical B1/);
    fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
    await screen.findByRole("alert");
    old.unmount();
    fixture.actor = "owner-b";
    const fresh = render(<MovePlayerDialog {...props} actorId={fixture.actor} />);
    try {
      await screen.findByText(/Canonical B1/);
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Xác nhận chuyển" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fixture.move).toHaveBeenCalledTimes(1);
    } finally { fresh.unmount(); }
  });
  it("does not turn a failed roster read into an empty table list or allow a write", async () => {
    fixture.roster.mockResolvedValue({ ok: false, error: "network_error" });
    const view = render(<MovePlayerDialog actorId={fixture.actor} open onOpenChange={vi.fn()} tournamentId="tour-1" entryId="entry-1"
      playerName="TEST Player" currentTournamentTableId="table-1" currentSeatNumber={1} onMoved={vi.fn()} />);
    try {
      expect(await screen.findByRole("alert")).toHaveTextContent("Không xác minh được phiên bàn");
      expect(screen.queryByText("Không có bàn active để chuyển tới.")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
      expect(fixture.client.rpc).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("does not grant source authority from legacy highlighting when the entry is absent", async () => {
    fixture.roster.mockResolvedValue({ ok: true, data: [destinationTable()] });
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      expect(await screen.findByRole("alert")).toHaveTextContent("ghế nguồn");
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
      expect(fixture.move).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("refuses an ambiguous duplicated entry even when both seats are on one table", async () => {
    fixture.roster.mockResolvedValue({ ok: true, data: [{ ...sourceTable(),
      seats: [...sourceTable().seats, { ...sourceTable().seats[0], seatNumber: 2 }] }, destinationTable()] });
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      expect(await screen.findByRole("alert")).toHaveTextContent("ghế nguồn");
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
      expect(fixture.move).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("refreshes fences after a definitive denial and requires a new explicit confirmation", async () => {
    fixture.roster.mockResolvedValueOnce({ ok: true, data: [sourceTable(), destinationTable()] })
      .mockResolvedValueOnce({ ok: true, data: [{ ...sourceTable(), sessionRevision: 9 }, { ...destinationTable(), sessionRevision: 10 }] });
    fixture.move.mockResolvedValueOnce({ ok: false, error: "STALE_STATE" })
      .mockImplementationOnce(async (args: { requestId: string }) => ({ ok: true, data: moveAck(args.requestId) }));
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      await waitFor(() => expect(fixture.roster).toHaveBeenCalledTimes(2));
      await screen.findByText(/Canonical B1/);
      expect(fixture.move).toHaveBeenCalledTimes(1);
      const first = fixture.move.mock.calls[0][0];
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      await waitFor(() => expect(fixture.move).toHaveBeenCalledTimes(2));
      expect(fixture.move.mock.calls[1][0]).toMatchObject({ expectedSourceRevision: 9, expectedDestinationRevision: 10 });
      expect(fixture.move.mock.calls[1][0].requestId).not.toEqual(first.requestId);
      expect(await screen.findByText("SERVER-TICKET")).toBeInTheDocument();
    } finally { view.unmount(); }
  });
  it("excludes every pending destination reservation instead of presenting it as free", async () => {
    fixture.pending.mockResolvedValue({ ok: true, data: Array.from({ length: 9 }, (_, index) => ({
      entryId: `other-entry-${index}`, destinationTournamentTableId: "table-2", destinationSeatNumber: index + 1, status: "pending",
    })) });
    const view = render(<MovePlayerDialog {...dialogProps()} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
      expect(fixture.move).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("does not announce a success or print a receipt from another session", async () => {
    fixture.move.mockImplementation(async (args: { requestId: string }) => ({ ok: true,
      data: { ...moveAck(args.requestId), to_table_session_id: "prior-session" } }));
    const props = dialogProps();
    const view = render(<MovePlayerDialog {...props} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác minh");
      expect(props.onMoved).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Xem phiếu mới" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sửa lại" })).toBeDisabled();
    } finally { view.unmount(); }
  });
  it("ignores an old actor's completion without unlocking the new actor's in-flight move", async () => {
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    fixture.move.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    const props = dialogProps();
    const view = render(<MovePlayerDialog {...props} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      await waitFor(() => expect(fixture.move).toHaveBeenCalledTimes(1));
      const old = fixture.move.mock.calls[0][0];
      fixture.actor = "owner-b";
      view.rerender(<MovePlayerDialog {...props} actorId={fixture.actor} />);
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển" }));
      await waitFor(() => expect(fixture.move).toHaveBeenCalledTimes(2));
      const fresh = fixture.move.mock.calls[1][0];
      expect(fresh.requestId).not.toEqual(old.requestId);
      await act(async () => { finishOld({ ok: true, data: moveAck(old.requestId) }); });
      expect(props.onMoved).not.toHaveBeenCalled();
      expect(screen.queryByText("SERVER-TICKET")).not.toBeInTheDocument();
      expect(screen.getByText("Đang chuyển ghế…")).toBeInTheDocument();
      await act(async () => { finishNew({ ok: true, data: moveAck(fresh.requestId) }); });
      expect(props.onMoved).toHaveBeenCalledTimes(1);
    } finally { view.unmount(); }
  });
  it("never makes a locked seat selectable via stale own-seat highlighting", async () => {
    fixture.roster.mockResolvedValue({ ok: true, data: [{ tournamentId: "tour-1", tournamentTableId: "table-1",
      gameTableId: "physical-1", tableSessionId: "session-1", sessionRevision: 4, controlEpoch: 2,
      tableName: "Canonical B1", tableNumber: 1, maxSeats: 9, seats: sourceTable().seats,
      seatLocks: Array.from({ length: 9 }, (_, index) => ({ seatNumber: index + 1, reason: "TEST" })) }] });
    const view = render(<MovePlayerDialog actorId={fixture.actor} open onOpenChange={vi.fn()} tournamentId="tour-1" entryId="entry-1"
      playerName="TEST Player" currentTournamentTableId="table-1" currentSeatNumber={1} onMoved={vi.fn()} />);
    try {
      await screen.findAllByText(/Canonical B1/);
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
      expect(fixture.client.rpc).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("shows an eligible canonical table even when legacy table_id is NULL", async () => {
    fixture.client.from.mockImplementation((name: string) => {
      const result = name === "tournament_tables"
        ? { data: [{ id: "table-2", table_name: "Canonical B2", table_number: 2, max_seats: 9,
          status: "active", table_id: null, game_table_id: "physical-2", table_session_id: "session-2" }], error: null }
        : name === "tournament_seats" ? { data: [], error: null }
          : { data: { name: "TEST", start_time: null }, error: null };
      const query = { select: () => query, eq: () => query, abortSignal: () => query, single: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      return query;
    });
    fixture.roster.mockResolvedValue({ ok: true, data: [sourceTable(), { tournamentId: "tour-1", tournamentTableId: "table-2",
      gameTableId: "physical-2", tableSessionId: "session-2", sessionRevision: 4, controlEpoch: 2,
      tableName: "Canonical B2", tableNumber: 2, maxSeats: 9, seats: [], seatLocks: [], pendingMoves: [] }] });
    const view = render(<MovePlayerDialog actorId={fixture.actor} open onOpenChange={vi.fn()} tournamentId="tour-1" entryId="entry-1"
      playerName="TEST Player" currentTournamentTableId="table-1" currentSeatNumber={1} onMoved={vi.fn()} />);
    try {
      await screen.findByText(/Canonical B1/);
      fireEvent.click(screen.getByRole("button", { name: "Bàn kế" }));
      expect(await screen.findByText(/Canonical B2/)).toBeInTheDocument();
      expect(screen.queryByText("Không có bàn active để chuyển tới.")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tiếp tục" })).not.toBeDisabled();
    } finally { view.unmount(); }
  });
});
