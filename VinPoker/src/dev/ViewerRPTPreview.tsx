import { TableAppearanceForm } from "@/components/tracker/TableAppearanceEditor";
import { DEFAULT_TABLE_APPEARANCE } from "@/components/tracker/tableAppearance";
import type { PublicTableSnapshot } from "@/components/cashier/tournament-live/viewer-hub/publicSnapshotTypes";
// DEV-only visual harness for the public Viewer shell. The route is gated in
// App.tsx and tree-shaken from production. All content is deterministic fixture
// data; no Supabase client, auth state, or real player data is used here.

import { useEffect, useMemo, useState } from "react";
import { TrackerViewerCardProvider, TrackerCardStyleToggle } from '@/components/tracker/TrackerCardStyle';
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, Crown, Layers3, Radio } from "lucide-react";
import { LiveFelt } from "@/components/cashier/tournament-live/LiveFelt";
import { ReplayScrubber } from "@/components/cashier/tournament-live/ReplayScrubber";
import { HandFeedCard } from "@/components/cashier/tournament-live/viewer-hub/HandFeedCard";
import { LiveHubHeader } from "@/components/cashier/tournament-live/viewer-hub/LiveHubHeader";
import { LiveStatsBar } from "@/components/cashier/tournament-live/viewer-hub/LiveStatsBar";
import { LiveStoryFeed } from "@/components/cashier/tournament-live/viewer-hub/LiveStoryFeed";
import { LiveUpdatesFeed } from "@/components/cashier/tournament-live/viewer-hub/LiveUpdatesFeed";
import { RealtimeTablesGrid } from "@/components/cashier/tournament-live/viewer-hub/RealtimeTablesGrid";
import { RealtimeRankingPanel } from "@/components/cashier/tournament-live/viewer-hub/RealtimeRankingPanel";
import { RealtimePayoutPanel } from "@/components/cashier/tournament-live/viewer-hub/RealtimePayoutPanel";
import { TournamentPostCard } from "@/components/cashier/tournament-live/viewer-hub/TournamentPostCard";
import type { HandFeedItem } from "@/components/cashier/tournament-live/viewer-hub/handFeedDerive";
import type { TournamentPostViewModel } from "@/components/cashier/tournament-live/viewer-hub/viewerTypes";
import { buildReplayFrames, detectBigBlind, type ReplayFrame } from "@/lib/tracker-poker/replayEngine";
import { buildFixtureHand } from "./livefeltFixtures";

const handCard: HandFeedItem = {
  handId: "fixture-hand-141",
  handNumber: 141,
  tableId: "table-1",
  createdAt: "2026-07-11T12:18:00.000Z",
  board: ["Th", "7c", "6d", "7s", "Ad"],
  potChips: 18_600_000,
  potBB: 62,
  sidePotCount: 1,
  bigBlind: 300_000,
  tags: ["all_in", "big_pot"],
  players: [
    { playerId: "fixture-kien", seatNumber: 2, name: "KIÊN", avatarUrl: null, endingStack: 21_300_000, deltaChips: 8_900_000, deltaBB: 29.7, holeCards: ["Ah", "7d"], isWinner: true, isEliminated: false, finishPosition: null, prize: null },
    { playerId: "fixture-nam", seatNumber: 5, name: "NAM", avatarUrl: null, endingStack: 4_200_000, deltaChips: -8_900_000, deltaBB: -29.7, holeCards: null, isWinner: false, isEliminated: false, finishPosition: null, prize: null },
  ],
  highHand: null,
};

handCard.highHand = { playerId: "fixture-kien", category: "full_house" };
handCard.actions = [
  { actionId: "fixture-a1", playerId: "fixture-kien", playerName: "KIEN", avatarUrl: null, seatNumber: 2, street: "river", actionType: "all_in", amount: 8_900_000, potAfter: 18_600_000, actionOrder: 1 },
  { actionId: "fixture-a2", playerId: "fixture-nam", playerName: "NAM", avatarUrl: null, seatNumber: 5, street: "river", actionType: "call", amount: 8_900_000, potAfter: 18_600_000, actionOrder: 2 },
];
handCard.showdownResult = "winner";

