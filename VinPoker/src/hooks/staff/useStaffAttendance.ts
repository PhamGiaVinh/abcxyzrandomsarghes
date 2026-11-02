import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { supabase } from "@/integrations/supabase/client";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { readMockAttendance } from "@/lib/staffApp/mockStaffData";
import type { StaffAttendanceView, StaffProfileView } from "@/types/staffApp";

const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const attendancePacket = z.array(z.object({
  id:z.string().min(1),staff_id:z.string(),shift_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_in_time:timestamp,check_out_time:timestamp.nullable(),status:z.enum(['checked_in','checked_out']),
  total_worked_minutes_today:z.number().int().nonnegative().nullable(),
}).refine(row => row.status === 'checked_in' ? row.check_out_time === null
  : row.check_out_time !== null && Date.parse(row.check_out_time) >= Date.parse(row.check_in_time)));

function mapAttendance(row: z.infer<typeof attendancePacket>[number]): StaffAttendanceView {
  return {
    id: row.id,
    staffId: row.staff_id,
    shiftDate: row.shift_date,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time ?? null,
    status: row.status,
    totalWorkedMinutesToday: row.total_worked_minutes_today ?? null,
  };
}

export function useStaffAttendance(profile: Pick<StaffProfileView,'staffId'|'userId'|'clubId'> | null) {
  const staffId = profile?.staffId;
  const source = staffDataSource();
  const {user,session,loading:authLoading} = useAuth();
  const canRead = source === 'mock' || (!!user && profile?.userId === user.id);
  const scopeError = profile && !authLoading && !canRead ? 'Chưa xác minh được quyền chấm công. Vui lòng đăng nhập lại.' : null;
  const q = useQuery({
    queryKey: [...staffKeys.attendance(staffId ?? undefined),source,user?.id,profile?.clubId,sessionReadEpoch(session)],
    enabled: !!staffId && !authLoading && canRead,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<StaffAttendanceView[]> => {
      if (!staffId) return [];
      if (!canRead) throw new Error('staff_attendance_scope_unverified');
      if (source === "mock") return readMockAttendance(staffId);

      const { data, error } = await observeTrackerContextRead(supabase
        .from("staff_attendance")
        .select("id, staff_id, shift_date, check_in_time, check_out_time, status, total_worked_minutes_today")
        .eq("staff_id", staffId)
        .order("check_in_time", { ascending: false })
        .limit(30));
      if (error) throw error;
      const parsed=attendancePacket.safeParse(data);
      if(!parsed.success || parsed.data.some(row=>row.staff_id!==staffId)
        || new Set(parsed.data.map(row=>row.id)).size!==parsed.data.length
        || parsed.data.filter(row=>row.status==='checked_in').length>1) {
        throw new Error('Không xác minh được dữ liệu chấm công. Vui lòng tải lại.');
      }
      return parsed.data.map(mapAttendance);
    },
  });

  const rows = canRead && !authLoading && !q.isError ? q.data ?? [] : [];
  const openAttendance = rows.find((r) => r.status === "checked_in" && !r.checkOutTime) ?? null;
  return { ...q, scopeError, isLoading: authLoading || q.isLoading, rows, openAttendance };
}

