import { Navigate, useLocation } from "react-router-dom";
import { financeAccountantPaths, financeAccountantTab } from "@/lib/financeNavigation";

/** Preserve bookmarked document IDs and filters when moving to the shared workplace. */
export default function FinanceLegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  const destination = pathname === "/cashier" ? "/finance/transactions"
    : pathname === "/accountant" ? financeAccountantPaths[financeAccountantTab(pathname, search)]
      : "/finance/overview";
  return <Navigate replace to={destination + search + hash} />;
}
