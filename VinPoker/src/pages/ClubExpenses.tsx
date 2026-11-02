import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, ClipboardList, Landmark, Plus, ReceiptText, WalletCards } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { formatShortDate, formatVND } from "@/lib/format";
import { financeBusinessToday } from "@/lib/financeSummaryRead";
import { clubExpensesSource } from "@/lib/clubExpenses/dataSource";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory, type ExpensePaymentSource, type ExpensePaymentStatus } from "@/lib/clubExpenses/types";
import { useExpenseClubs } from "@/hooks/clubExpenses/useExpenseClubs";
import { useClubExpenses, useRecordClubExpense } from "@/hooks/clubExpenses/useClubExpenses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

function monthBounds(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1) - 7 * 60 * 60 * 1000);
  const to = new Date(Date.UTC(year, month, 1) - 7 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  return financeBusinessToday().slice(0,7);
}

export default function ClubExpenses({ embedded }: { embedded?: boolean } = {}) {
  const { loading: authLoading, isAdmin, isClubAdmin, isClubOwner, isCashier, isAccountant } = useAuth();
  const [searchParams] = useSearchParams();
  const source = clubExpensesSource();
  const preview = source === "mock";
  const mockPreview = preview && searchParams.get("preview") === "mock";
  // Accountant manages expenses (server authz via 20261236000000); owner/cashier unchanged.
  const liveAllowed = isAdmin || isClubAdmin || isClubOwner || isCashier || isAccountant;
  const previewAllowed = isAdmin || isClubOwner;
  const allowed = FEATURES.clubExpenses ? liveAllowed : previewAllowed || mockPreview;
  const [clubId, setClubId] = useState<string>("");
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const { from, to } = useMemo(() => monthBounds(monthKey), [monthKey]);
  const clubsQuery = useExpenseClubs(source, allowed);
  const clubs = clubsQuery.isError ? [] : clubsQuery.data ?? [];
  const activeClubId = clubs.some(c=>c.id===clubId) ? clubId : clubs[0]?.id ?? null;
  const expensesQuery = useClubExpenses(source, activeClubId, from, to);
  const recordExpense = useRecordClubExpense(source, activeClubId, from, to);

  useEffect(() => {
    if (!clubId && clubs[0]?.id) setClubId(clubs[0].id);
  }, [clubId, clubs]);

  if (authLoading || clubsQuery.isLoading) return <ExpensesSkeleton />;
  // Embedded (accountant workspace): the parent already gates access — never redirect.
  if (!allowed && !embedded) return <Navigate to="/club/admin" replace />;

  const summary = expensesQuery.isError ? undefined : expensesQuery.data;
  const rows = summary?.rows ?? [];
  const activeClub = clubs.find((c) => c.id === activeClubId);

  return (
    <div className={embedded ? "space-y-4" : "container mx-auto max-w-6xl px-4 py-6 space-y-4"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl text-primary">Sổ chi phí</h1>
            <Badge variant="outline" className={preview ? "text-[10px] border-primary/40 text-primary" : "text-[10px]"}>
              {preview ? "PREVIEW · MOCK" : "LIVE"}
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground max-w-2xl">
            Ghi chi phí vận hành thủ công của CLB. Ledger append-only: sửa sai bằng dòng điều chỉnh, không edit/xóa dòng cũ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonthKey((m) => shiftMonth(m, -1))} aria-label="Tháng trước">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="h-9 min-w-28 rounded-md border border-border bg-card px-3 inline-flex items-center justify-center text-sm font-bold tabular-nums">
            {monthKey}
          </div>
          <Button variant="outline" size="sm" onClick={() => setMonthKey((m) => shiftMonth(m, 1))} aria-label="Tháng sau">
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {preview && (
        <Card className="p-3 border-primary/30 bg-primary/10 text-[12px] text-primary">
          Flag <span className="font-mono">clubExpenses</span> đang OFF. Trang này đang chạy preview bằng local mock, không gọi Supabase và chưa lên live.
        </Card>
      )}

      {clubsQuery.isError ? (
        <Card role="alert" className="p-4 border-destructive/40 text-sm">
          Không tải được danh sách CLB. <Button variant="outline" size="sm" onClick={()=>void clubsQuery.refetch()}>Thử lại</Button>
        </Card>
      ) : clubs.length === 0 ? (
        <Card className="p-6 border-border text-sm text-muted-foreground">Bạn chưa có CLB hoặc quyền thu ngân để ghi chi phí.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard icon={ReceiptText} label="Tổng chi" value={summary?formatVND(summary.totalVnd):'Chưa xác minh'} />
              <MetricCard icon={Banknote} label="Đã trả" value={summary?formatVND(summary.paidVnd):'Chưa xác minh'} />
              <MetricCard icon={WalletCards} label="Chưa trả" value={summary?formatVND(summary.unpaidVnd):'Chưa xác minh'} />
              <MetricCard icon={ClipboardList} label="Số dòng" value={summary?`${rows.length}`:'Chưa xác minh'} />
            </div>

            <Card className="p-4 border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Chi tiết tháng</h2>
                  <p className="text-[12px] text-muted-foreground">{activeClub?.name ?? "Chưa chọn CLB"}</p>
                </div>
                {clubs.length > 1 && (
                  <div className="w-full sm:w-64">
                    <Select value={activeClubId ?? ""} onValueChange={setClubId}>
                      <SelectTrigger className="bg-background border-border">
                        <SelectValue placeholder="Chọn CLB" />
                      </SelectTrigger>
                      <SelectContent>
                        {clubs.map((club) => (
                          <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {expensesQuery.isError || (!summary&&!expensesQuery.isLoading) ? (
                <div role="alert" className="text-sm text-destructive">
                  Không xác minh được sổ chi phí. <Button variant="outline" size="sm" onClick={()=>void expensesQuery.refetch()}>Thử lại</Button>
                </div>
              ) : expensesQuery.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
                </div>
              ) : rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Chưa có chi phí trong tháng này.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map((row) => (
                    <div key={row.id} className="py-3 flex items-start gap-3">
                      <span className="grid place-items-center w-10 h-10 rounded-xl bg-muted text-muted-foreground shrink-0">
                        <CalendarDays className="w-5 h-5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-foreground">{EXPENSE_CATEGORY_LABELS[row.category]}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {row.paymentStatus === "paid" ? "Đã trả" : "Chưa trả"}
                          </Badge>
                          {row.paymentSource && <span className="text-[11px] text-muted-foreground uppercase">{row.paymentSource}</span>}
                        </div>
                        <p className="text-[12px] text-muted-foreground truncate">{row.description || "Không có mô tả"}</p>
                        <p className="text-[11px] text-muted-foreground">{formatShortDate(row.incurredAt)}</p>
                      </div>
                      <div className={row.amountVnd < 0 ? "text-right font-bold tabular-nums text-red-400" : "text-right font-bold tabular-nums text-foreground"}>
                        {formatVND(row.amountVnd)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <ExpenseEntryForm
            key={`${source}:${activeClubId}:${monthKey}:${recordExpense.contextKey}`}
            disabled={!activeClubId||!summary||expensesQuery.isError}
            pending={recordExpense.isPending}
            preview={preview}
            initialInput={recordExpense.pendingInput}
            onSubmit={(input) => recordExpense.mutateAsync(input)}
          />
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <Card className="p-3 border-border bg-card">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="w-3.5 h-3.5 text-primary" />
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</div>
    </Card>
  );
}

type ExpenseInput=Parameters<ReturnType<typeof useRecordClubExpense>['mutateAsync']>[0];

function ExpenseEntryForm({
  disabled,
  pending,
  preview,
  onSubmit,
  initialInput,
}: {
  disabled: boolean;
  pending: boolean;
  preview: boolean;
  onSubmit: (input: ExpenseInput) => Promise<unknown>;
  initialInput?:ExpenseInput|null;
}) {
  const [category, setCategory] = useState<ExpenseCategory>(initialInput?.category??"misc");
  const [amount, setAmount] = useState(initialInput?String(initialInput.amountVnd):"");
  const [incurredDate, setIncurredDate] = useState(()=>initialInput?.incurredAt.slice(0,10)??financeBusinessToday());
  const [paymentStatus, setPaymentStatus] = useState<ExpensePaymentStatus>(initialInput?.paymentStatus??"unpaid");
  const [paymentSource, setPaymentSource] = useState<ExpensePaymentSource | "none">(initialInput?.paymentSource??"none");
  const [description, setDescription] = useState(initialInput?.description??"");
  const [submitting,setSubmitting]=useState(false),[formError,setFormError]=useState<string|null>(null);
  const locked=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  return (
    <Card className="p-4 border-border bg-card h-fit">
      <div className="flex items-center gap-2 mb-3">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-primary/10 text-primary">
          <Plus className="w-5 h-5" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-foreground">Ghi chi phí</h2>
          <p className="text-[12px] text-muted-foreground">Một lần submit = một dòng ledger mới.</p>
        </div>
      </div>

      <form
        className="space-y-3"
        onSubmit={async(event) => {
          event.preventDefault();
          const amountVnd = Number(amount);
          if(disabled||pending||locked.current||!Number.isSafeInteger(amountVnd)||!amountVnd)return;
          locked.current=true;setSubmitting(true);setFormError(null);
          try{await onSubmit({
            category,
            amountVnd,
            incurredAt: `${incurredDate}T12:00:00+07:00`,
            description: description.trim() || undefined,
            paymentStatus,
            paymentSource: paymentSource === "none" ? null : paymentSource,
          });
          if(mounted.current){setAmount("");setDescription("");}
          }catch(error){if(mounted.current)setFormError(error instanceof Error?error.message:'Chưa xác minh được kết quả ghi chi phí.');}
          finally{locked.current=false;if(mounted.current)setSubmitting(false);}
        }}
      >
        <fieldset disabled={pending||submitting} className="space-y-3 min-w-0">
        {initialInput&&<p className="text-sm text-amber-400">Có lần ghi chưa xác minh. Nội dung đã được giữ lại để thử lại cùng giao dịch.</p>}
        {formError&&<p role="alert" className="text-sm text-destructive">{formError}</p>}
        <div className="space-y-1.5">
          <Label>Danh mục</Label>
          <Select value={category} onValueChange={(value) => setCategory(value as ExpenseCategory)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{EXPENSE_CATEGORY_LABELS[cat]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="expense-amount">Số tiền</Label>
            <Input id="expense-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-date">Ngày</Label>
            <Input id="expense-date" value={incurredDate} onChange={(e) => setIncurredDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Trạng thái</Label>
            <Select value={paymentStatus} onValueChange={(value) => setPaymentStatus(value as ExpensePaymentStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unpaid">Chưa trả</SelectItem>
                <SelectItem value="paid">Đã trả</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nguồn</Label>
            <Select value={paymentSource} onValueChange={(value) => setPaymentSource(value as ExpensePaymentSource | "none")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Chưa chọn</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank">Bank</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-description">Mô tả</Label>
          <Textarea id="expense-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ví dụ: in poster, mua vật tư..." />
        </div>

        <Button type="submit" className="w-full" disabled={disabled || pending || submitting || !Number.isSafeInteger(Number(amount)) || !Number(amount)}>
          <Landmark className="w-4 h-4 mr-1.5" />
          {preview ? "Ghi preview" : "Ghi chi phí"}
        </Button>
        </fieldset>
      </form>
    </Card>
  );
}

function ExpensesSkeleton() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-6 space-y-3">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
