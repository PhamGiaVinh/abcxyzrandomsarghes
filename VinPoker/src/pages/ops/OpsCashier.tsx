/* eslint-disable @typescript-eslint/no-explicit-any -- legacy read rows are normalized below */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ClipboardList,
  Loader2,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { cn } from "@/lib/utils";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { OPS_TOUR_CASHIER_ENABLED } from "@/lib/featureFlags";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

type OpsSupabaseClient = SupabaseClient<Database>;
type CashierTab = "queue" | "receipts" | "status";
type RegistrationRow = {
  id: string;
  status: string;
  reference: string | null;
  total: number | null;
  committedAt: string | null;
  playerName: string;
  phone: string | null;
  tournamentName: string;
};
type TournamentStatusRow = {
  id: string;
  name: string;
  status: string;
  startTime: string | null;
  buyIn: number | null;
};

const TABS = [
  { id: "queue", label: "Hàng chờ", icon: ClipboardList },
  { id: "receipts", label: "Biên nhận", icon: ReceiptText },
  { id: "status", label: "Trạng thái giải", icon: Trophy },
] as const;

export default function OpsCashier() {
  const client = useSupabaseClient();
  const { user } = useOpsAuth();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const allowedClubIds = capabilities.cashierClubIds;
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || allowedClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const [tab, setTab] = useState<CashierTab>("queue");
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    registrations: RegistrationRow[];
    tournaments: TournamentStatusRow[];
  }>({ loading: true, error: null, registrations: [], tournaments: [] });

  useEffect(() => {
    if (!user || !clubId || capabilities.loading || capabilities.scopeError) return;
    let active = true;
    const controller = new AbortController();
    setState({ loading: true, error: null, registrations: [], tournaments: [] });
    void observeTrackerContextRead(Promise.all([
      loadRegistrations(client, clubId, controller.signal),
      loadTournamentStatuses(client, clubId, controller.signal),
    ])).then(([registrations, tournaments]) => {
      if (active) setState({ loading: false, error: null, registrations, tournaments });
    }).catch((error: unknown) => {
      controller.abort();
      if (!active) return;
      setState({
        loading: false,
        error: error instanceof Error && error.message === "tracker_context_read_timeout"
          ? "Quá thời gian tải dữ liệu Cashier. Chọn làm mới để thử lại."
          : error instanceof Error ? error.message : "Không tải được dữ liệu Cashier.",
        registrations: [],
        tournaments: [],
      });
    });
    return () => { active = false; controller.abort(); };
  }, [capabilities.loading, capabilities.scopeError, client, clubId, revision, user]);

  const pending = useMemo(
    () => state.registrations.filter((row) => row.status === "pending"),
    [state.registrations],
  );
  const receipts = useMemo(
    () => state.registrations.filter((row) => row.status === "confirmed"),
    [state.registrations],
  );
  const clubName = clubId
    ? capabilities.clubs.find((club) => club.id === clubId)?.name ?? `CLB ${maskId(clubId)}`
    : "CLB";

  if (capabilities.loading) {
    return <CashierState icon={<Loader2 className="h-8 w-8 animate-spin text-[#d8bc85]" />} title="Đang tải quyền Cashier…" />;
  }
  if (capabilities.scopeError) {
    return <CashierState icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi Cashier" detail="Hệ thống không dùng dữ liệu thay thế." />;
  }
  if (!clubId) {
    return <CashierState icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa chọn đúng CLB" detail="Quay lại Đổi không gian và chọn CLB thuộc phạm vi Cashier." />;
  }

  return (
    <div className="min-w-0 space-y-4 pt-1">
      <header className="px-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#f2ece6]">Cashier</h1>
            <p className="mt-1 text-sm text-[#91a49b]">{clubName} · chỉ đọc trong production</p>
          </div>
          <span className="rounded-full border border-amber-300/25 bg-amber-300/8 px-3 py-1 text-xs font-semibold text-amber-200">
            READ_ONLY
          </span>
        </div>
      </header>

      {OPS_TOUR_CASHIER_ENABLED && (
        <Link
          to={`/ops/cashier/tour?club=${encodeURIComponent(clubId)}`}
          className="inline-flex min-h-11 items-center rounded-2xl bg-emerald-300 px-4 text-sm font-semibold text-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Mở quầy Buy-in theo tour
        </Link>
      )}

      {capabilities.metadataError && (
        <div className="rounded-2xl border border-amber-300/15 bg-amber-300/8 px-4 py-3 text-sm text-amber-100">
          {capabilities.metadataError}
        </div>
      )}
      <div className="rounded-2xl border border-amber-300/15 bg-amber-300/8 px-4 py-3 text-sm leading-6 text-amber-100">
        OPS MONEY GATE B đang tắt. Xác nhận đăng ký, offline buy-in, SePay, staking, duyệt hồ sơ và chốt giải không được mount ở màn này.
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Dữ liệu Cashier">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              data-ops-action="cashier.navigate"
              onClick={() => setTab(item.id)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300",
                tab === item.id ? "bg-[#d8bc85] text-[#241a08]" : "border border-white/8 bg-white/5 text-[#aebdb5]",
              )}
            >
              <Icon className="h-4 w-4" /> {item.label}
            </button>
          );
        })}
        <button
          type="button"
          data-ops-action="cashier.refresh"
          onClick={() => setRevision((value) => value + 1)}
          className="ml-auto flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/5 text-[#aebdb5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          aria-label="Làm mới dữ liệu Cashier"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {state.loading ? (
        <CashierState icon={<Loader2 className="h-7 w-7 animate-spin text-[#d8bc85]" />} title="Đang tải dữ liệu thật…" />
      ) : state.error ? (
        <CashierState icon={<AlertTriangle className="h-7 w-7 text-rose-300" />} title="Không tải được dữ liệu" detail={state.error} />
      ) : tab === "queue" ? (
        <RegistrationList rows={pending} empty="Không có đăng ký đang chờ." />
      ) : tab === "receipts" ? (
        <RegistrationList rows={receipts} empty="Chưa có biên nhận đăng ký đã xác nhận." receipt />
      ) : (
        <TournamentStatusList rows={state.tournaments} />
      )}
    </div>
  );
}

