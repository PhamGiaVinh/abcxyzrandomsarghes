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
  /** Existing operational document; its own server-scoped club picker remains authoritative. */
  operationalRoute?: string;
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

export const OPS_MODULE_REGISTRY: readonly OpsModuleDefinition[] = [
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
    description: "Đăng ký, buy-in, biên nhận và đối soát tại quầy.",
    route: "/ops/cashier",
    operationalRoute: "/cashier",
    group: "CORE",
    capabilityPredicate: anyClub(inherited((row) => row.can_cashier)),
    clubCapabilityPredicate: inherited((row) => row.can_cashier),
    requiredContracts: ["club_cashiers", "cashier queue read contracts", "caller-bound cashier mutation contracts"],
    sideEffectClass: "MONEY",
    defaultState: "LIVE",
  },
  {
    id: "tracker",
    title: "Tracker",
    description: "Theo dõi và vận hành bàn tại màn hình Tracker đầy đủ.",
    route: "/ops/tracker",
    operationalRoute: "/tracker",
    group: "CORE",
    capabilityPredicate: anyClub(inherited((row) => row.can_tracker)),
    clubCapabilityPredicate: inherited((row) => row.can_tracker),
    requiredContracts: [
      "club_trackers",
      "tournaments/tournament_tables/tournament_seats read RLS",
      "Tracker operational document server write guards",
    ],
    sideEffectClass: "DESTRUCTIVE",
    defaultState: "LIVE",
  },
  {
    id: "dealer-control",
    title: "Dealer Swing",
    description: "Điều phối dealer, lịch ca và bảng lương theo quyền riêng.",
    route: "/ops/dealer-swing",
    operationalRoute: "/dealer-swing",
    group: "CORE",
    capabilityPredicate: anyClub(inherited((row) => row.can_dealer_control)),
    clubCapabilityPredicate: inherited((row) => row.can_dealer_control),
    requiredContracts: [
      "club_dealer_controls",
      "game_tables/dealer_assignments/dealer_attendance/dealers read RLS",
      "Dealer Swing operational document server write guards",
    ],
    sideEffectClass: "MONEY",
    defaultState: "LIVE",
  },
  {
    id: "fnb",
    title: "F&B",
    description: "Quầy, phục vụ, bếp và quản trị theo từng quyền F&B.",
    route: "/ops/fnb",
    operationalRoute: "/fnb/hub",
    group: "SERVICE",
    capabilityPredicate: anyClub(inherited((row) =>
      row.can_fnb_cashier || row.can_fnb_server || row.can_fnb_kitchen)),
    clubCapabilityPredicate: inherited((row) =>
      row.can_fnb_cashier || row.can_fnb_server || row.can_fnb_kitchen),
    requiredContracts: ["club_fnb_staff cashier/server/kitchen facets", "F&B money and stock UAT"],
    sideEffectClass: "MONEY",
    defaultState: "LIVE",
  },
  {
    id: "marketing",
    title: "Marketing",
    description: "Soạn nội dung và quản lý lịch Marketing theo CLB.",
    route: "/ops/marketing",
    operationalRoute: "/marketing",
    group: "SERVICE",
    capabilityPredicate: anyClub(inherited((row) => row.can_marketer)),
    clubCapabilityPredicate: inherited((row) => row.can_marketer),
    requiredContracts: ["club_marketers", "marketing read contract", "external send UAT"],
    sideEffectClass: "EXTERNAL_SIDE_EFFECT",
    defaultState: "LIVE",
  },
  {
    id: "chip-ops",
    title: "Chip Ops",
    description: "Bộ chip, mẫu stack, cấp phát, kiểm kê và bag/tag.",
    route: "/ops/chip-ops",
    operationalRoute: "/chip-ops",
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
    defaultState: "LIVE",
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
    defaultState: "LIVE",
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
    defaultState: "LIVE",
  },
  {
    id: "accountant",
    title: "Tài chính & Đối soát · nhân sự",
    description: "Lương nhân sự, chi phí và đối soát theo quyền được server xác nhận.",
    route: "/ops/accountant",
    operationalRoute: "/accountant",
    group: "CONTROL",
    capabilityPredicate: anyClub(inherited((row) => row.can_accountant)),
    clubCapabilityPredicate: inherited((row) => row.can_accountant),
    requiredContracts: [
      "club_accountants",
      "20270110000001 payroll approval guard applied and verified",
      "accountant write UAT",
    ],
    sideEffectClass: "MONEY",
    defaultState: "LIVE",
  },
  {
    id: "series",
    title: "Series",
    description: "Phân tích, lập kế hoạch và xuất lịch Series.",
    route: "/ops/series",
    operationalRoute: "/club/admin/series-intelligence",
    group: "PLANNING",
    capabilityPredicate: anyClub(owner),
    clubCapabilityPredicate: owner,
    requiredContracts: ["get_club_series_events", "Series operational document separates browser-local planning from server data"],
    sideEffectClass: "NON_MONEY_WRITE",
    defaultState: "LIVE",
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