const post: TournamentPostViewModel = {
  id: "fixture-post-final-table",
  tournamentId: "fixture-tournament",
  kind: "announcement",
  titleVi: "Bàn chung kết đang đến rất gần",
  titleEn: "The final table is within reach",
  bodyVi: "Chỉ còn 10 người chơi. Hai bàn đã được cân bằng và nhịp độ đang tăng nhanh khi bubble bắt đầu.",
  bodyEn: "Only 10 players remain. The two tables are balanced and the pace is rising as the bubble begins.",
  coverPhotoUrl: null,
  linkedHandNumber: 141,
  isPinned: true,
  publishedAt: "2026-07-11T12:20:00.000Z",
  sourceLabel: "VinPoker Media",
};

const views = [
  { id: "updates", labelKey: "updates", fallback: "Cập nhật", Icon: Activity },
  { id: "tables", labelKey: "tablesLive", fallback: "Bàn LIVE", Icon: Radio },
  { id: "leaders", labelKey: "leaders", fallback: "Xếp hạng", Icon: Crown },
  { id: "structure", labelKey: "structure", fallback: "Cấu trúc", Icon: Layers3 },
] as const;

export default function ViewerRPTPreview() {
  return <TrackerViewerCardProvider><TrackerCardStyleToggle /><ViewerRPTPreviewContent /></TrackerViewerCardProvider>;
}

