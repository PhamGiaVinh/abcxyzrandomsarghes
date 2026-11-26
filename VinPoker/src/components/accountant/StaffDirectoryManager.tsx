import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Copy, KeyRound, Link2, Pencil, Plus, UserRound } from "lucide-react";
import { formatVND } from "@/lib/format";
import { STAFF_DEPARTMENT_LABELS, type StaffDepartment, type StaffEmploymentType } from "@/types/staffApp";
import {
  useLinkCandidates,
  useStaffDirectory,
  useStaffGenerateCode,
  useStaffLinkUser,
  useStaffUpsert,
  type DirectoryStaff,
  type StaffUpsertInput,
} from "@/hooks/accountant/useStaffDirectory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const DEPARTMENTS = Object.keys(STAFF_DEPARTMENT_LABELS) as StaffDepartment[];

/**
 * Nhân viên & lương — the operator staff directory (accountant workspace tab).
 * Per-department roster with each person's pay config; add/edit via the staff_upsert RPC
 * (server validates + authorizes); account linking via search_staff_link_candidates +
 * staff_link_user (first-link-wins — the server is the arbiter). Read access for
 * accountants requires migration 20261236000000 (the parent tab gates on capabilities).
 */
export function StaffDirectoryManager({ clubId }: { clubId: string | null }) {
  const { staff, isLoading } = useStaffDirectory(clubId);
  const upsert = useStaffUpsert(clubId);
  const genCode = useStaffGenerateCode();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DirectoryStaff | null>(null);
  const [linking, setLinking] = useState<DirectoryStaff | null>(null);
  const [codeInfo, setCodeInfo] = useState<{ name: string; code: string; expiresAt: string } | null>(null);

  const byDepartment = useMemo(() => {
    const map = new Map<StaffDepartment, DirectoryStaff[]>();
    for (const dept of DEPARTMENTS) map.set(dept, []);
    for (const s of staff) (map.get(s.department) ?? map.set(s.department, []).get(s.department)!).push(s);
    return map;
  }, [staff]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          Hồ sơ + mức lương nhân viên theo bộ phận. Lương dealer quản ở tab riêng.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Thêm nhân viên
        </Button>
      </div>

      {staff.length === 0 ? (
        <Card className="p-6 border-dashed border-border text-center text-sm text-muted-foreground">
          Chưa có nhân viên nào — bấm "Thêm nhân viên" để tạo hồ sơ đầu tiên.
        </Card>
      ) : (
        DEPARTMENTS.map((dept) => {
          const rows = byDepartment.get(dept) ?? [];
          if (rows.length === 0) return null;
          return (
            <Card key={dept} className="p-4 border-border bg-card space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-foreground">{STAFF_DEPARTMENT_LABELS[dept]}</h2>
                <span className="text-[11px] text-muted-foreground">{rows.length} người</span>
              </div>
              <div className="divide-y divide-border">
                {rows.map((s) => (
                  <StaffRow
                    key={s.id}
                    staff={s}
                    onEdit={() => {
                      setEditing(s);
                      setEditorOpen(true);
                    }}
                    onLink={() => setLinking(s)}
                    onGenerateCode={() =>
                      genCode.mutate(s.id, {
                        onSuccess: (r) => setCodeInfo({ name: s.fullName, code: r.code, expiresAt: r.expires_at }),
                      })
                    }
                    generating={genCode.isPending}
                  />
                ))}
              </div>
            </Card>
          );
        })
      )}

      <StaffEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        pending={upsert.isPending}
        onSubmit={(input) =>
          upsert.mutate(input, {
            onSuccess: () => setEditorOpen(false),
          })
        }
      />
      <LinkAccountDialog clubId={clubId} staff={linking} onClose={() => setLinking(null)} />
      <CodeDialog info={codeInfo} onClose={() => setCodeInfo(null)} />
    </div>
  );
}

