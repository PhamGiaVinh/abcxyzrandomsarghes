import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

/** Shared navigation only; each existing page retains its own data and access guards. */
export default function FinanceWorkspace() {
  const { isAccountant, isClubOwner, isAdmin, isClubAdmin } = useAuth();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const landing = pathname === "/finance";

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {landing ? (
          <h1 className="font-display text-2xl text-primary">{t("financeWorkspace.title")}</h1>
        ) : (
          <NavLink to="/finance" className="text-sm font-semibold text-primary">
            {t("financeWorkspace.title")}
          </NavLink>
        )}
        <nav aria-label={t("financeWorkspace.title")} className={cn("flex flex-wrap gap-2", landing && "grid sm:grid-cols-3")}>
          {(isClubAdmin || isClubOwner) && (
            <FinanceLink to="/club/admin/finance" label={t("financeWorkspace.overview")} landing={landing}>
              {t("financeWorkspace.overviewDescription")}
            </FinanceLink>
          )}
          {(isAccountant || isClubOwner || isAdmin) && (
            <FinanceLink to="/accountant" label={t("financeWorkspace.payroll")} landing={landing}>
              {t("financeWorkspace.payrollDescription")}
            </FinanceLink>
          )}
          {(isClubAdmin || isClubOwner) && FEATURES.accountingControl && (
            <FinanceLink to="/club/admin/accounting-control" label={t("financeWorkspace.reconciliation")} landing={landing}>
              {t("financeWorkspace.reconciliationDescription")}
            </FinanceLink>
          )}
        </nav>
      </div>
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
