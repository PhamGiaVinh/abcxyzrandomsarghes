import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { loadOpsCapabilities, type LoadedOpsCapabilities, type OpsRpcClient } from "@/ops/auth/opsCapabilityLoader";
import { getOpsModule, type OpsModuleId } from "@/ops/registry/opsModuleRegistry";
import type { OpsClubCapabilityRow } from "@/ops/auth/opsCapabilityContract";

/** Caller-bound membership readiness for operational documents, independent of nav role timing. */
export function useOperationalCapabilities() {
  const { user, session, loading, authError } = useAuth();
  const actorId = user?.id;
  const key = JSON.stringify([actorId, sessionReadEpoch(session), loading, authError]);
  const [state, setState] = useState<{ key: string; value: LoadedOpsCapabilities | null; error: boolean } | null>(null);
  useEffect(() => {
    if (loading || authError || !actorId) return;
    let current = true;
    void observeTrackerContextRead(loadOpsCapabilities(supabase as unknown as OpsRpcClient))
      .then(value => { if (current) setState({ key, value, error: false }); })
      .catch(() => { if (current) setState({ key, value: null, error: true }); });
    return () => { current = false; };
  }, [key, loading, authError, actorId]);
  const visible = state?.key === key ? state : null;
  const value = !loading && !authError && user ? visible?.value ?? null : null;
  const snapshot = value ? { clubs: value.scope, global: value.global } : null;
  return {
    loading: loading || Boolean(user && !authError && !visible),
    error: Boolean(authError || visible?.error),
    allows: (module: OpsModuleId) => Boolean(snapshot && getOpsModule(module).capabilityPredicate(snapshot)),
    hasFacet: (facet: keyof Omit<OpsClubCapabilityRow, "club_id">, clubId?: string) => Boolean(value && (
      value.global.is_super_admin || value.scope.some(row => (!clubId || row.club_id === clubId) && (row.can_owner || row[facet]))
    )),
  };
}