function ViewerRPTPreviewContent() {
  const [params] = useSearchParams();
  const { t, i18n } = useTranslation();
  const requestedView = params.get("view") || "updates";
  const view = ["replay", "appearance"].includes(requestedView) ? requestedView : views.some((item) => item.id === requestedView) ? requestedView : "updates";
  const state = params.get("state") || "ready";
  const language = params.get("lang") === "en" ? "en" : "vi";
  const replayHand = useMemo(() => buildFixtureHand("allin-sidepots", 6), []);
  const frames = useMemo(() => buildReplayFrames(replayHand, { trackBets: true }), [replayHand]);
  const [frame, setFrame] = useState<ReplayFrame>(frames.at(-1)!);
  const fixtureNames = ["KIÊN", "NAM", "MINH", "AN", "BÌNH", "LINH"];
  const visualSeats = frame.seats.map((seat, index) => ({ ...seat, display_name: fixtureNames[index] || t("liveHub.handFeed.unknownPlayer", "Người chơi") }));

  useEffect(() => { void i18n.changeLanguage(language); }, [i18n, language]);

  const bb = detectBigBlind(replayHand);
  const formatBB = (chips: number) => bb > 0 ? `${(chips / bb).toFixed(1).replace(/\.0$/, "")} BB` : null;
  const [tick, setTick] = useState(0);
  const animated = params.get("motion") === "live";
  useEffect(() => { if (!animated) return; const timer = setInterval(() => setTick(n => n + 1), 2000); return () => clearInterval(timer); }, [animated]);
  const previewTables: PublicTableSnapshot[] = [{ tableId: "table-1", tableSessionId: "session-1", name: "Bàn 14", handId: "hand-141", handNumber: 141, buttonSeat: 2, street: "turn", board: ["4S", "AC", "6D", "QH"], pot: 18_600_000, smallBlind: 150_000, bigBlind: 300_000, levelNumber: 11, ante: 300_000, trackerState: "live" as const, players: visualSeats.slice(0, 6).map((seat, index) => ({ entryId: `entry-${index}`, playerId: seat.player_id, entryNumber: 1, seatNumber: seat.seat_number, name: fixtureNames[index], avatarUrl: null, stack: 12000000 + index * 300000, isFolded: false, isAllIn: false, holeCards: index === 0 ? ["QS", "QC"] : [] })) }];
  if (params.get("tables") === "dense") previewTables[0].players.push(...[7, 8, 9].map((seatNumber) => ({
    entryId: `dense-entry-${seatNumber}`, playerId: `dense-player-${seatNumber}`, entryNumber: 1,
    seatNumber, isFolded: false, isAllIn: false, name: `TEST ${seatNumber}`, avatarUrl: null, stack: 2_000_000,
    holeCards: seatNumber === 8 ? ["2S", "2H"] : [],
  })));
  previewTables.push({ ...previewTables[0], tableId: "table-2", tableSessionId: "session-2", name: "Bàn 15", handId: "hand-28", handNumber: 28, street: "flop", board: ["AS", "TH", "7C"], pot: 3_000_000, players: previewTables[0].players.slice(0, 6).map((player, index) => ({ ...player, entryId: `other-entry-${index}`, playerId: `other-player-${index}`, name: ["HẢI", "TRANG", "PHÚC", "QUÂN", "THẢO", "ĐỨC"][index], holeCards: index === 1 ? ["8D", "8H"] : [] })) });
  for (const [i, name] of ["Bàn 20", "Bàn 21"].entries()) previewTables.push({ ...previewTables[i], tableId: `table-${i + 3}`, name, handId: `independent-${i}`, board: i === 0 ? [] : ["2S", "JH", "6C", "9D", "7D"], pot: i === 0 ? 450000 : 9000000 });
  const labels = ["fold", "call", "all_in", "raise"];
  previewTables.forEach((table, i) => {
    const actorIndex = i === 0 ? 2 : i === 1 ? 3 : 4;
    const actionType = labels[(i + tick) % labels.length];
    const amount = actionType === 'fold' ? 0 : actionType === 'all_in' ? 15000000 : 600000;
    table.players = table.players.map((player, index) => ({ ...player,
      ...(index === actorIndex ? { isFolded: actionType === 'fold', isAllIn: actionType === 'all_in', lastAction: { actionType, amount }, stack: actionType === 'all_in' ? 0 : 12000000 - tick * 300000 } : {}) }));
    const actor = table.players[actorIndex];
    table.latestAction = { playerId: actor.playerId, entryNumber: 1, actionType, amount };
    table.pot = (table.pot ?? 0) + tick * (i + 1) * 300000;
  });
  if (params.get('pots') === 'split') {
    previewTables[0].pot = 19_500_000;
    previewTables[0].potLayers = [15_000_000, 3_000_000, 1_500_000];
  }
  const previewCatalog = params.get("tables") === "many"
    ? Array.from({ length: 8 }, (_, index) => ({
      tableId: index === 0 ? previewTables[0].tableId : `table-${index + 1}`,
      name: `Bàn ${14 + index}`,
      playerCount: index === 0 ? previewTables[0].players.length : 0,
      searchPlayers: index === 0 ? previewTables[0].players.map((player) => player.name) : [],
    }))
    : previewTables.map((table) => ({ tableId: table.tableId, name: table.name, playerCount: table.players.length, searchPlayers: table.players.map((player) => player.name) }));
  const freshness = { sourceRevision: "fixture", projectedSourceRevision: "fixture", sourceChangedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), serverCheckedAt: new Date().toISOString(), oldestPendingAt: null, state: "current" as const };

  return (
    <main
      data-dev-viewer-rpt
      data-viewer-shell="rpt"
      data-language={language}
      className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_12%_-8%,hsl(var(--viewer-neon)_/_0.12),transparent_34%),radial-gradient(circle_at_88%_22%,hsl(var(--poker-felt)_/_0.1),transparent_31%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--card)_/_0.45))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-foreground sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-4 lg:pl-[max(1.75rem,env(safe-area-inset-left))] lg:pr-[max(1.75rem,env(safe-area-inset-right))]"
    >
      <p className="mb-2 text-center text-xs text-amber-200">DEMO · Dữ liệu minh họa{animated ? " · 4 bàn tự cập nhật cùng lúc" : ""}</p>
      <div className="mx-auto min-w-0 max-w-[1480px] space-y-3 sm:space-y-4">
        <LiveHubHeader rpt title="VinPoker Sakura Championship" clubName="Royal Poker Club" liveTableCount={4} guarantee={3_000_000_000} buyIn={15_000_000} startingStack={50_000} playersRemaining={10} lastUpdated={new Date()} onShare={() => {}} />
        <LiveStatsBar prizePool={3_420_000_000} playersRemaining={10} chipLeader={{ playerName: "KIÊN", seatNumber: 2, chipCount: 21_300_000 }} rpt />

        {view !== "replay" && (
          <nav aria-label={t("liveHub.watch.viewer", "Trình xem ván đấu")} className="sticky top-[env(safe-area-inset-top)] z-30 -mx-3 border-y border-border/45 bg-background/88 px-3 backdrop-blur-xl sm:-mx-1 sm:rounded-2xl sm:border sm:px-1">
            <div className="flex h-12 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {views.map(({ id, labelKey, fallback, Icon }) => (
                <Link
                  key={id}
                  to={`/__dev/viewer-rpt?view=${id}&lang=${language}`}
                  className={`inline-flex min-h-11 shrink-0 snap-start items-center border-b-2 px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 sm:text-sm ${view === id ? "border-[hsl(var(--viewer-neon))] bg-[hsl(var(--viewer-neon)_/_0.08)] text-[hsl(var(--viewer-neon))]" : "border-transparent text-muted-foreground"}`}
                >
                  <Icon className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t(`liveHub.tabs.${labelKey}`, fallback)}
                </Link>
              ))}
            </div>
          </nav>
        )}

        {view === "appearance" ? <TableAppearanceForm initial={DEFAULT_TABLE_APPEARANCE} onSave={async () => {}} onUpload={async file => URL.createObjectURL(file)} /> : state === "loading" ? <FixtureLoading /> : state === "error" ? <FixtureError /> : state === "empty" ? <FixtureEmpty /> : view === "replay" ? (
          <section className="grid min-w-0 grid-cols-1 gap-3 min-[1200px]:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] min-[1200px]:items-start">
            <div className="min-w-0 rounded-2xl border border-border/55 bg-card/55 p-2 sm:p-3">
              <LiveFelt seats={visualSeats} lastActorId={frame.lastActorId} displayCards={frame.displayCards} potSize={frame.potSize} potBreakdown={frame.potBreakdown} multiTableUnresolved={false} handNumber={replayHand.hand_number} latestAction={frame.latestAction} formatBB={formatBB} buttonSeat={replayHand.button_seat} viewerLayout compact tableFx={false} blinds={{ sb: bb / 2, bb, ante: 0 }} />
            </div>
            <aside className="min-w-0 md:sticky md:top-4">
              <ReplayScrubber hand={replayHand} onFrame={setFrame} hud trackBets />
            </aside>
          </section>
        ) : view === "updates" ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)] xl:items-start">
            <aside className="min-w-0 space-y-4 xl:col-start-2 xl:row-start-1">
              <LiveStoryFeed rpt items={[{ id: "bubble", kind: "bubble", count: 10, label: "Bubble" }, { id: "elim", kind: "elimination", name: "MINH", count: 10, label: "Eliminated" }]} />
              <LiveUpdatesFeed rpt feed={[{ id: "a1", seatNumber: 2, playerName: "KIÊN", label: "ALL-IN 4.5M", kind: "allin", actionType: "all_in", amount: 4_500_000 }, { id: "a2", seatNumber: 5, playerName: "NAM", label: "Theo 4.5M", kind: "call", actionType: "call", amount: 4_500_000 }]} />
            </aside>
            <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
              <TournamentPostCard post={post} onShare={() => {}} onViewHand={() => {}} />
              <HandFeedCard rpt item={handCard} tableName="Bàn Sakura" onShare={() => {}} onViewHand={() => {}} />
            </div>
          </div>
        ) : view === "tables" ? (
          <RealtimeTablesGrid catalog={previewCatalog} tables={previewTables} freshness={freshness} onVisibleTableIds={() => {}} onView={() => {}} onHistory={() => {}} />
        ) : view === "leaders" ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2 xl:items-start">
            <RealtimeRankingPanel loading={false} bigBlind={300_000} freshness={freshness} rows={previewTables[0].players.map((player) => ({ ...player, chips: player.stack, updatedAt: freshness.publishedAt }))} />
            <RealtimePayoutPanel loading={false} published freshness={freshness} rows={[{ fromPlace: 1, toPlace: 1, amountPerPlayer: 1_500_000_000, playerName: "KIÊN", avatarUrl: null, resultStatus: "official" }, { fromPlace: 2, toPlace: 2, amountPerPlayer: 1_040_000_000, playerName: null, avatarUrl: null, resultStatus: "open" }, { fromPlace: 3, toPlace: 5, amountPerPlayer: 250_000_000, playerName: null, avatarUrl: null, resultStatus: "open" }]} />
          </div>
        ) : (
          <FixtureEmpty />
        )}
      </div>
    </main>
  );
}

function FixtureLoading() {
  return <div data-testid="viewer-loading" className="grid gap-3 sm:grid-cols-2"><div className="h-40 rounded-2xl bg-card/70 motion-safe:animate-pulse" /><div className="h-40 rounded-2xl bg-card/70 motion-safe:animate-pulse" /></div>;
}

function FixtureEmpty() {
  const { t } = useTranslation();
  return <div data-testid="viewer-empty" className="rounded-2xl border border-dashed border-border/55 bg-card/35 px-4 py-16 text-center text-sm text-muted-foreground">{t("liveHub.handFeed.empty", "Chưa có ván nào hoàn tất")}</div>;
}

function FixtureError() {
  const { t } = useTranslation();
  return <div data-testid="viewer-error" role="alert" className="rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-8 text-center text-sm text-destructive">{t("liveHub.state.error", "Không tải được cập nhật. Vui lòng thử lại.")}</div>;
}
