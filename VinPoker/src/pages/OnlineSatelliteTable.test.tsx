import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import OnlineSatelliteTable from "./OnlineSatelliteTable";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner-test" }, loading: false }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => ({ rpc }),
}));

it("uses the server revision and refreshes a stale clock command", async () => {
  const pilotId = "ab510000-0000-4000-8000-000000000019";
  const tableId = "ab510000-0000-4000-8000-000000000020";
  let reads = 0;
  rpc.mockImplementation((name) => {
    if (name === "set_online_satellite_clock_v1") {
      return Promise.resolve({ data: { outcome: "stale" }, error: null });
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
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/poker/satellite/${pilotId}/table`]}>
        <Routes><Route path="/poker/satellite/:pilotId/table" element={<OnlineSatelliteTable />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Chạy đồng hồ" }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_online_satellite_clock_v1",
    { p_pilot_id: pilotId, p_expected_revision: "4", p_running: true }));
  expect(await screen.findByRole("button", { name: "Tạm dừng đồng hồ" })).toBeVisible();
  expect(screen.getByText("Đồng hồ đã thay đổi. Hãy kiểm tra trạng thái mới.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Vào bàn" })).toHaveAttribute("href", `/poker/table/${tableId}`);
});
