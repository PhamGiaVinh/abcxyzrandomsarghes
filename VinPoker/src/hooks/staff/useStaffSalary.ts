import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { supabase } from "@/integrations/supabase/client";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { readMockSalary } from "@/lib/staffApp/mockStaffData";
import type { StaffProfileView, StaffSalaryView } from "@/types/staffApp";

const rpcClient = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const salaryPacket = z.object({
  staff_id:z.string(),club_id:z.string(),employment_type:z.enum(['full_time','part_time']),
  hourly_rate_vnd:amount,accrued_minutes:amount,balance_vnd:amount,
  last_reset_at:timestamp.nullable(),current_shift_open:z.boolean(),current_shift_start:timestamp.nullable(),
  monthly_salary_vnd:amount.nullable(),recent_payments:z.array(z.object({
    id:z.string().min(1),amount_vnd:amount,minutes_paid:amount,paid_at:timestamp,
    covered_from:timestamp.nullable(),covered_to:timestamp.nullable(),
    payment_method:z.string().nullable(),payment_reference:z.string().nullable(),
  })),
});

function mapSalary(raw: unknown, profile: StaffProfileView): StaffSalaryView {
  const parsed = salaryPacket.safeParse(raw);
  if (!parsed.success || parsed.data.staff_id !== profile.staffId || parsed.data.club_id !== profile.clubId
    || (parsed.data.current_shift_open && !parsed.data.current_shift_start)) {
    throw new Error('Chưa xác minh được dữ liệu lương nhân viên. Hãy tải lại.');
  }
  const r = parsed.data;
  return {
    staffId: profile.staffId,
    employmentType: r.employment_type,
    hourlyRateVnd: r.hourly_rate_vnd,
    accruedMinutes: r.accrued_minutes,
    balanceVnd: r.balance_vnd,
    lastResetAt: r.last_reset_at,
    currentShiftOpen: r.current_shift_open,
    currentShiftStart: r.current_shift_start,
    monthlySalaryVnd: r.monthly_salary_vnd,
    recentPayments: r.recent_payments.map((p) => ({
          id: p.id,
          amountVnd: p.amount_vnd,
          minutesPaid: p.minutes_paid,
          paidAt: p.paid_at,
          coveredFrom: p.covered_from ?? null,
          coveredTo: p.covered_to ?? null,
          paymentMethod: p.payment_method ?? null,
          paymentReference: p.payment_reference ?? null,
        })),
  };
}

/**
 * Read-only "Lương của tôi" data for the signed-in staff member. Live source calls the
 * SECURITY DEFINER RPC get_my_staff_salary (self-scoped, binds auth.uid() via staff.user_id);
 * mock source (staffApp flag OFF) returns preview data. Never writes.
 */
export function useStaffSalary(profile: StaffProfileView | null) {
  const source = staffDataSource();
  const { user, session, loading: authLoading } = useAuth();
  const canRead = source === 'mock' || (!!user && profile?.userId === user.id);
  const scopeError = profile && !authLoading && !canRead ? 'Chưa xác minh được quyền xem lương. Vui lòng đăng nhập lại.' : null;
  const q = useQuery({
    queryKey: [...staffKeys.salary(profile?.staffId ?? undefined),source,user?.id,profile?.clubId,sessionReadEpoch(session)],
    enabled: !!profile && !authLoading && canRead,
    retry: false,
    staleTime: 20_000,
    queryFn: async (): Promise<StaffSalaryView | null> => {
      if (!profile) return null;
      if (!canRead) throw new Error('staff_salary_scope_unverified');
      if (source === "mock") return readMockSalary(profile);
      const { data, error } = await observeTrackerContextRead(rpcClient.rpc("get_my_staff_salary", { p_staff_id: profile.staffId }));
      if (error) throw error;
      return mapSalary(data, profile);
    },
  });

  return { ...q, scopeError, isLoading: authLoading || q.isLoading, salary: canRead && !authLoading && !q.isError ? q.data ?? null : null };
}
