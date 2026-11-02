import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DealerAttendance, GameTableRow } from "@/hooks/useDealerSwing";

const state = vi.hoisted(() => ({ actorId: "actor", inventoryError: "503 TEST" as string | null,
  tables: [] as GameTableRow[], roster: [] as DealerAttendance[], invoke: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: state.error, success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actorId } }) }));
vi.mock("@/hooks/useOperatorClubs", () => ({ useOperatorClubs: () => ({
  loading: false, user: { id: state.actorId }, clubs: [{ id: "club", name: "TEST" }], clubIds: ["club"], dealerClubIds: ["club"], error: null,
}) }));
vi.mock("@/hooks/usePublishedDealerSchedule", () => ({ usePublishedDealerSchedule: () => ({ daysByDate: {}, loading: false, error: null }) }));
vi.mock("@/hooks/useDealerSwingPhoneRollout", () => ({ useDealerSwingPhoneRollout: () => ({ enabled: false, loading: false, error: null }) }));
vi.mock("@/hooks/useShiftPlanner", () => ({ useShiftPlanner: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/hooks/useDealerSwing", () => ({
  useDealerOperationalTables: () => ({ data: state.tables, loading: false, error: state.inventoryError, refetch: vi.fn() }),
  useActiveAssignmentsWithTimeline: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
  useCheckedInDealers: () => ({ data: state.roster, loading: false, error: null, refetch: vi.fn() }),
  useTodayCheckedOutDealers: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), functions: { invoke: state.invoke } } }));
import OpsDealerSwing from "./OpsDealerSwing";

describe("Swing mobile read verification", () => {
  beforeEach(() => { state.actorId = "actor"; state.inventoryError = "503 TEST";
    state.tables = []; state.roster = []; state.invoke.mockReset(); state.error.mockReset(); });
  it("does not expose operational actions when table inventory failed", async () => {
    render(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    expect(await screen.findByText("Không xác minh được dữ liệu Dealer Swing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check-in/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
  it("does not carry the previous actor's selected screen into the same club", async () => {
    state.inventoryError = null;
    const view = render(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Dealer" }));
    expect(screen.getByText("Chưa có dealer nào trong ca.")).toBeInTheDocument();
    state.actorId = "actor-b";
    view.rerender(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    expect(screen.queryByText("Chưa có dealer nào trong ca.")).not.toBeInTheDocument();
    expect(screen.getByText("Chưa có bàn nào đang mở.")).toBeInTheDocument();
  });

  const table = (session: string | null): GameTableRow => ({
    id: "table", club_id: "club", table_name: "Bàn TEST", shift_id: null,
    status: "active", table_session_id: session, availability_status: "in_use",
  });
  const prepareAssignment = async (session: string | null = "session-a") => {
    state.inventoryError = null;
    state.tables = [table(session)];
    state.roster = [{ id: "attendance", dealer_id: "dealer", shift_date: "2026-10-31",
      status: "checked_in", check_in_time: null, check_out_time: null, overtime_minutes: 0,
      current_state: "available", worked_minutes_since_last_break: 0,
      priority_break_flag: false, last_released_at: null,
      dealers: { full_name: "Dealer TEST", tier: "C", club_id: "club" } }];
    const view = render(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Bàn TEST.*chưa có dealer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Gán dealer ngay" }));
    await screen.findByRole("heading", { name: "Chọn dealer vào Bàn TEST" });
    return view;
  };

  it("binds one assignment to the selected session, actor and club even after a double click", async () => {
    let finishAssignment!: (value: { data: { status: string }; error: null }) => void;
    const pending = new Promise<{ data: { status: string }; error: null }>((resolve) => { finishAssignment = resolve; });
    state.invoke.mockReturnValue(pending);
    await prepareAssignment();
    const choose = screen.getByRole("button", { name: /Dealer TEST.*chọn/ });
    fireEvent.click(choose); fireEvent.click(choose);
    await waitFor(() => expect(state.invoke).toHaveBeenCalledOnce());
    expect(state.invoke).toHaveBeenCalledWith("assign-dealer", { body: {
      table_id: "table", table_session_id: "session-a", force_dealer_id: "dealer",
      requested_by: "actor", expected_actor_id: "actor", expected_club_id: "club",
      idempotency_key: expect.stringMatching(/^[a-f0-9-]{36}$/),
    } });
    await act(async () => finishAssignment({ data: { status: "success" }, error: null }));
  });

  it("does not assign a legacy table without a verified session", async () => {
    await prepareAssignment(null);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Dealer TEST.*chọn/ })); });
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("Phiên bàn đã thay đổi hoặc chưa được xác minh. Tải lại trước khi gán dealer.");
  });

  it("does not move a retained dealer picker into the table's reopened session", async () => {
    const view = await prepareAssignment();
    state.tables = [table("session-b")];
    view.rerender(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Dealer TEST.*chọn/ })); });
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("Phiên bàn đã thay đổi hoặc chưa được xác minh. Tải lại trước khi gán dealer.");
  });
});