function CodeDialog({
  info,
  onClose,
}: {
  info: { name: string; code: string; expiresAt: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!info} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mã mời — {info?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => { if (info) navigator.clipboard?.writeText(info.code).then(() => toast.success("Đã copy mã.")); }}
            className="w-full rounded-xl border border-primary/40 bg-primary/10 px-4 py-4 text-center transition-colors hover:bg-primary/15"
          >
            <div className="text-2xl font-mono font-black tracking-[0.18em] text-primary break-all">{info?.code}</div>
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Copy className="w-3 h-3" /> Bấm để copy
            </div>
          </button>
          <ol className="space-y-1 text-[12px] text-muted-foreground list-decimal pl-4">
            <li>Gửi mã này cho nhân viên.</li>
            <li>Nhân viên đăng nhập app → vào mục <span className="font-medium text-foreground">Nhân viên</span> (/staff).</li>
            <li>Nhập mã ở màn "Chưa liên kết" → tự liên kết xong.</li>
          </ol>
          <p className="text-[11px] text-muted-foreground">Mã dùng 1 lần, hết hạn sau 14 ngày. Tạo lại nếu cần mã mới.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StaffRow({
  staff,
  onEdit,
  onLink,
  onGenerateCode,
  generating,
}: {
  staff: DirectoryStaff;
  onEdit: () => void;
  onLink: () => void;
  onGenerateCode: () => void;
  generating: boolean;
}) {
  const pay =
    staff.employmentType === "part_time"
      ? `${formatVND(staff.hourlyRateVnd ?? 0)}/giờ`
      : `${formatVND(staff.monthlySalaryVnd ?? 0)}/tháng`;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-muted text-muted-foreground shrink-0">
        <UserRound className="w-4.5 h-4.5" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-foreground truncate">{staff.fullName}</span>
          <Badge variant="outline" className="text-[10px]">
            {staff.employmentType === "part_time" ? "PT" : "FT"}
          </Badge>
          {staff.status !== "active" && (
            <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
              nghỉ
            </Badge>
          )}
          {staff.userId ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary">
              <BadgeCheck className="w-3 h-3" /> đã liên kết
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">chưa liên kết</span>
          )}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {pay}
          {(staff.manualBhxhVnd ?? 0) > 0 && <> · BHXH {formatVND(staff.manualBhxhVnd!)}</>}
          {(staff.manualTaxVnd ?? 0) > 0 && <> · Thuế {formatVND(staff.manualTaxVnd!)}</>}
          {staff.phone && <> · {staff.phone}</>}
        </div>
      </div>
      <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
        {!staff.userId && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onGenerateCode}
              disabled={generating}
            >
              <KeyRound className="w-3.5 h-3.5 mr-1" />
              Tạo mã
            </Button>
            <Button variant="outline" size="sm" className="shrink-0" onClick={onLink}>
              <Link2 className="w-3.5 h-3.5 mr-1" />
              Gán tài khoản
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" className="shrink-0" onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Sửa
        </Button>
      </div>
    </div>
  );
}

