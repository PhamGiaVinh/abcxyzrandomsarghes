import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import OnlineSatelliteTable from "./OnlineSatelliteTable";

const rpc = vi.hoisted(() => vi.fn());
const startHand = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onlinePoker/client", () => ({ onlinePokerClient: { startHand } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner-test" }, loading: false }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => ({ rpc }),
}));

const pilotId = "ab510000-0000-4000-8000-000000000019";
const tableId = "ab510000-0000-4000-8000-000000000020";
const handId = "ab510000-0000-4000-8000-000000000028";

function openControl() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/poker/satellite/${pilotId}/table`]}>
        <Routes><Route path="/poker/satellite/:pilotId/table" element={<OnlineSatelliteTable />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the participant's own qualification on their closed table", async () => {
  rpc.mockImplementation(name => ({
    abortSignal: async () => ({
      data: name === "get_my_online_satellite_result_v1"
        ? { qualified: true, destinationName: "Giải đích TEST", lockedAt: "2030-01-01T12:00:00Z" }
        : { tableId, clockRevision: "5", running: false, status: "closed",
          canManage: false, canPlay: true, canProvision: false, qualificationReached: true },
      error: null,
    }),
  }));
  openControl();
  expect(await screen.findByText("Bạn đạt suất TEST.")).toBeVisible();
  expect(screen.getByText("Giải đích TEST")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Chia ván mới" })).not.toBeInTheDocument();
});

it("shows the qualification boundary without offering another deal", async () => {
  rpc.mockImplementation(name => {
    if (name === "lock_online_satellite_result_v1") {
      return Promise.resolve({ data: { outcome: "bubble_review_required" }, error: null });
    }
    return { abortSignal: async () => ({
      data: name === "get_online_satellite_bubble_evidence_v1"
        ? { handId, handNo: "8", stateVersion: 3, status: "complete", survivingCount: 1, eliminations: [] }
        : { tableId, clockRevision: "4", running: true, status: "open",
          canManage: true, canPlay: true, canProvision: false, qualificationReached: true },
      error: null,
    }) };
  });
  openControl();
  expect(await screen.findByText("Đã chạm ngưỡng suất TEST")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Chia ván mới" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tạm dừng đồng hồ" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Kiểm tra ván mới nhất" }));
  fireEvent.click(await screen.findByRole("button", { name: "Khóa kết quả TEST và đóng bàn" }));
  expect(await screen.findByText("Cần TD phân xử suất còn thiếu.")).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("lock_online_satellite_result_v1", {
    p_pilot_id: pilotId, p_expected_hand_id: handId, p_expected_hand_version: 3,
  });
});

it("uses the server revision and refreshes a stale clock command", async () => {
  rpc.mockClear();
  let reads = 0;
  rpc.mockImplementation((name) => {
    if (name === "set_online_satellite_clock_v1") {
      return Promise.resolve({ data: { outcome: "stale" }, error: null });
    }
    if (name === "get_online_satellite_bubble_evidence_v1") {
      return { abortSignal: async () => ({
        data: { handId, handNo: "8", stateVersion: 3, status: "complete", survivingCount: 1,
          eliminations: [{ seat: 2, startingStack: "10" }, { seat: 7, startingStack: "30" }] },
        error: null,
      }) };
    }
    return {
      abortSignal: () => {
        reads += 1;
        return Promise.resolve({
          data: { tableId, clockRevision: String(reads + 3), running: reads > 1,
            status: reads > 1 ? "open" : "paused", canManage: true, canPlay: true, canProvision: false },
          error: null,
        });
      },
    };
  });
  openControl();
  fireEvent.click(await screen.findByRole("button", { name: "Chạy đồng hồ" }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_online_satellite_clock_v1",
    { p_pilot_id: pilotId, p_expected_revision: "4", p_running: true }));
  expect(await screen.findByRole("button", { name: "Tạm dừng đồng hồ" })).toBeVisible();
  expect(screen.getByText("Đồng hồ đã thay đổi. Hãy kiểm tra trạng thái mới.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Vào bàn" })).toHaveAttribute("href", `/poker/table/${tableId}`);
  startHand.mockResolvedValue({ outcome: "already_active" });
  fireEvent.click(screen.getByRole("button", { name: "Chia ván mới" }));
  expect(await screen.findByText("Bàn đang chơi một ván.")).toBeVisible();
  expect(startHand).toHaveBeenCalledWith(tableId);
  fireEvent.click(screen.getByRole("button", { name: "Kiểm tra ván mới nhất" }));
  expect(await screen.findByText("Còn 1 người có chip.")).toBeVisible();
  expect(screen.getByText("Ghế 7 · 30 chip đầu ván")).toBeVisible();
});

it("sends the manager's full schedule and opens only the confirmed table", async () => {
  rpc.mockClear();
  let created = false;
  rpc.mockImplementation((name) => {
    if (name === "provision_online_satellite_table_v1") {
      created = true;
      return Promise.resolve({ data: { tableId }, error: null });
    }
    return { abortSignal: () => Promise.resolve({
      data: created ? {
        tableId, clockRevision: "1", running: false, status: "paused",
        canManage: true, canPlay: true, canProvision: false,
      } : { tableId: null, clockRevision: null, status: "unprovisioned", canProvision: true },
      error: null,
    }) };
  });
  openControl();
  fireEvent.click(await screen.findByRole("button", { name: "Thêm level" }));
  fireEvent.change(screen.getAllByLabelText("Small blind")[0], { target: { value: "5" } });
  fireEvent.change(screen.getAllByLabelText("Big blind", { exact: true })[0], { target: { value: "10" } });
  fireEvent.change(screen.getAllByLabelText("Mốc bắt đầu (giây)")[1], { target: { value: "60" } });
  fireEvent.change(screen.getAllByLabelText("Small blind")[1], { target: { value: "10" } });
  fireEvent.change(screen.getAllByLabelText("Big blind", { exact: true })[1], { target: { value: "20" } });
  fireEvent.change(screen.getAllByLabelText("Big blind ante")[1], { target: { value: "20" } });
  expect(screen.queryByRole("link", { name: "Vào bàn" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tạo bàn và khóa lịch" }));
  expect(await screen.findByRole("link", { name: "Vào bàn" })).toHaveAttribute("href", `/poker/table/${tableId}`);
  expect(rpc).toHaveBeenCalledWith("provision_online_satellite_table_v1", {
    p_pilot_id: pilotId, p_qualification_slots: 1, p_levels: [
      { starts_at_second: 0, small_blind: 5, big_blind: 10, big_blind_ante: 0 },
      { starts_at_second: 60, small_blind: 10, big_blind: 20, big_blind_ante: 20 },
    ],
  });
});
