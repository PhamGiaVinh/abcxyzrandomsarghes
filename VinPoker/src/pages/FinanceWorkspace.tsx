import type { ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

/** Shared navigation only; each existing page retains its own data and access guards. */
export default function FinanceWorkspace() {
  const { isAccountant, isClubOwner, isAdmin, isClubAdmin, isCashier, loading } = useAuth();
  const { pathname } = useLocation();
  const landing = pathname === "/finance";

  if (landing && !loading) {
    const destination = isClubOwner || isAdmin || isClubAdmin
      ? "/club/admin/finance"
      : isAccountant ? "/accountant" : isCashier ? "/cashier" : "/";
    return <Navigate to={destination} replace />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {landing ? (
          <h1 className="font-display text-2xl text-primary">Quầy &amp; Tài chính</h1>
        ) : (
          <NavLink to="/finance" className="text-sm font-semibold text-primary">
            Quầy &amp; Tài chính
          </NavLink>
        )}
        <nav aria-label="Quầy & Tài chính" className={cn("flex flex-wrap gap-2", landing && "grid sm:grid-cols-3")}>
          {(isCashier || isClubOwner || isAdmin) && (
            <FinanceLink to="/cashier" label="Quầy" landing={landing}>
              Ca thu ngân, buy-in, hoàn tiền và trả thưởng.
            </FinanceLink>
          )}
          {(isClubAdmin || isClubOwner) && (
            <FinanceLink to="/club/admin/finance" label="Báo cáo" landing={landing}>
              Doanh thu, dòng tiền và công nợ.
            </FinanceLink>
          )}
          {(isAccountant || isClubOwner || isAdmin) && (
            <FinanceLink to="/accountant" label="Đối soát" landing={landing}>
              Lương, chi phí và các khoản cần kiểm tra.
            </FinanceLink>
          )}
        </nav>
      </div>
      {(isClubOwner || isAdmin || isClubAdmin) && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Tra cứu chi tiết</summary>
          <div className="mt-3 flex flex-wrap gap-3">
            {(isClubOwner || isAdmin) && <NavLink className="text-primary underline" to="/club/admin/player-finance">Giao dịch theo người chơi</NavLink>}
            {FEATURES.accountingControl && <NavLink className="text-primary underline" to="/club/admin/accounting-control">Các báo cáo đối soát hiện có</NavLink>}
          </div>
        </details>
      )}
      <Outlet />
    </div>
  );
}

function FinanceLink({ to, label, landing, children }: {
  to: string; label: string; landing: boolean; children: ReactNode;
}) {
  return (
    <NavLink to={to} className={({ isActive }) => cn(
      "rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      isActive ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:border-primary/50",
      landing && "p-4",
    )}>
      <span className="font-medium">{label}</span>
      {landing && <span className="mt-1 block text-xs text-muted-foreground">{children}</span>}
    </NavLink>
  );
}
