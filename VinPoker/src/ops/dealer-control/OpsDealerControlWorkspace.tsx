import { useEffect, useMemo, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import {
  loadDealerControlReadModel,
  type DealerControlReadModel,
} from "@/ops/dealer-control/dealerControlReadAdapter";
import { DealerControlWorkspaceView } from "@/ops/dealer-control/DealerControlWorkspaceView";

export default function OpsDealerControlWorkspace() {
  const { user, session, loading } = useOpsAuth();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const allowed = Boolean(user && !loading && !capabilities.loading && !capabilities.scopeError
    && selectedClubId && (capabilities.isSuperAdmin
      || capabilities.moduleClubIds("dealer-control").includes(selectedClubId)));
  // Scope changes retire the entire snapshot, even when returning A -> B -> A.
  return <ScopedDealerControlWorkspace key={JSON.stringify([
    user?.id, sessionReadEpoch(session), allowed, selectedClubId,
  ])} allowed={allowed} />;
}

function ScopedDealerControlWorkspace({ allowed }: { allowed: boolean }) {
  const client = useSupabaseClient();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const dealerControlClubIds = capabilities.moduleClubIds("dealer-control");
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || dealerControlClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    model: DealerControlReadModel | null;
    errorCode: string | null;
  }>({ loading: true, model: null, errorCode: null });

  useEffect(() => {
    if (!allowed || !clubId) return;
    let active = true;
    const controller=new AbortController();
    const deadline = window.setTimeout(() => {
      if (!active) return;
      active = false;
      controller.abort();
      setState({ loading: false, model: null, errorCode: "DEALER_CONTROL_READ_TIMEOUT" });
    }, 10000);
    setState((current) => ({ ...current, loading: true, errorCode: null }));
    void loadDealerControlReadModel(client, clubId,controller.signal)
      .then((model) => {
        window.clearTimeout(deadline);
        if (active) setState({ loading: false, model, errorCode: null });
      })
      .catch((error: unknown) => {
        window.clearTimeout(deadline);
        if (active) setState({ loading: false, model: null, errorCode: safeErrorCode(error) });
      }).finally(()=>controller.abort());
    return () => { active = false;controller.abort(); window.clearTimeout(deadline); };
  }, [allowed, client, clubId, revision]);

  const clubName = useMemo(
    () => capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB đã chọn",
    [capabilities.clubs, clubId],
  );

  return (
    <DealerControlWorkspaceView
      clubName={clubName}
      model={allowed ? state.model : null}
      loading={capabilities.loading || (allowed && state.loading)}
      errorCode={capabilities.scopeError ?? (!allowed && !capabilities.loading ? "DEALER_CONTROL_CLUB_SCOPE_REQUIRED" : state.errorCode)}
      onRefresh={() => {
        if (capabilities.scopeError) capabilities.refresh();
        else setRevision((value) => value + 1);
      }}
    />
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "DEALER_CONTROL_READ_FAILED";
  return /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "DEALER_CONTROL_READ_FAILED";
}
