// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), error: vi.fn(), staleOrphan: false, currentOrphan: false }));
vi.mock("sonner", () => ({ toast: { error: mock.error, success: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
 auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
 rpc: mock.rpc,
 from: (table: string) => {
  const result = { data: table === "tournaments" ? { id: "tour" } : [], error: null };
  const filters: Record<string, unknown> = {};
  const chain: any = { then: (resolve: any) => Promise.resolve(result).then(resolve),
   maybeSingle: async () => ({ data: table === "tournaments" ? { id: "tour" }
    : table === "tournament_hands" && mock.staleOrphan && filters.status === "in_progress"
      && filters.table_session_id !== "session-a"
      ? { id: "old-session-hand", hand_number: 99 }
      : table === "tournament_hands" && mock.currentOrphan && filters.status === "in_progress"
        && filters.table_session_id === "session-a" ? { id: "current-session-hand", hand_number: 2 } : null,
    error: null }) };
  for (const method of ["select", "eq", "filter", "order", "limit", "in", "neq", "is", "or"]) chain[method] = () => chain;
  chain.eq = (key: string, value: unknown) => { filters[key] = value; return chain; };
  chain.filter = (key: string, _operator: string, value: unknown) => { filters[key] = value; return chain; };
  return chain;
 },
} }));
import { useStandaloneHandInput } from "./useStandaloneHandInput";
const tables = ["a", "b"].map(id => ({ table_id: id, tournament_table_id: `logical-${id}`,
 table_session_id: `session-${id}`, control_epoch: 1, max_seats: 9, table_name: id, player_count: 0, has_live_hand: false }));
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const snapshot = (args: any) => ({ data: { ok: true, tournament_table_id: args.p_tournament_table_id,
 table_session_id: args.p_table_session_id, control_epoch: args.p_expected_epoch,
 seats: Array.from({ length: 9 }, (_, i) => ({ seat_number: i + 1,
  seat: i === 0 && mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2").length >= 2
   ? { player_id: "player", entry_number: 1, seat_number: 1, chip_count: 20000, player_name: "TEST" } : null,
  token: "empty" })) }, error: null });
