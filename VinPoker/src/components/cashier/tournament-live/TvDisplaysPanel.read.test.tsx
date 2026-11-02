import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TvDisplaysPanel } from "./TvDisplaysPanel";

const state = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useLiveClock", () => ({ useLiveClock: () => 0 }));
vi.mock("./TvLivePreviewCard", () => ({ TvLivePreviewCard: () => null }));
vi.mock("./TvBrandingEditor", () => ({ TvBrandingEditor: () => null }));
vi.mock("@/lib/tv/displayAdminRpc", async (original) => ({
  ...await original<typeof import("@/lib/tv/displayAdminRpc")>(),
  listClubDisplays: state.read,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: state.rpc,
  channel: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return channel;
  },
  removeChannel: vi.fn(),
} }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TV operator initial read recovery", () => {
  it("shows an initial failure and recovers through the actual refresh button", async () => {
    state.read.mockResolvedValueOnce({ data: [], error: "LOCAL_READ_UNAVAILABLE" })
      .mockResolvedValueOnce({ data: [], error: null });
    render(<TvDisplaysPanel tournamentId="tour" tournamentName="Local tour" clubId="club" tournaments={[]} />);
    expect(await screen.findByText("LOCAL_READ_UNAVAILABLE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tournamentLive.tvDisplays.refresh" }));
    await waitFor(() => expect(screen.getByText("tournamentLive.tvDisplays.empty")).toBeInTheDocument());
    expect(screen.queryByText("LOCAL_READ_UNAVAILABLE")).not.toBeInTheDocument();
    expect(state.read).toHaveBeenCalledTimes(2);
  });

  it("reloads canonical data instead of retaining an optimistic assignment after a null save receipt", async () => {
    const row = {
      id: "display-a", club_id: "club", display_number: 1,
      name: "Local TV", zone: null, display_token: "LOCAL_TEST_ONLY",
      assigned_tournament_id: null, layout: "clock", announcement: null,
      theme: "dark", status: "paired", last_seen_at: null, paired_at: null,
      created_at: "2026-10-28T00:00:00Z",
    };
    state.read.mockResolvedValue({ data: [row], error: null });
    state.rpc.mockResolvedValueOnce({ data: null, error: null });
    render(<TvDisplaysPanel tournamentId="tour" tournamentName="Local tour" clubId="club" tournaments={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "tournamentLive.tvDisplays.assignThis" }));
    await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "tournamentLive.tvDisplays.assignThis" })).toBeEnabled();
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining("Không xác minh được"));
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
});