async function loadRegistrations(client: OpsSupabaseClient, clubId: string, signal: AbortSignal): Promise<RegistrationRow[]> {
  const { data, error } = await client
    .from("tournament_registrations")
    .select("id, reference_code, status, total_pay, player_id, tournament_id, committed_at")
    .eq("club_id", clubId)
    .in("status", ["pending", "confirmed"])
    .order("committed_at", { ascending: false })
    .limit(150)
    .abortSignal(signal);
  if (signal.aborted) throw new Error("cashier_read_aborted");
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Không xác minh được danh sách đăng ký Cashier. Chọn làm mới để thử lại.");
  const rows = data as any[];
  const playerIds = [...new Set(rows.map((row) => row.player_id).filter(Boolean))];
  const tournamentIds = [...new Set(rows.map((row) => row.tournament_id).filter(Boolean))];
  const [profilesResult, tournamentsResult] = await Promise.all([
    playerIds.length
      ? client.from("profiles").select("user_id, display_name, phone").in("user_id", playerIds).abortSignal(signal)
      : Promise.resolve({ data: [], error: null }),
    tournamentIds.length
      ? client.from("tournaments").select("id, name").eq("club_id", clubId).in("id", tournamentIds).abortSignal(signal)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (tournamentsResult.error) throw tournamentsResult.error;
  if (!Array.isArray(profilesResult.data) || !Array.isArray(tournamentsResult.data)) {
    throw new Error("Không xác minh được thông tin người chơi hoặc giải đấu. Chọn làm mới để thử lại.");
  }
  const profiles = new Map(profilesResult.data.map((row: any) => [row.user_id, row] as const));
  const tournaments = new Map(tournamentsResult.data.map((row: any) => [row.id, row.name] as const));
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    reference: row.reference_code ?? null,
    total: typeof row.total_pay === "number" ? row.total_pay : null,
    committedAt: row.committed_at ?? null,
    playerName: profiles.get(row.player_id)?.display_name ?? "Người chơi",
    phone: profiles.get(row.player_id)?.phone ?? null,
    tournamentName: tournaments.get(row.tournament_id) ?? "Giải đấu",
  }));
}

async function loadTournamentStatuses(client: OpsSupabaseClient, clubId: string, signal: AbortSignal): Promise<TournamentStatusRow[]> {
  const { data, error } = await client
    .from("tournaments")
    .select("id, name, status, start_time, buy_in")
    .eq("club_id", clubId)
    .order("created_at", { ascending: false })
    .limit(80)
    .abortSignal(signal);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Không xác minh được trạng thái giải đấu. Chọn làm mới để thử lại.");
  return data.map((row: any) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    startTime: row.start_time ?? null,
    buyIn: typeof row.buy_in === "number" ? row.buy_in : null,
  }));
}

function RegistrationList({ rows, empty, receipt = false }: { rows: RegistrationRow[]; empty: string; receipt?: boolean }) {
  if (!rows.length) return <EmptyState text={empty} />;
  return (
    <div className="overflow-hidden rounded-3xl border border-white/8 bg-[#07100c]">
      {rows.map((row) => (
        <article key={row.id} className="border-b border-white/7 px-4 py-4 last:border-b-0 sm:px-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className={cn("mt-0.5 h-5 w-5 shrink-0", receipt ? "text-emerald-300" : "text-amber-300")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate font-semibold text-white">{row.playerName}</p>
                <span className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  receipt ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200",
                )}>
                  {receipt ? "Đã xác nhận" : "Đang chờ"}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-[#91a49b]">{row.tournamentName}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-[#b9c8c0]">
                <span>{formatVnd(row.total)}</span>
                {row.reference && <span>Mã {maskReference(row.reference)}</span>}
                {row.phone && <span>{maskPhone(row.phone)}</span>}
                {row.committedAt && <span>{formatTime(row.committedAt)}</span>}
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function TournamentStatusList({ rows }: { rows: TournamentStatusRow[] }) {
  if (!rows.length) return <EmptyState text="CLB chưa có giải đấu." />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => (
        <article key={row.id} className="rounded-3xl border border-white/8 bg-[#07100c] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{row.name}</p>
              <p className="mt-1 text-sm text-[#91a49b]">{row.startTime ? formatDateTime(row.startTime) : "Chưa có giờ bắt đầu"}</p>
            </div>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-[#cbd8d1]">{row.status}</span>
          </div>
          <p className="mt-3 font-mono text-sm text-[#d8bc85]">Buy-in {formatVnd(row.buyIn)}</p>
        </article>
      ))}
    </div>
  );
}

function CashierState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-3xl border border-white/8 bg-[#07100c] px-5 text-center">
      {icon}
      <p className="mt-3 font-semibold text-white">{title}</p>
      {detail && <p className="mt-1 max-w-md text-sm leading-6 text-[#91a49b]">{detail}</p>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <CashierState icon={<ClipboardList className="h-7 w-7 text-[#91a49b]" />} title={text} />;
}

function formatVnd(value: number | null): string {
  return value == null ? "—" : `${value.toLocaleString("vi-VN")} ₫`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function maskPhone(value: string): string {
  return value.length >= 6 ? `${value.slice(0, 2)}••••${value.slice(-3)}` : "••••";
}

function maskReference(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-3)}` : value;
}

function maskId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
}
