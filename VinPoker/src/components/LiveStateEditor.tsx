import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTournamentParticipationSummary } from "@/hooks/useTournamentParticipationSummary";
import { Button } from "@/components/ui/button";

interface Props {
  tournament: { id: string; club_id?: string | null };
  onSaved?: () => void;
}
type Clock = { status: string; level: number | null; small: number | null; big: number | null };
type ClockRead = { scope: string; state: "loading" | "ready" | "error"; data?: Clock };

/** Observes canonical state; operator writes stay in the existing workspace. */
export const LiveStateEditor = ({ tournament }: Props) => {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [openedScope, setOpenedScope] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const identity = JSON.stringify([user?.id, loading, tournament.club_id, tournament.id]);
  const identityRef = useRef({ identity, generation: 0 });
  if (identityRef.current.identity !== identity) {
    identityRef.current = { identity, generation: identityRef.current.generation + 1 };
  }
  const scope = `${identity}:${identityRef.current.generation}`;
  const opened = openedScope === scope && !loading && !!user;
  const participation = useTournamentParticipationSummary(opened ? user?.id : undefined,
    tournament.club_id ?? undefined, opened ? tournament.id : null, refresh);
  const [clockRead, setClockRead] = useState<ClockRead>({ scope: "", state: "loading" });
  useEffect(() => {
    let cancelled = false;
    if (!opened || !tournament.club_id) return;
    setClockRead({ scope, state: "loading" });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournament.id });
        if (error) throw error;
        const clock = data as unknown as { tournament_id?: string; status?: string; current_level?: {
          level_number: number; small_blind: number; big_blind: number;
        } | null };
        const level = clock?.current_level;
        if (!clock || clock.tournament_id !== tournament.id || typeof clock.status !== "string"
          || (level != null && ![level.level_number, level.small_blind, level.big_blind]
            .every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0))) {
          throw new Error("invalid_clock_scope");
        }
        if (!cancelled) setClockRead({ scope, state: "ready", data: { status: clock.status,
          level: level?.level_number ?? null, small: level?.small_blind ?? null, big: level?.big_blind ?? null } });
      } catch {
        if (!cancelled) setClockRead({ scope, state: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [opened, scope, tournament.id, tournament.club_id, refresh]);
  const clock = opened && clockRead.scope === scope ? clockRead : { state: "loading" as const, data: undefined };
  const missingScope = !tournament.club_id;
  const unavailable = missingScope || participation.status === "error" || clock.state === "error";
  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <Button type="button" variant="ghost" className="w-full justify-start" disabled={loading || !user}
        aria-expanded={opened} onClick={() => {
          setClockRead({ scope, state: "loading" });
          setOpenedScope(opened ? null : scope);
        }}>
        {t("liveStateSummary.title")}
      </Button>
      {opened && <>
        {unavailable ? <p role="alert" className="text-sm text-destructive">{t("liveStateSummary.error")}</p>
          : participation.status !== "ready" || clock.state !== "ready"
            ? <p role="status" className="text-sm text-muted-foreground">{t("liveStateSummary.loading")}</p>
            : <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt>{t("liveStateSummary.players")}</dt><dd>{participation.data?.counts.remaining}</dd></div>
              <div><dt>{t("liveStateSummary.level")}</dt><dd>{clock.data?.level ?? "—"}</dd></div>
              <div><dt>{t("liveStateSummary.blinds")}</dt><dd>{clock.data?.small == null ? "—" : `${clock.data.small}/${clock.data.big}`}</dd></div>
              <div><dt>{t("liveStateSummary.status")}</dt><dd>{clock.data?.status}</dd></div>
            </dl>}
        <p className="text-xs text-muted-foreground">{t("liveStateSummary.explanation")}</p>
        <Button type="button" variant="outline" onClick={() => setRefresh(value => value + 1)}>{t("liveStateSummary.refresh")}</Button>
        {!missingScope && <Button asChild variant="outline"><Link to={`/ops/floor/tournaments/${encodeURIComponent(tournament.id)}/clock?club=${encodeURIComponent(tournament.club_id!)}`}>
          {t("liveStateSummary.openClock")}
        </Link></Button>}
      </>}
    </section>
  );
};
