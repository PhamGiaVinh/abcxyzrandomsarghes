import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import OnlineSatelliteRegistration from "./OnlineSatelliteRegistration";
import { safeSatelliteReturnTarget } from "@/lib/onlineSatelliteRoute";

const rpc = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: auth.signedIn ? { id: "player" } : null, session: null, loading: false }),
}));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    rpc: (name: string, args: unknown) => {
      const request = rpc(name, args);
      return Object.assign(request, { abortSignal: () => request });
    },
  };
  return { useSupabaseClient: () => client };
});

const pilotId = "ef300000-0000-4000-8000-000000000001";
const entryId = "ef300000-0000-4000-8000-000000000002";
const verified = {
  pilotId, destinationName: "Giải đích TEST",
  registrationClosesAt: "2026-11-20T10:00:00Z",
  startingStack: 10000, seatLimit: 9, entryId: null, acceptingEntries: true,
};
const open = () => render(<MemoryRouter initialEntries={[`/poker/satellite/${pilotId}`]}>
  <Routes><Route path="/poker/satellite/:pilotId" element={<OnlineSatelliteRegistration />} /></Routes>
</MemoryRouter>);

beforeEach(() => {
  rpc.mockReset();
  auth.signedIn = true;
});

it("keeps the exact pilot link through sign-in before reading pilot data", () => {
  auth.signedIn = false;
  open();
  const href = screen.getByRole("link", { name: "Đăng nhập" }).getAttribute("href")!;
  const target = new URL(href, "https://vinpoker.vercel.app");
  expect(target.pathname).toBe("/auth");
  expect(safeSatelliteReturnTarget(target.searchParams.get("next"))).toBe(`/poker/satellite/${pilotId}`);
  expect(rpc).not.toHaveBeenCalled();
});

it("only accepts an exact internal pilot path as the sign-in destination", () => {
  for (const target of [null, "//example.com", "/account", `/poker/satellite/${pilotId}?next=/ops`, `/poker/satellite/${pilotId}/extra`]) {
    expect(safeSatelliteReturnTarget(target)).toBeNull();
  }
});

it("shows a server-confirmed entry and suppresses a duplicate in-flight click", async () => {
  let finish!: (value: unknown) => void;
  rpc.mockResolvedValueOnce({ data: verified, error: null })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open();
  const register = await screen.findByRole("button", { name: "Đăng ký một ghế" });
  fireEvent.click(register);
  fireEvent.click(register);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenLastCalledWith("register_online_satellite_pilot_v1", { p_pilot_id: pilotId });
  expect(screen.queryByText("Máy chủ đã xác nhận đăng ký.")).toBeNull();
  await act(async () => finish({ data: { entryId, idempotent: false }, error: null }));
  expect(screen.getByText("Máy chủ đã xác nhận đăng ký.")).toBeVisible();
});

it("hides the pilot and the action when the server cannot verify scope", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: "SATELLITE_PILOT_NOT_AVAILABLE" } });
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác minh được quyền");
  expect(screen.queryByRole("button", { name: "Đăng ký một ghế" })).toBeNull();
  expect(screen.queryByText("Giải đích TEST")).toBeNull();
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_online_satellite_pilot_v1", { p_pilot_id: pilotId });
});
