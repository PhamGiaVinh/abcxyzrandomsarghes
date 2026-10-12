import { TableAppearanceEditor } from "@/components/tracker/TableAppearanceEditor";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTournamentParticipationSummary } from "@/hooks/useTournamentParticipationSummary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Clock, Hand, Trophy, List, Settings, RefreshCw, Eye, History,
  Users, Layers, AlertTriangle, ArrowLeft, ListOrdered, Tv, Grid3x3, Bot,
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Tournament, TournamentLevel, TournamentLeaderboard } from "@/types/tournament";
import { ClockPanel } from "./tournament-live/ClockPanel";
import { TrackerHandInputBoundary } from "./tournament-live/handinput/unified/TrackerHandInputBoundary";
import { LeaderboardPanel } from "./tournament-live/LeaderboardPanel";
import { PlayersGroupedPanel } from "./tournament-live/PlayersGroupedPanel";
import { BlindEditorPanel } from "./tournament-live/BlindEditorPanel";
import { FloorTableMapPanel } from "./tournament-live/FloorTableMapPanel";
import { PrizesTab } from "./tournament-live/PrizesTab";
import { TournamentLiveView } from "./tournament-live/TournamentLiveView";
import { HandHistoryPanel } from "./tournament-live/HandHistoryPanel";
import { RegistrationQueuePanel } from "./tournament-live/RegistrationQueuePanel";
import { TrackerFloorAlertLane } from "./tournament-live/TrackerFloorAlertLane";
import { TvDisplaysPanel } from "./tournament-live/TvDisplaysPanel";
import { TdAiTabPanel } from "@/components/td-ai/TdAiTabPanel";
import { FloorTournamentsLanding } from "@/components/floor/FloorTournamentsLanding";
import { FEATURES } from "@/lib/featureFlags";
import CloseReportDialog from "./tournament-live/CloseReportDialog";

const STATUS_STYLES: Record<string, string> = {
  upcoming: "bg-muted text-muted-foreground border-border",
  registering: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  drawing: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  playing: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paused: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  live: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  break: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  final_table: "bg-red-500/15 text-red-400 border-red-500/30",
};

// Operator-facing labels for tournament live statuses (colors above stay per-status).
const LABELLED_STATUSES = new Set(["upcoming", "registering", "drawing", "active", "playing",
  "live", "break", "paused", "final_table", "completed", "cancelled"]);

type LiveTournament = Tournament & { live_status?: string | null };

// Presentation only. Keep catalog status unchanged for all existing writers.
function displayStatus(tournament: LiveTournament): string {
  if (tournament.status === "completed" || tournament.status === "cancelled") return tournament.status;
  return tournament.live_status ?? tournament.status;
}

function statusLabel(status: string, t: TFunction): string {
  return LABELLED_STATUSES.has(status) ? t(`tournamentLive.statusLabels.${status}`)
    : status.trim() ? status.replace(/_/g, " ") : t("tournamentLive.statusLabels.unknown");
}

