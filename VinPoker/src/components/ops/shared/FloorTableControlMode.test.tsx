import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import { readPendingFloorModeIntent } from "@/lib/floorPendingModeIntent";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorTableControlV3: true } }));

import { FloorTableControlModeControl } from "./FloorTableControlMode";

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => sessionStorage.clear());

describe("FloorTableControlModeControl", () => {
  const canonicalTable = { tt_id: "table-1", table_name: "Bàn 2",
    floor_control_mode: "manual" as const, floor_control_revision: 3,
    table_session_id: "session-1", control_epoch: 7 };
  it("does not read or mutate canonical mode while actor context is unknown", async () => {
    const rpc = vi.fn();
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={null} tournamentId="tour" table={canonicalTable} onChanged={vi.fn()} />
    </SupabaseClientProvider>);
    expect(screen.getByTestId("floor-table-control-mode-save")).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });
  const confirmTracker = async () => {
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-tracker")).toBeEnabled());
    fireEvent.click(screen.getByTestId("floor-table-control-mode-tracker"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-save"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-confirm"));
  };
  it("ignores an old mode acknowledgement after table A -> B -> A", async () => {
    let finish!: (value: unknown) => void;
    const rpc = vi.fn().mockImplementation((name) => name === "floor_request_table_control_mode_v4"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ error: null, data: { ok: true, request: null } }));
    const client = { rpc } as never; const onChanged = vi.fn();
    const ui = (table = canonicalTable) => <SupabaseClientProvider client={client}>
      <FloorTableControlModeControl actorId="actor" tournamentId="tour" table={table} onChanged={onChanged} />
    </SupabaseClientProvider>;
    const view = render(ui()); await confirmTracker();
    view.rerender(ui({ ...canonicalTable, tt_id: "table-b", table_session_id: "session-b" }));
    view.rerender(ui());
    await act(async () => finish({ error: null, data: { ok: true, outcome: "pending", request_id: "old-pending", blockers: ["active_hand"] } }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText("Đang chờ chuyển sang Live Tracker.")).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(1);
  });
  it("bounds a stalled mode read without accepting its late pending state", async () => {
    vi.useFakeTimers(); let finish!: (value: unknown) => void;
    const rpc = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId="actor" tournamentId="tour" table={canonicalTable} onChanged={vi.fn()} />
    </SupabaseClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh được yêu cầu đổi chế độ");
    await act(async () => finish({ error: null, data: { ok: true, request: { id: "late", target_mode: "tracker", blockers: ["active_hand"] } } }));
    expect(screen.queryByText("Đang chờ chuyển sang Live Tracker.")).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("bounds an unknown mode write while preserving its exact journal", async () => {
    let finish!: (value: unknown) => void; const changed = vi.fn();
    const rpc = vi.fn().mockImplementation((name) => name === "floor_request_table_control_mode_v4"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ error: null, data: { ok: true, request: null } }));
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId="actor" tournamentId="tour" table={canonicalTable} onChanged={changed} />
    </SupabaseClientProvider>);
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-tracker")).toBeEnabled());
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("floor-table-control-mode-tracker"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-save"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-confirm"));
    const key = sessionStorage.key(0)!; const saved = sessionStorage.getItem(key);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    expect(screen.getByTestId("floor-table-control-mode-confirm")).toBeEnabled();
    await act(async () => finish({ error: null, data: { ok: true, outcome: "applied" } }));
    expect(sessionStorage.getItem(key)).toBe(saved); expect(changed).not.toHaveBeenCalled();
    expect(rpc.mock.calls.filter(([name]) => name === "floor_request_table_control_mode_v4")).toHaveLength(1);
  });
  it("does not let a pre-mutation null poll erase the newly accepted pending request", async () => {
    let poll!: () => void;
    const interval = vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      if (delay === 4000 && typeof callback === "function") poll = callback as () => void;
      return 123 as unknown as ReturnType<typeof setInterval>;
    });
    let finishOld!: (value: unknown) => void;
    let reads = 0;
    const rpc = vi.fn().mockImplementation(async (name) => {
      if (name === "floor_get_table_control_mode_request_v1") {
        if (++reads === 2) return new Promise((resolve) => { finishOld = resolve; });
        return { error: null, data: { ok: true, request: null } };
      }
      return { error: null, data: { ok: true, outcome: "pending", request_id: "pending-new", blockers: ["active_hand"] } };
    });
    const rendered = render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={vi.fn()} />
    </SupabaseClientProvider>);
    try {
      await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-tracker")).toBeEnabled());
      await act(async () => { poll(); });
      expect(finishOld).toBeTypeOf("function");
      await confirmTracker();
      await screen.findByText("Đang chờ chuyển sang Live Tracker.");
      await act(async () => { finishOld({ error: null, data: { ok: true, request: null } }); });
      expect(screen.getByText("Đang chờ chuyển sang Live Tracker.")).toBeInTheDocument();
      expect(screen.getByTestId("floor-table-control-mode-save")).toBeDisabled();
    } finally { rendered.unmount(); interval.mockRestore(); }
  });
  it("shows pending without claiming a mode change and cancels the exact request", async () => {
    const rpc = vi.fn().mockImplementation(async (name) => ({ error: null, data:
      name === "floor_get_table_control_mode_request_v1" ? { ok: true, request: null }
        : name === "floor_cancel_table_control_mode_request_v1" ? { ok: true, outcome: "cancelled" }
        : { ok: true, outcome: "pending", request_id: "pending-1", blockers: ["active_hand"] },
    }));
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={vi.fn()} />
    </SupabaseClientProvider>);
    await confirmTracker();
    await screen.findByText("Đang chờ chuyển sang Live Tracker.");
    expect(screen.getByTestId("floor-table-control-mode-save")).toBeDisabled();
    expect(screen.getByText("Ván đang chạy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy yêu cầu đổi chế độ" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("floor_cancel_table_control_mode_request_v1", {
      p_tournament_table_id: "table-1", p_table_session_id: "session-1", p_mode_request_id: "pending-1",
    }));
    await waitFor(() => expect(screen.queryByText("Đang chờ chuyển sang Live Tracker.")).not.toBeInTheDocument());
  });
  it("keeps the same exact intent after a lost mutation response", async () => {
    let writes = 0;
    const rpc = vi.fn().mockImplementation(async (name) => {
      if (name === "floor_get_table_control_mode_request_v1") return { data: { ok: true, request: null }, error: null };
      if (++writes === 1) throw new Error("response lost after commit");
      return { data: { ok: true, outcome: "applied" }, error: null };
    });
    const changed = vi.fn();
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={changed} />
    </SupabaseClientProvider>);
    await confirmTracker();
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-confirm")).toBeEnabled());
    fireEvent.click(screen.getByTestId("floor-table-control-mode-confirm"));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const calls = rpc.mock.calls.filter(([name]) => name === "floor_request_table_control_mode_v4");
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(calls[0][1]);
  });
  it("recovers the frozen intent after unmount/reload rather than allocating a new key", async () => {
    let writes = 0;
    const rpc = vi.fn().mockImplementation(async (name) => {
      if (name === "floor_get_table_control_mode_request_v1") return { data: { ok: true, request: null }, error: null };
      if (++writes === 1) throw new Error("response lost");
      return { data: { ok: true, outcome: "applied" }, error: null };
    });
    const changed = vi.fn();
    const view = () => <SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={changed} />
    </SupabaseClientProvider>;
    const first = render(view());
    await confirmTracker();
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-confirm")).toBeEnabled());
    first.unmount();
    render(view());
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-save")).toBeEnabled());
    fireEvent.click(screen.getByTestId("floor-table-control-mode-save"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-confirm"));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const calls = rpc.mock.calls.filter(([name]) => name === "floor_request_table_control_mode_v4");
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(calls[0][1]);
  });
  it("disables legacy contexts instead of falling back to the table-only RPC", () => {
    const rpc = vi.fn();
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={{ ...canonicalTable,
        table_session_id: undefined, control_epoch: undefined }} onChanged={vi.fn()} />
    </SupabaseClientProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh được phiên bàn");
    expect(screen.getByTestId("floor-table-control-mode-save")).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("can reconcile a lost response even when a refreshed roster already shows the target mode", async () => {
    let writes = 0;
    const rpc = vi.fn().mockImplementation(async (name) => {
      if (name === "floor_get_table_control_mode_request_v1") return { data: { ok: true, request: null }, error: null };
      if (++writes === 1) throw new Error("response lost");
      return { data: { ok: true, outcome: "applied" }, error: null };
    });
    const changed = vi.fn();
    const first = render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={changed} />
    </SupabaseClientProvider>);
    await confirmTracker();
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-confirm")).toBeEnabled());
    first.unmount();
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={{ ...canonicalTable,
        floor_control_mode: "tracker", floor_control_revision: 4, control_epoch: 8 }} onChanged={changed} />
    </SupabaseClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Đối chiếu yêu cầu đã lưu" })).toBeEnabled());
    fireEvent.click(screen.getByTestId("floor-table-control-mode-save"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-confirm"));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const calls = rpc.mock.calls.filter(([name]) => name === "floor_request_table_control_mode_v4");
    expect(calls[1][1]).toEqual(calls[0][1]);
  });
  it("does not send a mutation when its recovery journal cannot be persisted", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, request: null }, error: null });
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={vi.fn()} />
    </SupabaseClientProvider>);
    try {
      await confirmTracker();
      await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-confirm")).toBeEnabled());
      expect(rpc.mock.calls.filter(([name]) => name === "floor_request_table_control_mode_v4")).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
  it("clears only a definitively rejected stale intent and requests refresh before another write", async () => {
    const rpc = vi.fn().mockImplementation(async (name) => ({ error: null, data:
      name === "floor_get_table_control_mode_request_v1" ? { ok: true, request: null }
        : { ok: false, error: "STALE_STATE" },
    }));
    const changed = vi.fn();
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={changed} />
    </SupabaseClientProvider>);
    await confirmTracker();
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(readPendingFloorModeIntent(JSON.stringify(["actor", "tour", "table-1", "session-1"]))).toBeNull();
    expect(screen.getByTestId("floor-table-control-mode-save")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Phiên bàn đã thay đổi");
  });
  it("does not classify an unknown successful shape as an applied mode", async () => {
    const rpc = vi.fn().mockImplementation(async (name) => ({ error: null, data:
      name === "floor_get_table_control_mode_request_v1" ? { ok: true, request: null }
        : { ok: true, outcome: "unexpected" },
    }));
    const changed = vi.fn();
    render(<SupabaseClientProvider client={{ rpc } as never}>
      <FloorTableControlModeControl actorId={"actor"} tournamentId="tour" table={canonicalTable} onChanged={changed} />
    </SupabaseClientProvider>);
    await confirmTracker();
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-confirm")).toBeEnabled());
    expect(changed).not.toHaveBeenCalled();
    expect(readPendingFloorModeIntent(JSON.stringify(["actor", "tour", "table-1", "session-1"]))).not.toBeNull();
  });
  it.each(["session", "actor"])("ignores a mutation response after the %s context is replaced", async (boundary) => {
    let finish!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { finish = resolve; });
    const rpc = vi.fn().mockImplementation(async (name) => name === "floor_get_table_control_mode_request_v1"
      ? { error: null, data: { ok: true, request: null } } : delayed);
    const changed = vi.fn();
    const client = { rpc } as never;
    const view = (session: string, actor = "actor") => <SupabaseClientProvider client={client}>
      <FloorTableControlModeControl actorId={actor} tournamentId="tour" table={{ ...canonicalTable, table_session_id: session }} onChanged={changed} />
    </SupabaseClientProvider>;
    const rendered = render(view("session-1"));
    await confirmTracker();
    await waitFor(() => expect(rpc.mock.calls.some(([name]) => name === "floor_request_table_control_mode_v4")).toBe(true));
    const nextActor = boundary === "actor" ? "actor-2" : "actor";
    const nextSession = boundary === "session" ? "session-2" : "session-1";
    rendered.rerender(view(nextSession, nextActor));
    await act(async () => { finish({ error: null, data: { ok: true, outcome: "applied" } }); });
    expect(changed).not.toHaveBeenCalled();
    expect(readPendingFloorModeIntent(JSON.stringify(["actor", "tour", "table-1", "session-1"]))).not.toBeNull();
    expect(readPendingFloorModeIntent(JSON.stringify([nextActor, "tour", "table-1", nextSession]))).toBeNull();
  });
  it("submits an exact-session mode intent instead of the legacy table-only mutation", async () => {
    const rpc = vi.fn().mockImplementation(async (name) => ({
      data: name === "floor_get_table_control_mode_request_v1"
        ? { ok: true, request: null } : { ok: true, outcome: "applied" }, error: null,
    }));
    const table = {
      tt_id: "table-1", table_name: "Bàn 2",
      floor_control_mode: "manual" as const, floor_control_revision: 3,
      table_session_id: "session-1", control_epoch: 7,
    };
    render(
      <SupabaseClientProvider client={{ rpc } as never}>
        <FloorTableControlModeControl actorId={"actor"} tournamentId="tournament-1" table={table} onChanged={vi.fn()} />
      </SupabaseClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-tracker")).toBeEnabled());
    fireEvent.click(screen.getByTestId("floor-table-control-mode-tracker"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-save"));
    fireEvent.click(screen.getByTestId("floor-table-control-mode-confirm"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      "floor_request_table_control_mode_v4",
      expect.objectContaining({
        p_tournament_table_id: "table-1", p_table_session_id: "session-1",
        p_control_mode: "tracker", p_expected_revision: 3,
        p_expected_epoch: 7, p_request_id: expect.any(String),
      }),
    ));
    expect(rpc.mock.calls.some(([name]) => name === "floor_set_table_control_mode")).toBe(false);
  });

  it("uses the visual Manual Floor and Live Tracker chooser in an existing table", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { ok: true, request: null }, error: null }) } as never;
    render(
      <SupabaseClientProvider client={client}>
        <FloorTableControlModeControl actorId={"actor"}
          tournamentId="tournament-1"
          table={{
            tt_id: "table-1",
            table_name: "Bàn 2",
            floor_control_mode: "manual",
            floor_control_revision: 3,
            table_session_id: "session-1",
            control_epoch: 7,
          }}
          onChanged={vi.fn()}
        />
      </SupabaseClientProvider>,
    );

    expect(screen.getByTestId("floor-table-control-mode-manual")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("floor-table-control-mode-tracker")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Lưu chế độ bàn" })).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId("floor-table-control-mode-tracker")).toBeEnabled());
    fireEvent.click(screen.getByTestId("floor-table-control-mode-tracker"));

    expect(screen.getByTestId("floor-table-control-mode-tracker")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Lưu chế độ bàn" })).toBeEnabled();
  });
});
