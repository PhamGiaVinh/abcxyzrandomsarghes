import type { OpsClubCapabilityRow, OpsGlobalCapability } from "@/ops/auth/opsCapabilityContract";
import { FEATURES } from "@/lib/featureFlags";

export type OpsRuntimeState = "LIVE" | "READ_ONLY" | "DISABLED" | "BLOCKED";

export type OpsSideEffectClass =
  | "READ"
  | "NON_MONEY_WRITE"
  | "DESTRUCTIVE"
  | "MONEY"
  | "EXTERNAL_SIDE_EFFECT";

export type OpsModuleGroup = "CORE" | "SERVICE" | "CONTROL" | "PLANNING";

export type OpsModuleId =
  | "club-admin"
  | "floor"
  | "cashier"
  | "tracker"
  | "dealer-control"
  | "fnb"
  | "marketing"
  | "chip-ops"
  | "daily-digest"
  | "finance"
  | "accountant"
  | "series";

export type OpsScopeSnapshot = {
  clubs: readonly OpsClubCapabilityRow[];
  global: OpsGlobalCapability;
};

export type OpsModuleDefinition = {
  id: OpsModuleId;
  title: string;
  description: string;
  route: string;
  group: OpsModuleGroup;
  capabilityPredicate: (scope: OpsScopeSnapshot) => boolean;
  clubCapabilityPredicate: (row: OpsClubCapabilityRow) => boolean;
  featureFlag?: keyof typeof import("@/lib/featureFlags").FEATURES;
  requiredContracts: readonly string[];
  sideEffectClass: OpsSideEffectClass;
  defaultState: OpsRuntimeState;
  disabledReasonCode?: string;
};

const owner = (row: OpsClubCapabilityRow) => row.can_owner;
const inherited = (direct: (row: OpsClubCapabilityRow) => boolean) =>
  (row: OpsClubCapabilityRow) => owner(row) || direct(row);
const anyClub = (predicate: (row: OpsClubCapabilityRow) => boolean) =>
  (scope: OpsScopeSnapshot) => scope.global.is_super_admin || scope.clubs.some(predicate);

export const OPS_MODULE_REGISTRY = [
  {
    id: "club-admin",
    title: "Quản trị CLB",
    description: "Mời và thu hồi quyền nhân sự theo đúng CLB.",
    route: "/ops/club-admin/accounts",
    group: "CORE",
    capabilityPredicate: anyClub(owner),
    clubCapabilityPredicate: owner,
    requiredContracts: ["clubs.owner_id", "club_operator_invites"],
    sideEffectClass: "NON_MONEY_WRITE",
    defaultState: "LIVE",
  },
  {
    id: "floor",
    title: "Floor",
    description: "Giải đấu, bàn, người chơi, đồng hồ và màn hình.",
    route: "/ops/floor",
    group: "CORE",
    capabilityPredicate: anyClub(inherited((row) => row.can_floor)),
    clubCapabilityPredicate: inherited((row) => row.can_floor),
    requiredContracts: ["club_floors", "get_my_floor_operator_scope"],
    sideEffectClass: "NON_MONEY_WRITE",
    defaultState: "LIVE",
  },
  {
    id: "cashier",
    title: "Cashier",
    description: "Hàng chờ và trạng thái thu ngân; money controls vẫn khóa.",
    route: "/ops/cashier",
    group: "CORE",
    capabilityPredicate: anyClub(inherited((row) => row.can_cashier)),
    clubCapabilityPredicate: inherited((row) => row.can_cashier),
    requiredContracts: ["club_cashiers", "cashier queue read contracts", "OPS MONEY GATE B OFF"],
    sideEffectClass: "MONEY",
    defaultState: "READ_ONLY",
  },
  {
    id: "tracker",
    title: "Tracker",
    description: "Theo dõi bàn; writer controls chưa được mount trong Ops V3.",
    route: "/ops/tracker",
    group: "CORE",
    capabilityPredicate: anyClub(inherited((row) => row.can_tracker)),
    clubCapabilityPredicate: inherited((row) => row.can_tracker),
    requiredContracts: [
      "club_trackers",
      "tournaments/tournament_tables/tournament_seats read RLS",
      "tracker writer concurrency UAT",
    ],
    sideEffectClass: "DESTRUCTIVE",
    defaultState: "READ_ONLY",
  },
  {
    id: "dealer-control",
    title: "Dealer Swing",
    description: "Điều phối dealer; payroll không kế thừa quyền Dealer Control.",
    route: "/ops/dealer-swing",
    group: "CORE",
    capabilityPredicate: anyClub(inherited((row) => row.can_dealer_control)),
    clubCapabilityPredicate: inherited((row) => row.can_dealer_control),
    requiredContracts: [
      "club_dealer_controls",
      "game_tables/dealer_assignments/dealer_attendance/dealers read RLS",
      "dealer read parity UAT",
    ],
    sideEffectClass: "NON_MONEY_WRITE",
    defaultState: "READ_ONLY",
  },
  {
    id: "fnb",
    title: "F&B",
    description: "Quầy, phục vụ và bếp giữ riêng từng facet quyền.",
    route: "/ops/fnb",
    group: "SERVICE",
    capabilityPredicate: anyClub(inherited((row) =>
      row.can_fnb_cashier || row.can_fnb_server || row.can_fnb_kitchen)),
    clubCapabilityPredicate: inherited((row) =>
      row.can_fnb_cashier || row.can_fnb_server || row.can_fnb_kitchen),
    requiredContracts: ["club_fnb_staff cashier/server/kitchen facets", "F&B money and stock UAT"],
    sideEffectClass: "MONEY",
    defaultState: "DISABLED",
    disabledReasonCode: "FNB_WRITE_UAT_REQUIRED",
  },
  {
    id: "marketing",
    title: "Marketing",
    description: "Lịch nội dung; publish/send chưa được mở trong Ops.",
    route: "/ops/marketing",
    group: "SERVICE",
    capabilityPredicate: anyClub(inherited((row) => row.can_marketer)),
    clubCapabilityPredicate: inherited((row) => row.can_marketer),
    requiredContracts: ["club_marketers", "marketing read contract", "external send UAT"],
    sideEffectClass: "EXTERNAL_SIDE_EFFECT",
    defaultState: "DISABLED",
    disabledReasonCode: "MARKETING_EXTERNAL_SEND_UAT_REQUIRED",
  },
  {
    id: "chip-ops",
    title: "Chip Ops",
    description: "Tồn chip đã phát hành; write adapters chưa được mở.",
    route: "/ops/chip-ops",
    group: "CONTROL",
    capabilityPredicate: anyClub(inherited((row) => row.can_chip_master)),
    clubCapabilityPredicate: inherited((row) => row.can_chip_master),
    requiredContracts: [
      "club_chip_masters",
      "tournaments read RLS",
      "get_issued_chip_inventory",
      "chip write stale contract",
    ],
    sideEffectClass: "DESTRUCTIVE",
    defaultState: "READ_ONLY",
  },
  {
    id: "daily-digest",
    title: "Báo cáo ngày",
    description: "Owner Daily Digest: một snapshot vận hành đã tạo sẵn, không tính lại trên web.",
    route: "/ops/daily-digest",
    group: "CONTROL",
    capabilityPredicate: anyClub(owner),
    clubCapabilityPredicate: owner,
    featureFlag: "ownerDailyDigestWebReport",
    requiredContracts: [
      "owner-daily-digest-artifact-v1",
      "owner-scoped read boundary",
      "no client aggregation fallback",
    ],
    sideEffectClass: "READ",
    defaultState: "READ_ONLY",
  },
  {
    id: "finance",
    title: "Tài chính & Đối soát",
    description: "Số liệu server-authoritative, không tổng hợp fallback ở client.",
    route: "/ops/finance",
    group: "CONTROL",
    capabilityPredicate: anyClub(owner),
    clubCapabilityPredicate: owner,
    requiredContracts: ["get_club_finance_summary", "no client aggregation fallback", "liability contract not yet displayed"],
    sideEffectClass: "READ",
    defaultState: "READ_ONLY",
  },
  {
    id: "accountant",
    title: "Tài chính & Đối soát · nhân sự",
    description: "Payroll, chi phí và chuẩn bị thanh toán đang chờ authority review.",
    route: "/ops/accountant",
    group: "CONTROL",
    capabilityPredicate: anyClub(inherited((row) => row.can_accountant)),
    clubCapabilityPredicate: inherited((row) => row.can_accountant),
    requiredContracts: [
      "club_accountants",
      "20270110000001 payroll approval guard applied and verified",
      "accountant write UAT",
    ],
    sideEffectClass: "MONEY",
    defaultState: "BLOCKED",
    disabledReasonCode: "ACCOUNTANT_PAYROLL_GUARD_NOT_LIVE",
  },
  {
    id: "series",
    title: "Series",
    description: "Kế hoạch Series ở chế độ đọc trong Ops V3.",
    route: "/ops/series",
    group: "PLANNING",
    capabilityPredicate: anyClub(owner),
    clubCapabilityPredicate: owner,
    requiredContracts: ["get_club_series_events", "Ops does not mount browser-local CSV library"],
    sideEffectClass: "READ",
    defaultState: "READ_ONLY",
  },
] as const satisfies readonly OpsModuleDefinition[];

