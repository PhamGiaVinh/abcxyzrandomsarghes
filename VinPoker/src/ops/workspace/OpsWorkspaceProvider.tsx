import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { OpsSuperAdminClub } from "@/ops/auth/opsCapabilityContract";
import type { OpsModuleDefinition } from "@/ops/registry/opsModuleRegistry";

type OpsWorkspaceContextValue = {
  selectedClubId: string | null;
  verifiedSuperAdminClubs: ReadonlyMap<string, OpsSuperAdminClub>;
  rememberVerifiedSuperAdminClub: (club: OpsSuperAdminClub) => void;
  registerRealtimeCleanup: (cleanup: () => void) => () => void;
  selectWorkspace: (module: OpsModuleDefinition, clubId: string, chipTournament?: string) => Promise<void>;
};

const OpsWorkspaceContext = createContext<OpsWorkspaceContextValue | null>(null);

export function OpsWorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const selectedClubId = params.get("club");
  const realtimeCleanup = useRef(new Set<() => void>());
  const [verifiedSuperAdminClubs, setVerifiedSuperAdminClubs] = useState(
    () => new Map<string, OpsSuperAdminClub>(),
  );

  const rememberVerifiedSuperAdminClub = useCallback((club: OpsSuperAdminClub) => {
    setVerifiedSuperAdminClubs((current) => {
      const next = new Map(current);
      next.set(club.club_id, club);
      return next;
    });
  }, []);

  const registerRealtimeCleanup = useCallback((cleanup: () => void) => {
    realtimeCleanup.current.add(cleanup);
    return () => realtimeCleanup.current.delete(cleanup);
  }, []);

  const selectWorkspace = useCallback(async (module: OpsModuleDefinition, clubId: string, chipTournament?: string) => {
    const previousClubId = new URLSearchParams(location.search).get("club");
    if (previousClubId && previousClubId !== clubId) {
      for (const cleanup of realtimeCleanup.current) cleanup();
      realtimeCleanup.current.clear();
      await queryClient.cancelQueries({ queryKey: ["ops", previousClubId] });
      queryClient.removeQueries({ queryKey: ["ops", previousClubId] });
    }
    const scope = new URLSearchParams({ club: clubId });
    if (module.id === "chip-ops" && chipTournament) scope.set("t", chipTournament);
    navigate(`${module.route}?${scope}`);
  }, [location.search, navigate, queryClient]);

  const value = useMemo<OpsWorkspaceContextValue>(() => ({
    selectedClubId,
    verifiedSuperAdminClubs,
    rememberVerifiedSuperAdminClub,
    registerRealtimeCleanup,
    selectWorkspace,
  }), [
    rememberVerifiedSuperAdminClub,
    registerRealtimeCleanup,
    selectWorkspace,
    selectedClubId,
    verifiedSuperAdminClubs,
  ]);

  return <OpsWorkspaceContext.Provider value={value}>{children}</OpsWorkspaceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOpsWorkspace(): OpsWorkspaceContextValue {
  const value = useContext(OpsWorkspaceContext);
  if (!value) throw new Error("useOpsWorkspace must be used inside OpsWorkspaceProvider.");
  return value;
}
