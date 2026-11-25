import type { ReactNode } from "react";
import { Navigate, NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { financeDestination } from "@/lib/financeNavigation";
import { cn } from "@/lib/utils";
import "./FinanceWorkspace.css";

/** Shared navigation only; each existing page retains its own data and access guards. */
export default function FinanceWorkspace() {
  const { isAccountant, isClubOwner, isAdmin, isClubAdmin, isCashier, loading, rolesLoading, rolesError } = useAuth();
  const { pathname, search } = useLocation();
  const landing = pathname === "/finance";

  if (landing && rolesError) return <p role="alert" className="p-4">Chưa xác minh được quyền CLB. Vui lòng tải lại trang.</p>;
  if (landing && !loading && !rolesLoading) {
    const destination = isClubOwner || isAdmin || isClubAdmin
      ? "/club/admin/finance"
      : isAccountant ? "/accountant" : isCashier ? "/cashier" : "/";
    return <Navigate to={financeDestination(destination, search)} replace />;
  }

  return (
    <div className="finance-workspace min-w-0 space-y-5 font-sans">
      <div className="space-y-2.5">
        {landing ? (
          <h1 className="font-display text-2xl text-primary">Tài chính &amp; Đối soát</h1>
        ) : (
          <NavLink to="/finance" className="text-sm font-semibold text-primary">
            Tài chính &amp; Đối soát
          </NavLink>
        )}
        <nav aria-label="Tài chính & Đối soát" className={cn("grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl border border-border/60 bg-muted/30 p-1", landing && "grid sm:grid-cols-4")}>
          {(isCashier || isClubOwner || isAdmin) && (
            <FinanceLink to="/cashier" label="Thu–chi" landing={landing}>
              Ca thu ngân, buy-in, hoàn tiền và trả thưởng.
            </FinanceLink>
          )}
          {(isClubAdmin || isClubOwner) && (
            <FinanceLink to="/club/admin/finance" label="Tổng quan" landing={landing}>
              Doanh thu, dòng tiền và công nợ.
            </FinanceLink>
          )}
          {(isAccountant || isClubOwner || isAdmin) && <FinanceLink to="/accountant?tab=salary" label="Lương" landing={landing}>Bảng lương, điều chỉnh và phiếu lương.</FinanceLink>}
          {(isAccountant || isClubOwner || isAdmin) && (
            <FinanceLink to="/accountant?tab=report" label="Đối soát" landing={landing}>
              Lương, chi phí và các khoản cần kiểm tra.
            </FinanceLink>
          )}
        </nav>
      </div>
      {(isAccountant || isClubOwner || isAdmin) && <div className="flex flex-wrap gap-3 text-sm"><Link className="inline-flex min-h-11 items-center text-primary underline" to={financeDestination("/accountant?tab=expenses", search)}>Khoản chi và chi phí CLB</Link></div>}
      <Outlet />
      {(isClubOwner || isAdmin || isClubAdmin) && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Tra cứu chi tiết</summary>
          <div className="mt-3 flex flex-wrap gap-3">
            {(isClubOwner || isAdmin) && <NavLink className="text-primary underline" to="/club/admin/player-finance">Giao dịch theo người chơi</NavLink>}

          </div>
        </details>
      )}
    </div>
  );
}

function FinanceLink({ to, label, landing, children }: {
  to: string; label: string; landing: boolean; children: ReactNode;
}) {
  const { pathname, search } = useLocation();
  const target = new URL(to, "https://local.invalid");
  const selected = pathname === target.pathname && (target.pathname !== "/accountant" || (new URLSearchParams(search).get("tab") ?? "salary") === target.searchParams.get("tab"));
  return (
    <Link to={financeDestination(to, search)} aria-current={selected ? "page" : undefined} className={cn(
      "min-h-11 flex-1 rounded-lg px-3 py-2.5 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-card/50",
      landing && "p-4",
    )}>
      <span className="font-medium">{label}</span>
      {landing && <span className="mt-1 block text-xs text-muted-foreground">{children}</span>}
    </Link>
  );
}
