import { CalendarDays, Clock3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShortDate, formatTime } from "@/lib/format";
import { useStaffLink } from "@/hooks/staff/useStaffLink";
import { useStaffAttendance } from "@/hooks/staff/useStaffAttendance";
import { StaffNotLinkedScreen } from "../StaffNotLinkedScreen";

function minutesLabel(minutes?: number | null): string {
  if (minutes == null) return "Đang tính";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}p` : `${m}p`;
}

export function StaffAttendanceScreen() {
  const { staff, isStaff, loading } = useStaffLink();
  const { rows, isLoading, isError, scopeError, refetch, isFetching } = useStaffAttendance(staff);

  if (loading || isLoading) return <AttendanceSkeleton />;
  if (!isStaff || !staff) return <StaffNotLinkedScreen />;
  if (isError || scopeError) return <Card role="alert" className="p-4 space-y-2">
    <p>Không xác minh được lịch sử chấm công.</p><p>{scopeError}</p>
    {!scopeError && <button type="button" className="underline" disabled={isFetching} onClick={()=>{void refetch();}}>Thử lại</button>}
  </Card>;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-display font-bold text-foreground">Chấm công</h1>
        <p className="text-[13px] text-muted-foreground">Lịch sử check-in/out gần đây của bạn.</p>
      </div>

      {rows.length === 0 ? (
        <Card className="p-5 border-border text-center text-sm text-muted-foreground">Chưa có dòng chấm công nào.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const open = row.status === "checked_in" && !row.checkOutTime;
            return (
              <Card key={row.id} className="p-3 border-border bg-card">
                <div className="flex items-start gap-3">
                  <span className="grid place-items-center w-10 h-10 rounded-xl bg-muted text-muted-foreground shrink-0">
                    <CalendarDays className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-foreground">{formatShortDate(row.checkInTime)}</div>
                      <span className={open ? "text-[11px] font-bold text-primary" : "text-[11px] text-muted-foreground"}>
                        {open ? "Đang mở" : "Đã đóng"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="w-3.5 h-3.5" />
                        {formatTime(row.checkInTime)} - {row.checkOutTime ? formatTime(row.checkOutTime) : "-"}
                      </span>
                      <span>{minutesLabel(row.totalWorkedMinutesToday)}</span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttendanceSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-36 rounded-lg" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
  );
}
