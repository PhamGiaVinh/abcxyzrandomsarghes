import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ actorId: "actor", error: "503 TEST" as string | null, loading: false, configError: null as string | null, configLoading: false, configRefetch: vi.fn() }));
vi.mock("@/lib/featureFlags", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/featureFlags")>();
  return { ...original, FEATURES: { ...original.FEATURES, floorTableControlV3: true } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actorId }, isClubAdmin: true, isAdmin: false, isClubOwner: true, isFloor: false }) }));
vi.mock("@/hooks/useDealerSwing", () => {
  const query = () => ({ data: [], loading: false, error: null, refetch: vi.fn() });
  return {
    useCheckedInDealers: query, useTodayCheckedOutDealers: query,
    useDealerOperationalTables: () => ({ ...query(), error: state.error, loading: state.loading }),
    useActiveAssignmentsWithTimeline: () => ({ ...query(), activeRawData: [] }),
    useSwingConfigs: () => ({ ...query(), error: state.configError, loading: state.configLoading, refetch: state.configRefetch }), useSwingMetrics: query, useSpecialDates: query, useBreakPool: query,
    useAuditLogs: () => [], useBreakPolicies: () => [], usePreAssignedDealers: () => ({}),
    useOptimisticDealerCount: () => ({ optimistic: 0, onCheckout: vi.fn() }),
    useNextDealerPredictions: () => ({ data: {} }),
  };
});
vi.mock("@/hooks/useRotationSchedule", () => ({ useRotationSchedule: () => ({ rows: [], byTableId: {}, loading: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/hooks/useTournaments", () => ({ useActiveTournaments: () => ({ data: [] }) }));
vi.mock("@/hooks/useDealerManagement", () => ({ useAllDealers: () => ({ data: [] }), useDealerScores: () => ({ data: [] }) }));
vi.mock("@/hooks/useDealerSwingHealth", () => ({ useDealerSwingHealth: () => ({ data: null, unavailable: true }) }));
vi.mock("@/hooks/useLiveClock", () => ({ useLiveClock: () => 0 }));
vi.mock("@/hooks/useSwingAnimation", () => ({ useSwingAnimation: () => ({}) }));
vi.mock("@/hooks/useFocusNavigation", () => ({ useFocusNavigation: () => ({}) }));
vi.mock("@/integrations/supabase/client", () => {
  const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
  for (const key of ["select", "eq", "in", "order"]) query[key as "select"].mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  query.then.mockImplementation((resolve) => resolve({ data: [], error: null }));
  return { supabase: { from: () => query, rpc: vi.fn().mockResolvedValue({ data: null, error: null }), functions: { invoke: vi.fn() } } };
});
import SwingPanel from "./DealerSwingTab";
import { supabase } from "@/integrations/supabase/client";

describe("desktop Swing authoritative read state", () => {
  beforeEach(() => { state.actorId = "actor"; state.error = "503 TEST"; state.loading = false; state.configError = null; state.configLoading = false; state.configRefetch.mockClear(); });
  it("blocks operations when config is unavailable instead of using fallback timing", async () => {
    state.error = null; state.configError = "503 config";
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Cấu hình Swing$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(state.configRefetch).toHaveBeenCalledOnce();
  });
  it("keeps emergency OFF available while config is being verified", async () => {
    state.error = null; state.configLoading = true;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Cấu hình Swing$/ })).not.toBeInTheDocument();
  });
  it("exposes declaration in the verified single-club workspace without opening a session", async () => {
    state.error = null;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    fireEvent.click(screen.getByRole("button", { name: /physicalTableDeclaration.action|Khai báo bàn vật lý|Declare physical table/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalledWith("declare_club_physical_table_v1", expect.anything());
  });
  it("blocks operational rendering on failed inventory but retains emergency OFF", async () => {
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Check-in/ })).not.toBeInTheDocument();
  });
  it("does not report a ready floor during initial verification", async () => {
    state.error = null; state.loading = true;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("status")).toHaveTextContent("Đang");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
  });
  it("discards an open configuration dialog after actor changes within the same club", async () => {
    state.error = null;
    const props = { clubIds: ["club"], clubs: [{ id: "club", name: "TEST" }] };
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<SwingPanel {...props} />); });
    fireEvent.click(screen.getByRole("button", { name: /^Cấu hình Swing$/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    state.actorId = "actor-b";
    await act(async () => { view.rerender(<SwingPanel {...props} />); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("distinguishes the configured rest preference from the automatic server floor", async () => {
    state.error = null;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    fireEvent.click(screen.getByRole("button", { name: /^Cấu hình Swing$/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Tự động gán dealer luôn yêu cầu nghỉ ít nhất 15 phút");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Dealer phải nghỉ tối thiểu 10 phút trước khi được xếp ca mới.");
  });
});
