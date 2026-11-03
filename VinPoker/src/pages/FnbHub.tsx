import { useOperationalCapabilities } from "@/hooks/useOperationalCapabilities";
import { Navigate, useNavigate } from "react-router-dom";
import { RouteLoader } from "@/components/RouteLoader";
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "@/hooks/useAuth";
import { UtensilsCrossed, ChefHat, Settings2, ConciergeBell, Eye, ChevronRight, type LucideIcon } from "lucide-react";

/**
 * F&B hub (/fnb/hub) — the single VẬN HÀNH → "F&B" entry lands here. Big tappable cards for each
 * F&B area (mobile-friendly; replaces the fly-out submenu that opened off-screen on phones). Each
 * card re-applies the SAME per-area flag + role gate as the nav, so no card is a dead link. If the
 * user has no F&B access at all, bounce home (mirrors the nav gating).
 */
type Tile = { to: string; icon: LucideIcon; title: string; desc: string };

export default function FnbHub() {
  const { loading, authError } = useAuth();
  const nav = useNavigate();
  const access = useOperationalCapabilities();
  const isOwner = access.hasFacet("can_owner");

  const tiles: Tile[] = [
    FEATURES.fnbCounter && access.hasFacet("can_fnb_cashier") &&
      { to: "/fnb", icon: UtensilsCrossed, title: "Quầy", desc: "Tạo đơn, thu tiền tại quầy" },
    FEATURES.fnbKitchen && access.hasFacet("can_fnb_kitchen") &&
      { to: "/fnb/kitchen", icon: ChefHat, title: "Bếp", desc: "Màn hình bếp — đơn đã thu" },
    FEATURES.fnbGuestOrder && (access.hasFacet("can_fnb_server") || access.hasFacet("can_fnb_cashier")) &&
      { to: "/fnb/serve", icon: ConciergeBell, title: "Phục vụ", desc: "Ra bàn thu tiền mặt" },
    FEATURES.fnbModule && isOwner &&
      { to: "/fnb/admin", icon: Settings2, title: "Quản trị", desc: "Thực đơn, kho, cài đặt, QR bàn" },
    FEATURES.fnbDemo && isOwner &&
      { to: "/fnb/demo", icon: Eye, title: "Xem thử", desc: "Bản demo tĩnh" },
  ].filter(Boolean) as Tile[];

  if (loading || access.loading) return <RouteLoader />;
  if (authError || access.error) return <p role="alert" className="p-6">Chưa xác minh được quyền F&B. Vui lòng tải lại trang.</p>;
  if (!tiles.length) return <Navigate to="/" replace />;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <UtensilsCrossed className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">F&B</h1>
          <p className="text-sm text-muted-foreground">Chọn khu vực bạn muốn mở.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.to}
              type="button"
              onClick={() => nav(tile.to)}
              className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4 text-left transition hover:border-primary/50 hover:bg-card/80 active:scale-[0.99]"
            >
              <div className="w-11 h-11 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{tile.title}</div>
                <div className="text-xs text-muted-foreground truncate">{tile.desc}</div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
