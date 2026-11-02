import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { z } from "zod";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { mockExpenseClubs } from "@/lib/clubExpenses/mockExpenses";
import type { ClubExpenseSource, ExpenseClub } from "@/lib/clubExpenses/types";

const db = supabase as unknown as { from: (table: string) => any };

const clubsPacket=z.array(z.object({id:z.string().min(1),name:z.string().min(1)}));
const membershipsPacket=z.array(z.object({club_id:z.string().min(1)}));

export function useExpenseClubs(source: ClubExpenseSource, requested: boolean) {
  const { user, session, loading: authLoading, isAdmin, isClubAdmin, isClubOwner, isCashier, isAccountant } = useAuth();
  const epoch=sessionReadEpoch(session);
  const enabled=requested&&!authLoading&&(source==='mock'||(!!user?.id&&!!session?.access_token));
  const scope=JSON.stringify([source,user?.id,epoch,authLoading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant,requested]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const read=async(request:PromiseLike<{data:unknown;error:unknown}>)=>{
    const response=await observeTrackerContextRead(request);
    if(active.current!==context)throw Error('EXPENSE_CLUB_READ_SUPERSEDED');
    if(response.error)throw response.error;
    return response.data;
  };
  const clubs=(data:unknown)=>{
    const rows=clubsPacket.parse(data);
    if(new Set(rows.map(c=>c.id)).size!==rows.length)throw Error('EXPENSE_CLUBS_DUPLICATED');
    return rows.map(c=>({id:c.id,name:c.name}));
  };

  const query=useQuery({
    queryKey: ["clubExpenses", "clubs", source, user?.id ?? "anon",epoch,authLoading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant,requested],
    enabled,retry:false,refetchInterval:5_000,refetchOnWindowFocus:'always',refetchOnReconnect:'always',
    staleTime: 60_000,
    queryFn: async (): Promise<ExpenseClub[]> => {
      if(!enabled||active.current!==context)throw Error('EXPENSE_AUTH_REQUIRED');
      if (source === "mock") return mockExpenseClubs();
      if (!user) return [];

      if (isAdmin || isClubAdmin) {
        return clubs(await read(db.from("clubs").select("id,name").order("name").limit(50)));
      }

      const [owned, cashierRows, acctRows] = await Promise.all([
        read(db.from("clubs").select("id,name").eq("owner_id", user.id)),
        read(db.from("club_cashiers").select("club_id").eq("user_id", user.id)),
        // Accountants manage expenses too (server authz via 20261236000000).
        read(db.from("club_accountants").select("club_id").eq("user_id", user.id)),
      ]);

      const result = new Map<string, ExpenseClub>();
      for (const c of clubs(owned)) result.set(c.id, c);
      const memberIds = [
        ...membershipsPacket.parse(cashierRows).map(r=>r.club_id),
        ...membershipsPacket.parse(acctRows).map(r=>r.club_id),
      ];
      const missingIds = [...new Set(memberIds)].filter(id => !result.has(id));
      if (missingIds.length) {
        const memberClubs=clubs(await read(db.from("clubs").select("id,name").in("id",missingIds)));
        if(memberClubs.some(c=>!missingIds.includes(c.id)))throw Error('EXPENSE_CLUB_SCOPE_INVALID');
        for (const c of memberClubs) result.set(c.id,c);
      }

      return Array.from(result.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return {...query,data:enabled&&!query.isError?query.data:undefined,isLoading:authLoading||query.isLoading,
    refetch:(...args:Parameters<typeof query.refetch>)=>{
      if(!enabled||active.current!==context)return Promise.reject(Error('EXPENSE_AUTH_REQUIRED'));
      return query.refetch(...args);
    }};
}

