import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import OnlineSatellitePilotSetup from "./OnlineSatellitePilotSetup";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    rpc: (name: string, args: unknown) => {
      const request = rpc(name, args);
      return Object.assign(request, { abortSignal: () => request });
    },
  };
  return { useSupabaseClient: () => client };
});

const clubId = "ef200000-0000-4000-8000-000000000001";
const destination = { id: "ef300000-0000-4000-8000-000000000001", name: "Giải đích TEST" };
const pilotId = "ef300000-0000-4000-8000-000000000002";
const open = () => render(<MemoryRouter>
  <OnlineSatellitePilotSetup clubId={clubId} destinations={[destination]} />
</MemoryRouter>);

beforeEach(() => rpc.mockReset());

it("keeps the setup hidden when club authority is denied", async () => {
  rpc.mockResolvedValueOnce({ data: false, error: null });
  open();
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Tạo link đăng ký thử" })).toBeNull();
  expect(rpc).toHaveBeenCalledExactlyOnceWith("can_create_online_satellite_pilot_v1", { p_club_id: clubId });
});

it("retries identical pilot settings with one request id, then shows the server link", async () => {
  rpc.mockResolvedValueOnce({ data: true, error: null })
    .mockRejectedValueOnce(new Error("TEST lost response"))
    .mockResolvedValueOnce({ data: { pilotId }, error: null });
  open();
  const create = await screen.findByRole("button", { name: "Tạo link đăng ký thử" });
  fireEvent.change(screen.getByLabelText("Giải đích thử"), { target: { value: destination.id } });
  fireEvent.change(screen.getByLabelText("Hạn đăng ký (giờ Việt Nam)"), { target: { value: "2099-04-18T22:30" } });
  fireEvent.change(screen.getByLabelText("Chip thử mỗi người"), { target: { value: "10000" } });
  fireEvent.change(screen.getByLabelText("Số ghế trên một bàn"), { target: { value: "9" } });
  fireEvent.click(create);
  expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác nhận được");
  expect(screen.queryByRole("link")).toBeNull();

  fireEvent.click(create);
  expect(await screen.findByRole("link")).toHaveAttribute("href", `/poker/satellite/${pilotId}`);
  expect(rpc).toHaveBeenCalledTimes(3);
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[2]);
  expect(rpc.mock.calls[2][1]).toMatchObject({
    p_club_id: clubId, p_destination_tournament_id: destination.id,
    p_registration_closes_at: "2099-04-18T15:30:00.000Z", p_starting_stack: 10000, p_seat_limit: 9,
  });
});