afterEach(() => { cleanup(); vi.clearAllMocks(); mock.staleOrphan = false; mock.currentOrphan = false; sessionStorage.clear(); });
describe("actual roster hook intent", () => {
 it("does not offer an in-progress hand from an older incarnation of the same table", async () => {
  mock.staleOrphan = true;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_hand_input_tables_v3") return { data: { ok: true, tables }, error: null };
   if (name === "get_tracker_roster_snapshot_v1") return snapshot(args);
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  expect(h.result.current.orphanHand).toBeNull();
 expect(mock.rpc.mock.calls.some(([name]) => name === "get_next_hand_number")).toBe(true);
 });
 it("retains a resumable hand from the verified current session", async () => {
  mock.currentOrphan = true;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_hand_input_tables_v3") return { data: { ok: true, tables }, error: null };
   if (name === "get_tracker_roster_snapshot_v1") return snapshot(args);
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  expect(h.result.current.orphanHand).toEqual({ id: "current-session-hand", hand_number: 2 });
  expect(mock.rpc.mock.calls.some(([name]) => name === "get_next_hand_number")).toBe(false);
 });
 it("does not merge an old confirmed receipt over a newer canonical stack", async () => {
  let snapshots = 0;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_hand_input_tables_v3") return { data: { ok: true, tables }, error: null };
   if (name === "get_tracker_roster_snapshot_v1") {
    const r = snapshot(args); snapshots++;
    if (snapshots > 1) r.data.seats[0] = { seat_number: 1, token: "newer25k",
     seat: { player_id: "player", entry_number: 1, seat_number: 1, chip_count: 25000, player_name: "TEST" } };
    return r;
   }
   if (name === "set_tracker_table_roster_seat_v2") return { data: { ok: true, seat_token: "old20k",
    tournament_table_id: args.p_tournament_table_id, table_session_id: args.p_table_session_id, control_epoch: args.p_expected_epoch,
    seat: { id: "seat", entry_id: "entry", player_id: "player", entry_number: 1, seat_number: 1, chip_count: 20000 } }, error: null };
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  await act(async () => { expect(await h.result.current.handleSetRosterSeat({ seatNumber: 1, playerName: "TEST", chipCount: 20000 }))
   .toEqual({ ok: true, error: "roster_refresh_required" }); });
  expect(h.result.current.players).toHaveLength(0);
  expect(mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2")).toHaveLength(1);
  expect(sessionStorage.length).toBe(0);
 });
 it("drops old A completion after A→B→A and sends only one simultaneous write", async () => {
  let release!: (value: any) => void;
  let sent: any;
  mock.rpc.mockImplementation((name: string, args: any) => {
   if (name === "get_tracker_roster_snapshot_v1") return Promise.resolve(snapshot(args));
   if (name === "get_tracker_hand_input_tables_v3") return Promise.resolve({ data: { ok: true, tables }, error: null });
   if (name === "set_tracker_table_roster_seat_v2") {
    sent = args;
    return new Promise(resolve => { release = resolve; });
   }
   return Promise.resolve({ data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null });
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  const args = { seatNumber: 1, playerName: "TEST", chipCount: 20000 };
  let pending!: ReturnType<typeof h.result.current.handleSetRosterSeat>;
  act(() => { pending = h.result.current.handleSetRosterSeat(args); });
  await act(async () => {
   expect((await h.result.current.handleSetRosterSeat(args)).error).toBe("roster_write_in_flight");
   await h.result.current.handleTableChange("b");
  });
  await act(async () => { await h.result.current.handleTableChange("a"); });
  await act(async () => {
   release({ data: { ok: true, seat_token: "empty", tournament_table_id: sent.p_tournament_table_id,
    table_session_id: sent.p_table_session_id, control_epoch: sent.p_expected_epoch,
    seat: { id: "seat", entry_id: "entry", player_id: "player", entry_number: 1,
     seat_number: 1, chip_count: 20000 } }, error: null });
   expect((await pending).error).toBe("stale_roster_context");
  });
  expect(mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2")).toHaveLength(1);
  expect(h.result.current.players).toHaveLength(0);
 });
 it.each([false, true])("keeps unknown key across remount; changed epoch=%s reconciles before any new mutation", async (changedEpoch) => {
  let first = true;
  let epoch = 1;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_roster_snapshot_v1") return snapshot(args);
   if (name === "get_tracker_hand_input_tables_v3") return { data: { ok: true, tables: tables.map(t => ({ ...t, control_epoch: epoch })) }, error: null };
   if (name === "set_tracker_table_roster_seat_v2") {
    if (first) { first = false; return { data: null, error: { message: "response lost" } }; }
    return { data: { ok: true, seat_token: "empty", tournament_table_id: args.p_tournament_table_id,
     table_session_id: args.p_table_session_id, control_epoch: args.p_expected_epoch,
     seat: { id: "seat", entry_id: "entry", player_id: "player", entry_number: 1,
      seat_number: args.p_seat_number, chip_count: args.p_chip_count, player_name: args.p_player_name } }, error: null };
   }
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  let h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  const args = { seatNumber: 1, playerName: "TEST", chipCount: 20000 };
  await act(async () => { expect((await h.result.current.handleSetRosterSeat(args)).ok).toBe(false); });
  expect(h.result.current.players).toHaveLength(0);
  h.unmount();
  if (changedEpoch) epoch = 2;
  h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  await act(async () => {
   const result = await h.result.current.handleSetRosterSeat(args);
   if (changedEpoch) expect(result.error).toBe("previous_intent_resolved");
   else expect(result.ok).toBe(true);
  });
  const writes = mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2");
  expect(writes).toHaveLength(2);
  expect(writes[0][1].p_request_id).toBe(writes[1][1].p_request_id);
  expect(writes[0][1].p_table_session_id).toBe("session-a");
  expect(writes[1][1].p_expected_epoch).toBe(1);
  if (changedEpoch) expect(h.result.current.players).toHaveLength(0);
  else expect(h.result.current.players[0].current_stack).toBe(20000);
 });
});
