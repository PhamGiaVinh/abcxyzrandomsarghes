import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import {
  loadChipOpsTournamentOptions,
  loadIssuedChipInventory,
  loadIssuedStackSummary,
  type ChipOpsTournamentOption,
  type IssuedChipInventory,
  type IssuedStackSummary,
} from "@/ops/chip-ops/chipOpsReadAdapter";
import { ChipOpsWorkspaceView } from "@/ops/chip-ops/ChipOpsWorkspaceView";
import { MultiDayBaggingPanel } from "@/ops/chip-ops/MultiDayBaggingPanel";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";

type WorkspaceState = {
  loading: boolean;
  tournaments: ChipOpsTournamentOption[];
  inventory: IssuedChipInventory | null;
  stacks: IssuedStackSummary | null;
  errorCode: string | null;
};

export default function OpsChipOpsWorkspace() {
  const { user, loading } = useOpsAuth();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const [params] = useSearchParams();
  const allowed = Boolean(user && !loading && !capabilities.loading && !capabilities.scopeError
    && selectedClubId && (capabilities.isSuperAdmin
      || capabilities.moduleClubIds("chip-ops").includes(selectedClubId)));
  // A changed scope owns a fresh read lifetime, including A -> B -> A.
  return <ScopedChipOpsWorkspace key={JSON.stringify([
    user?.id, allowed, selectedClubId, params.get("t"),
  ])} allowed={allowed} />;
}

function ScopedChipOpsWorkspace({ allowed }: { allowed: boolean }) {
  const client = useSupabaseClient();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const [params, setParams] = useSearchParams();
  const chipClubIds = capabilities.moduleClubIds("chip-ops");
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || chipClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const selectedTournamentId = params.get("t") ?? "";
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<WorkspaceState>({
    loading: true,
    tournaments: [],
    inventory: null,
    stacks: null,
    errorCode: null,
  });

  useEffect(() => {
    if (!allowed || !clubId) return;
    let active = true;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => {
      if (!active) return;
      active = false;
      controller.abort();
      setState((current) => ({ ...current, loading: false, inventory: null, stacks: null, errorCode: "CHIP_OPS_READ_TIMEOUT" }));
    }, 10000);
    const load = async () => {
      setState((current) => ({ ...current, loading: true, errorCode: null }));
      try {
        const tournaments = await loadChipOpsTournamentOptions(client, clubId, controller.signal);
        if (!active) return;
        if (selectedTournamentId && !tournaments.some((row) => row.id === selectedTournamentId)) {
          setState({ loading: false, tournaments, inventory: null, stacks: null, errorCode: "CHIP_TOURNAMENT_SCOPE_INVALID" });
          return;
        }
        const [inventory, stacks] = selectedTournamentId
          ? await Promise.all([
            loadIssuedChipInventory(client, selectedTournamentId, controller.signal),
            loadIssuedStackSummary(client, selectedTournamentId, controller.signal),
          ])
          : [null, null];
        if (!active) return;
        setState({ loading: false, tournaments, inventory, stacks, errorCode: null });
      } catch (error) {
        if (!active) return;
        setState((current) => ({
          ...current,
          loading: false,
          inventory: null,
          stacks: null,
          errorCode: safeErrorCode(error),
        }));
      } finally {
        window.clearTimeout(deadline);
      }
    };
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(deadline); };
  }, [allowed, client, clubId, selectedTournamentId, revision]);

  const clubName = useMemo(
    () => capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB đã chọn",
    [capabilities.clubs, clubId],
  );

  const onSelectTournament = (tournamentId: string) => {
    const next = new URLSearchParams(params);
    if (tournamentId) next.set("t", tournamentId);
    else next.delete("t");
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
    <ChipOpsWorkspaceView
      clubName={clubName}
      tournaments={allowed ? state.tournaments : []}
      selectedTournamentId={selectedTournamentId}
      inventory={allowed ? state.inventory : null}
      stacks={allowed ? state.stacks : null}
      loading={capabilities.loading || (allowed && state.loading)}
      errorCode={capabilities.scopeError ?? (!allowed && !capabilities.loading ? "CHIP_OPS_CLUB_SCOPE_REQUIRED" : state.errorCode)}
      onSelectTournament={onSelectTournament}
      onRefresh={() => {
        if (capabilities.scopeError) capabilities.refresh();
        else setRevision((value) => value + 1);
      }}
    />
    {allowed && !state.loading && !state.errorCode && selectedTournamentId
      && state.tournaments.find((row) => row.id === selectedTournamentId)?.phase === "flight"
      && <MultiDayBaggingPanel key={selectedTournamentId} tournamentId={selectedTournamentId} />}
    </div>
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "CHIP_OPS_READ_FAILED";
  return /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "CHIP_OPS_READ_FAILED";
}