export function getOpsModule(moduleId: OpsModuleId): OpsModuleDefinition {
  const definition = OPS_MODULE_REGISTRY.find((module) => module.id === moduleId);
  if (!definition) throw new Error(`Unknown Ops module: ${moduleId}`);
  return definition;
}

export function getOpsModuleByPath(pathname: string): OpsModuleDefinition | null {
  const candidates = OPS_MODULE_REGISTRY
    .filter((module) => pathname === module.route || pathname.startsWith(`${module.route}/`))
    .sort((a, b) => b.route.length - a.route.length);
  return candidates[0] ?? null;
}

export function getAvailableOpsModules(scope: OpsScopeSnapshot): OpsModuleDefinition[] {
  return OPS_MODULE_REGISTRY.filter((module) => (
    isOpsModuleFeatureEnabled(module, { superAdmin: scope.global.is_super_admin })
    && module.capabilityPredicate(scope)
  ));
}

export function isOpsModuleFeatureEnabled(
  module: OpsModuleDefinition,
  options: { development?: boolean; superAdmin?: boolean; features?: typeof FEATURES } = {},
): boolean {
  if (!module.featureFlag) return true;
  // Local development and authenticated Super Admins may preview the Digest while
  // ordinary club Owners remain governed by the default-OFF production flag.
  const development = options.development ?? import.meta.env.DEV;
  const features = options.features ?? FEATURES;
  if ((development || options.superAdmin === true) && module.id === "daily-digest") return true;
  return features[module.featureFlag] === true;
}

export function getAvailableOpsModulesForSource(
  scope: OpsScopeSnapshot,
  source: "unified" | "legacy" | null,
): OpsModuleDefinition[] {
  const available = getAvailableOpsModules(scope);
  if (source !== "legacy") return available;
  const legacyIds = new Set<OpsModuleId>(["club-admin", "floor", "cashier"]);
  return available.filter((module) => legacyIds.has(module.id));
}

export function getModuleClubIds(
  module: OpsModuleDefinition,
  rows: readonly OpsClubCapabilityRow[],
): string[] {
  return rows.filter(module.clubCapabilityPredicate).map((row) => row.club_id);
}
