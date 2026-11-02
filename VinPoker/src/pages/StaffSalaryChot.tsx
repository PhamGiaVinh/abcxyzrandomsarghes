import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Coins,
  Lock,
  Send,
  ThumbsDown,
  ThumbsUp,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { formatVND } from "@/lib/format";
import {financeBusinessToday} from '@/lib/financeSummaryRead';
import { staffSalarySource } from "@/lib/staffSalary/dataSource";
import { STAFF_DEPARTMENT_LABELS, type StaffDepartment } from "@/types/staffApp";
import { useSalaryActions, useSalaryClubs, useStaffSalaryMonth } from "@/hooks/staffSalary/useStaffSalary";
import type { SalaryPeriodStatus, SalaryRow } from "@/lib/staffSalary/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_LABEL: Record<SalaryPeriodStatus, string> = {
  prepared: "Đã chốt · chờ gửi",
  submitted: "Đã gửi · chờ chủ CLB duyệt",
  approved: "Đã duyệt",
  rejected: "Bị từ chối",
};

function statusTone(status: SalaryPeriodStatus): string {
  if (status === "approved") return "border-primary/40 bg-primary/10 text-primary";
  if (status === "submitted") return "border-amber-500/40 bg-amber-500/10 text-amber-400";
  if (status === "rejected") return "border-red-500/40 bg-red-500/10 text-red-400";
  return "border-border bg-card text-muted-foreground";
}

function deptLabel(dept: string): string {
  return STAFF_DEPARTMENT_LABELS[dept as StaffDepartment] ?? dept;
}

function currentYM(): { year: number; month: number } {
  const [year,month]=financeBusinessToday().split('-').map(Number);
  return {year,month};
}

