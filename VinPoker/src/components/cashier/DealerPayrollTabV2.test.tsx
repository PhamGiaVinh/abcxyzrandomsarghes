import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DealerPayrollTabV2 from "./DealerPayrollTabV2";
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, isClubAdmin: false, isClubOwner: true }) }));

vi.mock("@/components/cashier/DealerPayrollTab", () => ({
  default: () => <div>Monthly payroll</div>,
}));

vi.mock("@/components/cashier/DealerPtWageTab", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div>{readOnly ? "PT wages read-only" : "PT wages editable"}</div>
  ),
}));

describe("DealerPayrollTabV2 customer preview", () => {
  it("opens the part-time view first and keeps it read-only", () => {
    render(<MemoryRouter><DealerPayrollTabV2 clubIds={["club-1"]} clubs={[{ id: "club-1", name: "HSOP" }]} /></MemoryRouter>);

    expect(screen.getByRole("tab", { name: "Theo giờ · Part-time" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Theo dõi và chốt phiếu PT")).toBeInTheDocument();
    expect(screen.getByText("PT wages read-only")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chốt và chi phiếu PT tại quầy' })).toHaveAttribute('href', '/cashier?tab=pt_wages');
    expect(screen.queryByText("Monthly payroll")).not.toBeInTheDocument();
  });
});
