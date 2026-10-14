import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseFinanceCore, financeSessionReadEpoch } from "@/lib/financeSummaryRead";

export interface FinanceSummaryRpc {
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
 * The RPC (get_club_finance_summary, accountant scope via 20261236000000) either
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
    queryKey: ["accountant", "financeSummary", user?.id??"", epoch, isAdmin, clubId ?? "", from, to, authLoading],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<FinanceSummaryRpc> => {
      if (!enabled || activeContext.current !== context) throw new Error("AUTH_REQUIRED");
      const { data, error } = await supabase.rpc("get_club_finance_summary", {
        p_from: from,
        p_to: to,
        p_club_id: clubId ?? undefined,
      }).abortSignal(signal);
      if (activeContext.current !== context) throw new Error("FINANCE_READ_SUPERSEDED");
      if (error) throw error;
      const {revenue:rev,cost,net}=parseFinanceCore(data);
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
