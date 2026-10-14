import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  committed: false,
  readError: false,
  readId: "hand1",
  metadataSession: "session1" as string | null,
  readback: null as Promise<unknown> | null,
  resume: false,
  seatStack: 30000,
  resumeRead: null as Promise<unknown> | null,
  readFilters: [] as Array<[string, unknown]>,
  invoke: vi.fn(),
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mock.errorToast, success: mock.successToast, warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: new Proxy({}, { get: () => false }) }));
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: mock.resume ? { id: "actor1" } : null } }) },
  functions: { invoke: mock.invoke },
  rpc: async (name: string) => ({ data: name === "get_tournament_tables" ? [{ table_id: "table1", table_name: "Test" }] : name === "heartbeat_lock" ? { status: "success", locked_by: "actor1" } : null, error: null }),
  from: (table: string) => {
    let cols = "";
    const result = () => ({ data: table === "tournaments" ? { id: "tour1" }
      : table === "tournament_tables" ? (cols.includes("max_seats") ? { max_seats: 9, table_session_id: mock.metadataSession } : [])
      : table === "tournament_seats" ? [{ player_id: "p1", entry_number: 1, seat_number: 1, chip_count: mock.seatStack, player_name: "TEST" }]
      : table === "hand_actions" ? []
      : table === "tournament_hands" && cols === "id, hand_number" ? { id: "hand1", hand_number: 1 }
      : table === "tournament_hands" && cols.includes("is_voided") ? { id: mock.readId, is_voided: mock.committed }
      : table === "tournament_hands" && mock.resume && cols.includes("community_cards") ? { id: "hand1", hand_number: 1, table_id: "table1", button_seat: 1, community_cards: [] }
      : table === "tournament_hands" && mock.resume && cols.includes("tracker_level_number") ? { tracker_level_number: null, tracker_small_blind: null, tracker_big_blind: null, tracker_bba: null }
      : null, error: cols.includes("is_voided") && mock.readError ? new Error("read unavailable") : null });
    const chain = () => query;
    const query = { select: (value: string) => { cols = value; return query; },
      filter: chain, in: chain, order: chain, limit: chain, maybeSingle: chain, single: chain,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown> => (cols === "id, is_voided" && mock.readback ? mock.readback
        : cols.includes("community_cards") && mock.resumeRead ? mock.resumeRead : Promise.resolve(result())).then(resolve, reject),
      eq: (key: string, value: unknown) => {
      if (table === "tournament_hands" && cols === "id, is_voided") mock.readFilters.push([key, value]);
      return query;
    } };
    return query;
  },
} }));
import { useStandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); mock.committed = false; mock.readError = false; mock.readId = "hand1"; mock.readFilters = []; mock.metadataSession = "session1"; mock.readback = null; mock.resume = false; mock.seatStack = 30000; mock.resumeRead = null; });
describe("void unknown response through the real controller", () => {
  it.each([
    ["tournament", "cards", "success"], ["unmount", "cards", "success"],
    ["tournament", "runout", "success"], ["unmount", "runout", "success"],
    ["tournament", "cards", "error"], ["unmount", "cards", "error"],
  ])("discards delayed manual response after %s changes through %s (%s)", async (change, handler, outcome) => {
    mock.resume = true;
    let respond!: (value: unknown) => void;
    const { result, rerender, unmount } = renderHook(({ tour }) => useStandaloneHandInput(tour),
      { initialProps: { tour: "tour1" } });
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.handId).toBe("hand1"));
    await act(async () => { result.current.setPlayerHoleCards({ p1: ["Qh", "Qs"] }); });
    mock.invoke.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = handler === "runout"
      ? result.current.handleRevealRunout() : result.current.handleShowHoleCards(); });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    if (change === "tournament") rerender({ tour: "tour2" });
    else unmount();
    mock.successToast.mockClear();
    mock.errorToast.mockClear();
    await act(async () => {
      respond(outcome === "success"
        ? { data: { status: "success", data: { status: "success", entry_count: 1 } }, error: null }
        : { data: null, error: new Error("late network failure") });
      await pending;
    });
    expect(mock.successToast).not.toHaveBeenCalled();
    expect(mock.errorToast).not.toHaveBeenCalled();
  });
  it("reports revealed manual cards only for the full canonical batch", async () => {
    mock.resume = true;
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.handId).toBe("hand1"));
    await act(async () => { result.current.setPlayerHoleCards({ p1: ["Qh", "Qs"] }); });
    mock.successToast.mockClear();
    mock.errorToast.mockClear();
    mock.invoke.mockResolvedValue({ data: { status: "success", data: { status: "success", entry_count: 1 } }, error: null });
    await act(async () => { await result.current.handleShowHoleCards(); });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.successToast).toHaveBeenCalledWith("Hole cards revealed");
    expect(mock.errorToast).not.toHaveBeenCalled();
  });
  it("does not send a second manual card mutation while the first is pending", async () => {
    mock.resume = true;
    const responders: Array<(value: unknown) => void> = [];
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.handId).toBe("hand1"));
    await act(async () => { result.current.setPlayerHoleCards({ p1: ["Qh", "Qs"] }); });
    mock.invoke.mockImplementation(() => new Promise((resolve) => { responders.push(resolve); }));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.handleShowHoleCards(); second = result.current.handleShowHoleCards(); });
    const invocations = mock.invoke.mock.calls.length;
    // Resolve every issued promise even on the buggy baseline, so the RED is
    // the duplicate-mutation assertion, not an unfinished test timeout.
    await act(async () => {
      for (const respond of responders) {
        respond({ data: { status: "success", data: { status: "success", entry_count: 1 } }, error: null });
      }
      await Promise.all([first, second]);
    });
    expect(invocations).toBe(1);
  });
  it("does not let an unresolved old manual reveal block a newly loaded session", async () => {
    mock.resume = true;
    const responders: Array<(value: unknown) => void> = [];
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.handId).toBe("hand1"));
    await act(async () => { result.current.setPlayerHoleCards({ p1: ["Qh", "Qs"] }); });
    mock.invoke.mockImplementation(() => new Promise((resolve) => { responders.push(resolve); }));
    let oldRequest!: Promise<void>;
    act(() => { oldRequest = result.current.handleShowHoleCards(); });
    mock.metadataSession = "sessionB";
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.handId).toBe("hand1"));
    await act(async () => { result.current.setPlayerHoleCards({ p1: ["Jh", "Js"] }); });
    let freshRequest!: Promise<void>;
    act(() => { freshRequest = result.current.handleShowHoleCards(); });
    const countBeforeOldCompletion = responders.length;
    mock.successToast.mockClear();
    await act(async () => {
      responders[0]({ data: { status: "success", data: { status: "success", entry_count: 1 } }, error: null });
      await oldRequest;
    });
    const freshBusyAfterOldFinally = result.current.submitting;
    const staleSuccessCount = mock.successToast.mock.calls.length;
    let thirdRequest!: Promise<void>;
    act(() => { thirdRequest = result.current.handleShowHoleCards(); });
    const countWhileFreshPending = responders.length;
    await act(async () => {
      for (const respond of responders.slice(1)) {
        respond({ data: { status: "success", data: { status: "success", entry_count: 1 } }, error: null });
      }
      await Promise.all([freshRequest, thirdRequest]);
    });
    expect(countBeforeOldCompletion).toBe(2);
    expect(freshBusyAfterOldFinally).toBe(true);
    expect(staleSuccessCount).toBe(0);
    expect(countWhileFreshPending).toBe(2);
    expect(result.current.submitting).toBe(false);
  });
  it.each([
    { status: "success", data: { error: "hand_not_found" } },
    { status: "success", data: { error: "lock_lost" } },
    { status: "success", data: null },
    { status: "success", data: { status: "success", entry_count: 0 } },
  ])("does not report manual cards revealed for an unconfirmed canonical result %j", async (payload) => {
    mock.resume = true;
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.handId).toBe("hand1"));
    await act(async () => { result.current.setPlayerHoleCards({ p1: ["Qh", "Qs"] }); });
    mock.successToast.mockClear();
    mock.errorToast.mockClear();
    mock.invoke.mockResolvedValue({ data: payload, error: null });
    await act(async () => { await result.current.handleShowHoleCards(); });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.successToast).not.toHaveBeenCalled();
    expect(mock.errorToast).toHaveBeenCalledTimes(1);
    expect(result.current.submitting).toBe(false);
  });
  it("does not offer or resume a legacy orphan when the current session is unknown", async () => {
    mock.metadataSession = null;
    mock.resume = true;
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    expect(result.current.orphanHand).toBeNull();
    await act(async () => { expect(await result.current.handleContinueOrphan()).toBe(false); });
    expect(result.current.handId).toBeNull();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("releases old void busy state immediately when tournament changes", async () => {
    let respond!: (value: unknown) => void;
    mock.invoke.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const { result, rerender } = renderHook(({ tour }) => useStandaloneHandInput(tour), { initialProps: { tour: "tour1" } });
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleVoidOrphan(); });
    expect(result.current.submitting).toBe(true);
    rerender({ tour: "tour2" });
    expect(result.current.submitting).toBe(false);
    await act(async () => { respond({ data: null, error: new Error("old response") }); await pending; });
  });
  it("same table reloaded into a new session discards the old confirmed response", async () => {
    let respond!: (value: unknown) => void;
    mock.metadataSession = "sessionA";
    mock.invoke.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleVoidOrphan(); });
    mock.metadataSession = "sessionB";
    await act(async () => { await result.current.handleTableChange("table1"); });
    await act(async () => { respond({ data: { status: "success", data: { status: "success" } }, error: null }); await pending; });
    expect(result.current.orphanHand?.id).toBe("hand1");
    expect(mock.successToast).not.toHaveBeenCalled();
  });
  it("old void finally cannot clear a new table's pending resume", async () => {
    let rejectRead!: (error: Error) => void;
    let finishResume!: (value: unknown) => void;
    mock.readback = new Promise((_, reject) => { rejectRead = reject; });
    mock.invoke.mockResolvedValue({ data: null, error: new Error("lost response") });
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleVoidOrphan(); });
    await waitFor(() => expect(mock.readFilters.length).toBeGreaterThan(0));
    mock.resumeRead = new Promise((resolve) => { finishResume = resolve; });
    await act(async () => { await result.current.handleTableChange("table2"); });
    await waitFor(() => expect(result.current.submitting).toBe(true));
    mock.errorToast.mockClear();
    await act(async () => { rejectRead(new Error("late read failure")); await pending; });
    expect(result.current.submitting).toBe(true);
    expect(mock.errorToast).not.toHaveBeenCalled();
    await act(async () => { finishResume({ data: null, error: new Error("fixture resume end") }); });
  });
  it.each(["confirmed", "recovered"])("normal void %s clears hand and uses the correct stack path", async (mode) => {
    mock.resume = true;
    vi.stubGlobal("confirm", () => true);
    mock.invoke.mockImplementation(async () => {
      mock.committed = true;
      mock.resume = false;
      mock.seatStack = 31000;
      return mode === "confirmed"
        ? { data: { status: "success", data: { status: "success" } }, error: null }
        : { data: null, error: new Error("lost response") };
    });
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.handId).toBe("hand1"));
    await act(async () => { await result.current.handleVoid(); });
    expect(result.current.handId).toBeNull();
    expect(result.current.submitting).toBe(false);
    expect(result.current.players[0].current_stack).toBe(mode === "confirmed" ? 30000 : 31000);
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["table", "tournament", "unmount"])("fences a rejected readback after %s changes", async (change) => {
    let rejectRead!: (error: Error) => void;
    mock.readback = new Promise((_, reject) => { rejectRead = reject; });
    mock.invoke.mockResolvedValue({ data: null, error: new Error("lost response") });
    const { result, rerender, unmount } = renderHook(({ tour }) => useStandaloneHandInput(tour), { initialProps: { tour: "tour1" } });
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleVoidOrphan(); });
    await waitFor(() => expect(mock.readFilters.length).toBeGreaterThan(0));
    if (change === "table") await act(async () => { await result.current.handleTableChange("table2"); });
    else if (change === "tournament") rerender({ tour: "tour2" });
    else unmount();
    mock.errorToast.mockClear();
    await act(async () => { rejectRead(new Error("late read failure")); await pending; });
    expect(mock.errorToast).not.toHaveBeenCalled();
    if (change === "table") expect(result.current.orphanHand?.id).toBe("hand1");
  });
  it("keeps the metadata-only known session in the recovery query", async () => {
    mock.metadataSession = "session1";
    mock.committed = true;
    mock.invoke.mockResolvedValue({ data: null, error: new Error("lost response") });
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await act(async () => { await result.current.handleVoidOrphan(); });
    expect(mock.readFilters).toContainEqual(["table_session_id", "session1"]);
  });
  it.each(["returned_error", "thrown_error"])("reconciles committed orphan void with %s without another mutation", async (mode) => {
    mock.invoke.mockImplementation(async () => {
      mock.committed = true;
      if (mode === "thrown_error") throw new Error("response lost after commit");
      return { data: null, error: new Error("response lost after commit") };
    });
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await waitFor(() => expect(result.current.orphanHand?.id).toBe("hand1"));
    await act(async () => { await result.current.handleVoidOrphan(); });
    expect(mock.committed).toBe(true);
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke.mock.calls[0][1].body.hand_id).toBe("hand1");
    expect(result.current.orphanHand).toBeNull();
    expect(mock.readFilters).toEqual([["id", "hand1"], ["tournament_id", "tour1"], ["table_id", "table1"],
      ["table_session_id", "session1"]]);
  });
  it.each(["not_committed", "read_error", "wrong_hand", "nested_denial", "unknown_success"])("does not claim success for %s", async (mode) => {
    mock.invoke.mockImplementation(async () => {
      mock.committed = ["read_error", "wrong_hand"].includes(mode);
      mock.readError = mode === "read_error";
      mock.readId = mode === "wrong_hand" ? "other-hand" : "hand1";
      if (mode === "nested_denial") return { data: { status: "success", data: { error: "actor_not_allowed" } }, error: null };
      if (mode === "unknown_success") return { data: null, error: null };
      return { data: null, error: new Error("response lost") };
    });
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    await act(async () => { await result.current.handleVoidOrphan(); });
    expect(result.current.orphanHand?.id).toBe("hand1");
    expect(mock.successToast).not.toHaveBeenCalled();
    expect(mock.errorToast).toHaveBeenCalled();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("discards a late response after tournament changes", async () => {
    let respond!: (value: unknown) => void;
    mock.invoke.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const { result, rerender } = renderHook(({ tour }) => useStandaloneHandInput(tour), { initialProps: { tour: "tour1" } });
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleVoidOrphan(); });
    rerender({ tour: "tour2" });
    await act(async () => { respond({ data: { ok: true }, error: null }); await pending; });
    expect(mock.successToast).not.toHaveBeenCalled();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("does not send a second void while the first response is pending", async () => {
    let respond!: (value: unknown) => void;
    mock.invoke.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.handleVoidOrphan(); second = result.current.handleVoidOrphan(); });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { respond({ data: { ok: true }, error: null }); await Promise.all([first, second]); });
  });
  it("does not clear the new table's orphan when an old table response arrives", async () => {
    let respond!: (value: unknown) => void;
    mock.invoke.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const { result } = renderHook(() => useStandaloneHandInput("tour1"));
    await waitFor(() => expect(result.current.tableLoadState).toBe("ready"));
    await act(async () => { await result.current.handleTableChange("table1"); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleVoidOrphan(); });
    await act(async () => { await result.current.handleTableChange("table2"); });
    await act(async () => { respond({ data: { status: "success", data: { status: "success" } }, error: null }); await pending; });
    expect(result.current.tableId).toBe("table2");
    expect(result.current.orphanHand?.id).toBe("hand1");
    expect(mock.successToast).not.toHaveBeenCalled();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
});