// Statuses where the floor still has setup work to do before play runs smoothly.
const NEEDS_ATTENTION_STATUSES = new Set(["registering", "drawing"]);

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${
        STATUS_STYLES[status] || STATUS_STYLES.upcoming
      }`}
    >
      {statusLabel(status, t)}
    </span>
  );
}

// The overview uses the same server-authoritative summary as the selected tour.
function OverviewParticipation({ actorId, tournament, refresh }: {
  actorId: string | undefined; tournament: Tournament; refresh: number;
}) {
  const { t } = useTranslation();
  const summary = useTournamentParticipationSummary(actorId, tournament.club_id, tournament.id, refresh);
  if (summary.status !== "ready" || !summary.data) {
    return <span role="status" className="text-xs text-muted-foreground">
      {t(summary.status === "error" ? "common.participationUnavailable" : "common.loading")}
    </span>;
  }
  return <div className="flex items-center gap-4 text-xs text-muted-foreground">
    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{summary.data.counts.remaining}</span>
    <span className="flex items-center gap-1"><Layers className="w-3.5 h-3.5" />{summary.data.averageStack.toLocaleString()}</span>
  </div>;
}

// Which tabs each operator role sees. "full" preserves the original panel
// (default, so existing call sites are unchanged); tracker = live-tracking view,
// floor = room-management view.
const MODE_TABS: Record<string, string[]> = {
  full: ["table_map", "live_view", "clock", "players", "queue", "hand_input", "hand_history", "leaderboard", "blinds", "prizes", "tv_displays"],
  // Owner IA 2026-06-14: Floor OWNS room operations + physical display management
  // (table map/draw, queue/waitlist, player movement, prizes, blind structure, TV/display
  // assignment). Tracker OWNS live tracking (live view, clock, hand input/history,
  // leaderboard). ClockPanel only READS the stored blind structure (no own levels).
  tracker: ["live_view", "clock", "hand_input", "hand_history", "leaderboard"],
  // Owner 2026-06-16: Floor drops the live-tracking "Xem trực tiếp" view (that's the
  // Tracker's job) and surfaces the TD AI rules assistant as its own tab instead.
  floor: ["table_map", "players", "queue", "prizes", "blinds", "tv_displays", "td_ai"],
};

export default function TournamentLivePanel({ clubIds, clubs, mode = "full", onSelectedTournamentChange }: { clubIds: string[]; clubs: { id: string; name: string }[]; mode?: "full" | "tracker" | "floor"; onSelectedTournamentChange?: (id: string | null) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<LiveTournament[] | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  useEffect(() => { onSelectedTournamentChange?.(selectedTournamentId); }, [onSelectedTournamentChange, selectedTournamentId]);
  const [selectedTournament, setSelectedTournament] = useState<LiveTournament | null>(null);
  const [closeReportOpen, setCloseReportOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const summaryContext = selectedTournament?.id === selectedTournamentId
    && clubIds.includes(selectedTournament.club_id) ? selectedTournament : null;
  const participation = useTournamentParticipationSummary(user?.id, summaryContext?.club_id,
    selectedTournamentId, refreshTrigger);

  const clubNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    clubs.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [clubs]);

  const loadTournaments = useCallback(async () => {
    setLoading(true);
    setRefreshTrigger((previous) => previous + 1);
    let q = supabase
      .from("tournaments")
      .select("*")
      .is("deleted_at", null)
      .in("status", ["upcoming", "registering", "drawing", "active", "live", "break", "final_table"])
      .order("created_at", { ascending: false });
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) {
      toast.error(error.message);
      setListError(error.message);
      setLoading(false);
      return;
    }
    setListError(null);
    setTournaments((data as unknown as LiveTournament[]) ?? []);
    setLoading(false);
  }, [clubIds]);

  const selectTournament = useCallback((id: string) => {
    setSelectedTournamentId(id);
    // The Floor landing can create a tour after this parent's snapshot loaded.
    // Resolve it from the server rather than leaving selection on the old list.
    if (!(tournaments ?? []).some((tour) => tour.id === id)) {
      void loadTournaments();
    }
  }, [loadTournaments, tournaments]);

  useEffect(() => { loadTournaments(); }, [loadTournaments]);

  useEffect(() => {
    if (!selectedTournamentId) {
      setSelectedTournament(null);
      return;
    }
    if (!tournaments) return;
    const t = tournaments.find((x) => x.id === selectedTournamentId) ?? null;
    setSelectedTournament(t);
  }, [selectedTournamentId, tournaments]);

  useEffect(() => {
    if (!selectedTournamentId) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(`tournament-live:${selectedTournamentId}`);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshParticipation = () => {
      if (refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        setRefreshTrigger((previous) => previous + 1);
      }, 100);
    };

    // hands/chips/seats events only bump refreshTrigger for the tab panels that
    // have no realtime channel of their own (TableDraw, Clock, Leaderboard).
    // Reloading the whole tournament list belongs to `tournaments` UPDATE only.
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_hands", filter: `tournament_id=eq.${selectedTournamentId}` },
        refreshParticipation
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${selectedTournamentId}` },
        refreshParticipation
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${selectedTournamentId}` },
        refreshParticipation
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_entries", filter: `tournament_id=eq.${selectedTournamentId}` },
        refreshParticipation
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${selectedTournamentId}` },
        () => {
          loadTournaments();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [selectedTournamentId, loadTournaments]);

  const needsAttention = useMemo(
    () => (tournaments ?? []).filter((t) => NEEDS_ATTENTION_STATUSES.has(displayStatus(t))),
    [tournaments]
  );

  const renderOverview = () => {
    // Floor landing → the Daily / Multi-day split (full management lives here now). Other
    // modes keep the legacy selection grid below. Clicking a tour calls onSelect → the
    // operational tabs (no redundant list-in-a-tab).
    if (mode === "floor") {
      if (selectedTournamentId && loading) {
        return <p role="status">Đang tải giải đã chọn…</p>;
      }
      if (selectedTournamentId && listError) {
        return <div role="alert" className="space-y-2">
          <p>Không tải được giải đã chọn. Thử lại để tiếp tục vận hành.</p>
          <Button onClick={() => { void loadTournaments(); }}>Thử lại</Button>
        </div>;
      }
      return <FloorTournamentsLanding clubIds={clubIds} clubs={clubs} onSelect={selectTournament} />;
    }
    if (listError && (!tournaments || tournaments.length === 0)) {
      return (
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto text-destructive" />
          <div className="font-semibold">Không tải được danh sách giải</div>
          <p className="text-xs text-muted-foreground break-all">{listError}</p>
          <Button size="sm" variant="outline" onClick={loadTournaments} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Thử lại
          </Button>
        </Card>
      );
    }

    if (tournaments === null) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      );
    }

    if (tournaments.length === 0) {
      return (
        <Card className="p-10 text-center">
          <div className="text-muted-foreground">Không có giải active</div>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {needsAttention.length > 0 && (
          <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1">
              Cần chú ý
            </div>
            <div className="flex flex-wrap gap-2">
              {needsAttention.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTournamentId(t.id)}
                  className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-card border border-amber-500/30 text-xs hover:border-amber-400/60 transition-colors"
                >
                  <span className="font-semibold">{t.name}</span>
                  <StatusBadge status={displayStatus(t)} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tournaments.filter((tour) => clubIds.includes(tour.club_id)).map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTournamentId(t.id)}
              className="text-left p-4 rounded-xl bg-card border border-border hover:border-emerald-500/50 transition-colors space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold leading-tight">{t.name}</div>
                <StatusBadge status={displayStatus(t)} />
              </div>
              {clubNameMap[t.club_id] && (
                <div className="text-xs text-muted-foreground">{clubNameMap[t.club_id]}</div>
              )}
              <OverviewParticipation actorId={user?.id} tournament={t} refresh={refreshTrigger} />
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {selectedTournament && (
              <Button size="sm" variant="ghost" onClick={() => setSelectedTournamentId(null)}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Tất cả giải
              </Button>
            )}
            <Select value={selectedTournamentId ?? ""} onValueChange={selectTournament}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder={t("tournamentLive.selectTournament")} />
              </SelectTrigger>
              <SelectContent>
                {(tournaments ?? []).map((tour) => (
                  <SelectItem key={tour.id} value={tour.id}>
                    <span className="flex items-center gap-2">
                      <span>{tour.name}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">
                        {statusLabel(displayStatus(tour), t)}
                        {clubNameMap[tour.club_id] ? ` · ${clubNameMap[tour.club_id]}` : ""}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={loadTournaments} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
            {FEATURES.closeReport && selectedTournament && (
              <Button size="sm" onClick={() => setCloseReportOpen(true)}>
                Chốt giải
              </Button>
            )}
          </div>
          {selectedTournament && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={displayStatus(selectedTournament)} />
              {participation.status === "ready" && participation.data && (
                <span>· {t("tournamentLive.liveView.playersRemaining")}: {participation.data.counts.remaining}
                  {" · AVG: "}{participation.data.averageStack.toLocaleString()}</span>
              )}
              {participation.status === "loading" && (
                <span role="status">{t("common.loading")}</span>
              )}
              {participation.status === "error" && (
                <span role="alert">{t("common.participationUnavailable")}</span>
              )}
              {participation.status === "error" && (
                <Button variant="outline" size="sm" onClick={() => setRefreshTrigger((previous) => previous + 1)}>
                  {t("common.retry")}
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {selectedTournament && FEATURES.closeReport && (
        <CloseReportDialog
          open={closeReportOpen}
          onOpenChange={setCloseReportOpen}
          tournamentId={selectedTournament.id}
          tournamentName={selectedTournament.name}
          onClosed={loadTournaments}
        />
      )}

      {selectedTournament && mode === "floor" && FEATURES.trackerVoiceInput && (
        <TrackerFloorAlertLane tournamentId={selectedTournament.id} />
      )}

      {selectedTournament ? (
        (() => {
          const TAB_DEFS = [
            { value: "table_map", icon: Grid3x3, label: "Sơ đồ bàn", render: () => <FloorTableMapPanel tournament={selectedTournament} refreshTrigger={refreshTrigger} /> },
            { value: "live_view", icon: Eye, label: t("tournamentLive.liveView.title"), render: () => <div className="space-y-3"><div className="flex justify-end"><TableAppearanceEditor tournamentId={selectedTournament.id} /></div><TournamentLiveView tournamentId={selectedTournament.id} /></div> },
            { value: "clock", icon: Clock, label: t("tournamentLive.clock.title"), render: () => <ClockPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} /> },
            { value: "queue", icon: ListOrdered, label: "Hàng chờ", render: () => (
              <>
                <RegistrationQueuePanel
                  tournamentId={selectedTournament.id}
                  tournamentName={selectedTournament.name}
                  tournamentDate={(selectedTournament as Tournament & { start_time?: string | null }).start_time ?? null}
                  refreshTrigger={refreshTrigger}
                />
              </>
            ) },
            { value: "hand_input", icon: Hand, label: t("tournamentLive.tabs.input"), render: () => (
              <TrackerHandInputBoundary
                tournamentId={selectedTournament.id}
              />
            ) },
            { value: "hand_history", icon: History, label: t("tournamentLive.handHistory.title"), render: () => <HandHistoryPanel tournamentId={selectedTournament.id} /> },
            { value: "leaderboard", icon: Trophy, label: t("tournamentLive.leaderboard.title"), render: () => <LeaderboardPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} /> },
            { value: "players", icon: Users, label: "Người chơi", render: () => <PlayersGroupedPanel tournament={selectedTournament} refreshTrigger={refreshTrigger} onTournamentChanged={() => { void loadTournaments(); }} /> },
            { value: "blinds", icon: List, label: t("tournamentLive.tabs.blinds"), render: () => <BlindEditorPanel tournamentId={selectedTournament.id} tournamentStatus={selectedTournament.status} /> },
            { value: "prizes", icon: Settings, label: t("tournamentLive.tabs.prizes"), render: () => <PrizesTab tournamentId={selectedTournament.id} clubId={selectedTournament.club_id} /> },
            { value: "tv_displays", icon: Tv, label: t("tournamentLive.tvDisplays.tab"), render: () => (
              <TvDisplaysPanel
                tournamentId={selectedTournament.id}
                tournamentName={selectedTournament.name}
                clubId={selectedTournament.club_id}
                tournaments={(tournaments ?? []).map((tour) => ({
                  id: tour.id,
                  name: tour.name,
                  club_id: tour.club_id,
                  status: tour.status,
                }))}
              />
            ) },
            { value: "td_ai", icon: Bot, label: "TD AI", render: () => <TdAiTabPanel tournamentId={selectedTournament.id} /> },
          ];
          const allowed = MODE_TABS[mode] ?? MODE_TABS.full;
          const visibleTabs = TAB_DEFS.filter((td) => allowed.includes(td.value));
          const defaultTab = visibleTabs.some((td) => td.value === "live_view") ? "live_view" : visibleTabs[0]?.value;
          return (
            <Tabs defaultValue={defaultTab} className="w-full">
              <div className="overflow-x-auto -mx-2 px-2 pb-1">
                <TabsList className="inline-flex w-max min-w-full">
                  {visibleTabs.map((td) => {
                    const Icon = td.icon;
                    return (
                      <TabsTrigger key={td.value} value={td.value}><Icon className="w-4 h-4 mr-1" /> {td.label}</TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
              {visibleTabs.map((td) => (
                <TabsContent key={td.value} value={td.value} className="mt-4">{td.render()}</TabsContent>
              ))}
            </Tabs>
          );
        })()
      ) : (
        renderOverview()
      )}
    </div>
  );
}
