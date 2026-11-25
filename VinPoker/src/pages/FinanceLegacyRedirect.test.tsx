import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import FinanceLegacyRedirect from "./FinanceLegacyRedirect";

afterEach(cleanup);
function Destination() {
  const location = useLocation();
  return <p>{location.pathname + location.search + location.hash}</p>;
}

it.each([
  ["/cashier?tab=pt_wages&club=B&payment_id=P#receipt", "/finance/transactions?tab=pt_wages&club=B&payment_id=P#receipt"],
  ["/accountant?tab=expenses&club=B", "/finance/expenses?tab=expenses&club=B"],
  ["/accountant?tab=report&from=2026-10-01", "/finance/reconciliation?tab=report&from=2026-10-01"],
  ["/accountant?club=B", "/finance/payroll?club=B"],
  ["/club/admin/finance?club=B", "/finance/overview?club=B"],
])("keeps the legacy intent from %s", (before, after) => {
  render(<MemoryRouter initialEntries={[before]}><Routes>
    <Route path="/cashier" element={<FinanceLegacyRedirect />} />
    <Route path="/accountant" element={<FinanceLegacyRedirect />} />
    <Route path="/club/admin/finance" element={<FinanceLegacyRedirect />} />
    <Route path="/finance/*" element={<Destination />} />
  </Routes></MemoryRouter>);
  expect(screen.getByText(after)).toBeVisible();
});
