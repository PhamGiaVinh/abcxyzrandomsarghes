import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import SeriesDecisionLogAdmin from "./SeriesDecisionLogAdmin";

const auth = vi.hoisted(() => ({
  loading: false, rolesLoading: true, isClubOwner: false, isClubAdmin: false, isAdmin: false,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/lib/featureFlags", () => ({
  FEATURES: { seriesDecisionLog: true, seriesDecisionPacketV1: true },
}));
vi.mock("@/components/series-intelligence/DecisionRoomV1", () => ({
  DecisionRoomV1: () => <p>Decision room fixture</p>,
}));
vi.mock("@/components/series-intelligence/SeriesCaptureConsole", () => ({
  SeriesCaptureConsole: () => null,
}));

function route() {
  return (
    <MemoryRouter initialEntries={["/club/admin/series-decision-log"]}>
      <Routes>
        <Route path="/" element={<p>Home fixture</p>} />
        <Route path="/club/admin/series-decision-log" element={<SeriesDecisionLogAdmin />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SeriesDecisionLogAdmin role lookup", () => {
  it.each([true, false])("waits for roles before deciding access (owner: %s)", async (owner) => {
    auth.rolesLoading = true;
    auth.isClubOwner = false;
    const view = render(route());
    expect(screen.queryByText("Home fixture")).not.toBeInTheDocument();
    expect(screen.queryByText("Decision room fixture")).not.toBeInTheDocument();

    auth.isClubOwner = owner;
    auth.rolesLoading = false;
    view.rerender(route());
    expect(await screen.findByText(owner ? "Decision room fixture" : "Home fixture")).toBeInTheDocument();
  });
});
