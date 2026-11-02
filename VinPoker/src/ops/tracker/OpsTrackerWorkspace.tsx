import { useEffect, useMemo, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { TrackerWorkspaceView } from "@/ops/tracker/TrackerWorkspaceView";
import { loadTrackerReadModel, type TrackerReadModel } from "@/ops/tracker/trackerReadAdapter";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

export default function OpsTrackerWorkspace() {
  const client = useSupabaseClient();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const trackerClubIds = capabilities.moduleClubIds("tracker");
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || trackerClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    model: TrackerReadModel | null;
    errorCode: string | null;
    clubId: string | null;
  }>({ loading: true, model: null, errorCode: null,clubId:null });

  useEffect(() => {
    if (!clubId || capabilities.loading || capabilities.scopeError) return;
    let active = true;
    const controller=new AbortController();
    setState({loading:true,model:null,errorCode:null,clubId});
    void observeTrackerContextRead(loadTrackerReadModel(client, clubId,controller.signal))
      .then((model) => { if (active) setState({ loading: false, model, errorCode: null,clubId }); })
      .catch((error: unknown) => {
        if (active) setState({ loading: false, model: null, errorCode: safeErrorCode(error),clubId });
      }).finally(()=>controller.abort());
    return () => { active = false;controller.abort(); };
  }, [capabilities.loading, capabilities.scopeError, client, clubId, revision]);

  const clubName = useMemo(
    () => capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB đã chọn",
    [capabilities.clubs, clubId],
  );

  return (
    <TrackerWorkspaceView
      clubName={clubName}
      model={clubId&&state.clubId===clubId ? state.model : null}
      loading={capabilities.loading || state.loading || state.clubId!==clubId}
      errorCode={capabilities.loading ? null : capabilities.scopeError ?? (!clubId ? "TRACKER_CLUB_SCOPE_REQUIRED" : state.clubId===clubId?state.errorCode:null)}
      onRefresh={() => setRevision((value) => value + 1)}
    />
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "TRACKER_READ_FAILED";
  if(error.message==='tracker_context_read_timeout')return 'TRACKER_READ_TIMEOUT';
  return /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "TRACKER_READ_FAILED";
}
