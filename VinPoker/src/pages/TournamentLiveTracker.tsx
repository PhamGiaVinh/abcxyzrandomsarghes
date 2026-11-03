import { lazy, useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { LiveHub } from "@/components/cashier/tournament-live/viewer-hub/LiveHub";
import { defaultViewerTab, parseViewerTab } from "@/components/cashier/tournament-live/viewer-hub/viewerUrlState";
import type { ViewerTab } from "@/components/cashier/tournament-live/viewer-hub/viewerTypes";
import { parseReplayTarget, replaceReplayTargetParams, type ReplayTarget } from "@/components/cashier/tournament-live/viewer-hub/replayTarget";
import { FEATURES } from "@/lib/featureFlags";
import { useIsMobile } from "@/hooks/use-mobile";

// The overview does not render a felt until a table/replay is opened.
const TournamentLiveView = lazy(() => import("@/components/cashier/tournament-live/TournamentLiveView").then(module => ({default: module.TournamentLiveView})));

const TournamentLiveTracker = () => {
  const { tournamentId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tournament, setTournament] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  // `handId` is canonical. Legacy `?hand=N` stays supported only when the
  // replay resolver can prove it maps to one completed hand in this tournament.
  const replayTarget = parseReplayTarget(searchParams);
  const focusedPostId = searchParams.get("post")?.trim() || null;
  const activeTab = parseViewerTab(
    searchParams.get("tab"),
    FEATURES.liveViewerPulseV2
      ? defaultViewerTab({ isMobile, hasDeepLinkedHand: replayTarget != null })
      : replayTarget != null ? "hands" : "updates",
  );

  useEffect(() => {
    if (!FEATURES.liveViewerPulseV2 || !isMobile || searchParams.has("tab") || replayTarget != null) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", "hands");
      return next;
    }, { replace: true });
  }, [isMobile, replayTarget, searchParams, setSearchParams]);

  const shareUrl = useCallback(
    async (url: string, ok: string) => {
      const title = tournament?.name ? `Live Tracker — ${tournament.name}` : "VinPoker Live Tracker";
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        toast.success(ok);
      } catch (e: any) {
        if (e?.name === "AbortError") return; // user cancelled the native sheet
        try {
          await navigator.clipboard.writeText(url);
          toast.success(ok);
        } catch {
          toast.error("Không sao chép được link — hãy copy từ thanh địa chỉ");
        }
      }
    },
    [tournament?.name],
  );

  const handleShare = useCallback(() => shareUrl(window.location.href, "Đã sao chép link live tracker"), [shareUrl]);

  // Hand-feed links use UUID identity so duplicate per-table hand numbers cannot
  // silently open the newest hand on the current live table.
  const handleShareHand = useCallback(
    (target: ReplayTarget) => {
      const u = new URL(window.location.href);
      if (FEATURES.liveViewerRPTShell) u.searchParams.set("tab", "hands");
      u.searchParams.delete("hand");
      if (target.handId) u.searchParams.set("handId", target.handId);
      if (target.tableId) u.searchParams.set("tableId", target.tableId);
      return shareUrl(u.toString(), `Đã sao chép link ván #${target.handNumber ?? "?"}`);
    },
    [shareUrl],
  );

  // Hand-feed "Xem ván" → set canonical identity + scroll to the featured felt.
  // the featured felt.
  const handleViewHand = useCallback(
    (target: ReplayTarget) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (FEATURES.liveViewerRPTShell) p.set("tab", "hands");
          p.delete("post");
          p.delete("hand");
          if (target.handId) p.set("handId", target.handId);
          if (target.tableId) p.set("tableId", target.tableId);
          return p;
        },
        { replace: false },
      );
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setSearchParams],
  );

  const handleReplayTargetChange = useCallback(
    (target: ReplayTarget) => {
      setSearchParams(
        (prev) => {
          const p = replaceReplayTargetParams(prev, target);
          if (FEATURES.liveViewerRPTShell) p.set("tab", "hands");
          return p;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  // Leaving the felt drops every replay identity so a refresh stays on the tabs.
  const handleCloseHand = useCallback(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("hand");
        p.delete("handId");
        p.delete("tableId");
        if (FEATURES.liveViewerRPTShell) p.set("tab", "hands");
        return p;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const handleTabChange = useCallback(
    (tab: ViewerTab) => {
      if (!FEATURES.liveViewerRPTShell) return;
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("tab", tab);
          if (tab !== "hands") {
            p.delete("hand");
            p.delete("handId");
            p.delete("tableId");
          }
          if (tab !== "updates") p.delete("post");
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleSharePost = useCallback(
    (postId: string) => {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", "updates");
      u.searchParams.set("post", postId);
      u.searchParams.delete("hand");
      u.searchParams.delete("handId");
      u.searchParams.delete("tableId");
      return shareUrl(u.toString(), "Đã sao chép link tin giải đấu");
    },
    [shareUrl],
  );

  useEffect(() => {
    if (!tournamentId) return;
    (async () => {
      const { data } = await supabase
        .from("tournaments")
        .select("id, name, status, prize_pool, players_remaining, current_level, buy_in, guarantee_amount, starting_stack, club:clubs(id, name)")
        .eq("id", tournamentId)
        .maybeSingle();
      setTournament(data);
      setLoading(false);
    })();
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    const channel = supabase
      .channel(`live-tracker:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
        (payload) => setTournament((prev: any) => (prev ? { ...prev, ...payload.new } : prev))
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tournamentId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-muted-foreground">Không tìm thấy giải đấu</p>
        <Button variant="outline" onClick={() => nav("/")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Quay lại
        </Button>
      </div>
    );
  }

  return (
    <div className={FEATURES.liveViewerRPTShell ? "min-w-0 space-y-3 sm:space-y-4" : "space-y-4"}>
      {!FEATURES.liveViewerRPTShell && (
        <div className="flex items-center gap-3">
          <BackButton />
        </div>
      )}

      <LiveHub
        tournamentId={tournamentId!}
        title={tournament.name}
        clubName={tournament.club?.name}
        clubId={tournament.club?.id}
        prizePool={tournament.prize_pool}
        playersRemaining={tournament.players_remaining}
        currentLevel={tournament.current_level}
        guarantee={tournament.guarantee_amount}
        buyIn={tournament.buy_in}
        startingStack={tournament.starting_stack}
        onShare={handleShare}
        initialReplayTarget={replayTarget}
        onViewHand={handleViewHand}
        onReplayTargetChange={handleReplayTargetChange}
        onShareHand={handleShareHand}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        focusedPostId={focusedPostId}
        onSharePost={handleSharePost}
        onCloseHand={handleCloseHand}
      >
        <TournamentLiveView tournamentId={tournamentId!} />
      </LiveHub>
    </div>
  );
};

export default TournamentLiveTracker;
