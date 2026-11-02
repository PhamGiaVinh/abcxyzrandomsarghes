import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type FnbClubRow = { id: string; name: string };
type FnbClubIdsRpc = (name: "fnb_club_ids", args: { _user_id: string }) => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * F&B club loader — mirrors `useOperatorClubs` but scoped via the live `fnb_club_ids` RPC
 * (memberships ∪ owned clubs ∪ all-if-super_admin). `clubs === null` = unverified (loading/error); `[]` = loaded,
 * none assigned (show the "chưa được phân công F&B" state). Single club → caller auto-selects;
 * multiple → caller shows a picker. The RPC response is validated before exposing a scope.
 */
export function useFnbClubs() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ actor: string | null; clubs: FnbClubRow[] | null; error: string | null }>({ actor: null, clubs: null, error: null });
  const reload = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!userId) {
      setState({ actor: null, clubs: authLoading ? null : [], error: null });
      return;
    }
    if (authLoading) return;
    let cancelled = false;
    setState({ actor: userId, clubs: null, error: null });
    void (async () => {
      try {
        const { data: ids, error: scopeError } = await (supabase.rpc as unknown as FnbClubIdsRpc)("fnb_club_ids", { _user_id: userId });
        if (cancelled) return;
        if (scopeError || !Array.isArray(ids)) throw new Error("scope_read_failed");
        const idArr = ids.map((row: unknown) => {
          const id = typeof row === "string" ? row : row && typeof row === "object" && "fnb_club_ids" in row ? row.fnb_club_ids : undefined;
          if (typeof id !== "string" || !id) throw new Error("scope_read_malformed");
          return id;
        });
        if (!idArr.length) {
          setState({ actor: userId, clubs: [], error: null });
          return;
        }
        const { data: cs, error: namesError } = await supabase.from("clubs").select("id,name").in("id", idArr);
        if (cancelled) return;
        if (namesError || !Array.isArray(cs) || !cs.length || cs.some(c => !idArr.includes(c.id) || typeof c.name !== "string")) throw new Error("club_read_failed");
        setState({ actor: userId, clubs: cs as FnbClubRow[], error: null });
      } catch {
        if (!cancelled) setState({ actor: userId, clubs: null, error: "Không tải được danh sách CLB F&B. Hãy thử lại; chưa thể xác minh phân công." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, authLoading, attempt]);

  // Hide the previous actor synchronously, before the next effect can run.
  const visible = !authLoading && state.actor === userId;
  const clubs = !userId && !authLoading ? [] : visible ? state.clubs : null;
  const error = userId && visible ? state.error : null;
  const clubIds = (clubs ?? []).map((c) => c.id);
  return { loading: authLoading || (clubs === null && !error), user, clubs, clubIds, error, reload };
}
