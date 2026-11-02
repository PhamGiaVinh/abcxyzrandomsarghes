import { useQuery } from "@tanstack/react-query";
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';
import { useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseFinanceCore, financeSessionReadEpoch, assertFinanceCalendarRange, assertFinanceCalendarScope } from "@/lib/financeSummaryRead";
import {parseFinanceStaffLive,parseFinanceDealerLive,parseFinanceDealerFtLive,type FinanceDealerFtLive,type FinanceDealerLive,type FinanceStaffLive} from '@/lib/financeSummaryRead';

export interface FinanceSummaryRpc {
  staffLive?:FinanceStaffLive;
  dealerLive?:FinanceDealerLive;
  dealerFtLive?:FinanceDealerFtLive;
  revenue: {
    total: number;
    rake: number;
    serviceFee: number;
    stakingFees: number;
    payoutFees: number;
    fnb: number;
  };
  cost: {
    payrollNet: number;
    payrollGross: number;
    ptWagePaid: number;
    fnbCogs: number;
    compCogs: number;
    clubExpenses: number;
  };
  net: number;
}

/**
 * RPC-ONLY finance summary for the accountant workspace. Deliberately NO client-side
 * fallback: failed canonical reads must not become client-calculated balances.
 * The date RPC v2 delegates the unchanged accountant/owner authority to v1 and either
 * answers or raises 42501 — the tab shows the explicit reason, never fake zeros.
 */
export function useFinanceSummaryRpcOnly(clubId: string | null, from: string, to: string) {
  const {user,session,loading:authLoading,isAdmin}=useAuth();
  const epoch=financeSessionReadEpoch(session);
  const enabled = !!clubId && !!user?.id && !!session?.access_token && !authLoading;
  const scope = JSON.stringify([user?.id, epoch, isAdmin, clubId, from, to, authLoading]);
  const context = useMemo(() => ({ scope }), [scope]);
  const activeContext = useRef(context);
  activeContext.current = context;
  const query = useQuery({
    queryKey: ["accountant", "financeSummaryV2", user?.id??"", epoch, isAdmin, clubId ?? "", from, to, authLoading],
    enabled,
    staleTime: 60_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: false,
    queryFn: async ({ signal }): Promise<FinanceSummaryRpc> => {
      if (!enabled || activeContext.current !== context) throw new Error("AUTH_REQUIRED");
      assertFinanceCalendarRange(from,to);
      const { data, error } = await observeTrackerContextRead(supabase.rpc("get_club_finance_summary_v2" as never, {
        p_from_date: from,
        p_to_date: to,
        p_club_id: clubId,
      } as never).abortSignal(signal));
      if (activeContext.current !== context) throw new Error("FINANCE_READ_SUPERSEDED");
      if (error) throw error;
      const {data:source,revenue:rev,cost,net}=parseFinanceCore(data);
      assertFinanceCalendarScope(source,{from,to,clubId});
      return {
        revenue: {
          total: rev.total,
          rake: rev.rake,
          serviceFee: rev.serviceFee ?? 0,
          stakingFees: rev.stakingFees,
          payoutFees: rev.payoutFees,
          fnb: rev.fnb ?? 0,
        },
        cost: {
          payrollNet: cost.payrollNet,
          payrollGross: cost.payrollGross,
          ptWagePaid: cost.ptWagePaid ?? 0,
          fnbCogs: cost.fnbCogs ?? 0,
          compCogs: cost.compCogs ?? 0,
          clubExpenses: cost.clubExpenses ?? 0,
        },
        net,
        ...(Object.prototype.hasOwnProperty.call(source,'staffLive')?{staffLive:parseFinanceStaffLive(source.staffLive)}:{}),
    ...(Object.prototype.hasOwnProperty.call(source,'dealerLive')?{dealerLive:parseFinanceDealerLive(source.dealerLive)}:{}),
    ...(Object.prototype.hasOwnProperty.call(source,'dealerFtLive')?{dealerFtLive:parseFinanceDealerFtLive(source.dealerFtLive)}:{}),
      };
    },
  });
  return {
    ...query,
    data: enabled ? query.data : undefined,
    isLoading: authLoading || query.isLoading,
    refetch: (...args: Parameters<typeof query.refetch>) => {
      if (!enabled || activeContext.current !== context) {
        return Promise.reject(new Error("AUTH_REQUIRED"));
      }
      return query.refetch(...args);
    },
  };
}
