import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import {
  loadOpsCapabilities,
  loadSuperAdminClubPage,
  verifySuperAdminClub,
  type OpsCapabilitySource,
  type OpsRpcClient,
} from "@/ops/auth/opsCapabilityLoader";
import type {
  OpsClubCapabilityRow,
  OpsSuperAdminClub,
} from "@/ops/auth/opsCapabilityContract";
import {
  getAvailableOpsModulesForSource,
  getModuleClubIds,
  getOpsModule,
  type OpsModuleDefinition,
  type OpsModuleId,
  type OpsScopeSnapshot,
} from "@/ops/registry/opsModuleRegistry";

export type OpsClubMetadata = {
  id: string;
  name: string;
};

export type OpsCapabilityContextValue = {
  loading: boolean;
  scopeError: string | null;
  metadataError: string | null;
  capabilitySource: OpsCapabilitySource | null;
  scope: OpsClubCapabilityRow[];
  snapshot: OpsScopeSnapshot;
  clubs: OpsClubMetadata[];
  operatorClubIds: string[];
  floorClubIds: string[];
  cashierClubIds: string[];
  hasOwnerAccess: boolean;
  hasFloorAccess: boolean;
  hasCashierAccess: boolean;
  hasAnyAccess: boolean;
  isSuperAdmin: boolean;
  availableModules: OpsModuleDefinition[];
  moduleClubIds: (moduleId: OpsModuleId) => string[];
  searchSuperAdminClubs: (input: {
    search?: string;
    afterName?: string;
    afterId?: string;
    limit?: number;
  }) => Promise<OpsSuperAdminClub[]>;
  verifySuperAdminClub: (clubId: string) => Promise<OpsSuperAdminClub | null>;
  refresh: () => void;
};

const OpsCapabilityContext = createContext<OpsCapabilityContextValue | null>(null);

export function OpsCapabilityProvider({ children }: { children: ReactNode }) {
  const client = useSupabaseClient();
  const rpcClient = client as unknown as OpsRpcClient;
  const { user, loading: authLoading, verificationRevision } = useOpsAuth();
  const verifiedScopeActor = useRef<string | null>(null);
  const [scopeActorId, setScopeActorId] = useState<string | null>(null);
  const [scope, setScope] = useState<OpsClubCapabilityRow[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [capabilitySource, setCapabilitySource] = useState<OpsCapabilitySource | null>(null);
  const [clubs, setClubs] = useState<OpsClubMetadata[]>([]);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const searchSuperAdminClubs = useCallback(
    (input: { search?: string; afterName?: string; afterId?: string; limit?: number }) =>
      loadSuperAdminClubPage(rpcClient, input),
    [rpcClient],
  );
  const verifySuperAdminClubById = useCallback(
    (clubId: string) => verifySuperAdminClub(rpcClient, clubId),
    [rpcClient],
  );

  useEffect(() => {
    if (authLoading) {
      verifiedScopeActor.current = null;
      setLoading(true);
      return;
    }
    if (!user) {
      verifiedScopeActor.current = null;
      setScopeActorId(null);
      setScope([]);
      setIsSuperAdmin(false);
      setCapabilitySource(null);
      setClubs([]);
      setScopeError(null);
      setMetadataError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    // A verified same-actor refocus still reloads canonical capabilities, but
    // keeps the current workspace mounted until that result settles.
    if (verifiedScopeActor.current !== user.id) {
      setLoading(true);
      setScopeActorId(null);
      setScope([]);
      setIsSuperAdmin(false);
      setCapabilitySource(null);
      setClubs([]);
      setScopeError(null);
      setMetadataError(null);
    }

    void (async () => {
      try {
        const loaded = await loadOpsCapabilities(rpcClient);
        if (cancelled) return;
        verifiedScopeActor.current = user.id;
        setScopeActorId(user.id);
        setScopeError(null);
        setMetadataError(null);
        setScope(loaded.scope);
        setIsSuperAdmin(loaded.global.is_super_admin);
        setCapabilitySource(loaded.source);

        const clubIds = [...new Set(loaded.scope.map((row) => row.club_id))];
        setClubs((current) => current.filter((club) => clubIds.includes(club.id)));
        if (!clubIds.length) {
          setLoading(false);
          return;
        }

        const metadataResult = await client.from("clubs").select("id,name").in("id", clubIds);
        if (cancelled) return;
        if (metadataResult.error) {
          setMetadataError("Tên CLB tạm thời chưa tải được; quyền server vẫn được giữ nguyên.");
          setClubs([]);
        } else {
          setClubs((metadataResult.data ?? []) as OpsClubMetadata[]);
        }
        setLoading(false);
      } catch {
        if (cancelled) return;
        verifiedScopeActor.current = null;
        setScopeActorId(null);
        setScope([]);
        setIsSuperAdmin(false);
        setCapabilitySource(null);
        setClubs([]);
        setScopeError("Không tải được phạm vi vận hành. Hệ thống đã khóa quyền để bảo vệ CLB.");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, client, revision, rpcClient, user, verificationRevision]);

  const value = useMemo<OpsCapabilityContextValue>(() => {
    const ownsScope = !!user && scopeActorId === user.id;
    const ownedScope = ownsScope ? scope : [];
    const ownedSuperAdmin = ownsScope && isSuperAdmin;
    const operatorClubIds = [...new Set(ownedScope.map((row) => row.club_id))];
    const snapshot: OpsScopeSnapshot = {
      clubs: ownedScope,
      global: { is_super_admin: ownedSuperAdmin },
    };
    const availableModules = getAvailableOpsModulesForSource(snapshot, ownsScope ? capabilitySource : null);
    const floorClubIds = getModuleClubIds(getOpsModule("floor"), ownedScope);
    const cashierClubIds = getModuleClubIds(getOpsModule("cashier"), ownedScope);
    const hasOwnerAccess = ownedSuperAdmin || ownedScope.some((row) => row.can_owner);
    const hasFloorAccess = ownedSuperAdmin || floorClubIds.length > 0;
    const hasCashierAccess = ownedSuperAdmin || cashierClubIds.length > 0;

    return {
      loading: authLoading || loading || (!!user && !ownsScope && !scopeError),
      scopeError,
      metadataError,
      capabilitySource: ownsScope ? capabilitySource : null,
      scope: ownedScope,
      snapshot,
      clubs: ownsScope ? clubs : [],
      operatorClubIds,
      floorClubIds,
      cashierClubIds,
      hasOwnerAccess,
      hasFloorAccess,
      hasCashierAccess,
      hasAnyAccess: availableModules.length > 0,
      isSuperAdmin: ownedSuperAdmin,
      availableModules,
      moduleClubIds: (moduleId) => getModuleClubIds(getOpsModule(moduleId), ownedScope),
      searchSuperAdminClubs,
      verifySuperAdminClub: verifySuperAdminClubById,
      refresh,
    };
  }, [
    authLoading,
    capabilitySource,
    clubs,
    isSuperAdmin,
    loading,
    metadataError,
    refresh,
    scope,
    scopeError,
    scopeActorId,
    user,
    searchSuperAdminClubs,
    verifySuperAdminClubById,
  ]);

  return <OpsCapabilityContext.Provider value={value}>{children}</OpsCapabilityContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOpsCapabilities(): OpsCapabilityContextValue {
  const value = useContext(OpsCapabilityContext);
  if (!value) throw new Error("useOpsCapabilities must be used inside OpsCapabilityProvider.");
  return value;
}
