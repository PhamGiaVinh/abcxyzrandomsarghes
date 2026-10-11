import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Play, Pause, SkipForward, SkipBack, Minus, Plus, RefreshCw, Timer } from "lucide-react";
import {
  canUseTournamentClockPostStartControls,
  getTournamentClockPrimaryAction,
} from "@/lib/tournament/clockControlState";

interface ClockData {
  tournament_id: string;
  status: string;
  is_running: boolean;
  elapsed_seconds: number;
  remaining_seconds: number;
  current_level: {
    id: string;
    level_number: number;
    small_blind: number;
    big_blind: number;
    ante: number;
    duration_minutes: number;
    is_break: boolean;
  } | null;
  is_break: boolean;
  next_level: {
    id: string;
    level_number: number;
    small_blind: number;
    big_blind: number;
    ante: number;
    duration_minutes: number;
    is_break: boolean;
  } | null;
  message?: string | null;
  control_revision: string;
}

export function ClockPanel({ tournamentId, refreshTrigger }: { tournamentId: string; refreshTrigger?: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const identity = JSON.stringify([user?.id, tournamentId]);
  const identityRef = useRef({ identity, generation: 0 });
  if (identityRef.current.identity !== identity) {
    identityRef.current = { identity, generation: identityRef.current.generation + 1 };
  }
  const scope = `${identity}:${identityRef.current.generation}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const readSequence = useRef(0);
  const mounted = useRef(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [storedClock, setClock] = useState<ClockData | null>(null);
  const clock = loadedScope === scope ? storedClock : null;
  const [readError, setReadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localRemaining, setLocalRemaining] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [autoNextLevel, setAutoNextLevel] = useState(true);
  const advancingRef = useRef<{ scope: string } | null>(null);
  const actionRef = useRef<{ scope: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadClock = useCallback(async () => {
    const sequence = ++readSequence.current;
    const current = () => mounted.current && scopeRef.current === scope && sequence === readSequence.current;
    setLoadedScope(null);
    setReadError(false);
    setClock(null);
    setIsRunning(false);
    setLoading(true);
    try {
      if (!user?.id) return;
      const { data, error } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
      if (!current()) return;
      if (error) throw error;
      const c = data as unknown as ClockData;
      if (!c || c.tournament_id !== tournamentId || !Number.isFinite(c.remaining_seconds)
        || typeof c.is_running !== "boolean") throw new Error("Clock context unavailable");
      setClock(c);
      setLoadedScope(scope);
      setLocalRemaining(c.remaining_seconds);
      setIsRunning(c.is_running);
    } catch (error) {
      if (current()) {
        setReadError(true);
        toast.error(error instanceof Error ? error.message : t("tournamentLive.clock.refresh"));
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [scope, tournamentId, user?.id, t]);

  useEffect(() => { loadClock(); }, [loadClock, refreshTrigger]);

  const handleClockAction = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    if (!clock || loading || !user?.id || actionRef.current?.scope === scope || scopeRef.current !== scope) return;
    const operation = { scope };
    const current = () => mounted.current && scopeRef.current === scope && actionRef.current === operation;
    const expectedControlRevision = action === "start" ? null : clock?.control_revision;
    if (action !== "start" && !expectedControlRevision) {
      toast.error(t("tournamentLive.clock.refresh"));
      await loadClock();
      return;
    }
    actionRef.current = operation;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-clock", {
        body: {
          tournament_id: tournamentId,
          action,
          ...extra,
          ...(expectedControlRevision
            ? { expected_control_revision: expectedControlRevision }
            : {}),
        },
      });
      if (!current()) return;
      if (error || data?.error) {
        toast.error(data?.error || error?.message);
        await loadClock();
        return;
      }
      toast.success("OK");
      await loadClock();
    } catch (e: unknown) {
      if (current()) toast.error(e instanceof Error ? e.message : t("tournamentLive.clock.refresh"));
    } finally {
      if (current()) setLoading(false);
      if (actionRef.current === operation) actionRef.current = null;
    }
  }, [clock, loading, user?.id, scope, tournamentId, loadClock, t]);

  const advanceToNextLevel = useCallback(async () => {
    if (!clock?.next_level || advancingRef.current?.scope === scope) return;
    const operation = { scope };
    advancingRef.current = operation;
    try {
      await handleClockAction("next_level");
    } finally {
      if (advancingRef.current === operation) advancingRef.current = null;
    }
  }, [clock, handleClockAction, scope]);

  const hasRemainingTime = localRemaining > 0;
  useEffect(() => {
    if (!clock || !isRunning || !hasRemainingTime) return;
    const interval = setInterval(() => {
      setLocalRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [clock, isRunning, hasRemainingTime]);

  useEffect(() => {
    if (!loading && isRunning && localRemaining === 0 && autoNextLevel && clock?.next_level && advancingRef.current?.scope !== scope) {
      advanceToNextLevel();
    }
  }, [loading, localRemaining, isRunning, autoNextLevel, clock, advanceToNextLevel, scope]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const isLowTime = localRemaining <= 30 && localRemaining > 0 && isRunning;
  const primaryClockAction = clock ? getTournamentClockPrimaryAction(clock) : null;
  const canUsePostStartControls = clock
    ? canUseTournamentClockPostStartControls(clock)
    : false;

  return (
    <Card className="operations-typography min-w-0 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{t("tournamentLive.clock.title")}</div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={autoNextLevel ? "default" : "outline"}
            onClick={() => setAutoNextLevel(!autoNextLevel)}
            className={`min-h-11 ${autoNextLevel ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
          >
            <Timer className="w-3.5 h-3.5 mr-1" />
            {autoNextLevel ? "Auto" : "Manual"}
          </Button>
          <Button size="sm" className="min-h-11" variant="outline" onClick={loadClock} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            {t("tournamentLive.clock.refresh")}
          </Button>
        </div>
      </div>

      {readError && <p role="alert">{t("tv.loadError")}</p>}
      {loading && !clock && <p role="status">{t("common.loading")}</p>}
      {clock && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className={`text-5xl sm:text-6xl font-mono font-bold tabular-nums leading-none ${isLowTime ? "text-amber-400 animate-pulse" : ""} ${localRemaining === 0 && isRunning ? "text-red-500" : ""}`}>
              {formatTime(Math.max(0, localRemaining))}
            </div>
            {/* Floor toolbar — large touch controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {primaryClockAction === "start" && (
                <Button size="lg" className="h-12 px-5 text-base" onClick={() => handleClockAction("start")} disabled={loading}>
                  <Play className="w-5 h-5 mr-1.5" /> {t("tournamentLive.clock.start")}
                </Button>
              )}
              {primaryClockAction === "pause" && (
                <Button size="lg" variant="outline" className="h-12 px-5 text-base" onClick={() => handleClockAction("pause")} disabled={loading}>
                  <Pause className="w-5 h-5 mr-1.5" /> {t("tournamentLive.clock.pause")}
                </Button>
              )}
              {primaryClockAction === "resume" && (
                <Button size="lg" variant="outline" className="h-12 px-4 text-base" onClick={() => handleClockAction("resume")} disabled={loading}>
                  <Play className="w-5 h-5 mr-1.5" /> {t("tournamentLive.clock.resume")}
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-4 text-base"
                onClick={() => handleClockAction("previous_level")}
                disabled={loading || !canUsePostStartControls || (clock.current_level?.level_number ?? 1) <= 1}
              >
                <SkipBack className="w-5 h-5 mr-1.5" /> Về level trước
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-4 text-base" onClick={() => handleClockAction("next_level")} disabled={loading || !canUsePostStartControls || !clock.next_level}>
                <SkipForward className="w-5 h-5 mr-1.5" /> {t("tournamentLive.clock.nextLevel")}
              </Button>
            </div>
          </div>

          {/* Chỉnh phút — adjusts ONLY the remaining time (shifts clock), never the blind
              structure. Disabled until the clock has a current level. */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Chỉnh giờ:</span>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-3 text-sm"
              onClick={() => handleClockAction("adjust_time", { delta_seconds: -60 })}
              disabled={loading || !canUsePostStartControls}
            >
              <Minus className="w-4 h-4 mr-1" /> 1 phút
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-3 text-sm"
              onClick={() => handleClockAction("adjust_time", { delta_seconds: 60 })}
              disabled={loading || !canUsePostStartControls}
            >
              <Plus className="w-4 h-4 mr-1" /> 1 phút
            </Button>
          </div>

          {clock.current_level && (
            <div className="break-words text-sm space-y-1 [overflow-wrap:anywhere]">
              <div className="font-medium">{t("tournamentLive.clock.level")} {clock.current_level.level_number} {clock.current_level.is_break ? "(Break)" : ""}</div>
              <div className="text-muted-foreground">
                {t("tournamentLive.clock.blinds")}: {clock.current_level.small_blind}/{clock.current_level.big_blind}
                {clock.current_level.ante > 0 ? ` · ${t("tournamentLive.clock.ante")}: ${clock.current_level.ante}` : ""}
              </div>
            </div>
          )}

          {clock.next_level && (
            <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
              Next: {t("tournamentLive.clock.level")} {clock.next_level.level_number} · {clock.next_level.small_blind}/{clock.next_level.big_blind}
              {clock.next_level.ante > 0 ? ` · ${t("tournamentLive.clock.ante")}: ${clock.next_level.ante}` : ""}
            </div>
          )}

          {autoNextLevel && isRunning && (
            <div className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1 inline-block">
              Auto-advance ON — sẽ tự động chuyển level khi hết giờ
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
