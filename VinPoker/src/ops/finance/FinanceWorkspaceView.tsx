import { AlertTriangle, Calculator, RefreshCw, Scale, ShieldCheck } from "lucide-react";
import type { FinanceRange, FinanceSummaryRead } from "@/ops/finance/financeReadAdapter";

export function FinanceWorkspaceView({
  clubName,
  range,
  summary,
  loading,
  blockedReason,
  onRefresh,
}: {
  clubName: string;
  range: FinanceRange;
  summary: FinanceSummaryRead | null;
  loading: boolean;
  blockedReason: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#d8bc85]">
            <Scale className="h-4 w-4" /> Reconciliation ledger
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-white">Tài chính &amp; Đối soát</h1>
          <p className="mt-1 text-sm text-[#91a49b]">{clubName} · {formatRange(range)} · Tạm tính</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-sky-300/20 bg-sky-300/8 px-3 py-1 text-xs font-semibold text-sky-200">READ_ONLY</span>
          <button
            type="button"
            data-ops-action="finance.refresh"
            onClick={onRefresh}
            disabled={loading}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#b9c8c0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
            aria-label="Làm mới Tài chính & Đối soát"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3 text-sm leading-6 text-sky-100">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Chỉ dùng <code>get_club_finance_summary</code>. Không đọc bảng để tự cộng fallback; contribution không được gọi là lợi nhuận.
      </div>

      {blockedReason ? (
        <BlockedState reason={blockedReason} />
      ) : loading && !summary ? (
        <StateCard title="Đang tải tổng hợp tài chính…" />
      ) : !summary ? (
        <BlockedState reason="FINANCE_SUMMARY_RPC_UNAVAILABLE" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Doanh thu tạm tính" value={summary.revenue.total} tone="emerald" />
            <Metric label="Lương đã lưu" value={summary.cost.payrollNet} tone="ivory" />
            <Metric label="Chi phí CLB" value={summary.cost.clubExpenses} tone="amber" />
            <Metric label="Net server" value={summary.net} tone={summary.net >= 0 ? "emerald" : "red"} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Breakdown title="Nguồn thu" rows={[
              ["Rake", summary.revenue.rake],
              ["Phí dịch vụ", summary.revenue.serviceFee],
              ["Phí staking", summary.revenue.stakingFees],
              ["Phí payout", summary.revenue.payoutFees],
              ["F&B", summary.revenue.fnb],
            ]} />
            <Breakdown title="Chi phí đã ghi nhận" rows={[
              ["Lương net (gồm PT đã trả)", summary.cost.payrollNet],
              ["Trong đó: PT đã trả", summary.cost.ptWagePaid],
              ["F&B COGS", summary.cost.fnbCogs],
              ["COMP COGS", summary.cost.compCogs],
              ["Chi phí CLB", summary.cost.clubExpenses],
            ]} />
          </div>
          {summary.staffLive ? (
            <div className="space-y-2">
              <Breakdown title="Lương nhân viên đang tạm tính · hiện tại" rows={[
                ["FT gross tạm tính", summary.staffLive.ftProvisionalGross],
                ["FT net tạm tính", summary.staffLive.ftProvisionalNet],
                ["PT chưa trả", summary.staffLive.ptUnpaidBalance],
              ]} />
              <p className="text-sm leading-6 text-[#91a49b]">
                FT kỳ {summary.staffLive.ftPeriod}; PT là số dư chưa trả hiện tại, có thể gồm ca từ kỳ trước.
                Các khoản này chưa cộng vào chi phí đã ghi nhận trong khoảng báo cáo.
              </p>
            </div>
          ) : (
            <StateCard title="Chưa xác minh được tổng hợp lương nhân viên ngoài dealer từ backend hiện tại." />
          )}
          {summary.dealerFtLive ? (
            <div className="space-y-2">
              <Breakdown title="Dealer FT dự tính · kỳ hiện tại chưa ghi nhận" rows={[
                ["Dealer FT gross dự tính",summary.dealerFtLive.gross],
                ["Dealer FT net dự tính",summary.dealerFtLive.net],
              ]}/>
              <p className="text-sm leading-6 text-[#91a49b]">Kỳ {summary.dealerFtLive.period}; chỉ gồm dealer chưa được ghi nhận trong kỳ. Ca đang mở dự tính theo giờ chuẩn, chưa cộng vào chi phí đã ghi nhận.</p>
            </div>
          ) : <StateCard title="Chưa có dữ liệu dự tính dealer FT đã xác minh."/>}
          {summary.dealerLive ? (
            <div className="space-y-2">
              <Breakdown title="Lương dealer PT chưa trả · hiện tại" rows={[
                ["Chưa chốt (dealer đang hoạt động)",summary.dealerLive.ptActiveUnfinalizedBalance],
                ["Đã chốt, chưa trả",summary.dealerLive.ptFinalizedUnpaidBalance],
                ["Tổng PT dealer chưa trả",summary.dealerLive.ptTotalUnpaid],
              ]}/>
              <p className="text-sm leading-6 text-[#91a49b]">Số dư hiện tại, có thể gồm ca từ kỳ trước. Chưa cộng vào chi phí đã ghi nhận; chi phí PT được ghi nhận khi trả.</p>
            </div>
          ) : <StateCard title="Chưa có dữ liệu lương dealer PT đã xác minh."/>}
          <div className="rounded-2xl border border-amber-300/15 bg-amber-300/8 px-4 py-3 text-sm leading-6 text-amber-100">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            Escrow và payout liability là khoản nợ phải trả. Contract này chưa trả liability nên màn hình không hiển thị số 0 giả.
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "emerald" | "ivory" | "amber" | "red" }) {
  const toneClass = {
    emerald: "text-emerald-200",
    ivory: "text-[#f2ece6]",
    amber: "text-amber-200",
    red: "text-rose-200",
  }[tone];
  return (
    <div className="rounded-2xl border border-white/7 bg-[#07100c] px-4 py-3">
      <span className="text-[11px] text-[#91a49b]">{label}</span>
      <span className={`mt-1 block truncate font-mono text-lg font-semibold ${toneClass}`}>{formatMoney(value)}</span>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <section className="rounded-3xl border border-white/8 bg-[#07100c] p-4 sm:p-5">
      <h2 className="font-semibold text-white">{title}</h2>
      <div className="mt-3 divide-y divide-white/7">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="text-[#91a49b]">{label}</span>
            <span className="font-mono text-[#f2ece6]">{formatMoney(value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BlockedState({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-amber-300/20 bg-amber-300/8 px-5 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-200" />
      <p className="mt-3 font-semibold text-white">Tài chính tạm khóa</p>
      <p className="mt-2 max-w-lg text-sm leading-6 text-[#b9c8c0]">RPC server thiếu, lỗi hoặc trả sai contract. Không dùng fallback phía trình duyệt.</p>
      <p className="mt-2 font-mono text-xs text-amber-200">{reason}</p>
    </div>
  );
}

function StateCard({ title }: { title: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-white/8 bg-[#07100c] px-5 text-center">
      <Calculator className="h-8 w-8 text-[#91a49b]" />
      <p className="mt-3 font-semibold text-white">{title}</p>
    </div>
  );
}

function formatMoney(value: number): string {
  return `${value.toLocaleString("vi-VN")} ₫`;
}

function formatRange(range: FinanceRange): string {
  return `${new Date(range.from).toLocaleDateString("vi-VN",{timeZone:'Asia/Ho_Chi_Minh'})}–${new Date(range.to).toLocaleDateString("vi-VN",{timeZone:'Asia/Ho_Chi_Minh'})}`;
}
