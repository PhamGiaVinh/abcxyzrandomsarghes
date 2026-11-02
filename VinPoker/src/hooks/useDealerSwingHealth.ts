import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMemo } from "react";

/**
 * Read-only swing-ENGINE health for the operator console (C2). Calls the access-scoped
 * `get_dealer_swing_health` RPC and polls only while foregrounded.
 * Errors remain explicit and cached data never crosses club scopes.
 */
export interface ClubSwingHealth {
  club_id: string;
  lock: {
    held: boolean;
    owner_id?: string | null;
    locked_by?: string | null;
    locked_at?: string | null;
    expires_at?: string | null;
    is_expired?: boolean;
    age_seconds?: number | null;
    heartbeat_age_seconds?: number | null;
  };
  pre_announce: { pending: number; processing: number; failed_recent: number };
  overdue_now: number;
  last_swing_activity_at: string | null;
}

export function useDealerSwingHealth(clubIds: string[], pollMs = 30_000) {
  const { user, session } = useAuth();
  // A new credential generation must not reuse a previous session's health.
  // Keep the credential itself out of Query keys/devtools/cache persistence.
  const sessionScope = useMemo(() => ({ actor: user?.id, token: session?.access_token, key: crypto.randomUUID() }),
    [user?.id, session?.access_token]);
  const scope = [...new Set(clubIds)].sort();
  const query = useQuery({
    queryKey: ["dealer-swing-engine-health", user?.id, sessionScope.key, scope],
    enabled: !!user && scope.length > 0,
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async ({ signal }): Promise<ClubSwingHealth[]> => {
      if (!user || scope.length === 0) return [];
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = supabase.rpc("get_dealer_swing_health", { p_club_ids: scope }).abortSignal(controller.signal);
      let packet: Awaited<typeof response>;
      try {
        packet = await Promise.race([Promise.resolve(response), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("dealer_swing_health_read_timeout")); }, 15_000);
        })]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
      }
      const { data: d, error } = packet;
      if (error) throw error;
      const valid = (value: unknown): value is ClubSwingHealth => {
        if (!value || typeof value !== "object") return false;
        const row = value as Partial<ClubSwingHealth>;
        const count = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
        const timestamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
        const leaseValid = row.lock?.held !== true || (
          typeof row.lock.is_expired === "boolean" && count(row.lock.age_seconds)
          && timestamp(row.lock.locked_at) && timestamp(row.lock.expires_at)
          && (row.lock.heartbeat_age_seconds == null || count(row.lock.heartbeat_age_seconds))
        );
        return typeof row.club_id === "string" && scope.includes(row.club_id)
          && typeof row.lock?.held === "boolean" && leaseValid && count(row.overdue_now)
          && (row.last_swing_activity_at === null || timestamp(row.last_swing_activity_at))
          && count(row.pre_announce?.pending) && count(row.pre_announce?.processing)
          && count(row.pre_announce?.failed_recent);
      };
      if (!Array.isArray(d)) {
        throw new Error("Invalid dealer swing health response");
      }
      const rows: unknown[] = d;
      if (!rows.every(valid)) throw new Error("Invalid dealer swing health response");
      if (new Set(rows.map((row) => row.club_id)).size !== rows.length) throw new Error("Duplicate dealer swing health clubs");
      return rows;
    },
  });
  return { data: !user ? null : scope.length ? query.data ?? null : [], unavailable: query.isError, refetch: query.refetch };
}
