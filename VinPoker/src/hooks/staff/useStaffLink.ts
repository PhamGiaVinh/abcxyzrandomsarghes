import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { mockStaffMemberships } from "@/lib/staffApp/mockStaffData";
import { setSelectedStaffId, useSelectedStaffId } from "@/lib/staffApp/selectedClub";
import type { StaffDataSource, StaffProfileView } from "@/types/staffApp";

const clubName = z.object({name:z.string()});
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullish();
const membershipRows = z.array(z.object({id:z.string().min(1),club_id:z.string().min(1),user_id:z.string().min(1),
  full_name:z.string(),phone:z.string().nullish(),department:z.enum(['floor','cashier','tracker','service','security']),
  employment_type:z.enum(['full_time','part_time']).nullish(),monthly_salary_vnd:amount,hourly_rate_vnd:amount,
  standard_hours_per_shift:z.number().finite().nonnegative().nullish(),status:z.string(),
  clubs:z.union([clubName,z.array(clubName)]).nullable(),
}));

function embeddedName(clubs: z.infer<typeof membershipRows>[number]['clubs']): string {
  if (!clubs) return "";
  return Array.isArray(clubs) ? (clubs[0]?.name ?? "") : (clubs.name ?? "");
}

export interface UseStaffLinkResult {
  staff: StaffProfileView | null;
  memberships: StaffProfileView[];
  selectedStaffId: string | null;
  setSelectedStaffId: (id: string) => void;
  isStaff: boolean;
  loading: boolean;
  source: StaffDataSource;
  error: string | null;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

export function useStaffLink(): UseStaffLinkResult {
  const { user, session, loading: authLoading } = useAuth();
  const source = staffDataSource();
  const selectedId = useSelectedStaffId();

  const q = useQuery({
    queryKey: [...staffKeys.link(user?.id),source,sessionReadEpoch(session)],
    enabled: !authLoading && (source === "mock" || !!user),
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<StaffProfileView[]> => {
      if (source === "mock") return mockStaffMemberships();
      if (!user) return [];

      const { data, error } = await observeTrackerContextRead(supabase
        .from("staff")
        .select(
          "id, club_id, user_id, full_name, phone, department, employment_type, monthly_salary_vnd, hourly_rate_vnd, standard_hours_per_shift, status, clubs(name)"
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("full_name"));
      if (error) throw error;
      const parsed=membershipRows.safeParse(data);
      if(!parsed.success || parsed.data.some(row=>row.user_id!==user.id)
        || new Set(parsed.data.map(row=>row.id)).size!==parsed.data.length)throw new Error('staff_membership_unverified');

      return parsed.data.map(
        (s): StaffProfileView => ({
          staffId: s.id,
          userId: s.user_id,
          clubId: s.club_id,
          clubName: embeddedName(s.clubs),
          fullName: s.full_name,
          phone: s.phone ?? null,
          department: s.department,
          employmentType: s.employment_type ?? "full_time",
          monthlySalaryVnd: s.monthly_salary_vnd ?? null,
          hourlyRateVnd: s.hourly_rate_vnd ?? null,
          standardHoursPerShift: s.standard_hours_per_shift ?? null,
          status: s.status,
        })
      );
    },
  });

  const memberships = useMemo(()=>!authLoading && (source==='mock'||!!user?.id) && !q.isError ? q.data ?? [] : [],
    [authLoading,source,user?.id,q.isError,q.data]);
  const staff = memberships.find((m) => m.staffId === selectedId) ?? memberships[0] ?? null;

  useEffect(() => {
    if (memberships.length === 0) return;
    if (!selectedId || !memberships.some((m) => m.staffId === selectedId)) {
      setSelectedStaffId(memberships[0].staffId);
    }
  }, [memberships, selectedId]);

  return {
    staff,
    memberships,
    selectedStaffId: staff?.staffId ?? null,
    setSelectedStaffId,
    isStaff: memberships.length > 0,
    loading: authLoading || q.isLoading,
    source,
    error:q.isError?'Không xác minh được hồ sơ nhân viên. Hãy kiểm tra kết nối và tải lại.':null,
    isFetching:q.isFetching,
    refetch:q.refetch,
  };
}

