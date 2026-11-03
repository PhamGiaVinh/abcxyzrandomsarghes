import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Loader2, Search, ShieldAlert, ShieldX } from "lucide-react";
import { DocumentRedirect } from "@/components/DocumentRedirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { resolveOpsEntry } from "@/ops/auth/opsCapabilityRouting";
import { requiresInvitePasswordSetup } from "@/ops/auth/opsInviteCompletion";
import type { OpsSuperAdminClub } from "@/ops/auth/opsCapabilityContract";
import {
  getOpsModule,
  type OpsModuleDefinition,
  type OpsModuleId,
} from "@/ops/registry/opsModuleRegistry";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";

export function OpsRequireSession({ children }: { children: ReactNode }) {
  const { user, loading } = useOpsAuth();
  const location = useLocation();
  if (loading) return <OpsLoading label="Đang kiểm tra phiên Ops…" />;
  if (!user) {
    return (
      <Navigate
        to="/ops/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  if (requiresInvitePasswordSetup() && location.pathname !== "/ops/account") {
    return <Navigate to="/ops/account?mode=reset-password&source=invite" replace />;
  }
  return <>{children}</>;
}

export function OpsEntryResolver() {
  const capabilities = useOpsCapabilities();
  if (capabilities.loading) return <OpsLoading label="Đang tải quyền vận hành…" />;
  if (capabilities.scopeError) return <OpsAccessDenied message={capabilities.scopeError} />;
  const destination = resolveOpsEntry({
    availableModuleRoutes: capabilities.availableModules.map((module) => module.route),
  });
  if (destination === "access-denied") {
    return <OpsAccessDenied message="Tài khoản này chưa được cấp quyền vận hành CLB." />;
  }
  return <Navigate to={destination} replace />;
}

export function OpsModuleGate({
  capability,
  children,
}: {
  capability: OpsModuleId;
  children?: ReactNode;
}) {
  const capabilities = useOpsCapabilities();
  const workspace = useOpsWorkspace();
  const [params] = useSearchParams();
  const clubId = params.get("club");
  const location = useLocation();
  const module = getOpsModule(capability);
  const allowedClubIds = capabilities.moduleClubIds(capability);

  if (capabilities.loading) return <OpsLoading label="Đang tải quyền vận hành…" />;
  if (capabilities.scopeError) return <OpsAccessDenied message={capabilities.scopeError} />;
  if (!capabilities.availableModules.some((available) => available.id === module.id)) {
    return <OpsAccessDenied message={`Tài khoản chưa có quyền mở ${module.title}.`} />;
  }

  if (module.defaultState === "BLOCKED" || module.defaultState === "DISABLED") {
    return <OpsModuleStatus module={module} />;
  }

  // Cross the document boundary only after this module and club are verified.
  // Never import the player auth/client into Ops or carry a stale tournament/tab.
  const operationalRoute = module.id === "fnb"
    ? ({
        "/ops/fnb/counter": "/fnb",
        "/ops/fnb/serve": "/fnb/serve",
        "/ops/fnb/kitchen": "/fnb/kitchen",
        "/ops/fnb/admin": "/fnb/admin",
      } as Record<string, string>)[location.pathname] ?? module.operationalRoute
    : location.pathname === module.route ? module.operationalRoute : undefined;
  const content = operationalRoute
    ? <DocumentRedirect to={operationalRoute} preserveCurrentLocation={false} />
    : children ?? <OpsModuleStatus module={module} />;

  if (!clubId) {
    if (!capabilities.isSuperAdmin && allowedClubIds.length === 1) {
      return <Navigate to={`${module.route}?club=${encodeURIComponent(allowedClubIds[0])}`} replace />;
    }
    return <OpsClubPicker module={module} clubIds={allowedClubIds} />;
  }

  if (allowedClubIds.includes(clubId)) return <>{content}</>;
  if (!capabilities.isSuperAdmin) {
    return <OpsAccessDenied message="CLB trên đường dẫn không thuộc phạm vi quyền của module này." />;
  }

  return (
    <SuperAdminClubGate clubId={clubId}>
      {content}
    </SuperAdminClubGate>
  );
}

function SuperAdminClubGate({ clubId, children }: { clubId: string; children: ReactNode }) {
  const capabilities = useOpsCapabilities();
  const workspace = useOpsWorkspace();
  const cached = workspace.verifiedSuperAdminClubs.get(clubId);
  const [state, setState] = useState<"loading" | "allowed" | "denied">(cached ? "allowed" : "loading");

  useEffect(() => {
    if (cached) {
      setState("allowed");
      return;
    }
    let active = true;
    void capabilities.verifySuperAdminClub(clubId)
      .then((club) => {
        if (!active) return;
        if (!club) {
          setState("denied");
          return;
        }
        workspace.rememberVerifiedSuperAdminClub(club);
        setState("allowed");
      })
      .catch(() => {
        if (active) setState("denied");
      });
    return () => { active = false; };
  }, [cached, capabilities, clubId, workspace]);

  if (state === "loading") return <OpsLoading label="Đang xác minh CLB…" />;
  if (state === "denied") {
    return <OpsAccessDenied message="Không xác minh được CLB cho super-admin. Không tải dữ liệu module." />;
  }
  return <>{children}</>;
}

export function OpsClubPicker({ module, clubIds }: { module: OpsModuleDefinition; clubIds: string[] }) {
  const capabilities = useOpsCapabilities();
  const workspace = useOpsWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpsSuperAdminClub[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const directClubs = useMemo(() => clubIds.map((id) => ({
    club_id: id,
    club_name: capabilities.clubs.find((club) => club.id === id)?.name ?? `CLB ${maskId(id)}`,
  })), [capabilities.clubs, clubIds]);
  const choices = capabilities.isSuperAdmin ? results : directClubs;

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      setResults(await capabilities.searchSuperAdminClubs({ search: query, limit: 30 }));
    } catch {
      setResults([]);
      setError("Không tìm được CLB. Không có module nào được tải.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl py-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Chọn phạm vi server</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">{module.title}</h1>
      <p className="mt-2 text-sm leading-6 text-[#91a49b]">Chọn đúng CLB trước khi tải công việc.</p>
      {capabilities.isSuperAdmin && (
        <div className="mt-5 flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm tên CLB hoặc dán ID chính xác"
            className="min-h-11 border-white/10 bg-white/5"
          />
          <Button className="min-h-11" disabled={busy} onClick={() => void search()}>
            <Search className="mr-2 h-4 w-4" /> Tìm
          </Button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {choices.map((club) => (
          <button
            key={club.club_id}
            type="button"
            className="min-h-14 rounded-2xl border border-white/10 bg-white/[0.035] px-4 text-left text-sm text-white transition hover:border-emerald-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            onClick={() => {
              if (capabilities.isSuperAdmin) workspace.rememberVerifiedSuperAdminClub(club);
              void workspace.selectWorkspace(module, club.club_id);
            }}
          >
            <span className="font-medium">{club.club_name}</span>
            <span className="mt-1 block text-xs text-[#91a49b]">{maskId(club.club_id)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function OpsModuleStatus({ module }: { module: OpsModuleDefinition }) {
  const locked = module.defaultState === "BLOCKED" || module.defaultState === "DISABLED";
  return (
    <section className="mx-auto w-full max-w-3xl py-8">
      <div className="rounded-3xl border border-white/10 bg-[#08110d] p-6 sm:p-8">
        <ShieldAlert className={locked ? "h-7 w-7 text-amber-300" : "h-7 w-7 text-emerald-300"} />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-white">{module.title}</h1>
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#c9d8d0]">
            {module.defaultState}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-[#91a49b]">{module.description}</p>
        {module.disabledReasonCode && (
          <p className="mt-4 rounded-xl bg-amber-300/8 px-3 py-2 text-xs text-amber-200">
            {module.disabledReasonCode}
          </p>
        )}
        {!locked && (
          <p className="mt-4 text-xs text-[#91a49b]">
            Workspace đọc sẽ được nối ở PR module riêng; màn này không mount data hook hoặc write control.
          </p>
        )}
      </div>
    </section>
  );
}

export function OpsAccessDenied({ message }: { message: string }) {
  return (
    <main className="flex min-h-[70dvh] items-center justify-center px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-rose-300/15 bg-[#0d1512] p-6 text-center">
        <ShieldX className="mx-auto h-8 w-8 text-rose-300" />
        <h1 className="mt-4 text-xl font-semibold">Không có quyền vận hành</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{message}</p>
        <Button asChild variant="outline" className="mt-5 min-h-11 w-full">
          <a href="/">Về ứng dụng chính</a>
        </Button>
      </div>
    </main>
  );
}

export function OpsLoading({ label }: { label: string }) {
  return (
    <main className="flex min-h-[70dvh] items-center justify-center text-zinc-300">
      <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-300" />
      {label}
    </main>
  );
}

function maskId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
}
