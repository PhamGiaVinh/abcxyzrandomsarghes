import { useTournamentTableAppearance } from "@/components/tracker/useTournamentTableAppearance";
// Public "Live Poker Event Hub" shell (Viewer Event Hub).
// Composes the hub header + stats bar around the spectator content. Presentational
// only; the caller supplies tournament meta and the live view (as `children`), so
// TournamentLiveView / LiveFelt / operator flow are untouched (zero felt-data
// fetching here — only the isolated useLiveTrackerData hook for the feeds/stats).
//
// `liveEventTabs` ON (RPT-Live style): a 5-tab event page (Cập nhật / Lịch sử ván /
// Giải thưởng / Cấu trúc / Hình ảnh). The felt mounts ON DEMAND — tap "Bàn đang
// chơi" to watch live, or a hand to replay. OFF: today's stacked layout (felt
// always shown), byte-identical.

import { cloneElement, isValidElement, Suspense, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { TrackerViewerCardProvider, TrackerCardStyleToggle } from "@/components/tracker/TrackerCardStyle";
import { useTranslation } from "react-i18next";
import { Activity, History, Trophy, Layers3, Image as ImageIcon, ArrowLeft, Share2, X, Radio, Crown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveHubHeader } from "./LiveHubHeader";
import { LiveStatsBar } from "./LiveStatsBar";
import { FeaturedTableCard } from "./FeaturedTableCard";
import { LiveTablesMap } from "./LiveTablesMap";
import { LiveStoryFeed } from "./LiveStoryFeed";
import { LiveUpdatesFeed } from "./LiveUpdatesFeed";
import { LiveHandFeed } from "./LiveHandFeed";
import { OrientationToggle } from "./OrientationToggle";
import { PrizesPanel } from "./PrizesPanel";
import { StructurePanel } from "./StructurePanel";
import { PhotosPanel } from "./PhotosPanel";
import { useLiveTrackerData } from "./useLiveTrackerData";
import { usePublicSpectatorSnapshot } from "./usePublicSpectatorSnapshot";
import { RealtimeRankingPanel } from "./RealtimeRankingPanel";
import { RealtimePayoutPanel } from "./RealtimePayoutPanel";
import { RealtimeTablesGrid } from "./RealtimeTablesGrid";
import { useIsMobile } from "@/hooks/use-mobile";
import { FEATURES } from "@/lib/featureFlags";
import { panelToViewerTab, viewerTabToPanel } from "./viewerUrlState";
import type { TournamentPostViewModel, ViewerTab } from "./viewerTypes";
import type { ReplayTarget } from "./replayTarget";

type Orientation = "landscape" | "portrait";
type Watch = { kind: "live" | "history"; tableId: string } | { kind: "replay"; target: ReplayTarget } | null;
type ViewerProps = { orientationOverride?: Orientation; spectator?: boolean; selectedTableIdOverride?: string | null; initialReplayTarget?: ReplayTarget | null; initialReplayHandNumber?: number | null; initialTablePanel?: "felt" | "history"; onReplayTargetChange?: (target: ReplayTarget) => void };

export interface LiveHubProps {
  tournamentId: string;
  title: string;
  clubName?: string | null;
  clubId?: string | null;
  subtitle?: string | null;
  /** Tournament prize pool (VND) — from `tournaments.prize_pool`; null when unset. */
  prizePool?: number | null;
  /** Players still alive — from `tournaments.players_remaining`; null when unset. */
  playersRemaining?: number | null;
  /** Live level number — highlights the current row in the Cấu trúc tab. */
  currentLevel?: number | null;
  /** Event info chips for the header (GTD / buy-in / starting stack). */
  guarantee?: number | null;
  buyIn?: number | null;
  startingStack?: number | null;
  onShare: () => void;
  /** Canonical deep-link target. UUID is authoritative over display hand number. */
  initialReplayTarget?: ReplayTarget | null;
  /** Deprecated prop kept for legacy callers while their URL is upgraded. */
  initialReplayHandNumber?: number | null;
  /** Hand-feed "Xem ván" → open the canonical replay target. */
  onViewHand?: (target: ReplayTarget) => void;
  onReplayTargetChange?: (target: ReplayTarget) => void;
  /** Hand-feed "Chia sẻ" → share the canonical replay target. */
  onShareHand?: (target: ReplayTarget) => void;
  /** URL-backed tab state for the new focus shell. */
  activeTab?: ViewerTab;
  onTabChange?: (tab: ViewerTab) => void;
  /** Optional editorial view-models. No query is made by this component. */
  editorialPosts?: TournamentPostViewModel[];
  focusedPostId?: string | null;
  onSharePost?: (postId: string) => void;
  /** Clear the ?hand param when leaving the felt (back to the tabs). */
  onCloseHand?: () => void;
  /** The live table view (e.g. <TournamentLiveView/>). */
  children: ReactNode;
}

export function LiveHub(props: LiveHubProps) {
  return <TrackerViewerCardProvider><LiveHubContent {...props} /></TrackerViewerCardProvider>;
}

function LiveHubContent({
  tournamentId, title, clubName, clubId, subtitle, prizePool, playersRemaining, currentLevel,
  guarantee, buyIn, startingStack,
  onShare, initialReplayTarget = null, initialReplayHandNumber = null, onViewHand, onReplayTargetChange, onShareHand,
  activeTab = "updates", onTabChange, editorialPosts = [], focusedPostId = null, onSharePost,
  onCloseHand, children,
}: LiveHubProps) {
  // Isolated hub data (count / all-tables / feed / chip leader). Does NOT touch
  // TournamentLiveView — the featured felt still renders the real viewer when watched.
  const realtimeEnabled = FEATURES.publicSpectatorRealtimeV2;
  const lastHandHistoryEnabled = realtimeEnabled && FEATURES.publicSpectatorLastHandHistory;
  const requestedReplayTarget = initialReplayTarget ?? (initialReplayHandNumber != null
    ? { handId: null, tableId: null, handNumber: initialReplayHandNumber }
    : null);
  const requestedReplayKey = requestedReplayTarget
    ? `${requestedReplayTarget.handId ?? "legacy"}:${requestedReplayTarget.tableId ?? ""}:${requestedReplayTarget.handNumber ?? ""}`
    : "";
  const [watch, setWatch] = useState<Watch>(requestedReplayTarget ? { kind: "replay", target: requestedReplayTarget } : null);
  const watchingTable=FEATURES.liveEventTabs&&watch!==null;
  const [visibleTableIds, setVisibleTableIds] = useState<string[]>([]);
  const [historyTableId, setHistoryTableId] = useState<string | null>(null);
  const appearance = useTournamentTableAppearance(tournamentId);
  const { liveTableCount, tables, feed, chipLeader, storyFeed, activeHandTableId } = useLiveTrackerData(tournamentId, !realtimeEnabled);
  const { snapshot: publicSnapshot, loading: publicSnapshotLoading, networkError } = usePublicSpectatorSnapshot(
    tournamentId,
    realtimeEnabled,
    realtimeEnabled ? watchingTable?[]:visibleTableIds : tables.map((table) => table.tableId),
    !watchingTable,
  );
  const realtimeTables = publicSnapshot?.access === "public"
    ? (publicSnapshot.sections.tables?.catalog ?? []).map((table) => ({ tableId: table.tableId, name: table.name, playerCount: table.playerCount }))
    : [];
  const displayedTables = realtimeEnabled ? realtimeTables : tables;
  const displayedLiveTableCount = realtimeEnabled
    ? (publicSnapshot?.sections.tables?.catalog?.length ?? displayedTables.length)
    : liveTableCount;
  const { t } = useTranslation();

  // "Cập nhật … trước" — stamp the moment the hub data last changed (each poll for a
  // live event re-stamps, so the header stays fresh; a finished event freezes).
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => { setLastUpdated(new Date()); }, [feed, publicSnapshot, tables, storyFeed]);

  // Public table-map picker (legacy stacked layout): which table to feature.
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const featuredTableId = selectedTableId ?? activeHandTableId;
  const tableNames = useMemo(
    () => Object.fromEntries(displayedTables.map((table) => [table.tableId, table.name])),
    [displayedTables],
  );
  const rptChipLeader = chipLeader && chipLeader.seatNumber > 0
    ? {
        ...chipLeader,
        playerName: /^[a-f0-9]{6}$/i.test(chipLeader.playerName) || /^[a-f0-9-]{24,}$/i.test(chipLeader.playerName)
          ? t("liveHub.handFeed.unknownPlayer", "Người chơi")
          : chipLeader.playerName,
      }
    : null;

  // Orientation: default to the device, but let the viewer flip Ngang/Dọc.
  const isMobile = useIsMobile();
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  const effectiveOrientation: Orientation = orientation ?? (isMobile ? "portrait" : "landscape");
  const viewerOrientation = orientation ?? undefined;

  // Event-tabs: which felt (if any) the viewer is actively watching. null → tabs.
  // Seeded synchronously from a deep-linked hand so it opens its replay
  // on first paint; the effect re-syncs if the deep-link changes while mounted.
  useEffect(() => {
    if (requestedReplayTarget) setWatch({ kind: "replay", target: requestedReplayTarget });
  // The URL key is deliberate: parent renders may create equivalent target objects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedReplayKey]);
  useEffect(() => {
    setVisibleTableIds([]);
    setHistoryTableId(null);
  }, [tournamentId]);
  useEffect(() => {
    if (realtimeEnabled && publicSnapshot?.access === "revoked") setWatch(null);
  }, [publicSnapshot?.access, realtimeEnabled]);

  const closeWatch = () => {
    setWatch(null);
    onCloseHand?.();
  };

  // Clone the child viewer with presentational overrides (orientation + spectator,
  // plus the table/hand to show). Guard: only inject into component children.
  const cloneViewer = (extra: ViewerProps): ReactNode =>
    isValidElement(children) && typeof children.type !== "string"
      ? <Suspense fallback={<p role="status" className="p-6 text-center text-sm text-muted-foreground">Đang mở bàn và trình xem ván…</p>}>
          {cloneElement(children as ReactElement<ViewerProps>, { key: `${tournamentId}:${extra.selectedTableIdOverride ?? "default"}:${extra.initialTablePanel ?? "felt"}`, orientationOverride: viewerOrientation, spectator: true, ...extra })}
        </Suspense>
      : children;

  // ── Legacy stacked layout (flag OFF) — byte-identical to before ────────────────
  if (!FEATURES.liveEventTabs) {
    const viewer = cloneViewer({ selectedTableIdOverride: selectedTableId, initialReplayTarget: requestedReplayTarget, initialReplayHandNumber, onReplayTargetChange });
    return (
      <div className="space-y-3 sm:space-y-4 animate-in fade-in-0 duration-500 motion-reduce:animate-none">
        <LiveHubHeader title={title} clubName={clubName} clubId={clubId} subtitle={subtitle} liveTableCount={displayedLiveTableCount} guarantee={guarantee} buyIn={buyIn} startingStack={startingStack} lastUpdated={lastUpdated} onShare={onShare} />
        <LiveStatsBar prizePool={prizePool} playersRemaining={playersRemaining} chipLeader={chipLeader} />
        <LiveTablesMap tables={displayedTables} activeTableId={featuredTableId} onSelect={setSelectedTableId} />
        <FeaturedTableCard
          badge={t("liveHub.featured.badge", "TRỰC TIẾP • BÀN ĐANG DIỄN RA")}
          headerAction={<div className="flex flex-wrap gap-2"><TrackerCardStyleToggle /><OrientationToggle value={effectiveOrientation} onChange={setOrientation} /></div>}
        >
          {viewer}
        </FeaturedTableCard>
        {FEATURES.liveHandFeed ? (
          <>
            <LiveUpdatesFeed feed={feed} />
            <LiveHandFeed tournamentId={tournamentId} featuredTableId={featuredTableId} onViewHand={onViewHand} onShare={onShareHand} />
          </>
        ) : (
          <>
            <LiveStoryFeed items={storyFeed} />
            <LiveUpdatesFeed feed={feed} />
          </>
        )}
      </div>
    );
  }

  // ── Event-tabs layout (flag ON) ────────────────────────────────────────────────
  // Hand-feed opens a UUID-backed replay and keeps its canonical URL in sync.
  const handleViewHand = (target: ReplayTarget) => {
    setWatch({ kind: "replay", target });
    onViewHand?.(target);
  };

  const watchViewer = watch
    ? cloneViewer(
        watch.kind === "replay"
          ? {
              initialReplayTarget: watch.target,
              // Preserve callers still using the number-only replay contract.
              initialReplayHandNumber: watch.target.handId ? null : watch.target.handNumber,
              selectedTableIdOverride: null,
              onReplayTargetChange,
            }
          : { initialReplayTarget: null, initialReplayHandNumber: null, selectedTableIdOverride: watch.tableId, initialTablePanel: watch.kind === "history" ? "history" : "felt" },
      )
    : null;

  const TAB_TRIGGER =
    "relative rounded-none border-b-2 border-transparent bg-transparent px-2.5 py-2 text-[12px] font-semibold text-muted-foreground shadow-none data-[state=active]:border-[hsl(var(--poker-gold))] data-[state=active]:bg-transparent data-[state=active]:text-[hsl(var(--poker-gold))] data-[state=active]:shadow-none sm:px-3.5 sm:text-sm";

  if (!FEATURES.liveViewerRPTShell) return (
    <div className="space-y-3 sm:space-y-4 animate-in fade-in-0 duration-500 motion-reduce:animate-none">
      <LiveHubHeader title={title} clubName={clubName} clubId={clubId} subtitle={subtitle} liveTableCount={displayedLiveTableCount} onShare={onShare} />
      <LiveStatsBar prizePool={prizePool} playersRemaining={playersRemaining} chipLeader={chipLeader} />

      {realtimeEnabled && publicSnapshot?.access === "revoked" ? null : watch ? (
        <div className="space-y-2 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
          <button
            type="button"
            onClick={closeWatch}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-emerald-500/40"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("liveHub.tabs.back", "Quay lại")}
          </button>
          <FeaturedTableCard
            badge={watch.kind === "replay" ? t("liveHub.watch.replay", "PHÁT LẠI VÁN") : t("liveHub.featured.badge", "TRỰC TIẾP • BÀN ĐANG DIỄN RA")}
            headerAction={<div className="flex flex-wrap gap-2"><TrackerCardStyleToggle /><OrientationToggle value={effectiveOrientation} onChange={setOrientation} /></div>}
          >
            {watchViewer}
          </FeaturedTableCard>
        </div>
      ) : (
        <Tabs defaultValue="updates" className="w-full">
          <div className="-mx-2 overflow-x-auto px-2 pb-px">
            <TabsList className="inline-flex h-auto w-max min-w-full justify-start gap-0.5 border-b border-border/40 bg-transparent p-0">
              <TabsTrigger value="updates" className={TAB_TRIGGER}><Activity className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.updates", "Cập nhật")}</TabsTrigger>
              <TabsTrigger value="history" className={TAB_TRIGGER}><History className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.handHistory", "Lịch sử ván")}</TabsTrigger>
              <TabsTrigger value="prizes" className={TAB_TRIGGER}><Trophy className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.prizes", "Giải thưởng")}</TabsTrigger>
              <TabsTrigger value="structure" className={TAB_TRIGGER}><Layers3 className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.structure", "Cấu trúc")}</TabsTrigger>
              <TabsTrigger value="photos" className={TAB_TRIGGER}><ImageIcon className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.photos", "Hình ảnh")}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="updates" className="mt-3 space-y-3 sm:space-y-4">
            <LiveTablesMap
              tables={displayedTables}
              activeTableId={null}
              onSelect={(id) => setWatch({ kind: "live", tableId: id })}
              minToShow={1}
              title={t("liveHub.watch.title", "Bàn đang chơi")}
            />
            <LiveStoryFeed items={storyFeed} />
            <LiveUpdatesFeed feed={feed} />
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            <LiveHandFeed tournamentId={tournamentId} featuredTableId={activeHandTableId} onViewHand={handleViewHand} onShare={onShareHand} />
          </TabsContent>

          <TabsContent value="prizes" className="mt-3">
            <PrizesPanel tournamentId={tournamentId} />
          </TabsContent>

          <TabsContent value="structure" className="mt-3">
            <StructurePanel tournamentId={tournamentId} currentLevel={currentLevel} />
          </TabsContent>

          <TabsContent value="photos" className="mt-3">
            <PhotosPanel tournamentId={tournamentId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );

  const RPT_TAB_TRIGGER =
    "min-h-11 min-w-[7.5rem] flex-1 shrink-0 snap-start rounded-none border-b-2 border-transparent bg-transparent px-3 text-xs font-bold text-muted-foreground shadow-none transition data-[state=active]:border-[hsl(var(--viewer-neon))] data-[state=active]:bg-[hsl(var(--viewer-neon)_/_0.08)] data-[state=active]:text-[hsl(var(--viewer-neon))] data-[state=active]:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-w-0 sm:px-4 sm:text-sm";
  const panelValue = realtimeEnabled && activeTab === "photos" ? "updates" : viewerTabToPanel(activeTab);

  return (
    <div data-testid="viewer-rpt-shell" data-viewer-shell="rpt" className="min-w-0 space-y-3 animate-in fade-in-0 duration-500 motion-reduce:animate-none sm:space-y-4">
      <LiveHubHeader
        title={title}
        clubName={clubName}
        clubId={clubId}
        subtitle={subtitle}
        liveTableCount={displayedLiveTableCount}
        guarantee={guarantee}
        buyIn={buyIn}
        startingStack={startingStack}
        playersRemaining={playersRemaining}
        lastUpdated={lastUpdated}
        rpt
        onShare={onShare}
      />
      <LiveStatsBar prizePool={prizePool} playersRemaining={playersRemaining} chipLeader={rptChipLeader} rpt />
      <div className="flex flex-wrap justify-end gap-2">
        <TrackerCardStyleToggle />
        {watch && <OrientationToggle value={effectiveOrientation} onChange={setOrientation} />}
      </div>
      {realtimeEnabled && networkError && publicSnapshot?.access !== "revoked" && (
        <div role="status" className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Mất kết nối tạm thời — đang giữ dữ liệu đã xác nhận gần nhất.
        </div>
      )}
      {realtimeEnabled && publicSnapshot?.access === "revoked" && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-8 text-center text-sm text-muted-foreground">
          Giải này không còn được công khai.
        </div>
      )}

      {realtimeEnabled && publicSnapshot?.access === "revoked" ? null : watch ? (
        <section className="min-w-0 space-y-3 animate-in fade-in-0 duration-300 motion-reduce:animate-none" aria-label={t("liveHub.watch.viewer", "Trình xem ván đấu")}>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/55 bg-card/55 p-2 sm:p-2.5">
            <button
              type="button"
              onClick={closeWatch}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/65 bg-background/35 px-3 text-xs font-bold text-foreground transition hover:border-[hsl(var(--viewer-neon)_/_0.48)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("liveHub.tabs.back", "Quay lại")}
            </button>

            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--viewer-neon))]">
                {watch.kind === "replay" ? t("liveHub.tabs.handHistory", "Lịch sử ván") : watch.kind === "history" ? "Lịch sử bàn chơi" : t("liveHub.watch.title", "Bàn đang chơi")}
              </p>
              <p className="truncate text-sm font-semibold text-foreground">
                {watch.kind === "replay"
                  ? watch.target.handNumber != null
                    ? t("liveHub.watch.handNumber", "Ván #{{n}}", { n: watch.target.handNumber })
                    : t("liveHub.watch.replay", "PHÁT LẠI VÁN")
                  : tableNames[watch.tableId] || t("liveHub.watch.liveTable", "Bàn trực tiếp")}
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => watch.kind === "replay" ? onShareHand?.(watch.target) : onShare()}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-border/65 px-3 text-xs font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("liveHub.header.share", "Chia sẻ")}
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t("liveHub.header.share", "Chia sẻ")}</span>
              </button>
              <button
                type="button"
                onClick={closeWatch}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border/65 text-muted-foreground transition hover:border-destructive/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("liveHub.watch.close", "Đóng trình xem")}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <FeaturedTableCard
            badge={watch.kind === "replay" ? t("liveHub.watch.replay", "PHÁT LẠI VÁN") : watch.kind === "history" ? "LỊCH SỬ BÀN CHƠI" : t("liveHub.featured.badge", "TRỰC TIẾP • BÀN ĐANG DIỄN RA")}
            rpt
          >
            {watchViewer}
          </FeaturedTableCard>
        </section>
      ) : (
        <Tabs value={panelValue} onValueChange={(value) => {
          if (realtimeEnabled && value === "history" && panelValue !== "history") setHistoryTableId(null);
          onTabChange?.(panelToViewerTab(value));
        }} className="min-w-0 w-full">
          <div className="sticky top-[env(safe-area-inset-top)] z-30 -mx-3 border-y border-border/45 bg-background/88 px-3 backdrop-blur-xl sm:-mx-1 sm:rounded-2xl sm:border sm:px-1">
            <div className="relative after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-8 after:bg-gradient-to-l after:from-background after:to-transparent sm:after:hidden">
              <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsList className="inline-flex h-12 w-max min-w-full snap-x snap-mandatory justify-start gap-0 bg-transparent p-0 [&>[role=tab]]:flex-1">
                  {realtimeEnabled ? <>
                    <TabsTrigger value="updates" className={RPT_TAB_TRIGGER}><Activity className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.updates", "Cập nhật")}</TabsTrigger>
                    <TabsTrigger value="history" className={RPT_TAB_TRIGGER}><Radio className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.tablesLive", "Bàn LIVE")}</TabsTrigger>
                    <TabsTrigger value="prizes" className={RPT_TAB_TRIGGER}><Crown className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.prizes", "Giải thưởng")}</TabsTrigger>
                    <TabsTrigger value="structure" className={RPT_TAB_TRIGGER}><Layers3 className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.structure", "Cấu trúc")}</TabsTrigger>
                  </> : <>
                    <TabsTrigger value="updates" className={RPT_TAB_TRIGGER}><Activity className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.updates", "Cập nhật")}</TabsTrigger>
                    <TabsTrigger value="history" className={RPT_TAB_TRIGGER}><History className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.handHistory", "Lịch sử ván")}</TabsTrigger>
                    <TabsTrigger value="prizes" className={RPT_TAB_TRIGGER}><Trophy className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.prizes", "Giải thưởng")}</TabsTrigger>
                    <TabsTrigger value="structure" className={RPT_TAB_TRIGGER}><Layers3 className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.structure", "Cấu trúc")}</TabsTrigger>
                    <TabsTrigger value="photos" className={RPT_TAB_TRIGGER}><ImageIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("liveHub.tabs.photos", "Hình ảnh")}</TabsTrigger>
                  </>}
                </TabsList>
              </div>
            </div>
          </div>

          <TabsContent value="updates" className="mt-3 min-w-0 focus-visible:outline-none sm:mt-4">
            <div className={`grid min-w-0 gap-4 ${realtimeEnabled ? "" : "xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)] xl:items-start"}`}>
              {!realtimeEnabled && <aside className={`min-w-0 space-y-4 xl:col-start-2 xl:row-start-1 ${FEATURES.liveHandFeed ? "" : "xl:col-span-2 xl:col-start-1"}`}>
                {!realtimeEnabled && <LiveTablesMap
                  tables={displayedTables}
                  activeTableId={null}
                  onSelect={(id) => setWatch({ kind: "live", tableId: id })}
                  minToShow={1}
                  title={t("liveHub.watch.title", "Bàn đang chơi")}
                  rpt
                />}
                <LiveStoryFeed items={storyFeed} rpt />
                <LiveUpdatesFeed feed={feed} rpt />
              </aside>}
              {FEATURES.liveHandFeed && (
                <div className="min-w-0 xl:col-start-1 xl:row-start-1">
                  <LiveHandFeed
                    tournamentId={tournamentId}
                    key={historyTableId ?? "all-updates"}
                    featuredTableId={historyTableId ?? activeHandTableId}
                    initialTableHistory={historyTableId !== null}
                    variant="updates"
                    tableNames={tableNames}
                    editorialPosts={editorialPosts}
                    focusedPostId={focusedPostId}
                    onViewHand={handleViewHand}
                    onShare={onShareHand}
                    onSharePost={onSharePost}
                  />
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-3 min-w-0 focus-visible:outline-none sm:mt-4">
            {realtimeEnabled ? <RealtimeTablesGrid appearance={appearance.data}
              tournamentId={tournamentId}
              catalog={publicSnapshot?.sections.tables?.catalog ?? []}
              tables={publicSnapshot?.sections.tables?.items ?? []}
              freshness={publicSnapshot?.sections.tables?.freshness}
              loading={publicSnapshotLoading}
              onVisibleTableIds={setVisibleTableIds}
              onView={(id) => setWatch({ kind: "live", tableId: id })}
              onHistory={(id) => lastHandHistoryEnabled
                ? setWatch({ kind: "history", tableId: id })
                : (setHistoryTableId(id), onTabChange?.("updates"))}
            /> : <div className="space-y-3">
              <LiveHandFeed
                tournamentId={tournamentId}
                featuredTableId={historyTableId ?? activeHandTableId}
                variant="history"
                tableNames={tableNames}
                onViewHand={handleViewHand}
                onShare={onShareHand}
              />
            </div>}
          </TabsContent>

          <TabsContent value="prizes" className="mt-3 focus-visible:outline-none sm:mt-4">
            {realtimeEnabled ? (
              <div className="grid min-w-0 gap-4 xl:grid-cols-2 xl:items-start">
                <RealtimeRankingPanel
                  rows={publicSnapshot?.sections.ranking?.items ?? []}
                  bigBlind={publicSnapshot?.sections.ranking?.bigBlind ?? null}
                  freshness={publicSnapshot?.sections.ranking?.freshness}
                  loading={publicSnapshotLoading}
                />
                <RealtimePayoutPanel
                  rows={publicSnapshot?.sections.payout?.items ?? []}
                  freshness={publicSnapshot?.sections.payout?.freshness}
                  published={publicSnapshot?.sections.payout?.published ?? false}
                  loading={publicSnapshotLoading}
                />
              </div>
            ) : <PrizesPanel tournamentId={tournamentId} rpt />}
          </TabsContent>

          <TabsContent value="structure" className="mt-3 focus-visible:outline-none sm:mt-4">
            <StructurePanel tournamentId={tournamentId} currentLevel={currentLevel} rpt />
          </TabsContent>

          {!realtimeEnabled && <TabsContent value="photos" className="mt-3 focus-visible:outline-none sm:mt-4">
            <PhotosPanel tournamentId={tournamentId} rpt />
          </TabsContent>}
        </Tabs>
      )}
    </div>
  );
}
