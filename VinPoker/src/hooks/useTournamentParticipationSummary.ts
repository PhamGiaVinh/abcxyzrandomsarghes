import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseParticipationSummary } from "@/lib/tournamentParticipation";

type Summary = ReturnType<typeof parseParticipationSummary>;
type State = { scope: string; status: "loading" | "ready" | "error"; data?: Summary };

/** Read-only display boundary: never substitute cached tournament counters. */
export function useTournamentParticipationSummary(actorId: string | undefined, clubId: string | undefined,
  tournamentId: string | null, refresh: number) {
  const scope = JSON.stringify([actorId, clubId, tournamentId]);
  const [state, setState] = useState<State>({ scope: "", status: "loading" });
  const requestRef = useRef<((revision: number) => void) | null>(null);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let trailing = false;
    let lastRefresh: number | undefined;
    setState({ scope, status: "loading" });
    if (!actorId || !clubId || !tournamentId) return () => { cancelled = true; };
    const request = (revision: number) => {
      if (cancelled || revision === lastRefresh) return;
      lastRefresh = revision;
      if (running) { trailing = true; return; }
      running = true;
      setState({ scope, status: "loading" });
      void (async () => {
        do {
          trailing = false;
          try {
            const { data, error } = await (supabase.rpc as unknown as
              (name: "get_tournament_participation_counts_v1", args: { p_tournament_id: string }) =>
                PromiseLike<{ data: unknown; error: { message: string } | null }>)("get_tournament_participation_counts_v1", {
              p_tournament_id: tournamentId,
            });
            if (error) throw error;
            const summary = parseParticipationSummary(data, tournamentId);
            if (!cancelled) setState({ scope, status: "ready", data: summary });
          } catch {
            if (!cancelled) setState({ scope, status: "error" });
          }
        } while (!cancelled && trailing);
        running = false;
      })();
    };
    requestRef.current = request;
    return () => {
      cancelled = true;
      if (requestRef.current === request) requestRef.current = null;
    };
  }, [actorId, clubId, tournamentId, scope]);
  useEffect(() => { requestRef.current?.(refresh); }, [scope, refresh]);
  return state.scope === scope ? state : { scope, status: "loading" as const };
}