function StaffEditorDialog({
  open,
  onOpenChange,
  editing,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: DirectoryStaff | null;
  pending: boolean;
  onSubmit: (input: StaffUpsertInput) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState<StaffDepartment>("floor");
  const [employmentType, setEmploymentType] = useState<StaffEmploymentType>("full_time");
  const [monthly, setMonthly] = useState("");
  const [hourly, setHourly] = useState("");
  const [bhxh, setBhxh] = useState("");
  const [tax, setTax] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [seeded, setSeeded] = useState<string | null>(null);

  // Seed form state when the dialog opens for a different row (or for create).
  const seedKey = open ? editing?.id ?? "new" : null;
  if (seedKey !== seeded) {
    setSeeded(seedKey);
    if (seedKey !== null) {
      setFullName(editing?.fullName ?? "");
      setPhone(editing?.phone ?? "");
      setDepartment(editing?.department ?? "floor");
      setEmploymentType(editing?.employmentType ?? "full_time");
      setMonthly(editing?.monthlySalaryVnd != null ? String(editing.monthlySalaryVnd) : "");
      setHourly(editing?.hourlyRateVnd != null ? String(editing.hourlyRateVnd) : "");
      setBhxh(editing?.manualBhxhVnd != null ? String(editing.manualBhxhVnd) : "");
      setTax(editing?.manualTaxVnd != null ? String(editing.manualTaxVnd) : "");
      setStatus(editing?.status === "inactive" ? "inactive" : "active");
    }
  }

  const isPT = employmentType === "part_time";
  const payOk = isPT ? Number(hourly) > 0 : Number(monthly) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa nhân viên" : "Thêm nhân viên"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fullName.trim() || !payOk) return;
            onSubmit({
              staffId: editing?.id ?? null,
              fullName: fullName.trim(),
              phone: phone.trim() || null,
              department,
              employmentType,
              monthlySalaryVnd: isPT ? null : Number(monthly),
              hourlyRateVnd: isPT ? Number(hourly) : null,
              manualBhxhVnd: bhxh === "" ? null : Number(bhxh),
              manualTaxVnd: tax === "" ? null : Number(tax),
              status,
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="sd-name">Họ tên</Label>
              <Input id="sd-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nguyễn Văn A" />
            </div>
            <div className="space-y-1.5">
              <Label>Bộ phận</Label>
              <Select value={department} onValueChange={(v) => setDepartment(v as StaffDepartment)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>{STAFF_DEPARTMENT_LABELS[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sd-phone">Điện thoại</Label>
              <Input id="sd-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="090..." />
            </div>
            <div className="space-y-1.5">
              <Label>Loại</Label>
              <Select value={employmentType} onValueChange={(v) => setEmploymentType(v as StaffEmploymentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full-time (lương tháng)</SelectItem>
                  <SelectItem value="part_time">Part-time (theo giờ)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isPT ? (
              <div className="space-y-1.5">
                <Label htmlFor="sd-hourly">Đơn giá giờ (đ)</Label>
                <Input id="sd-hourly" inputMode="numeric" value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="80000" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="sd-monthly">Lương tháng (đ)</Label>
                <Input id="sd-monthly" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="12000000" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="sd-bhxh">BHXH (đ, tùy chọn)</Label>
              <Input id="sd-bhxh" inputMode="numeric" value={bhxh} onChange={(e) => setBhxh(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sd-tax">Thuế TNCN (đ, tùy chọn)</Label>
              <Input id="sd-tax" inputMode="numeric" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" />
            </div>
            {editing && (
              <div className="space-y-1.5">
                <Label>Trạng thái</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Đang làm</SelectItem>
                    <SelectItem value="inactive">Nghỉ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={pending || !fullName.trim() || !payOk}>
            {editing ? "Lưu thay đổi" : "Thêm nhân viên"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkAccountDialog({
  clubId,
  staff,
  onClose,
}: {
  clubId: string | null;
  staff: DirectoryStaff | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const { candidates, isFetching } = useLinkCandidates(staff ? clubId : null, query);
  const link = useStaffLinkUser(clubId);

  return (
    <Dialog open={!!staff} onOpenChange={(v) => { if (!v) { setQuery(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gán tài khoản — {staff?.fullName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sd-link-q">Tìm tài khoản (tên / SĐT, tối thiểu 2 ký tự)</Label>
            <Input id="sd-link-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nhập tên hoặc số điện thoại…" />
          </div>
          {query.trim().length >= 2 && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {isFetching ? (
                <Skeleton className="h-12 rounded-lg" />
              ) : candidates.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-3">Không tìm thấy tài khoản phù hợp.</p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    disabled={link.isPending}
                    onClick={() =>
                      staff &&
                      link.mutate(
                        { staffId: staff.id, userId: c.userId },
                        { onSuccess: () => { setQuery(""); onClose(); } }
                      )
                    }
                    className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-primary/50 transition-colors"
                  >
                    <span className="font-medium text-foreground truncate">{c.displayName}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{c.phoneMasked ?? "—"}</span>
                  </button>
                ))
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Liên kết lần đầu là chốt (first-link-wins) — gỡ liên kết chỉ chủ CLB xử lý.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
