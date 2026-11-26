import { useEffect, useId, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Banknote, Loader2, Search } from "lucide-react";
import type { DealerRecord } from "@/hooks/useDealerManagement";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

// Bulk-apply salary to EXISTING dealers (owner 2026-07-07: dealers imported before
// the batch-salary field existed have empty salary and show "—" — fixing them one
// by one is impractical for hundreds). Mirrors AddDealerDialog's field semantics:
//   PT → hourly_rate_vnd (monthly_salary_vnd = 0)
//   FT → monthly_salary_vnd + derived base_rate_vnd = round(monthly/26) and
//        hourly_rate_vnd = round(monthly/26/standard_hours_per_shift ?? 8)
// so a bulk-updated dealer is indistinguishable from a hand-edited one for payroll.
// Guarded by a final confirm; writes go through the same RLS as the ✏️ edit dialog.

const WORKING_DAYS_PER_MONTH = 26;
const MAX_INTEGER_RATE_VND = 2_147_483_647;

function parseVnd(input: string, max: number): number | null {
  const value = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(value)) return null;
  const amount = Number(value.replace(/\./g, ""));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= max ? amount : null;
}
const fmt = (n: number) => n.toLocaleString("vi-VN");

function ftSalaryRates(monthly: number, standardHours: number | null | undefined) {
  const hours = standardHours && standardHours > 0 ? standardHours : 8;
  return {
    monthly_salary_vnd: monthly,
    base_rate_vnd: Math.round(monthly / WORKING_DAYS_PER_MONTH),
    hourly_rate_vnd: Math.round(monthly / WORKING_DAYS_PER_MONTH / hours),
  };
}

type SalaryRateKey = "monthly_salary_vnd" | "base_rate_vnd" | "hourly_rate_vnd";
type SalaryTarget = { dealer: DealerRecord; rates: Partial<Record<SalaryRateKey, number>>; amount: number };

