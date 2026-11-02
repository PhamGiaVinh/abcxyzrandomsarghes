import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

afterEach(cleanup);

// Mutable FEATURES — tests flip accountingControl per scenario (house pattern: PrizesTab.test.tsx).
vi.mock("@/lib/featureFlags", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/featureFlags")>();
  return { ...actual, FEATURES: { ...actual.FEATURES, accountingControl: false } };
});

// Mutable auth — the page only reads isAdmin / isClubAdmin / isClubOwner.
const AUTH = { isAdmin: false, isClubAdmin: false, isClubOwner: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => AUTH }));

// Stub the finance hook so tests never touch supabase (the live W1 path uses it).
const FIN: { loading: boolean; error: string | null; clubs: unknown[]; summary: unknown; reload: () => void } = {
  loading: false, error: null, clubs: [], summary: null, reload: () => {},
};
vi.mock("@/hooks/useClubFinanceSummary", () => ({ useClubFinanceSummary: () => FIN }));

// Stub the payout-liability hook (W3-B live path).
const PAYOUT: { loading: boolean; error: string | null; notApplied: boolean; data: unknown } = {
  loading: false, error: null, notApplied: false, data: null,
};
vi.mock("@/hooks/useClubPayoutLiability", () => ({ useClubPayoutLiability: () => PAYOUT }));

import AccountingControl from "@/pages/AccountingControl";
import { FEATURES } from "@/lib/featureFlags";
import { OverviewTab } from "../tabs/OverviewTab";
import { DailyCloseTab } from "../tabs/DailyCloseTab";
import { EventPnlTab } from "../tabs/EventPnlTab";
import { SeriesPnlTab } from "../tabs/SeriesPnlTab";
import { CashBankTab } from "../tabs/CashBankTab";
import { PayoutLiabilityTab } from "../tabs/PayoutLiabilityTab";
import { FnbFinanceTab } from "../tabs/FnbFinanceTab";
import { PayrollCostTab } from "../tabs/PayrollCostTab";
import { StakingEscrowTab } from "../tabs/StakingEscrowTab";
import { VarianceAlertsTab } from "../tabs/VarianceAlertsTab";
import { MonthlyReportTab } from "../tabs/MonthlyReportTab";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/club/admin/accounting-control"]}>
      <Routes>
        <Route path="/club/admin/accounting-control" element={<AccountingControl />} />
        <Route path="/club/admin" element={<div>REDIRECT_CLUB_ADMIN</div>} />
        <Route path="/" element={<div>REDIRECT_HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  (FEATURES as { accountingControl: boolean }).accountingControl = false;
  (FEATURES as { accountingControlLiveOverview: boolean }).accountingControlLiveOverview = false;
  (FEATURES as { accountingControlLivePayroll: boolean }).accountingControlLivePayroll = false;
  (FEATURES as { accountingControlLivePayout: boolean }).accountingControlLivePayout = false;
  AUTH.isAdmin = false;
  AUTH.isClubAdmin = false;
  AUTH.isClubOwner = false;
  FIN.loading = false;
  FIN.error = null;
  FIN.summary = null;
  PAYOUT.loading = false;
  PAYOUT.error = null;
  PAYOUT.notApplied = false;
  PAYOUT.data = null;
});

describe("AccountingControl — flag + role gates", () => {
  it("flag ON + club owner → renders heading and all 11 tabs", () => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    AUTH.isClubOwner = true;
    renderPage();
    expect(screen.getByText("Tài chính & Đối soát")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(11);
  });

  it("flag OFF + club owner (not super_admin) → redirected to /club/admin", () => {
    AUTH.isClubOwner = true;
    renderPage();
    expect(screen.getByText("REDIRECT_CLUB_ADMIN")).toBeInTheDocument();
    expect(screen.queryByText("Tài chính & Đối soát")).not.toBeInTheDocument();
  });

  it("flag OFF + super_admin → still renders (internal UAT bypass)", () => {
    AUTH.isAdmin = true;
    AUTH.isClubAdmin = true;
    renderPage();
    expect(screen.getByText("Tài chính & Đối soát")).toBeInTheDocument();
  });

  it("no owner/club-admin role → redirected home regardless of flag", () => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    renderPage();
    expect(screen.getByText("REDIRECT_HOME")).toBeInTheDocument();
  });
});

describe("AccountingControl — doctrine strings on the default tab", () => {
  beforeEach(() => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    AUTH.isClubOwner = true;
  });

  it("shows the mandatory pass-through explainer verbatim", () => {
    renderPage();
    expect(
      screen.getByText(/Doanh thu giữ lại ≠ tổng buy-in\. Prize pool và escrow là tiền pass-through\/liability, không phải doanh thu\./),
    ).toBeInTheDocument();
  });

  it("labels contribution with the operating-cost caveat and shows the mock banner", () => {
    renderPage();
    expect(screen.getAllByText(/Biên đóng góp \(chưa trừ chi phí vận hành chung\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/DỮ LIỆU MẪU \(mock\)/)).toBeInTheDocument();
  });
});

