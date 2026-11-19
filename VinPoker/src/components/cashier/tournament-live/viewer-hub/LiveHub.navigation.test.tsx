import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewerTab } from "./viewerTypes";
import type { PublicFreshness } from "./publicSnapshotTypes";
const { hubData, publicData, snapshotReads } = vi.hoisted(() => ({
  snapshotReads:vi.fn(),
  hubData: { tables: [], feed: [], storyFeed: [] },
  publicData: { networkError: false, snapshot: { access: "public", tournamentId: "tour", sections: { tables: { freshness: undefined as PublicFreshness | undefined, catalog: [{ tableId: "table-2", name: "Bàn 2", playerCount: 3, searchPlayers: [] }], items: [] } } } },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { publicSpectatorRealtimeV2: true, publicSpectatorLastHandHistory: true, liveEventTabs: true, liveViewerRPTShell: true, liveHandFeed: true } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("./useLiveTrackerData", () => ({ useLiveTrackerData: () => hubData }));
vi.mock("./usePublicSpectatorSnapshot", () => ({ usePublicSpectatorSnapshot: (...args:unknown[]) => {snapshotReads(...args);return publicData;} }));
vi.mock("@/components/tracker/useTournamentTableAppearance", () => ({ useTournamentTableAppearance: () => ({ data: undefined }) }));
vi.mock("./LiveHubHeader", () => ({ LiveHubHeader: ({ lastUpdated }: {lastUpdated?: Date | null}) => <output data-testid="table-publication">{lastUpdated?.toISOString() ?? "unverified"}</output> }));
vi.mock("./LiveStatsBar", () => ({ LiveStatsBar: () => null }));
vi.mock("./LiveStoryFeed", () => ({ LiveStoryFeed: () => null }));
vi.mock("./LiveUpdatesFeed", () => ({ LiveUpdatesFeed: () => null }));
vi.mock("./LiveHandFeed", () => ({ LiveHandFeed: ({ featuredTableId, initialTableHistory, variant }: { featuredTableId: string; initialTableHistory: boolean; variant: string }) => <output data-testid="feed">{variant}:{featuredTableId}:{String(initialTableHistory)}</output> }));
import { LiveHub } from "./LiveHub";
afterEach(() => {
  cleanup();
  publicData.networkError = false;
  publicData.snapshot.access = "public";
  publicData.snapshot.sections.tables.freshness = undefined;
});

describe("table history opens inside one selected table", () => {
  it("keeps the scoped publication time during an outage and clears it after revocation", () => {
    const first = "2026-11-19T19:00:00.000Z";
    const next = "2026-11-19T19:10:00.000Z";
    const tables = publicData.snapshot.sections.tables;
    const view = (tournamentId = "tour") => <LiveHub tournamentId={tournamentId} title="TEST" onShare={() => {}} />;
    publicData.networkError = true;
    const { rerender } = render(view());
    expect(screen.getByText(/chưa có dữ liệu bàn đã xác minh/)).toBeVisible();
    expect(screen.getByTestId("table-publication")).toHaveTextContent("unverified");

    publicData.networkError = false;
    tables.freshness = { sourceRevision: "1", projectedSourceRevision: "1", sourceChangedAt: first, publishedAt: first, serverCheckedAt: first, oldestPendingAt: null, state: "current" };
    rerender(view());
    expect(screen.getByTestId("table-publication")).toHaveTextContent(first);

    publicData.networkError = true;
    tables.freshness = { ...tables.freshness, state: "stale" };
    rerender(view());
    expect(screen.getByText(/đang giữ dữ liệu đã xác nhận gần nhất/)).toBeVisible();
    expect(screen.getByTestId("table-publication")).toHaveTextContent(first);

    publicData.networkError = false;
    tables.freshness = { ...tables.freshness, state: "current", serverCheckedAt: next };
    rerender(view());
    expect(screen.getByTestId("table-publication")).toHaveTextContent(first);

    tables.freshness = { ...tables.freshness, sourceRevision: "2", projectedSourceRevision: "2", publishedAt: next };
    rerender(view());
    expect(screen.getByTestId("table-publication")).toHaveTextContent(next);
    rerender(view("other-tour"));
    expect(screen.getByTestId("table-publication")).toHaveTextContent("unverified");
    publicData.snapshot.access = "revoked";
    rerender(view());
    expect(screen.getByTestId("table-publication")).toHaveTextContent("unverified");
  });
  it("keeps four event sections and opens the table-history child panel", () => {
    function App() {
      const [activeTab, onTabChange] = useState<ViewerTab>("hands");
      return <LiveHub tournamentId="tour" title="TEST" onShare={() => {}} activeTab={activeTab} onTabChange={onTabChange}><Viewer /></LiveHub>;
    }
    function Viewer({ selectedTableIdOverride, initialTablePanel }: { selectedTableIdOverride?: string | null; initialTablePanel?: string }) {
      return <output data-testid="viewer">{selectedTableIdOverride}:{initialTablePanel}</output>;
    }
    render(<App />);
    expect(screen.getByTestId("table-publication")).toHaveTextContent("unverified");
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Bàn LIVE" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(screen.getByRole("article", { name: "Bàn 2" })).getByRole("button", { name: "Lịch sử" }));
    expect(screen.getByTestId("viewer")).toHaveTextContent("table-2:history");
    expect(snapshotReads).toHaveBeenLastCalledWith('tour',true,[],false,true);
    fireEvent.click(screen.getByRole('button',{name:'Quay lại'}));
    expect(snapshotReads.mock.calls.at(-1)![3]).toBe(true);
  });
});