export function BulkSalaryDialog({
  dealers,
  onDone,
}: {
  /** Active (non-deleted) dealers of the current club. */
  dealers: DealerRecord[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ptHourlyInput, setPtHourlyInput] = useState("");
  const [ftMonthlyInput, setFtMonthlyInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ confirmed: string[]; pending: string[] } | null>(null);
  const ptHelpId = useId();
  const ftHelpId = useId();
  const pendingTargets = useRef(new Map<string, SalaryTarget>());
  const savingRef = useRef(false);
  const sessionGeneration = useRef(0);

  useEffect(() => () => { sessionGeneration.current += 1; }, []);

  const hasSalary = (d: DealerRecord) =>
    d.employment_type === "part_time"
      ? (d.hourly_rate_vnd ?? 0) > 0
      : (d.monthly_salary_vnd ?? 0) > 0;

  const visible = useMemo(() => {
    let list = dealers;
    if (onlyMissing) list = list.filter((d) => !hasSalary(d));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((d) => d.full_name.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [dealers, onlyMissing, search]);

  const selectedDealers = useMemo(
    () => {
      const available = new Map(dealers.map((dealer) => [dealer.id, dealer]));
      for (const [id, target] of pendingTargets.current) available.set(id, target.dealer);
      return [...available.values()].filter((dealer) => selected.has(dealer.id));
    },
    [dealers, selected, ptHourlyInput, ftMonthlyInput],
  );
  const selPt = selectedDealers.filter((d) => d.employment_type === "part_time");
  const selFt = selectedDealers.filter((d) => d.employment_type !== "part_time");
  const ptHourly = parseVnd(ptHourlyInput, MAX_INTEGER_RATE_VND);
  const ftMonthly = parseVnd(ftMonthlyInput, MAX_INTEGER_RATE_VND);
  const invalidPt = selPt.length > 0 && ptHourlyInput.trim() !== "" && ptHourly === null;
  const invalidFt = selFt.length > 0 && ftMonthlyInput.trim() !== "" && (
    ftMonthly === null || selFt.some((dealer) => {
      const rates = ftSalaryRates(ftMonthly, dealer.standard_hours_per_shift);
      return [rates.base_rate_vnd, rates.hourly_rate_vnd].some(
        (rate) => !Number.isSafeInteger(rate) || rate < 0 || rate > MAX_INTEGER_RATE_VND,
      );
    })
  );
  const invalidAmount = invalidPt || invalidFt;
  // Groups that will actually be written (selected + amount entered for their type).
  const willWritePt = ptHourly ? selPt.length : 0;
  const willWriteFt = ftMonthly ? selFt.length : 0;

  const reset = () => {
    setSearch("");
    setSelected(new Set());
    setPtHourlyInput("");
    setFtMonthlyInput("");
    setSaving(false);
    setResult(null);
    pendingTargets.current.clear();
  };

  const toggle = (id: string) => {
    pendingTargets.current.delete(id);
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of visible) next.add(d.id);
      return next;
    });

  const applyAll = async () => {
    if (savingRef.current) return;
    setConfirmOpen(false);
    if (invalidAmount) return;
    if (willWritePt + willWriteFt === 0) {
      toast.error("Chưa chọn dealer hoặc chưa nhập mức lương.");
      return;
    }
    savingRef.current = true;
    const generation = sessionGeneration.current;
    const isCurrent = () => generation === sessionGeneration.current;
    setSaving(true);
    setResult(null);
    try {
      const confirmed = new Set<string>();
      const pending: string[] = [];
      const proposed: SalaryTarget[] = [
        ...(ptHourly === null ? [] : selPt.map((dealer) => ({
          dealer, rates: { hourly_rate_vnd: ptHourly, monthly_salary_vnd: 0 }, amount: ptHourly,
        }))),
        ...(ftMonthly === null ? [] : selFt.map((dealer) => ({
          dealer, rates: ftSalaryRates(ftMonthly, dealer.standard_hours_per_shift), amount: ftMonthly,
        }))),
      ];
      const targets = proposed.map((target) => {
        const previous = pendingTargets.current.get(target.dealer.id);
        if (previous && previous.amount === target.amount) return previous;
        const captured = {...target, dealer: {...target.dealer}};
        pendingTargets.current.set(target.dealer.id, captured);
        return captured;
      });
      for (const { dealer, rates } of targets) {
        if (!isCurrent()) return;
        try {
          const keys = Object.keys(rates) as SalaryRateKey[];
          const fields = "id,club_id,employment_type,monthly_salary_vnd,base_rate_vnd,hourly_rate_vnd,standard_hours_per_shift";
          const sameIdentity = (row: Partial<DealerRecord> | null) => !!row && row.id === dealer.id
            && row.club_id === dealer.club_id && row.employment_type === dealer.employment_type
            && (dealer.employment_type === "part_time" || row.standard_hours_per_shift === dealer.standard_hours_per_shift);
          const matches = (row: Partial<DealerRecord> | null) => sameIdentity(row) && keys.every((key) => row![key] === rates[key]);
          const current = await waitForManualPlayerResponse(supabase.from("dealers").select(fields)
            .eq("club_id", dealer.club_id).eq("id", dealer.id).is("deleted_at", null).maybeSingle(), 15_000);
          if (!isCurrent()) return;
          if (current.error || !sameIdentity(current.data)) {
            pending.push(dealer.full_name);
            continue;
          }
          if (matches(current.data)) {
            confirmed.add(dealer.id);
            continue;
          }
          if (!keys.every((key) => current.data![key] === dealer[key])) {
            pending.push(dealer.full_name);
            continue;
          }
          let update = supabase.from("dealers").update(rates).eq("club_id", dealer.club_id).eq("id", dealer.id).is("deleted_at", null);
          update = dealer.employment_type === null
            ? update.is("employment_type", null) : update.eq("employment_type", dealer.employment_type);
          for (const key of keys) {
            const previous = dealer[key];
            update = previous === null ? update.is(key, null) : update.eq(key, previous);
          }
          if (dealer.employment_type !== "part_time") {
            const previous = dealer.standard_hours_per_shift;
            update = previous === null ? update.is("standard_hours_per_shift", null) : update.eq("standard_hours_per_shift", previous);
          }
          const written = await waitForManualPlayerResponse(update.select(fields).maybeSingle(), 15_000);
          if (!isCurrent()) return;
          if (!written.error && matches(written.data)) confirmed.add(dealer.id);
          else pending.push(dealer.full_name);
        } catch {
          if (!isCurrent()) return;
          pending.push(dealer.full_name);
        }
      }

      for (const id of confirmed) pendingTargets.current.delete(id);
      setSelected((previous) => new Set([...previous].filter((id) => !confirmed.has(id))));
      setResult({
        confirmed: targets.filter(({ dealer }) => confirmed.has(dealer.id)).map(({ dealer }) => dealer.full_name),
        pending,
      });
      if (confirmed.size > 0) {
        toast.success(`Đã xác minh lương cho ${confirmed.size}/${targets.length} dealer`);
        onDone();
      }
      if (pending.length > 0) toast.error("Có dealer chưa xác minh được mức lương.");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi áp lương");
    } finally {
      if (isCurrent()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-8 text-xs border-success/40 text-success hover:bg-success/10"
      >
        <Banknote className="h-3.5 w-3.5 mr-1" /> Áp lương hàng loạt
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (savingRef.current) return; setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-lg bg-popover border border-border text-foreground max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Áp lương hàng loạt</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Tick chọn dealer → nhập mức lương → áp một lần cho tất cả.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {/* Search + filter */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  disabled={saving}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm tên dealer..."
                  className="h-8 pl-8 text-xs bg-card border-border"
                />
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setOnlyMissing((v) => !v)}
                className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  onlyMissing
                    ? "border-warning bg-warning/10 text-warning"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Chỉ hiện chưa có lương
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {visible.length} dealer hiển thị · đã chọn{" "}
                <b className="text-foreground">{selected.size}</b>
                {selected.size > 0 && ` (${selPt.length} PT · ${selFt.length} FT)`}
              </span>
              <span className="flex gap-2">
                <button disabled={saving} className="text-primary hover:underline" onClick={selectAllVisible}>
                  Chọn tất cả đang hiển thị
                </button>
                <button disabled={saving} className="text-muted-foreground hover:underline" onClick={() => { pendingTargets.current.clear(); setSelected(new Set()); setResult(null); }}>
                  Bỏ chọn
                </button>
              </span>
            </div>

            {/* Dealer list */}
            <div className="max-h-[38vh] overflow-y-auto overscroll-contain rounded-md border border-border">
              <div className="divide-y divide-border">
                {visible.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {onlyMissing ? "Tất cả dealer đã có lương 🎉" : "Không có dealer khớp tìm kiếm."}
                  </div>
                )}
                {visible.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-muted/30">
                    <Checkbox disabled={saving} checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{d.full_name}</span>
                    <span className={`shrink-0 text-[11px] ${d.employment_type === "part_time" ? "text-warning" : "text-success"}`}>
                      {d.employment_type === "part_time" ? "PT" : "FT"}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {d.employment_type === "part_time"
                        ? d.hourly_rate_vnd ? `${Math.round(d.hourly_rate_vnd / 1000)}k/h` : "chưa có"
                        : d.monthly_salary_vnd ? `${(d.monthly_salary_vnd / 1e6).toFixed(1)}M/th` : "chưa có"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Amounts */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Lương giờ cho PT (VND/giờ)</div>
                <Input
                  type="text" inputMode="numeric" disabled={saving}
                  aria-label="Lương giờ cho PT" aria-invalid={invalidPt} aria-describedby={ptHelpId} value={ptHourlyInput}
                  onChange={(e) => {
                    for (const [id, target] of pendingTargets.current) if (target.dealer.employment_type === "part_time") pendingTargets.current.delete(id);
                    setResult(null); setPtHourlyInput(e.target.value);
                  }}
                  placeholder="VD: 100000"
                  className="h-9 text-sm bg-card border-border"
                />
                <div id={ptHelpId} aria-live="polite" className="mt-0.5 text-[10px] text-muted-foreground">
                  {invalidPt ? "Nhập số VND nguyên dương trong giới hạn." : ptHourly ? `= ${fmt(ptHourly)}đ/giờ · áp cho ${selPt.length} PT đã chọn` : "Bỏ trống = không đổi PT"}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Lương tháng cho FT (VND/tháng)</div>
                <Input
                  type="text" inputMode="numeric" disabled={saving}
                  aria-label="Lương tháng cho FT" aria-invalid={invalidFt} aria-describedby={ftHelpId} value={ftMonthlyInput}
                  onChange={(e) => {
                    for (const [id, target] of pendingTargets.current) if (target.dealer.employment_type !== "part_time") pendingTargets.current.delete(id);
                    setResult(null); setFtMonthlyInput(e.target.value);
                  }}
                  placeholder="VD: 9000000"
                  className="h-9 text-sm bg-card border-border"
                />
                <div id={ftHelpId} aria-live="polite" className="mt-0.5 text-[10px] text-muted-foreground">
                  {invalidFt ? "Nhập số VND nguyên dương trong giới hạn." : ftMonthly ? `= ${fmt(ftMonthly)}đ/tháng · áp cho ${selFt.length} FT đã chọn` : "Bỏ trống = không đổi FT"}
                </div>
              </div>
            </div>
          </div>

          {result && (
            <div role="status" className="text-xs">
              {result.confirmed.length > 0 && <p>Đã xác minh: {result.confirmed.join(", ")}.</p>}
              {result.pending.length > 0 && <p>Chưa xác minh: {result.pending.join(", ")}.</p>}
            </div>
          )}
          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-border pt-2">
            <Button disabled={saving} variant="outline" className="border-border" onClick={() => { setOpen(false); reset(); }}>
              Đóng
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={saving || invalidAmount || willWritePt + willWriteFt === 0}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Áp lương cho {willWritePt + willWriteFt} dealer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Final confirm — bulk salary write */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận áp lương?</AlertDialogTitle>
            <AlertDialogDescription>
              {willWritePt > 0 && (
                <>Áp <b>{fmt(ptHourly!)}đ/giờ</b> cho <b>{willWritePt} dealer PT</b>. </>
              )}
              {willWriteFt > 0 && (
                <>Áp <b>{fmt(ftMonthly!)}đ/tháng</b> cho <b>{willWriteFt} dealer FT</b> (tự tính lương ngày/giờ như thêm tay). </>
              )}
              Lương hiện tại của những dealer này sẽ bị ghi đè.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction disabled={saving || invalidAmount} onClick={applyAll} className="bg-success text-success-foreground hover:bg-success/90">
              Áp lương
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
