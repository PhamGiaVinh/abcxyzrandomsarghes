import { BadgeCheck, Building2, Clock3, LogIn, LogOut, Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/format";
import { useStaffLink } from "@/hooks/staff/useStaffLink";
import { useStaffAttendance } from "@/hooks/staff/useStaffAttendance";
import { useStaffAttendanceActions } from "@/hooks/staff/useStaffAttendanceActions";
import { STAFF_DEPARTMENT_LABELS } from "@/types/staffApp";
import { StaffNotLinkedScreen } from "../StaffNotLinkedScreen";

function minutesLabel(minutes?: number | null): string {
  if (!minutes) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}p` : `${m}p`;
}

export function StaffHomeScreen() {
  const { staff, isStaff, loading } = useStaffLink();
  const { rows, openAttendance, isLoading, isError, scopeError, refetch, isFetching } = useStaffAttendance(staff);
  const { checkIn, checkOut, isPending } = useStaffAttendanceActions(staff);

  if (loading || isLoading) return <HomeSkeleton />;
  if (!isStaff || !staff) return <StaffNotLinkedScreen />;
  if (isError || scopeError) return <Card role="alert" className="p-4 space-y-2">
    <p>Không xác minh được trạng thái chấm công. Chưa thể check-in/out.</p><p>{scopeError}</p>
    {!scopeError && <button type="button" className="underline" disabled={isFetching} onClick={()=>{void refetch();}}>Thử lại</button>}
  </Card>;

  const firstName = staff.fullName.trim().split(/\s+/).slice(-1)[0] || staff.fullName;
  const latestClosed = rows.find((r) => r.status === "checked_out");
  const isOpen = !!openAttendance;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-display font-bold text-foreground">Chào {firstName}</h1>
        <p className="text-[13px] text-muted-foreground">Bấm chấm công khi bắt đầu và kết thúc ca làm.</p>
      </div>

      <Card className="p-4 border-border bg-card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Building2 className="w-3.5 h-3.5" />
              {staff.clubName}
            </div>
            <div className="mt-1 text-base font-bold text-foreground">{STAFF_DEPARTMENT_LABELS[staff.department]}</div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
            <BadgeCheck className="w-3.5 h-3.5" />
            {staff.status}
          </span>
        </div>

        <div className="rounded-2xl border border-border bg-background/60 p-4 text-center">
          <div className="text-[12px] text-muted-foreground">{isOpen ? "Đang trong ca" : "Chưa check-in"}</div>
          <div className="mt-1 text-2xl font-display font-black text-foreground">
            {isOpen ? formatTime(openAttendance.checkInTime) : "Sẵn sàng"}
          </div>
          <button
            type="button"
            disabled={isPending || isFetching}
            onClick={() => { if (!isFetching) { if (isOpen) checkOut.mutate(); else checkIn.mutate(); } }}
            className="mt-4 w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isOpen ? <LogOut className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
            {isPending ? "Đang gửi chấm công…" : isFetching ? "Đang xác minh ca…" : isOpen ? "Check-out" : "Check-in"}
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3 border-border bg-card">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock3 className="w-3.5 h-3.5 text-primary" />
            Ca gần nhất
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">
            {latestClosed ? minutesLabel(latestClosed.totalWorkedMinutesToday) : "-"}
          </div>
        </Card>
        <Card className="p-3 border-border bg-card">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Timer className="w-3.5 h-3.5 text-primary" />
            Lượt đã ghi
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">{isLoading ? "..." : rows.length}</div>
        </Card>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-40 rounded-lg" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    </div>
  );
}
