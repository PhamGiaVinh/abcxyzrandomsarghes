import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import {
  TournamentOpsProvider,
  type TournamentOpsSnapshot,
} from "@/ops/workspace/TournamentOpsProvider";
import {
  floorScopeFingerprint,
  isCurrentTournamentScope,
  type VerifiedTournamentScope,
} from "@/ops/auth/opsTournamentScope";
import { OpsAccessDenied } from "@/ops/pages/OpsEntryResolver";

/**
 * Resolves a tournament only inside the caller-bound Floor club scope before
 * mounting any tournament data hook. The club-name metadata query is not part
 * of this authorization decision.
 */
export function OpsTournamentScopeGate({ children }: { children: ReactNode }) {
  const { id } = useParams();
  const client = useSupabaseClient();
  const { floorClubIds, isSuperAdmin, loading, scopeError } = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const selectedScope = selectedClubId && (isSuperAdmin || floorClubIds.includes(selectedClubId))
    ? [selectedClubId]
    : [];
  const scopeFingerprint = floorScopeFingerprint(selectedScope);
  const [verification, setVerification] = useState<VerifiedTournamentScope>({
    status: "checking",
    tournamentId: null,
    scopeFingerprint: "",
  });
  const [snapshot, setSnapshot] = useState<TournamentOpsSnapshot | null>(null);

  useEffect(() => {
    if (loading) {
      setVerification({
        status: "checking",
        tournamentId: id ?? null,
        scopeFingerprint,
      });
      return;
    }
    if (scopeError || !id || !selectedClubId || selectedScope.length === 0) {
      setVerification({
        status: "denied",
        tournamentId: id ?? null,
        scopeFingerprint,
      });
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setVerification({
      status: "checking",
      tournamentId: id,
      scopeFingerprint,
    });
    void (async () => {
      try {
        const { data, error } = await client
          .from("tournaments")
          .select("id, club_id, name, status")
          .eq("id", id)
          .eq("club_id", selectedClubId)
          .is("deleted_at", null)
          .maybeSingle();
        if (cancelled) return;
        const allowed = !error && data?.id === id && data.club_id === selectedClubId;
        setVerification({
          status: allowed ? "allowed" : "denied",
          tournamentId: id,
          scopeFingerprint,
        });
        setSnapshot(allowed ? {
          tournamentId: data.id,
          clubId: data.club_id,
          tournamentName: data.name,
          status: data.status,
        } : null);
      } catch {
        if (!cancelled) {
          setVerification({
            status: "denied",
            tournamentId: id,
            scopeFingerprint,
          });
        }
        setSnapshot(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, id, isSuperAdmin, loading, scopeError, scopeFingerprint, selectedClubId, selectedScope.length]);

  const verificationMatchesRoute = verification.tournamentId === (id ?? null)
    && verification.scopeFingerprint === scopeFingerprint;
  if (!verificationMatchesRoute || verification.status === "checking") {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center text-zinc-300">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-300" />
        Đang kiểm tra phạm vi giải đấu…
      </main>
    );
  }
  if (verification.status === "denied") {
    return <OpsAccessDenied message="Giải đấu không thuộc CLB Floor đang được chọn." />;
  }
  return isCurrentTournamentScope(verification, id, scopeFingerprint) && snapshot
    ? <TournamentOpsProvider snapshot={snapshot}>{children}</TournamentOpsProvider>
    : null;
}
