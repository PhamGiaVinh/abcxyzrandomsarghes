import type React from "react";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Coins, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import { formatVND } from "@/lib/format";
import { useFinanceSummaryRpcOnly } from "@/hooks/accountant/useFinanceSummaryRpcOnly";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { financeReadErrorKey } from "@/lib/financeSummaryRead";
import { useTranslation } from "react-i18next";

function currentYM(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function shiftYM(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * Báo cáo — read-only monthly P&L for the accountant (Tạm tính view of the same
 * get_club_finance_summary the owner cockpit reads; includes the clubExpenses cost line).
 * No write controls; numbers of an un-closed period are provisional by doctrine.
 */
export function AccountantFinanceTab({ clubId }: { clubId: string | null }) {
  const { t } = useTranslation();
  const [ym, setYM] = useState(currentYM);
  const { from, to } = useMemo(() => {
    const f = new Date(Date.UTC(ym.year, ym.month - 1, 1));
    const t = new Date(Date.UTC(ym.year, ym.month, 1));
    return { from: f.toISOString(), to: t.toISOString() };
  }, [ym]);
  const q = useFinanceSummaryRpcOnly(clubId, from, to);
  const s = q.data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          Thu — chi — còn lại của tháng (chỉ xem; kỳ chưa chốt sổ là số tạm tính).
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setYM((s0) => shiftYM(s0.year, s0.month, -1))} aria-label="Tháng trước">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="h-9 min-w-24 rounded-md border border-border bg-card px-3 inline-flex items-center justify-center text-sm font-bold tabular-nums">
            {String(ym.month).padStart(2, "0")}/{ym.year}
          </div>
          <Button variant="outline" size="sm" onClick={() => setYM((s0) => shiftYM(s0.year, s0.month, 1))} aria-label="Tháng sau">
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <Card role="alert" className="p-5 border-destructive/40 bg-destructive/10 text-[13px] text-destructive">
          {t(financeReadErrorKey(q.error))}
        </Card>
      ) : s ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <BigCard icon={Coins} label="Tổng thu" value={formatVND(s.revenue.total)} tone="text-primary" />
            <BigCard
              icon={Wallet}
              label="Tổng chi"
              value={formatVND(s.cost.payrollNet + s.cost.fnbCogs + s.cost.compCogs + s.cost.clubExpenses)}
              tone="text-foreground"
            />
            <BigCard icon={TrendingUp} label="Còn lại (tạm tính)" value={formatVND(s.net)} tone={s.net >= 0 ? "text-primary" : "text-destructive"} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4 border-border bg-card space-y-2">
              <h3 className="text-sm font-bold text-foreground">Nguồn thu</h3>
              <Line label="Rake giải đấu" value={s.revenue.rake} />
              <Line label="Phí dịch vụ giải" value={s.revenue.serviceFee} />
              <Line label="Phí staking" value={s.revenue.stakingFees} />
              <Line label="Phí chi trả staking" value={s.revenue.payoutFees} />
              <Line label="F&B (đồ ăn, đồ uống)" value={s.revenue.fnb} />
            </Card>
            <Card className="p-4 border-border bg-card space-y-2">
              <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5">
                <ReceiptText className="w-4 h-4 text-primary" />
                Khoản chi
              </h3>
              <Line label="Lương (đã lưu, gồm PT)" value={s.cost.payrollNet} />
              <Line label="— trong đó trả PT theo giờ" value={s.cost.ptWagePaid} muted />
              <Line label="Giá vốn F&B" value={s.cost.fnbCogs} />
              <Line label="Giá vốn suất mời (comp)" value={s.cost.compCogs} />
              <Line label="Chi phí vận hành (Sổ chi phí)" value={s.cost.clubExpenses} />
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BigCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card className="p-4 border-border bg-card">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="w-3.5 h-3.5 text-primary" />
        {label}
      </div>
      <div className={`mt-1 text-xl font-display font-black tabular-nums ${tone}`}>{value}</div>
    </Card>
  );
}

function Line({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className={muted ? "text-muted-foreground/70" : "text-muted-foreground"}>{label}</span>
      <span className={`font-bold tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}>{formatVND(value)}</span>
    </div>
  );
}
