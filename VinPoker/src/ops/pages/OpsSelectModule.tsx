import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Banknote,
  Boxes,
  CalendarRange,
  ClipboardList,
  ChefHat,
  CircleDollarSign,
  Grid3X3,
  Megaphone,
  RadioTower,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { OpsAccessDenied, OpsLoading } from "@/ops/pages/OpsEntryResolver";
import {
  type OpsModuleDefinition,
  type OpsModuleGroup,
  type OpsModuleId,
} from "@/ops/registry/opsModuleRegistry";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { OpsIntelligenceEntryGate } from "@/ops/intelligence/OpsIntelligenceEntryGate";

const GROUPS: readonly { id: OpsModuleGroup; title: string; description: string }[] = [
  { id: "CORE", title: "Điều hành trực tiếp", description: "Công việc đang diễn ra trong CLB và giải đấu." },
  { id: "SERVICE", title: "Dịch vụ CLB", description: "Các luồng phục vụ có money hoặc external gate riêng." },
  { id: "CONTROL", title: "Kiểm soát", description: "Tồn kho, tài chính và đối soát server-authoritative." },
  { id: "PLANNING", title: "Kế hoạch", description: "Không gian phân tích và chuẩn bị dài hạn." },
];

const ICONS: Record<OpsModuleId, LucideIcon> = {
  "club-admin": ShieldCheck,
  floor: Grid3X3,
  cashier: Banknote,
  tracker: RadioTower,
  "dealer-control": UsersRound,
  fnb: ChefHat,
  marketing: Megaphone,
  "chip-ops": Boxes,
  "daily-digest": ClipboardList,
  finance: CircleDollarSign,
  accountant: CircleDollarSign,
  series: CalendarRange,
};

export default function OpsSelectModule() {
  const capabilities = useOpsCapabilities();
  const workspace = useOpsWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const spacesOnly = params.get("view") === "spaces";

  if (capabilities.loading) return <OpsLoading label="Đang tải Control Deck…" />;
  if (capabilities.scopeError) return <OpsAccessDenied message={capabilities.scopeError} />;
  if (!capabilities.hasAnyAccess) return <OpsAccessDenied message="Tài khoản chưa có quyền vận hành CLB." />;

  return <OpsIntelligenceEntryGate fallback={<OpsModuleSelector capabilities={capabilities} workspace={workspace} navigate={navigate} spacesOnly={spacesOnly} />} />;
}

function OpsModuleSelector({
  capabilities,
  workspace,
  navigate,
  spacesOnly,
}: {
  capabilities: ReturnType<typeof useOpsCapabilities>;
  workspace: ReturnType<typeof useOpsWorkspace>;
  navigate: ReturnType<typeof useNavigate>;
  spacesOnly: boolean;
}) {
  const openModule = (module: OpsModuleDefinition) => {
    if (module.defaultState === "BLOCKED" || module.defaultState === "DISABLED") return;
    const clubIds = capabilities.moduleClubIds(module.id);
    if (!capabilities.isSuperAdmin && clubIds.length === 1) {
      void workspace.selectWorkspace(module, clubIds[0]);
      return;
    }
    navigate(module.route);
  };

  return (
    <div className="space-y-8">
      <section className="border-b border-white/8 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Ops Control Deck</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {spacesOnly ? "Chọn không gian làm việc" : "Một lối vào cho mọi công việc vận hành"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#91a49b]">
          Mở mô đun để làm việc theo quyền được server xác nhận. Với màn hình vận hành đầy đủ, chọn lại CLB hoặc giải tại màn hình vừa mở.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <StatusLabel state="LIVE" label="Đang dùng" />
          <StatusLabel state="READ_ONLY" label="Chỉ đọc" />
          <StatusLabel state="DISABLED" label="Đang tắt" />
          <StatusLabel state="BLOCKED" label="Chưa đủ contract" />
          {capabilities.capabilitySource === "legacy" && (
            <span className="rounded-full border border-amber-300/20 bg-amber-300/8 px-3 py-1.5 text-amber-200">
              Compatibility mode: chỉ Club Admin, Floor, Cashier
            </span>
          )}
        </div>
      </section>

      {GROUPS.map((group) => {
        const modules = capabilities.availableModules.filter((module) => module.group === group.id);
        if (!modules.length) return null;
        return (
          <section key={group.id} aria-labelledby={`ops-group-${group.id}`}>
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <h2 id={`ops-group-${group.id}`} className="text-lg font-semibold text-white">{group.title}</h2>
              <p className="text-xs text-[#73867c]">{group.description}</p>
            </div>
            <div className="overflow-hidden rounded-3xl border border-white/9 bg-[#07100c]">
              {modules.map((module) => (
                <ModuleRow
                  key={module.id}
                  module={module}
                  clubCount={capabilities.isSuperAdmin ? null : capabilities.moduleClubIds(module.id).length}
                  onOpen={() => openModule(module)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ModuleRow({
  module,
  clubCount,
  onOpen,
}: {
  module: OpsModuleDefinition;
  clubCount: number | null;
  onOpen: () => void;
}) {
  const Icon = ICONS[module.id];
  const locked = module.defaultState === "BLOCKED" || module.defaultState === "DISABLED";
  return (
    <div className="flex min-h-24 items-center gap-4 border-b border-white/7 px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/9 bg-white/[0.035]">
        <Icon className="h-5 w-5 text-emerald-300" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-white">{module.title}</h3>
          <StatusLabel state={module.defaultState} />
        </div>
        <p className="mt-1 text-sm leading-5 text-[#91a49b]">{module.description}</p>
        <p className="mt-1 text-[11px] text-[#65786e]">
          {clubCount === null ? "Chọn CLB sau khi mở" : `${clubCount} CLB trong phạm vi`} · {module.sideEffectClass}
        </p>
      </div>
      {locked ? (
        <div className="hidden max-w-48 text-right text-[11px] leading-4 text-amber-200 sm:block">
          {module.disabledReasonCode}
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="min-h-11 shrink-0 rounded-2xl border border-emerald-300/20 bg-emerald-300/8 px-4 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-300/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          Mở
        </button>
      )}
    </div>
  );
}

function StatusLabel({ state, label }: { state: OpsModuleDefinition["defaultState"]; label?: string }) {
  const color = state === "LIVE"
    ? "border-emerald-300/20 bg-emerald-300/8 text-emerald-200"
    : state === "READ_ONLY"
      ? "border-sky-300/20 bg-sky-300/8 text-sky-200"
      : "border-amber-300/20 bg-amber-300/8 text-amber-200";
  const friendlyLabel = state === "LIVE"
    ? "Đang dùng"
    : state === "READ_ONLY"
      ? "Chỉ đọc"
      : state === "DISABLED"
        ? "Đang tắt"
        : "Chưa đủ contract";
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide ${color}`}>{label ?? friendlyLabel}</span>;
}