function shiftYM(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function StaffSalaryChot({ embedded }: { embedded?: boolean } = {}) {
  const { loading: authLoading, user, isAdmin, isClubAdmin, isClubOwner } = useAuth();
  const [searchParams] = useSearchParams();
  const source = staffSalarySource();
  const preview = source === "mock";
  const mockPreview = preview && searchParams.get("preview") === "mock";
  const previewAllowed = isAdmin || isClubOwner;
  const allowed = FEATURES.staffSalaryChot ? !!user : previewAllowed || mockPreview;

  const [clubId, setClubId] = useState("");
  const [ym, setYM] = useState(currentYM);
  const { year, month } = ym;

  const clubsQuery = useSalaryClubs(source, allowed);
  const clubs = useMemo(() => clubsQuery.data ?? [], [clubsQuery.data]);
  const activeClubId = clubs.find((c) => c.id === clubId)?.id || clubs[0]?.id || null;
  const activeClub = clubs.find((c) => c.id === activeClubId) ?? clubs[0] ?? null;

  const monthQuery = useStaffSalaryMonth(source, activeClubId, year, month);
  const actions = useSalaryActions(source, activeClubId, year, month);

  useEffect(() => {
    if (!clubId && clubs[0]?.id) setClubId(clubs[0].id);
  }, [clubId, clubs]);

  if (authLoading || clubsQuery.isLoading) return <ChotSkeleton />;
  // Embedded (accountant workspace): the parent already gates access — never redirect.
  if (!allowed && !embedded) return <Navigate to="/club/admin" replace />;
  if (clubsQuery.isPaused || monthQuery.isPaused) {
    return <Card role="status" className="p-6 text-sm text-muted-foreground">
      Mất kết nối — bảng lương sẽ tự cập nhật khi có mạng trở lại.
    </Card>;
  }

  const view = monthQuery.data;
  const status: SalaryPeriodStatus = view?.status ?? "prepared";
  const hasRuns = view?.hasRuns ?? false;
  const rows = hasRuns ? view?.lockedRows ?? [] : view?.previewRows ?? [];
  const canApprove = activeClub?.role === "owner" || activeClub?.role === "admin";
  const busy =
    !view || monthQuery.isFetching ||
    actions.chot.isPending ||
    actions.submit.isPending ||
    actions.approve.isPending ||
    actions.reject.isPending;

  return (
    <div className={embedded ? "space-y-4" : "container mx-auto max-w-5xl px-4 py-6 space-y-4"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl text-primary">Chốt lương nhân viên</h1>
            <Badge variant="outline" className={preview ? "text-[10px] border-primary/40 text-primary" : "text-[10px]"}>
              {preview ? "PREVIEW · MOCK" : "LIVE"}
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground max-w-2xl">
            Kế toán tính + chốt bảng lương tháng rồi gửi cho chủ CLB duyệt. Số đã chốt là bất biến — không tính lại.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setYM((s) => shiftYM(s.year, s.month, -1))} aria-label="Tháng trước">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="h-9 min-w-24 rounded-md border border-border bg-card px-3 inline-flex items-center justify-center text-sm font-bold tabular-nums">
            {String(month).padStart(2, "0")}/{year}
          </div>
          <Button variant="outline" size="sm" onClick={() => setYM((s) => shiftYM(s.year, s.month, 1))} aria-label="Tháng sau">
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {preview && (
        <Card className="p-3 border-primary/30 bg-primary/10 text-[12px] text-primary">
          Cờ <span className="font-mono">staffSalaryChot</span> đang OFF. Trang chạy preview bằng mock, không gọi Supabase và chưa lên live.
        </Card>
      )}

      {clubsQuery.isError ? (
        <Card role="alert" className="p-6 border-border text-sm text-destructive">
          Không tải được danh sách CLB. <Button variant="outline" size="sm" onClick={() => void clubsQuery.refetch()}>Thử lại</Button>
        </Card>
      ) : clubs.length === 0 ? (
        <Card className="p-6 border-border text-sm text-muted-foreground">
          Bạn không có CLB nào để chốt lương (cần quyền chủ CLB hoặc kế toán CLB).
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={Coins} label="Tổng lương (gross)" value={view ? formatVND(view.totalGrossVnd) : "—"} />
            <MetricCard icon={Wallet} label="Thực nhận (net)" value={view ? formatVND(view.totalNetVnd) : "—"} />
            <MetricCard icon={Users} label="Số nhân viên" value={view ? `${rows.length}` : "—"} />
            <MetricCard icon={BadgeCheck} label="Trạng thái" value={!view ? "Chưa xác minh" : hasRuns ? STATUS_LABEL[status] : "Chưa chốt"} />
          </div>

          <Card className="p-4 border-border bg-card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">
                  Bảng lương {String(month).padStart(2, "0")}/{year}
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  {activeClub?.name ?? "Chưa chọn CLB"} · {!view ? "chưa xác minh bảng lương" : hasRuns ? "số đã chốt (bất biến)" : "tạm tính (chưa chốt)"}
                </p>
              </div>
              {clubs.length > 1 && (
                <div className="w-full sm:w-64">
                  <Select value={activeClubId ?? ""} onValueChange={setClubId}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue placeholder="Chọn CLB" />
                    </SelectTrigger>
                    <SelectContent>
                      {clubs.map((club) => (
                        <SelectItem key={club.id} value={club.id}>
                          {club.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {status === "rejected" && view?.rejectedReason && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
                Chủ CLB đã từ chối: {view.rejectedReason}. Kế toán sửa rồi gửi lại.
              </div>
            )}

            {monthQuery.isError ? (
              <div role="alert" className="text-sm text-destructive">
                Không xác minh được bảng lương. <Button variant="outline" size="sm" onClick={() => void monthQuery.refetch()}>Thử lại</Button>
              </div>
            ) : monthQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Không có nhân viên hưởng lương trong tháng này.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {rows.map((row) => (
                  <SalaryRowItem
                    key={row.runId ?? row.staffId}
                    row={row}
                    showMarkPaid={hasRuns && status === "approved"}
                    onMarkPaid={() => row.runId && actions.markPaid.mutate(row.runId)}
                    markPaidPending={busy || actions.markPaid.isPending}
                  />
                ))}
              </div>
            )}
          </Card>

          <ActionBar
            hasRuns={hasRuns}
            status={status}
            canApprove={canApprove}
            busy={busy}
            hasRows={rows.length > 0}
            onChot={() => actions.chot.mutate()}
            onSubmit={() => actions.submit.mutate(undefined)}
            onApprove={() => actions.approve.mutate()}
            onReject={() => {
              const reason = window.prompt("Lý do từ chối (gửi lại cho kế toán):") ?? undefined;
              if (reason !== undefined) actions.reject.mutate(reason || undefined);
            }}
          />
        </div>
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-3 border-border bg-card">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="w-3.5 h-3.5 text-primary" />
        {label}
      </div>
      <div className="mt-1 text-base font-bold tabular-nums text-foreground">{value}</div>
    </Card>
  );
}

function SalaryRowItem({
  row,
  showMarkPaid,
  onMarkPaid,
  markPaidPending,
}: {
  row: SalaryRow;
  showMarkPaid: boolean;
  onMarkPaid: () => void;
  markPaidPending: boolean;
}) {
  const paid = row.status === "paid";
  const meta =
    row.employmentType === "part_time"
      ? "PT"
      : `FT · ${row.workedDays ?? 0} công`;
  return (
    <div className="py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-foreground truncate">{row.fullName}</span>
          <Badge variant="outline" className="text-[10px]">
            {deptLabel(row.department)}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{meta}</span>
          {row.alreadyLocked && <span className="text-[10px] text-amber-400">đã có bản chốt</span>}
        </div>
        {row.employmentType === "part_time" && (
          <p className="text-[11px] text-muted-foreground">Tổng đã trả theo ngày · chỉ đối chiếu tháng</p>
        )}
        {(row.manualBhxhVnd > 0 || row.manualTaxVnd > 0) && (
          <p className="text-[11px] text-muted-foreground">
            BHXH {formatVND(row.manualBhxhVnd)} · Thuế {formatVND(row.manualTaxVnd)}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold tabular-nums text-foreground">{formatVND(row.netVnd)}</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">gross {formatVND(row.grossVnd)}</div>
      </div>
      {showMarkPaid && row.employmentType === "full_time" &&
        (paid ? (
          <span className="text-[11px] font-bold text-primary shrink-0 inline-flex items-center gap-1">
            <BadgeCheck className="w-3.5 h-3.5" /> Đã trả
          </span>
        ) : (
          <Button variant="outline" size="sm" className="shrink-0" disabled={markPaidPending} onClick={onMarkPaid}>
            Đánh dấu trả
          </Button>
        ))}
    </div>
  );
}

function ActionBar({
  hasRuns,
  status,
  canApprove,
  busy,
  hasRows,
  onChot,
  onSubmit,
  onApprove,
  onReject,
}: {
  hasRuns: boolean;
  status: SalaryPeriodStatus;
  canApprove: boolean;
  busy: boolean;
  hasRows: boolean;
  onChot: () => void;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (!hasRuns) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">Chốt để khoá số liệu tháng này (không tính lại sau khi chốt).</p>
        <Button disabled={busy || !hasRows} onClick={onChot}>
          <Lock className="w-4 h-4 mr-1.5" /> Chốt lương tháng
        </Button>
      </div>
    );
  }
  if (status === "prepared" || status === "rejected") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">Gửi bảng lương đã chốt cho chủ CLB duyệt.</p>
        <Button disabled={busy} onClick={onSubmit}>
          <Send className="w-4 h-4 mr-1.5" /> {status === "rejected" ? "Gửi lại" : "Gửi báo cáo cho chủ CLB"}
        </Button>
      </div>
    );
  }
  if (status === "submitted") {
    return canApprove ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onReject}>
          <ThumbsDown className="w-4 h-4 mr-1.5" /> Từ chối
        </Button>
        <Button disabled={busy} onClick={onApprove}>
          <ThumbsUp className="w-4 h-4 mr-1.5" /> Duyệt bảng lương
        </Button>
      </div>
    ) : (
      <p className="text-[12px] text-muted-foreground text-right">Đã gửi — đang chờ chủ CLB duyệt.</p>
    );
  }
  return (
    <p className="text-[12px] text-primary text-right inline-flex items-center gap-1 justify-end w-full">
      <BadgeCheck className="w-4 h-4" /> Đã duyệt — lương FT được đánh dấu trả theo từng dòng; lương PT chỉ đối chiếu các khoản đã trả theo ngày.
    </p>
  );
}

function ChotSkeleton() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 space-y-3">
      <Skeleton className="h-9 w-56" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}
