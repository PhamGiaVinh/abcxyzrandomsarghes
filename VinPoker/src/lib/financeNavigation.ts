/** Carry report scope between work areas without copying action IDs or tab names. */
export function financeDestination(destination: string, currentSearch: string): string {
  const target = new URL(destination, "https://finance.invalid");
  const current = new URLSearchParams(currentSearch);
  for (const key of ["club", "from", "to"]) {
    const value = current.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  return target.pathname + target.search;
}

export const financeAccountantPaths = {
  salary: "/finance/payroll",
  expenses: "/finance/expenses",
  report: "/finance/reconciliation",
} as const;

export function financeAccountantTab(pathname: string, search: string) {
  const route = Object.entries(financeAccountantPaths).find(([, path]) => path === pathname);
  if (route) return route[0] as keyof typeof financeAccountantPaths;
  const tab = new URLSearchParams(search).get("tab");
  return tab === "expenses" || tab === "report" ? tab : "salary";
}
