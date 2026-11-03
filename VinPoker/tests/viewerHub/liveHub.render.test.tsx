import { describe, it, expect, vi, beforeEach } from "vitest";
import { lazy, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LiveHubHeader } from "@/components/cashier/tournament-live/viewer-hub/LiveHubHeader";
import { FeaturedTableCard } from "@/components/cashier/tournament-live/viewer-hub/FeaturedTableCard";

// Isolate LiveHub from its supabase-backed data hook — the hub composition is what
// we assert here, with stubbed hub data.
vi.mock("@/components/cashier/tournament-live/viewer-hub/useLiveTrackerData", () => {
  const data = {
    liveTableCount: 2,
    tables: [
      { tableId: "tA", name: "Bàn 1", playerCount: 8 },
      { tableId: "tB", name: "Bàn 2", playerCount: 6 },
    ],
    feed: [{ id: "1", seatNumber: 2, playerName: "Bình", label: "ALL-IN 5k", kind: "allin" }],
    chipLeader: null,
    storyFeed: [],
    activeHandTableId: "tA",
    loading: false,
  };
  return { useLiveTrackerData: () => data };
});

vi.mock("@/components/cashier/tournament-live/viewer-hub/useCompletedHandsFeed", () => ({
  useCompletedHandsFeed: () => ({ items: [], loading: false, hasMore: false, loadMore: vi.fn() }),
}));

