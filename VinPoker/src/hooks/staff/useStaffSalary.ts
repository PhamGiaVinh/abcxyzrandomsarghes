import { useQuery } from "@tanstack/react-query";
import {useMemo,useRef} from 'react';
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { supabase } from "@/integrations/supabase/client";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { FEATURES } from "@/lib/featureFlags";
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

const ftPayslipPacket = z.object({
  staff_id: z.string(),
  club_id: z.string(),
  pending_adjustments:z.array(z.object({id:z.string().min(1),base_run_id:z.string().min(1),period_year:z.number().int(),period_month:z.number().int().min(1).max(12),amount_vnd:amount.positive()})).max(20).optional(),
  payslips: z.array(z.object({
    id: z.string().min(1),
    period_year: z.number().int(),
    period_month: z.number().int().min(1).max(12),
    net_vnd: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    status: z.enum(["approved", "recorded_paid"]),
    paid_at: timestamp.nullable(),
    payment_method: z.string().nullable(),
    adjusts_id: z.string().min(1).nullish(),
    source_status: z.enum(['verified','unverified']).optional(),
  })).max(20),
});

/**
 * Read-only "Lương của tôi" data for the signed-in staff member. Live source calls the
 * SECURITY DEFINER RPC get_my_staff_salary (self-scoped, binds auth.uid() via staff.user_id);
 * mock source (staffApp flag OFF) returns preview data. Never writes.
 */
export function useStaffSalary(profile: StaffProfileView | null) {
  const source = staffDataSource();
  const { user, session, loading: authLoading } = useAuth();
  const canRead = source === 'mock' || (!!user && !!session?.access_token && profile?.userId === user.id);
  const epoch=sessionReadEpoch(session),scope=JSON.stringify([source,profile?.staffId,profile?.clubId,user?.id,epoch,authLoading,canRead,FEATURES.staffFtPayslips]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const assertCurrent=()=>{if(!canRead||authLoading||active.current!==context)throw Error('staff_salary_scope_unverified');};
  const scopeError = profile && !authLoading && !canRead ? 'Chưa xác minh được quyền xem lương. Vui lòng đăng nhập lại.' : null;
  const q = useQuery({
    queryKey: [...staffKeys.salary(profile?.staffId ?? undefined),source,user?.id,profile?.clubId,epoch],
    enabled: !!profile && !authLoading && canRead,
    retry: false,
    staleTime: 20_000,
    refetchInterval:2000,refetchOnWindowFocus:'always',refetchOnReconnect:'always',
    queryFn: async (): Promise<StaffSalaryView | null> => {
      if (!profile) return null;
      assertCurrent();
      if (source === "mock") return readMockSalary(profile);
      const { data, error } = await observeTrackerContextRead(rpcClient.rpc("get_my_staff_salary", { p_staff_id: profile.staffId }));
      assertCurrent();
      if (error) throw error;
      return mapSalary(data, profile);
    },
  });

  const enableFtPayslips = FEATURES.staffFtPayslips && source === "live" && !!profile;
  const ftPayslips = useQuery({
    queryKey: [...staffKeys.salary(profile?.staffId ?? undefined), "ftPayslipsV1", user?.id, profile?.clubId, epoch],
    enabled: enableFtPayslips && canRead && !authLoading,
    retry: false,
    staleTime: 20_000,
    refetchInterval:2000,refetchOnWindowFocus:'always',refetchOnReconnect:'always',
    queryFn: async () => {
      if (!profile || !canRead) throw new Error("staff_salary_scope_unverified");
      assertCurrent();
      const { data, error } = await observeTrackerContextRead(rpcClient.rpc("get_my_staff_ft_payslips_v1", {
        p_staff_id: profile.staffId,
        p_club_id: profile.clubId,
      }));
      assertCurrent();
      if (error) throw error;
      const packet = ftPayslipPacket.parse(data);
      if (packet.staff_id !== profile.staffId || packet.club_id !== profile.clubId) throw new Error("staff_salary_scope_unverified");
      if(new Set(packet.payslips.map(slip=>slip.id)).size!==packet.payslips.length)throw new Error('staff_salary_receipts_duplicated');
      for(const slip of packet.payslips){
        if(!slip.adjusts_id)continue;
        const base=packet.payslips.find(row=>row.id===slip.adjusts_id);
        if(slip.id===slip.adjusts_id || (base&&(base.adjusts_id||base.period_year!==slip.period_year||base.period_month!==slip.period_month)))throw new Error('staff_salary_supplement_link_invalid');
      }
      if(new Set(packet.pending_adjustments?.map(request=>request.id)).size!==(packet.pending_adjustments?.length??0))throw Error('staff_salary_requests_duplicated');
      return packet;
    },
  });
  return { ...q, scopeError, refetch:()=>{assertCurrent();return q.refetch();},isLoading: authLoading || q.isLoading, salary: canRead && !authLoading && !q.isError && !q.isPaused ? q.data ?? null : null,
    ftPayslips: enableFtPayslips && canRead && !authLoading ? {...ftPayslips,
      data:!ftPayslips.isError&&!ftPayslips.isPaused?ftPayslips.data?.payslips:undefined,
      pendingAdjustments:!ftPayslips.isError&&!ftPayslips.isPaused?ftPayslips.data?.pending_adjustments:undefined,
      refetch:()=>{try{assertCurrent();}catch(error){return Promise.reject(error);}return ftPayslips.refetch();},
    } : null,
  };
}
