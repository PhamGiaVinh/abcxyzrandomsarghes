import { Banknote, Info, Landmark, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShortDate } from "@/lib/format";
import { useStaffLink } from "@/hooks/staff/useStaffLink";
import { useStaffSalary } from "@/hooks/staff/useStaffSalary";
import { StaffNotLinkedScreen } from "../StaffNotLinkedScreen";
import type { StaffSalaryPaymentView } from "@/types/staffApp";

function fmtVnd(n?: number | null): string {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(n ?? 0))}đ`;
}

function hoursLabel(minutes?: number | null): string {
  if (!minutes) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}p` : `${h}h`;
}

function methodMeta(method?: string | null): { icon: typeof Banknote; label: string } {
  if (method === "cash") return { icon: Banknote, label: "tiền mặt" };
  if (method === "bank") return { icon: Landmark, label: "chuyển khoản" };
  return { icon: Wallet, label: method || "khác" };
}

export function StaffSalaryScreen() {
  const { staff, isStaff, loading } = useStaffLink();
  const { salary, isLoading, isError, scopeError, refetch, isFetching } = useStaffSalary(staff);

  if (loading) return <SalarySkeleton />;
  if (!isStaff || !staff) return <StaffNotLinkedScreen />;
  if (isError || scopeError) return <Card role="alert" className="p-4 space-y-2">
    <h1 className="font-bold">Không xác minh được dữ liệu lương.</h1>
    <p className="text-sm text-muted-foreground">{scopeError ?? 'Không thể kết luận số dư hoặc lịch sử chi trả. Vui lòng tải lại.'}</p>
    {!scopeError && <button type="button" className="underline" disabled={isFetching} onClick={()=>{void refetch();}}>Thử lại</button>}
  </Card>;

  const isPartTime = (salary?.employmentType ?? staff.employmentType) === "part_time";
  const payments = salary?.recentPayments ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-display font-bold text-foreground">Lương của tôi</h1>
        <p className="text-[13px] text-muted-foreground">Câu lạc bộ chi trả — bạn chỉ theo dõi.</p>
      </div>

      {isLoading || !salary ? (
        <Skeleton className="h-44 w-full rounded-2xl" />
      ) : isPartTime ? (
        <Card className="p-4 border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">Số dư chờ nhận</span>
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-400">
              Tạm tính
            </span>
          </div>
          <div className="text-3xl font-display font-black text-primary">{fmtVnd(salary.balanceVnd)}</div>
          <div className="text-[12px] text-muted-foreground">
            {hoursLabel(salary.accruedMinutes)} làm × {fmtVnd(salary.hourlyRateVnd)}/h
          </div>
          {salary.currentShiftOpen && (
            <div className="flex items-center gap-2 text-[12px] text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Đang trong ca — số dư đang tăng
            </div>
          )}
          <div className="flex items-start gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Con số còn thay đổi cho tới khi câu lạc bộ chốt và chi trả.
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">Lương tháng này</span>
            <span className="text-[11px] text-muted-foreground">Trả theo tháng</span>
          </div>
          <div className="text-3xl font-display font-black text-primary">{salary.monthlySalaryVnd == null
            ? <span className="text-sm text-muted-foreground">Chưa cấu hình mức lương tháng.</span>
            : fmtVnd(salary.monthlySalaryVnd)}</div>
          <div className="flex items-start gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Lương cố định theo tháng. Câu lạc bộ chốt và chi trả cuối kỳ.
          </div>
        </Card>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Đã nhận</h2>
          <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            Đã chốt · không đổi
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <Card className="p-5 border-border text-center text-[13px] text-muted-foreground">
            Chưa có lần chi trả nào.
          </Card>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentRow({ payment }: { payment: StaffSalaryPaymentView }) {
  const meta = methodMeta(payment.paymentMethod);
  const Icon = meta.icon;
  return (
    <Card className="p-3 border-border bg-card">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
          <Icon className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-foreground">{fmtVnd(payment.amountVnd)}</div>
          <div className="text-[12px] text-muted-foreground">
            {hoursLabel(payment.minutesPaid)} · {meta.label}
          </div>
        </div>
        <div className="text-[12px] text-muted-foreground text-right">{formatShortDate(payment.paidAt)}</div>
      </div>
    </Card>
  );
}

function SalarySkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-40 rounded-lg" />
      <Skeleton className="h-44 w-full rounded-2xl" />
      <Skeleton className="h-6 w-28 rounded" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