vi.mock("@/components/cashier/tournament-live/viewer-hub/usePublicSpectatorSnapshot", () => ({
  usePublicSpectatorSnapshot: () => ({ snapshot: null, loading: false, networkError: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
} }));

// A MUTABLE copy of the real flags so we can flip liveEventTabs per test (ON = new
// 5-tab layout, OFF = legacy stacked felt) while keeping every other real flag.
vi.mock("@/lib/featureFlags", async (orig) => {
  const actual = (await orig()) as { FEATURES: Record<string, unknown> };
  return { ...actual, FEATURES: { ...actual.FEATURES } };
});

import { LiveHub } from "@/components/cashier/tournament-live/viewer-hub/LiveHub";
import { FEATURES } from "@/lib/featureFlags";

const noop = () => {};
function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const wrap = (node: ReactNode) => renderToStaticMarkup(<QueryProvider><MemoryRouter>{node}</MemoryRouter></QueryProvider>);

beforeEach(() => {
  cleanup();
  (FEATURES as Record<string, unknown>).liveEventTabs = true;
  (FEATURES as Record<string, unknown>).liveHandFeed = true;
  (FEATURES as Record<string, unknown>).liveViewerRPTShell = false;
  (FEATURES as Record<string, unknown>).liveSpotlightPosts = false;
  // This fixture supplies legacy feeds; realtime projection composition has
  // its own LiveHub.navigation.test.tsx coverage and canonical snapshot fixture.
  (FEATURES as Record<string, unknown>).publicSpectatorRealtimeV2 = false;
});

describe("Viewer Event Hub — header / featured card", () => {
  it("LiveHubHeader shows live badge, title, club link, share", () => {
    const html = wrap(<LiveHubHeader title="Main Event" clubName="CLB Sài Gòn" clubId="c1" onShare={noop} />);
    expect(html).toContain("TRỰC TIẾP");
    expect(html).toContain("Main Event");
    expect(html).toContain("CLB Sài Gòn");
    expect(html).toContain("/club/c1");
    expect(html).toContain("Chia sẻ");
  });

  it("RPT header shows reliable event metadata without changing the legacy header", () => {
    const html = wrap(
      <LiveHubHeader
        rpt
        title="Main Event"
        liveTableCount={4}
        guarantee={50_000_000}
        buyIn={2_000_000}
        startingStack={30_000}
        playersRemaining={27}
        lastUpdated={new Date()}
        onShare={noop}
      />,
    );
    expect(html).toContain("Main Event");
    expect(html).toContain("50M");
    expect(html).toContain("2M");
    expect(html).toContain("30k");
    expect(html).toContain("27");
    expect(html).toContain("Cập nhật");
  });

  it("FeaturedTableCard frames children + badge + footer", () => {
    const html = renderToStaticMarkup(
      <FeaturedTableCard badge="TRỰC TIẾP • BÀN 1" footer={<span>Xem tất cả bàn</span>}>
        <div>FELT_HERE</div>
      </FeaturedTableCard>
    );
    expect(html).toContain("TRỰC TIẾP • BÀN 1");
    expect(html).toContain("FELT_HERE");
    expect(html).toContain("Xem tất cả bàn");
  });
});

describe("LiveHub — event-tabs layout (liveEventTabs ON, legacy feed)", () => {
  it("does not load viewer code on the overview and keeps the event header while a replay chunk loads", async () => {
    let finish!: (value: { default: (props: { spectator?: boolean; initialReplayHandNumber?: number | null }) => ReactNode }) => void;
    const load = vi.fn(() => new Promise<{ default: (props: { spectator?: boolean; initialReplayHandNumber?: number | null }) => ReactNode }>(resolve => { finish = resolve; }));
    const Viewer = lazy(load);
    const hub = (hand: number | null) => <QueryProvider><MemoryRouter>
      <LiveHub tournamentId="t1" title="Daily Turbo" initialReplayHandNumber={hand} onShare={noop}><Viewer /></LiveHub>
    </MemoryRouter></QueryProvider>;
    const view = render(hub(null));
    expect(load).not.toHaveBeenCalled();
    view.rerender(hub(7));
    expect(view.getByText("Daily Turbo")).toBeInTheDocument();
    expect(await view.findByRole("status")).toHaveTextContent("Đang mở bàn");
    finish({ default: ({ spectator, initialReplayHandNumber }) => <div>FELT {String(spectator)} #{initialReplayHandNumber}</div> });
    expect(await view.findByText("FELT true #7")).toBeInTheDocument();
  });

  it("renders the 5 tabs and does NOT mount the felt at rest (default = Cập nhật)", () => {
    const html = wrap(
      <LiveHub tournamentId="t1" title="Daily Turbo" onShare={noop}>
        <div>LIVE_TABLE_VIEW</div>
      </LiveHub>
    );
    ["Cập nhật", "Lịch sử ván", "Giải thưởng", "Cấu trúc", "Hình ảnh"].forEach((label) => expect(html).toContain(label));
    expect(html).not.toContain("LIVE_TABLE_VIEW"); // felt is on-demand, not mounted by default
    expect(html).toContain("ALL-IN 5k"); // Cập nhật is the active tab → its feed renders
    expect(html).toContain("Bàn đang chơi"); // tappable live-table card
  });

  it("a ?hand deep-link opens the replay felt with the spectator + hand props injected", () => {
    const Viewer = ({ spectator, initialReplayHandNumber }: { spectator?: boolean; initialReplayHandNumber?: number | null }) => (
      <div>FELT spec:{String(spectator)} hand:{initialReplayHandNumber}</div>
    );
    const html = wrap(
      <LiveHub tournamentId="t1" title="X" initialReplayHandNumber={7} onShare={noop}>
        <Viewer />
      </LiveHub>
    );
    expect(html).toContain("PHÁT LẠI VÁN"); // replay badge
    expect(html).toContain("FELT spec:true hand:7");
    expect(html).not.toContain("Lịch sử ván"); // tabs hidden while watching
  });

  it("flag OFF does not emit any RPT-shell marker", () => {
    const html = wrap(
      <LiveHub tournamentId="t1" title="Legacy event" activeTab="hands" onShare={noop}>
        <div>VIEWER</div>
      </LiveHub>,
    );
    expect(html).not.toContain("viewer-rpt-shell");
    expect(html).not.toContain("viewer-rpt-hand-card");
  });

  it("RPT shell uses the controlled URL tab and maps history back to hands", () => {
    (FEATURES as Record<string, unknown>).liveViewerRPTShell = true;
    const onTabChange = vi.fn();
    const view = render(
      <QueryProvider><MemoryRouter>
        <LiveHub tournamentId="t1" title="Main Event" activeTab="updates" onTabChange={onTabChange} onShare={noop}>
          <div>VIEWER</div>
        </LiveHub>
      </MemoryRouter></QueryProvider>,
    );

    expect(view.getByTestId("viewer-rpt-shell")).toBeTruthy();
    const history = view.getByRole("tab", { name: /Lịch sử ván/i });
    expect(history.className).toContain("min-h-11");
    fireEvent.mouseDown(history, { button: 0, ctrlKey: false });
    expect(onTabChange).toHaveBeenCalledWith("hands");
  });

  it("RPT shell lets the felt size itself to its container and retains orientation controls", () => {
    (FEATURES as Record<string, unknown>).liveViewerRPTShell = true;
    const Viewer = ({ orientationOverride }: { orientationOverride?: "landscape" | "portrait" | null }) => (
      <div>ORIENT:{orientationOverride ?? 'auto'}</div>
    );
    const html = wrap(
      <LiveHub tournamentId="t1" title="Main Event" initialReplayHandNumber={7} onShare={noop}>
        <Viewer />
      </LiveHub>,
    );
    expect(html).toContain("ORIENT:auto");
    expect(html).toContain("Ngang");
    expect(html).toContain("Dọc");
    expect(html).toContain("4 màu");
  });
});

describe("LiveHub — legacy stacked layout (liveEventTabs OFF) stays intact", () => {
  it("renders the felt + featured badge + orientation toggle", () => {
    (FEATURES as Record<string, unknown>).liveEventTabs = false;
    const html = wrap(
      <LiveHub tournamentId="t1" title="Daily Turbo" onShare={noop}>
        <div>LIVE_TABLE_VIEW</div>
      </LiveHub>
    );
    expect(html).toContain("LIVE_TABLE_VIEW");
    expect(html).toContain("BÀN ĐANG DIỄN RA");
    expect(html).toContain("Ngang");
    expect(html).toContain("Dọc");
  });

  it("injects orientation + spectator overrides into the child viewer", () => {
    (FEATURES as Record<string, unknown>).liveEventTabs = false;
    const Viewer = ({ orientationOverride, spectator }: { orientationOverride?: "landscape" | "portrait" | null; spectator?: boolean }) => (
      <div>ORIENT:{orientationOverride ?? 'auto'}|SPECTATOR:{String(spectator)}</div>
    );
    const html = wrap(
      <LiveHub tournamentId="t1" title="X" onShare={noop}>
        <Viewer />
      </LiveHub>
    );
    expect(html).toContain("ORIENT:auto");
    expect(html).toContain("SPECTATOR:true");
  });
});
