import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckCircle2, History, Radio, Search, ShieldCheck, Trophy } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { HandHistoryPanel, type HandHistorySelection } from "@/components/cashier/tournament-live/HandHistoryPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { archiveTournamentClubScope } from "@/lib/tracker-poker/trackerHistoryAccess";

type TournamentSummary = {
  id: string;
  club_id: string;
  name: string;
  status: string;
  created_at: string;
};

type TournamentGroup = "running" | "finished" | "other";

const GROUP_LABEL: Record<TournamentGroup, string> = {
  running: "Đang vận hành",
  finished: "Đã kết thúc",
  other: "Khác",
};

function groupOf(status: string): TournamentGroup {
  if (["active", "live", "break", "final_table", "registering", "drawing"].includes(status)) return "running";
  if (["completed", "finished"].includes(status)) return "finished";
  return "other";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    live: "LIVE",
    active: "Đang chơi",
    break: "Đang nghỉ",
    final_table: "Final table",
    registering: "Đăng ký",
    drawing: "Xếp bàn",
    completed: "Đã kết thúc",
    finished: "Đã kết thúc",
    upcoming: "Sắp diễn ra",
    cancelled: "Đã huỷ",
  };
  return labels[status] ?? status;
}

export default function TrackerHandHistory() {
  const { user, loading: authLoading, authError, rolesLoading, rolesError, isTracker, isAdmin, isClubOwner } = useAuth();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tournamentResult, setTournamentResult] = useState<{
    scope: string; data: TournamentSummary[]; error: string | null;
  } | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase("vi"));
  const selectedTournamentId = searchParams.get("t");
  const selectedTableId = searchParams.get("table");
  const selectedHandId = searchParams.get("hand");
  const selectedActionId = searchParams.get("action");
  const [showTournamentPicker, setShowTournamentPicker] = useState(!selectedTournamentId);
  const authorized = isTracker || isAdmin || isClubOwner;
  const scopeIdentity = user && authorized && !authLoading && !rolesLoading && !authError
    ? JSON.stringify([user.id, isAdmin, isTracker, isClubOwner]) : null;
  const scopeOwner = useRef({ identity: scopeIdentity, generation: 0 });
  if (scopeOwner.current.identity !== scopeIdentity) {
    scopeOwner.current = { identity: scopeIdentity, generation: scopeOwner.current.generation + 1 };
  }
  const generation = scopeOwner.current.generation;
  const readScope = scopeIdentity === null ? null : `${scopeIdentity}:${generation}`;
  const tournaments = readScope && tournamentResult?.scope === readScope ? tournamentResult.data : null;
  const loadError = readScope && tournamentResult?.scope === readScope ? tournamentResult.error : null;

  useEffect(() => {
    if (!user || !readScope) return;
    let cancelled = false;
    const isCurrent = () => !cancelled && scopeOwner.current.generation === generation;
    void (async () => {
      const { data: ids, error: idsError } = await supabase.rpc("tracker_club_ids", { _user_id: user.id });
      if (!isCurrent()) return;
      if (idsError) {
        setTournamentResult({ scope: readScope, data: [], error: idsError.message });
        return;
      }
      const clubIds = (ids ?? []).filter((clubId): clubId is string => typeof clubId === "string");
      const archiveClubScope = archiveTournamentClubScope({ isAdmin, trackerClubIds: clubIds });
      let query = supabase
        .from("tournaments")
        .select("id, club_id, name, status, created_at")
        .order("created_at", { ascending: false });
      if (archiveClubScope && archiveClubScope.length > 0) query = query.in("club_id", archiveClubScope);
      else if (archiveClubScope && archiveClubScope.length === 0) {
        setTournamentResult({ scope: readScope, data: [], error: null });
        return;
      }
      const { data, error } = await query;
      if (!isCurrent()) return;
      if (error) {
        setTournamentResult({ scope: readScope, data: [], error: error.message });
        return;
      }
      setTournamentResult({ scope: readScope, data: (data ?? []) as TournamentSummary[], error: null });
    })().catch((error: unknown) => {
      if (!isCurrent()) return;
      setTournamentResult({ scope: readScope, data: [], error: error instanceof Error ? error.message : t("common.archiveUnavailable") });
    });
    return () => { cancelled = true; };
  }, [generation, isAdmin, readScope, t, user]);

  useEffect(() => {
    if (!tournaments || tournaments.length === 0 || selectedTournamentId) return;
    const first = tournaments.find((tournament) => groupOf(tournament.status) === "running") ?? tournaments[0];
    setSearchParams({ t: first.id }, { replace: true });
  }, [selectedTournamentId, setSearchParams, tournaments]);

  const chooseTournament = useCallback((tournamentId: string) => {
    setShowTournamentPicker(false);
    startTransition(() => setSearchParams({ t: tournamentId }));
  }, [setSearchParams]);

  const updateHandSelection = useCallback((selection: HandHistorySelection) => {
    if (!selectedTournamentId) return;
    const next = new URLSearchParams({ t: selectedTournamentId });
    if (selection.tableId) next.set("table", selection.tableId);
    if (selection.handId) next.set("hand", selection.handId);
    if (selection.handId === selectedHandId && selectedActionId) next.set("action", selectedActionId);
    setSearchParams(next, { replace: true });
  }, [selectedActionId, selectedHandId, selectedTournamentId, setSearchParams]);

  if (authLoading || (user && rolesLoading)) {
    return <div aria-busy="true" className="container mx-auto space-y-4 p-3 md:p-6"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-[620px] rounded-2xl" /></div>;
  }
  const accessError = authError || (!authorized ? rolesError : null);
  if (accessError) return <div className="container mx-auto p-3 md:p-6">
    <Card role="alert" className="space-y-3 border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p>{accessError}</p>
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>{t("common.retry")}</Button>
    </Card>
  </div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!authorized) return <Navigate to="/" replace />;
  if (tournaments === null) {
    return <div className="container mx-auto space-y-4 p-3 md:p-6"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-[620px] rounded-2xl" /></div>;
  }

  const visibleTournaments = (tournaments ?? []).filter((tournament) =>
    !deferredSearch || tournament.name.toLocaleLowerCase("vi").includes(deferredSearch),
  );
  const selectedTournament = (tournaments ?? []).find((tournament) => tournament.id === selectedTournamentId) ?? null;

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))]">
      <div className="container mx-auto space-y-4 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">
        <header className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/35 via-card to-amber-950/20 p-4 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2 min-h-11 text-muted-foreground hover:text-foreground">
                <Link to="/tracker"><ArrowLeft className="mr-2 h-4 w-4" /> Quay lại Live Tracker</Link>
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border border-emerald-400/35 bg-emerald-400/15 text-emerald-300"><History className="mr-1 h-3.5 w-3.5" /> HAND ARCHIVE</Badge>
                <Badge variant="outline" className="border-amber-400/30 text-amber-200"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Server xác minh winner</Badge>
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-tight text-foreground md:text-4xl">Lịch sử & đối chiếu hand</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Chọn <strong className="text-foreground">Giải → Bàn → Hand</strong> để xem toàn bộ action và lập bản nháp đối chiếu. Ghi sửa hand đang tạm khóa.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs lg:w-[360px]">
              <div className="rounded-xl border border-border/50 bg-background/35 p-2"><span className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 font-black text-emerald-300">1</span>Chọn giải</div>
              <div className="rounded-xl border border-border/50 bg-background/35 p-2"><span className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 font-black text-amber-300">2</span>Chọn bàn</div>
              <div className="rounded-xl border border-border/50 bg-background/35 p-2"><span className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 font-black text-sky-300">3</span>Sửa / xác minh</div>
            </div>
          </div>
        </header>

        {loadError && <Card role="alert" className="border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">Không tải được kho hand: {loadError}</Card>}

        {selectedTournament && (
          <Button type="button" variant="outline" className="min-h-11 w-full xl:hidden" onClick={() => setShowTournamentPicker((current) => !current)}>
            {showTournamentPicker ? "Ẩn danh sách giải" : `Giải: ${selectedTournament.name} · Chọn giải khác`}
          </Button>
        )}
        <div className="grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className={`self-start rounded-2xl border border-border/50 bg-card/80 p-3 xl:sticky xl:top-20 ${selectedTournament && !showTournamentPicker ? "hidden xl:block" : ""}`} aria-label="Chọn giải đấu">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên giải..." className="min-h-11 pl-9" aria-label="Tìm giải đấu" />
            </div>
            <div className="mt-3 space-y-4 pr-1 xl:max-h-[620px] xl:overflow-y-auto">
              {(["running", "finished", "other"] as TournamentGroup[]).map((group) => {
                const rows = visibleTournaments.filter((tournament) => groupOf(tournament.status) === group);
                if (rows.length === 0) return null;
                return (
                  <section key={group} aria-labelledby={`tour-group-${group}`}>
                    <h2 id={`tour-group-${group}`} className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{GROUP_LABEL[group]}</h2>
                    <div className="space-y-1.5">
                      {rows.map((tournament) => {
                        const active = selectedTournament?.id === tournament.id;
                        return (
                          <button
                            key={tournament.id}
                            type="button"
                            onClick={() => chooseTournament(tournament.id)}
                            className={`min-h-14 w-full rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${active ? "border-emerald-400/55 bg-emerald-950/30" : "border-border/40 bg-background/25 hover:border-border"}`}
                          >
                            <span className="block truncate text-sm font-semibold">{tournament.name}</span>
                            <span className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>{new Date(tournament.created_at).toLocaleDateString("vi-VN")}</span>
                              <span className={group === "running" ? "text-emerald-300" : ""}>{statusLabel(tournament.status)}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {visibleTournaments.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Không tìm thấy giải phù hợp.</p>}
            </div>
          </aside>

          <main className="min-w-0 space-y-3">
            {selectedTournament ? (
              <>
                <div className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between md:p-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Giải đang chọn</p>
                    <h2 className="truncate text-lg font-bold md:text-xl">{selectedTournament.name}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="min-h-8 border-emerald-500/30 text-emerald-300"><Radio className="mr-1 h-3.5 w-3.5" /> {statusLabel(selectedTournament.status)}</Badge>
                    <Badge variant="outline" className="min-h-8"><Trophy className="mr-1 h-3.5 w-3.5" /> Chọn bàn bên dưới</Badge>
                  </div>
                </div>
                <Card className="overflow-hidden border-border/50 bg-card/75 p-3 md:p-4">
                  <HandHistoryPanel
                    key={selectedTournament.id}
                    tournamentId={selectedTournament.id}
                    initialTableId={selectedTableId}
                    initialHandId={selectedHandId}
                    initialActionId={selectedActionId}
                    onSelectionChange={updateHandSelection}
                    workspaceMode
                    enableHistoricalBatchControls
                  />
                </Card>
              </>
            ) : (
              <Card className="flex min-h-[420px] items-center justify-center border-dashed p-8 text-center">
                <div><History className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3 font-semibold">Chọn một giải để mở kho hand</p><p className="mt-1 text-sm text-muted-foreground">Giải đang chạy và giải đã kết thúc đều nằm ở cột bên trái.</p></div>
              </Card>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
