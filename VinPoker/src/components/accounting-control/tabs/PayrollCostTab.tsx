import { ShieldCheck, TriangleAlert, PlugZap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { MOCK_PAYROLL, MOCK_TABLE_HOUR } from "../mock/mockData";
import type { PayrollLineFixture } from "../mock/types";
import { DataStateBadge } from "../shared/DataStateBadge";
import { MoneyCard } from "../shared/MoneyCard";
import { TabShell } from "../shared/TabShell";

/** Số thật (read-only) từ get_club_finance_summary — tổng lương, chưa tách theo vai trò. */
export interface LivePayrollData {
  periodLabel: string;
  payrollNet: number; // tổng lương đã lưu (net) — đã gồm PT sau #656 R2
  payrollGross: number;
  adjustments: number;
  unpaidTotal: number;
  reconciledTotal: number;
  perPeriod: { periodKey: string; gross: number; net: number; statusLabel: string; statusTone: string }[];
}

export interface LivePayrollState {
  active: boolean;
  loading: boolean;
  error: string | null;
  data: LivePayrollData | null;
}

const sampleAlertChip = (
  <span className="mt-auto self-start text-[10px] font-semibold px-1.5 py-0.5 rounded border border-dashed border-amber-500/50 text-amber-400">
    Cảnh báo mẫu
  </span>
);

const FRAMING = (
  <p className="text-[12px] leading-relaxed text-muted-foreground">
    Lương được <span className="font-semibold text-foreground/90">GHI NHẬN khi làm việc</span> — ca
    xong là thành chi phí, kể cả khi chưa trả tiền. Việc{" "}
    <span className="font-semibold text-foreground/90">TRẢ tiền</span> là dòng tiền riêng — đối soát
    ở tab «Tiền &amp; Bank».
  </p>
);

const HARD_RULE = (
  <Card className="p-3 md:p-4 border-[#378ADD]/30 bg-[#378ADD]/[0.04]">
    <div className="flex items-start gap-2.5">
      <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-[#378ADD]" />
      <p className="text-[12px] leading-relaxed text-foreground/85">
        <span className="font-semibold text-[#378ADD]">Quy tắc cứng.</span> Lương đã lưu KHÔNG BAO
        GIỜ tính lại — thay đổi chính sách chỉ áp dụng về sau; sửa sai bằng bút toán điều chỉnh.
      </p>
    </div>
  </Card>
);

function TableHourCard({ tableHour, live }: { tableHour: typeof MOCK_TABLE_HOUR; live: boolean }) {
  return (
    <Card className="p-3 md:p-4 gradient-card">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Chi phí giờ-bàn {live && <span className="text-amber-400/80 normal-case">(mock — chưa nối)</span>}
        </span>
        <DataStateBadge state="provisional" />
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-lg md:text-xl font-semibold tabular-nums text-foreground">
          ~{formatVND(tableHour.costPerTableHour)}/giờ
        </span>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          ({formatVND(tableHour.staffCost)} / {tableHour.tableHours} giờ-bàn)
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Con số để ra quyết định — «thêm 1 ca dealer có đáng không?» — không phải KPI để khoe. Chưa
        gồm lương PT.
      </p>
      {tableHour.missingCheckouts > 0 && (
        <span className="mt-2 inline-flex w-fit items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10">
          <TriangleAlert className="w-3 h-3 shrink-0" />
          {tableHour.missingCheckouts} dealer chưa check-out — giờ công chưa chốt được
        </span>
      )}
    </Card>
  );
}

export function PayrollCostTab({
  lines = MOCK_PAYROLL,
  tableHour = MOCK_TABLE_HOUR,
  live,
}: {
  lines?: PayrollLineFixture[];
  tableHour?: typeof MOCK_TABLE_HOUR;
  live?: LivePayrollState;
}) {
  const isLive = !!live?.active;
  const d = live?.data ?? null;
  const showLiveNumbers = isLive && !live?.loading && !live?.error && !!d;

  return (
    <TabShell
      title="Lương & chi phí nhân sự"
      question="Tháng này chi phí người vận hành là bao nhiêu — và đã ghi nhận đủ chưa?"
      doctrine={[
        "Lương ghi nhận (chi phí) và lương đã trả (dòng tiền) là hai việc khác nhau — không bao giờ trộn lẫn.",
        "Dòng chi phí ĐÃ BIẾT là đang thiếu phải hiện cảnh báo kèm khoảng ước — không bao giờ hiện 0 ₫.",
      ]}
    >
      {FRAMING}

      {showLiveNumbers && (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
          <PlugZap className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <p className="text-[12px] leading-relaxed text-foreground/85">
            <span className="font-semibold text-primary">Tổng lương là SỐ THẬT</span> (lương dealer đã
            lưu, đã gồm PT sau #656 R2, Tạm tính). Chi tiết theo vai trò (floor/thu ngân/PT) và chi
            phí giờ-bàn chưa tách được từ nguồn này — xem «Bảng lương» để chi tiết.
          </p>
        </div>
      )}

      {isLive && live?.error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
          <p className="text-[12px] text-foreground/85">Không tải được số thật ({live.error}). Không thay số chưa xác minh bằng dữ liệu mẫu.</p>
        </div>
      )}

      {showLiveNumbers && d ? (
        <>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {d.periodLabel}
            {live?.loading && " · đang tải…"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <MoneyCard label="Tổng lương đã lưu (gồm PT)" amount={d.payrollNet} state="provisional" kind="cost" sub="Net đã lưu — không tính lại" />
            <MoneyCard label="Lương gộp (gross)" amount={d.payrollGross} state="provisional" kind="neutral" />
            <MoneyCard label="Điều chỉnh" amount={d.adjustments} state="provisional" kind="neutral" />
            <MoneyCard
              label="Chưa trả (công nợ lương)"
              amount={d.unpaidTotal}
              state="provisional"
              kind={d.unpaidTotal > 0 ? "cost" : "neutral"}
              sub={d.unpaidTotal > 0 ? "Đã ghi nhận chi phí nhưng chưa chi trả" : "Đã trả hết trong kỳ"}
            />
          </div>
          {d.perPeriod.length > 0 && (
            <Card className="p-0 gradient-card overflow-hidden">
              <div className="px-3 py-2 border-b border-border/50 text-[12px] font-semibold">Theo kỳ lương</div>
              <div className="divide-y divide-border/50">
                {d.perPeriod.map((p) => (
                  <div key={p.periodKey} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                    <span className="text-sm text-foreground/90">{p.periodKey}</span>
                    <span className="flex items-center gap-3 text-[12px] tabular-nums text-muted-foreground">
                      <span>Gộp {formatVND(p.gross)}</span>
                      <span className="text-foreground/80">Thực {formatVND(p.net)}</span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border" style={{ borderColor: `${p.statusTone}55`, color: p.statusTone, background: `${p.statusTone}18` }}>
                        {p.statusLabel}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : isLive ? <div role="status" className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        {live?.loading ? "Đang tải số liệu lương…" : "Chưa xác minh số liệu lương. Không hiển thị số tiền thay thế."}
      </div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {lines.map((line) =>
            line.missing ? (
              <div key={line.category} className="h-full [&>div]:border-amber-500/50">
                <MoneyCard label={line.label} amount={line.amount} state={line.state} kind="cost" sub={line.note} footer={sampleAlertChip} />
              </div>
            ) : (
              <MoneyCard key={line.category} label={line.label} amount={line.amount} state={line.state} kind="cost" sub={line.note} />
            ),
          )}
        </div>
      )}

      {HARD_RULE}
      <TableHourCard tableHour={tableHour} live={isLive} />
    </TabShell>
  );
}
