import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  flags: { multiDayTournaments: true, blindTemplates: true, blindDraftSuggest: true },
}));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: h.flags }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 'e9100000-0000-4000-8000-000000000001' }, isAdmin: true, isClubOwner: true }) }));
vi.mock("@/components/LiveStateEditor", () => ({ LiveStateEditor: () => null }));
vi.mock("@/components/cashier/tournament-live/BlindEditorPanel", () => ({ BlindEditorPanel: () => null }));
vi.mock("@/components/FomoPrice", () => ({ FomoPrice: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: h.rpc,
  from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
} }));

import { NewTournamentDialog } from "./TournamentManagerShared";

beforeEach(() => {
  localStorage.clear();
  h.rpc.mockReset().mockImplementation(async (_name, request) => ({ data: {
    ok: true, event_id: 'e9100000-0000-4000-8000-000000000041', final_tournament_id: 'e9100000-0000-4000-8000-000000000042',
    actor_id: request.p_expected_actor_id, club_id: request.p_club_id, request_id: request.p_request_id,
    flight_count: request.p_config.flight_count, level_count: request.p_levels.length,
  }, error: null }));
  h.flags.blindDraftSuggest = true;
  Element.prototype.scrollIntoView ||= () => {};
});

describe("blind draft in tournament setup", () => {
  it("keeps the reviewed levels local until the existing multi-day create request", async () => {
    const created = vi.fn();
    render(<NewTournamentDialog clubs={[{ id: "club", name: "Club" }]} defaultClubId="club" multiClub={false} onCreated={created} lockMode="multi" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^(Create Multi-day|Tạo Multi-day)$/ })); });
    const dialog = screen.getByRole("dialog");
    fireEvent.change(dialog.querySelector('input:not([type])') ?? dialog.querySelector('input[type="text"]')!, { target: { value: "Main Event" } });
    const dates = dialog.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(dates[0], { target: { value: "2026-10-01T12:00" } });
    fireEvent.change(dates[1], { target: { value: "2026-10-03T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    expect(h.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Row 1 big_blind" }), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Use reviewed draft" }));
    expect(h.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(h.rpc).toHaveBeenCalledWith("create_tournament_event_with_flights_v2", expect.objectContaining({
      p_levels: expect.arrayContaining([expect.objectContaining({ level_number: 1, big_blind: 600 })]),
    }));
  });

  it("hides the builder with its rollout flag off", async () => {
    h.flags.blindDraftSuggest = false;
    render(<NewTournamentDialog clubs={[]} defaultClubId="club" multiClub={false} onCreated={vi.fn()} lockMode="single" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tạo giải thường" })); });
    expect(screen.queryByRole("button", { name: "Generate draft" })).toBeNull();
  });

  it("invalidates a reviewed draft when starting stack changes", async () => {
    render(<NewTournamentDialog clubs={[]} defaultClubId="club" multiClub={false} onCreated={vi.fn()} lockMode="multi" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^(Create Multi-day|Tạo Multi-day)$/ })); });
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Use reviewed draft" }));
    expect(screen.getByText(/Reviewed draft/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Starting stack"), { target: { value: "30000" } });
    expect(screen.queryByText(/Reviewed draft/)).toBeNull();
  });
});
