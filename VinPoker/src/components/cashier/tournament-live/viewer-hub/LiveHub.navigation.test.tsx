import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewerTab } from "./viewerTypes";
const { hubData, publicData, snapshotReads } = vi.hoisted(() => ({
  snapshotReads:vi.fn(),
  hubData: { tables: [], feed: [], storyFeed: [] },
  publicData: { snapshot: { access: "public", sections: { tables: { catalog: [{ tableId: "table-2", name: "Bàn 2", playerCount: 3, searchPlayers: [] }], items: [] } } } },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { publicSpectatorRealtimeV2: true, publicSpectatorLastHandHistory: true, liveEventTabs: true, liveViewerRPTShell: true, liveHandFeed: true } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("./useLiveTrackerData", () => ({ useLiveTrackerData: () => hubData }));
vi.mock("./usePublicSpectatorSnapshot", () => ({ usePublicSpectatorSnapshot: (...args:unknown[]) => {snapshotReads(...args);return publicData;} }));
vi.mock("@/components/tracker/useTournamentTableAppearance", () => ({ useTournamentTableAppearance: () => ({ data: undefined }) }));
vi.mock("./LiveHubHeader", () => ({ LiveHubHeader: () => null }));
vi.mock("./LiveStatsBar", () => ({ LiveStatsBar: () => null }));
vi.mock("./LiveStoryFeed", () => ({ LiveStoryFeed: () => null }));
vi.mock("./LiveUpdatesFeed", () => ({ LiveUpdatesFeed: () => null }));
vi.mock("./LiveHandFeed", () => ({ LiveHandFeed: ({ featuredTableId, initialTableHistory, variant }: { featuredTableId: string; initialTableHistory: boolean; variant: string }) => <output data-testid="feed">{variant}:{featuredTableId}:{String(initialTableHistory)}</output> }));
import { LiveHub } from "./LiveHub";

describe("table history opens inside one selected table", () => {
  it("keeps four event sections and opens the table-history child panel", () => {
    function App() {
      const [activeTab, onTabChange] = useState<ViewerTab>("hands");
      return <LiveHub tournamentId="tour" title="TEST" onShare={() => {}} activeTab={activeTab} onTabChange={onTabChange}><Viewer /></LiveHub>;
    }
    function Viewer({ selectedTableIdOverride, initialTablePanel }: { selectedTableIdOverride?: string | null; initialTablePanel?: string }) {
      return <output data-testid="viewer">{selectedTableIdOverride}:{initialTablePanel}</output>;
    }
    render(<App />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Bàn LIVE" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(screen.getByRole("article", { name: "Bàn 2" })).getByRole("button", { name: "Lịch sử" }));
    expect(screen.getByTestId("viewer")).toHaveTextContent("table-2:history");
    expect(snapshotReads).toHaveBeenLastCalledWith('tour',true,[],false);
    fireEvent.click(screen.getByRole('button',{name:'Quay lại'}));
    expect(snapshotReads.mock.calls.at(-1)![3]).toBe(true);
  });
});
