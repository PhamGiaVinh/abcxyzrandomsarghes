import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import { IdCard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStaffLink } from "@/hooks/staff/useStaffLink";
import { FEATURES } from "@/lib/featureFlags";
import { RouteLoader } from "@/components/RouteLoader";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BackButton } from "@/components/BackButton";
import { StaffBottomNav } from "./StaffBottomNav";
import { StaffClubSwitcher } from "./StaffClubSwitcher";
import { StaffComingSoon } from "./StaffComingSoon";
import { Button } from "@/components/ui/button";

export default function StaffAppShell() {
  const { user, isAdmin, isClubOwner, loading: authLoading } = useAuth();
  const { loading, source, error, refetch, isFetching } = useStaffLink();
  const [searchParams] = useSearchParams();
  const mockPreview = !FEATURES.staffApp && searchParams.get("preview") === "mock";
  const allowPreview = isAdmin || isClubOwner || mockPreview;

  if (authLoading || loading) return <RouteLoader />;
  if (source === "live" && !user) return <Navigate to="/auth" replace />;
  if (!FEATURES.staffApp && !allowPreview) return <StaffComingSoon />;
  if(error)return <div role="alert" className="mx-auto max-w-md space-y-3 p-4">
    <h1 className="font-bold">Không tải được hồ sơ nhân viên</h1>
    <p className="text-sm text-muted-foreground">{error}</p>
    <Button disabled={isFetching} onClick={()=>{void refetch();}}>Tải lại hồ sơ</Button>
  </div>;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/85 border-b border-border/60 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="mx-auto w-full max-w-md flex items-center justify-between gap-2 px-4 h-14">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-card border border-primary/30 text-primary shrink-0">
              <IdCard className="w-5 h-5" />
            </span>
            <div className="leading-tight min-w-0">
              <div className="text-sm font-display font-black tracking-[0.14em] text-primary">VBACKER</div>
              <div className="text-[11px] text-muted-foreground -mt-0.5 truncate">Nhân viên · Cổng chấm công</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StaffClubSwitcher />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-md px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] animate-fade-in">
        <BackButton to="/" label="Về app chính" className="mb-2" />
        {!FEATURES.staffApp && allowPreview && (
          <div className="mb-3 rounded-xl border border-primary/35 bg-primary/10 px-3 py-2 text-[12px] text-primary">
            Preview nội bộ: flag staffApp đang OFF, dữ liệu chấm công là mock và không ghi Supabase.
          </div>
        )}
        <Outlet />
      </main>

      <StaffBottomNav />
    </div>
  );
}
