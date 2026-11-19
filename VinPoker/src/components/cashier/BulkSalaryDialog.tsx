import { useMemo, useState } from "react";
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
    () => dealers.filter((d) => selected.has(d.id)),
    [dealers, selected],
  );
  const selPt = selectedDealers.filter((d) => d.employment_type === "part_time");
  const selFt = selectedDealers.filter((d) => d.employment_type !== "part_time");
  const ptHourly = parseVnd(ptHourlyInput, MAX_INTEGER_RATE_VND);
  const ftMonthly = parseVnd(ftMonthlyInput, MAX_INTEGER_RATE_VND * WORKING_DAYS_PER_MONTH);
  const invalidPt = selPt.length > 0 && ptHourlyInput.trim() !== "" && ptHourly === null;
  const invalidFt = selFt.length > 0 && ftMonthlyInput.trim() !== "" && ftMonthly === null;
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
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of visible) next.add(d.id);
      return next;
    });

  const applyAll = async () => {
    setConfirmOpen(false);
    if (invalidAmount) return;
    if (willWritePt + willWriteFt === 0) {
      toast.error("Chưa chọn dealer hoặc chưa nhập mức lương.");
      return;
    }
    setSaving(true);
    try {
      let updated = 0;
      const errors: string[] = [];

      // PT: one grouped update — same hourly for the whole selection.
      if (ptHourly && selPt.length > 0) {
        const { error } = await supabase
          .from("dealers")
          .update({ hourly_rate_vnd: ptHourly, monthly_salary_vnd: 0 })
          .in("id", selPt.map((d) => d.id));
        if (error) errors.push(`PT: ${error.message}`);
        else updated += selPt.length;
      }

      // FT: derive base/hourly per the dealer's own standard hours (defaults 8),
      // exactly like AddDealerDialog — group by hours so each group is one update.
      if (ftMonthly && selFt.length > 0) {
        const byHours = new Map<number, DealerRecord[]>();
        for (const d of selFt) {
          const h = d.standard_hours_per_shift && d.standard_hours_per_shift > 0
            ? d.standard_hours_per_shift : 8;
          byHours.set(h, [...(byHours.get(h) ?? []), d]);
        }
        for (const [hours, group] of byHours) {
          const { error } = await supabase
            .from("dealers")
            .update({
              monthly_salary_vnd: ftMonthly,
              base_rate_vnd: Math.round(ftMonthly / WORKING_DAYS_PER_MONTH),
              hourly_rate_vnd: Math.round(ftMonthly / WORKING_DAYS_PER_MONTH / hours),
            })
            .in("id", group.map((d) => d.id));
          if (error) errors.push(`FT (${hours}h): ${error.message}`);
          else updated += group.length;
        }
      }

      if (updated > 0) {
        toast.success(`Đã áp lương cho ${updated} dealer`);
        onDone();
      }
      if (errors.length) toast.error(errors.join(" · "));
      if (updated > 0 && errors.length === 0) {
        setOpen(false);
        reset();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi áp lương");
    } finally {
      setSaving(false);
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

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
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
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm tên dealer..."
                  className="h-8 pl-8 text-xs bg-card border-border"
                />
              </div>
              <button
                type="button"
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
                <button className="text-primary hover:underline" onClick={selectAllVisible}>
                  Chọn tất cả đang hiển thị
                </button>
                <button className="text-muted-foreground hover:underline" onClick={() => setSelected(new Set())}>
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
                    <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} />
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
                  type="text" inputMode="numeric"
                  aria-label="Lương giờ cho PT" aria-invalid={invalidPt} value={ptHourlyInput}
                  onChange={(e) => setPtHourlyInput(e.target.value)}
                  placeholder="VD: 100000"
                  className="h-9 text-sm bg-card border-border"
                />
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {invalidPt ? "Nhập số VND nguyên dương trong giới hạn." : ptHourly ? `= ${fmt(ptHourly)}đ/giờ · áp cho ${selPt.length} PT đã chọn` : "Bỏ trống = không đổi PT"}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Lương tháng cho FT (VND/tháng)</div>
                <Input
                  type="text" inputMode="numeric"
                  aria-label="Lương tháng cho FT" aria-invalid={invalidFt} value={ftMonthlyInput}
                  onChange={(e) => setFtMonthlyInput(e.target.value)}
                  placeholder="VD: 9000000"
                  className="h-9 text-sm bg-card border-border"
                />
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {invalidFt ? "Nhập số VND nguyên dương trong giới hạn." : ftMonthly ? `= ${fmt(ftMonthly)}đ/tháng · áp cho ${selFt.length} FT đã chọn` : "Bỏ trống = không đổi FT"}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-border pt-2">
            <Button variant="outline" className="border-border" onClick={() => { setOpen(false); reset(); }}>
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
