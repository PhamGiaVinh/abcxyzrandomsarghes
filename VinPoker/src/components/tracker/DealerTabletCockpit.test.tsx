import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
// Layout tests model the enclosing app AuthProvider; server scope checks below
// still use their own RPC fixtures and do not infer authority from this actor.
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'local-layout-actor'},session:null})}));
vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: vi.fn(),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { source_revision: 1 }, error: null });
  return { supabase: { rpc: vi.fn(), from: vi.fn(() => query) } };
});
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorTableControlV3: true, trackerOperationalFloorAlerts: false } }));
vi.mock("@/ops/chip-ops/MultiDayBaggingPanel", () => ({
  MultiDayBaggingPanel: ({ tournamentId }: { tournamentId: string }) => <p>Dealer bagging for {tournamentId}</p>,
}));
vi.mock("@/ops/chip-ops/MultiDayBaggingPanel", () => ({
  MultiDayBaggingPanel: ({ tournamentId }: { tournamentId: string }) => <p>Dealer bagging for {tournamentId}</p>,
}));
import { supabase } from "@/integrations/supabase/client";
import { DealerTabletCockpit, DealerTabletLayout } from "./DealerTabletCockpit";

afterEach(cleanup);
beforeEach(() => { vi.mocked(supabase.rpc).mockReset(); vi.mocked(supabase.from).mockReset(); });
const hook = { actions: [], syncPhase: "idle", tableId: "table" } as unknown as StandaloneHandInput;
const props = { hook, header: null, orphan: null, progress: null, felt: <p>Bàn</p>, board: null, voice: <p>Voice mounted</p>, guided: <p>Manual writer</p>, log: null };
describe("Dealer tablet modes", () => {
  it("does not mount any writer when Floor permission is absent", () => {
    render(<DealerTabletLayout {...props} trackerAllowed={false} />);
    expect(screen.getByRole("button", { name: "Tracker" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Manual writer")).toBeNull();
    expect(screen.queryByText("Voice mounted")).toBeNull();
  });
  it("unmounts Voice when switching to normal or when authority is lost", () => {
    const { rerender } = render(<DealerTabletLayout {...props} trackerAllowed />);
    fireEvent.click(screen.getByRole("button", { name: "Voice Assist" }));
    expect(screen.getByText("Voice mounted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thường" }));
    expect(screen.queryByText("Voice mounted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tracker" }));
    expect(screen.getByText("Voice mounted")).toBeTruthy();
    rerender(<DealerTabletLayout {...props} trackerAllowed={false} />);
    expect(screen.queryByText("Voice mounted")).toBeNull();
  });
  it("keeps Floor reporting separate from Voice in manual mode and uses the roster name for the clock", () => {
    const activeHook = {
      ...hook,
      handStarted: true,
      showActionStep: true,
      handId: "hand-1",
      tournamentId: "tournament",
      tournamentTableId: "table",
      currentStreet: "preflop",
      engineActor: { player_id: "player-1", seat_number: 1, toCall: 10, minRaiseTo: 20, legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true } },
      playerName: () => "Test 1",
      actions: [{ action_order: 1, street: "preflop", player_id: "player-1", display_name: "Test 1", seat_number: 1, action_type: "call", amount: 10 }],
      canUndo: false,
    } as StandaloneHandInput;
    render(<DealerTabletLayout {...props} hook={activeHook} trackerAllowed floorAlertsEnabled />);
    expect(screen.getByText("Ghế 1 · Test 1")).toBeTruthy();
    expect(screen.getByText(/Action trước khi tải lại không nằm trong Hoàn tác cục bộ/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gọi Floor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vấn đề hiển thị" })).toBeTruthy();
    expect(screen.queryByText("Voice mounted")).toBeNull();
    const floorControls = screen.getByRole("region", { name: "Liên hệ Floor" });
    expect(floorControls.compareDocumentPosition(screen.getByText("Bàn")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("hides Floor alert controls while the capability is off", () => {
    const activeHook = { ...hook, tournamentId: "tournament", tournamentTableId: "table" } as StandaloneHandInput;
    render(<DealerTabletLayout {...props} hook={activeHook} trackerAllowed />);
    expect(screen.queryByRole("region", { name: "Liên hệ Floor" })).toBeNull();
  });
});

describe("Dealer tablet server context", () => {
  const row = { tournament_table_id: "table", table_session_id: "session", control_epoch: 1, control_mode: "tracker", can_manual_cards: true, table_number: null };
  const boundProps = { ...props, hook: { ...hook, tournamentId: "tournament", tournamentTableId: "table" } as StandaloneHandInput };
  function respond(rows: unknown[], allowed = true) {
    vi.mocked(supabase.rpc).mockImplementation((async (name: string) => ({ data: name === "get_tracker_hand_input_tables_v4" ? { ok: true, tables: rows } : { ok: allowed, error: allowed ? undefined : "STALE_TRACKER_CONTEXT" }, error: null })) as never);
  }
  it("places server-scoped bag entry on the dealer tablet only for flights", async () => {
    respond([row]);
    vi.mocked(supabase.from).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { phase: "flight" }, error: null }) }) }),
    } as never);
    render(<DealerTabletCockpit {...boundProps} />);
    expect(await screen.findByText("Dealer bagging for tournament")).toBeTruthy();
  });
  it("accepts server-validated session authority even with a null display table number", async () => {
    respond([row]);
    render(<DealerTabletCockpit {...boundProps} />);
    await screen.findByText("Manual writer");
    expect(supabase.rpc).not.toHaveBeenCalledWith("get_floor_tournament_table_roster_v3", expect.anything());
    expect(supabase.rpc).toHaveBeenCalledWith("validate_tracker_table_writer_context_v3", { p_tournament_id: "tournament", p_tournament_table_id: "table", p_table_session_id: "session", p_control_epoch: 1 });
  });
  it.each([
    [{ ...row, control_mode: "manual" }], [{ ...row, can_manual_cards: false }],
    [{ ...row, tournament_table_id: "other" }], [row, row],
    [{ ...row, control_epoch: 0 }], [{ ...row, table_session_id: null }],
  ])("denies invalid or ambiguous session context before writer validation", async (...rows) => {
    respond(rows);
    render(<DealerTabletCockpit {...boundProps} />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Manual writer")).toBeNull();
  });
  it("keeps Tracker locked when the server rejects the current epoch", async () => {
    respond([row], false);
    render(<DealerTabletCockpit {...boundProps} />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Manual writer")).toBeNull();
  });
});