describe("Per-tab doctrine (rendered directly — Radix unmounts inactive TabsContent in jsdom)", () => {
  const noop = () => {};

  it("SeriesPnlTab carries the Series-Intelligence bridge verbatim", () => {
    render(<MemoryRouter><SeriesPnlTab /></MemoryRouter>);
    expect(
      screen.getByText(/Series Intelligence dự báo trước\. Accounting Control chốt số thật sau event\/series\. Forecast không phải accounting truth\./),
    ).toBeInTheDocument();
  });

  it('FnbFinanceTab shows the not-wired state (never "F&B chưa bật", never an earned 0)', () => {
    const { container } = render(<MemoryRouter><FnbFinanceTab /></MemoryRouter>);
    expect(screen.getByText(/Chưa nối dữ liệu tài chính F&B vào Accounting Control/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/F&B chưa bật/i);
    expect(container.textContent).not.toMatch(/0\s*₫/);
  });

  it("W1 live overview: shows real retained/cost/còn-lại + số-thật banner, mock parts tagged", () => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    (FEATURES as { accountingControlLiveOverview: boolean }).accountingControlLiveOverview = true;
    AUTH.isClubOwner = true;
    FIN.summary = {
      revenue: { total: 12_345_000 },
      cost: { payrollNet: 4_000_000 },
      net: 8_345_000,
    };
    renderPage();
    // real numbers from the mocked finance summary
    expect(screen.getByText(/12\.345\.000/)).toBeInTheDocument();
    expect(screen.getByText(/8\.345\.000/)).toBeInTheDocument();
    // Canonical net also deducts recorded COGS/club expenses; it is not just after payroll.
    expect(screen.getByText(/Khối "Tiền của club" đang là SỐ THẬT/)).toBeInTheDocument();
    expect(screen.getByText(/Biên đóng góp theo báo cáo tài chính/)).toBeInTheDocument();
    // page banner reflects partial-live, and mock parts are tagged
    expect(screen.getByText(/SỐ THẬT một phần/)).toBeInTheDocument();
    expect(screen.getAllByText(/\(mock — chưa nối\)/).length).toBeGreaterThan(0);
  });

  it("W4 live payroll: shows real total payroll (incl PT) + banner + per-period, role split stays mock", async () => {
    const { LivePayrollTab } = await import("../live/LivePayrollTab");
    FIN.summary = {
      cost: { payrollNet: 78_500_000, payrollGross: 82_000_000, adjustments: -1_200_000, fnbCogs: 0, compCogs: 0 },
      unpaidTotal: 12_000_000,
      reconciledTotal: 40_000_000,
      perPeriod: [{ periodKey: "07/2026", gross: 82_000_000, net: 78_500_000, status: "paid" }],
    };
    render(<MemoryRouter><LivePayrollTab /></MemoryRouter>);
    expect(screen.getAllByText(/78\.500\.000/).length).toBeGreaterThan(0); // real payrollNet (card + period row)
    expect(screen.getByText(/Tổng lương là SỐ THẬT/)).toBeInTheDocument();
    expect(screen.getByText(/07\/2026/)).toBeInTheDocument(); // per-period row
    // table-hour cost stays mock-tagged in live mode
    expect(screen.getAllByText(/\(mock — chưa nối\)/).length).toBeGreaterThan(0);
  });

  it("W3-B live payout: real owed/paid/outstanding + honest states; over-pay = variance not negative debt", async () => {
    const { LivePayoutTab } = await import("../live/LivePayoutTab");
    PAYOUT.data = {
      periodFrom: "2026-07-01", periodTo: "2026-07-31",
      owedTotal: 28_500_000, paidTotal: 30_000_000, outstandingTotal: -1_500_000,
      perTournament: [
        { tournamentId: "t1", name: "Deepstack 500tr", closeDate: "2026-07-05", isClosed: true, hasFinishedPlace: true, owed: 28_500_000, paid: 30_000_000, outstanding: -1_500_000, finishersCount: 8 },
        { tournamentId: "t2", name: "Turbo tối nay", closeDate: "2026-07-20", isClosed: false, hasFinishedPlace: false, owed: null, paid: 0, outstanding: null, finishersCount: 0 },
      ],
      aging: { d0_1: 0, d2_7: 0, d8p: 0 },
    };
    const { container } = render(<MemoryRouter><LivePayoutTab /></MemoryRouter>);
    const txt = (container.textContent ?? "").normalize("NFC");
    expect(txt.normalize("NFC")).toContain("Số thật".normalize("NFC"));
    expect(screen.getAllByText(/28\.500\.000/).length).toBeGreaterThan(0); // real owed
    // over-paid → the TOTAL card shows a variance warning (abs), NOT a negative total debt
    expect(txt).toContain("Chênh lệch trả vượt".normalize("NFC"));
    // not-finalized tournament shows "chưa chốt", not an owed 0
    expect(txt).toContain("chưa chốt kết quả".normalize("NFC"));
  });

  it("W3-B payout notApplied → 'chưa áp dụng' banner + mock body (no real 0)", async () => {
    const { LivePayoutTab } = await import("../live/LivePayoutTab");
    PAYOUT.notApplied = true;
    PAYOUT.data = null;
    render(<MemoryRouter><LivePayoutTab /></MemoryRouter>);
    expect(screen.getByText(/Chưa áp dụng/)).toBeInTheDocument();
    // mock body still shows (owed row exists), never a bare real 0
    expect(screen.getByText(/Còn nợ người chơi/)).toBeInTheDocument();
  });

  it("AC PayoutLiabilityTab is READ-ONLY: no 'Đã trả thưởng' button (that lives only in Cashier)", () => {
    const { container } = render(<MemoryRouter><PayoutLiabilityTab live={{ active: true, loading: false, error: null, notApplied: false, data: {
      periodLabel: "Tháng này", owedTotal: 1_000_000, paidTotal: 0, outstandingTotal: 1_000_000,
      perTournament: [{ tournamentId: "t1", name: "G1", closeDate: "2026-07-05", isClosed: true, hasFinishedPlace: true, owed: 1_000_000, paid: 0, outstanding: 1_000_000, finishersCount: 1 }],
      aging: { d0_1: 1_000_000, d2_7: 0, d8p: 0 },
    } }} /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/Đã trả thưởng/);
    expect(screen.queryByRole("button", { name: /trả/i })).not.toBeInTheDocument();
  });

  it("live flag OFF → Tổng quan renders pure mock (no live banner, no finance fetch)", () => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    AUTH.isClubOwner = true;
    renderPage();
    expect(screen.queryByText(/Khối "Tiền của club" đang là SỐ THẬT/)).not.toBeInTheDocument();
    expect(screen.getByText(/DỮ LIỆU MẪU \(mock\)/)).toBeInTheDocument();
  });

  it("OverviewTab renders the entries forecast as a COUNT range, not currency (no ₫)", () => {
    const { container } = render(<MemoryRouter><OverviewTab onNavigate={noop} /></MemoryRouter>);
    expect(screen.getByText(/Dự báo entries giải tới/)).toBeInTheDocument();
    // the entries range must read "70 – 105 (thường gặp ~85)" with NO đồng sign
    expect(container.textContent).toMatch(/70\s*–\s*105\s*\(thường gặp ~85\)/);
    expect(container.textContent).not.toMatch(/70\s*₫/);
    expect(container.textContent).not.toMatch(/85\s*₫/);
  });

  it("EventPnlTab shows the DUAL break-even labels (P0: never a generic break-even)", () => {
    render(<MemoryRouter><EventPnlTab /></MemoryRouter>);
    expect(screen.getByText(/Hòa vốn GTD \(đủ phủ đảm bảo\)/)).toBeInTheDocument();
    expect(screen.getByText(/Hòa vốn đóng góp \(gồm chi phí trực tiếp/)).toBeInTheDocument();
  });

  it("word guard across all 11 tabs: no 'lợi nhuận'/'net profit'; 'lãi ròng' only inside the negation", () => {
    const tabs = [
      <OverviewTab key="o" onNavigate={noop} />,
      <DailyCloseTab key="d" />,
      <EventPnlTab key="e" />,
      <SeriesPnlTab key="s" />,
      <CashBankTab key="c" />,
      <PayoutLiabilityTab key="p" />,
      <FnbFinanceTab key="f" />,
      <PayrollCostTab key="pr" />,
      <StakingEscrowTab key="st" />,
      <VarianceAlertsTab key="v" onNavigate={noop} />,
      <MonthlyReportTab key="m" />,
    ];
    for (const el of tabs) {
      const { container, unmount } = render(<MemoryRouter>{el}</MemoryRouter>);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/lợi nhuận|net profit/i);
      const laiRong = text.match(/lãi ròng/gi)?.length ?? 0;
      const negated = text.match(/chưa phải lãi ròng/gi)?.length ?? 0;
      expect(laiRong).toBe(negated); // mọi lần xuất hiện đều phải nằm trong câu phủ định
      unmount();
    }
  });
});
