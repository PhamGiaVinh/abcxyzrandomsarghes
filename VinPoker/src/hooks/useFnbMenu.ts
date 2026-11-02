import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import {observeTrackerContextRead} from "@/lib/tournament/observeTrackerContextRead";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

export type FnbCategory = {
  id: string; club_id: string; name: string; sort_order: number; is_active: boolean;
};
export type FnbMenuItem = {
  id: string; club_id: string; category_id: string | null; name: string;
  price_vnd: number; is_active: boolean; image_url: string | null; sort_order: number;
};
export type FnbIngredient = {
  id: string; club_id: string; name: string; stock_unit: string; purchase_unit: string | null;
  units_per_purchase: number; on_hand: number; avg_unit_cost: number;
  low_stock_threshold: number; is_active: boolean; version: number;
};
export type FnbMenuData = {
  categories: FnbCategory[]; items: FnbMenuItem[]; ingredients: FnbIngredient[];
};

/**
 * Reads the club's F&B catalogue (categories + menu items + ingredients) — all RLS-scoped direct
 * SELECTs (the RLS policy already limits rows to F&B staff / owner of `clubId`; no RPC needed).
 * One react-query entry → a single `refetch()` / `invalidateQueries(['fnb','menu',clubId])` refreshes
 * everything; the admin managers call that after each upsert. Reused by OrderEntryPanel (F5),
 * RecipeEditor + StockInForm (F3). `fnb_*` is untyped → `supabase as any`.
 */
export function useFnbMenu(clubId: string | undefined) {
  const { user, session, loading: authLoading } = useAuth();
  const actor = authLoading ? undefined : user?.id;
  const epoch = sessionReadEpoch(session);
  return useQuery({
    queryKey: ["fnb", "menu", clubId, actor, epoch],
    enabled: !!actor && !!clubId,
    retry: false,
    queryFn: async ({signal}): Promise<FnbMenuData> => {
      const controller=new AbortController();let abort!:()=>void;
      const cancelled=new Promise<never>((_,reject)=>{
        abort=()=>{controller.abort();reject(new Error('FNB_MENU_READ_CANCELLED'));};
        signal.addEventListener('abort',abort,{once:true});
      });
      const read=async(query:PromiseLike<{data:unknown;error:unknown}>)=>{
        const reply=await query;
        if(reply.error)throw reply.error;
        if(!Array.isArray(reply.data))throw new Error('Không xác minh được thực đơn F&B.');
        return reply.data;
      };
      try {
        if(signal.aborted)throw new Error('FNB_MENU_READ_CANCELLED');
        const sb = supabase as any;
        const [categories,items,ingredients]=await observeTrackerContextRead(Promise.race([Promise.all([
          read(sb.from('fnb_categories').select('*').eq('club_id',clubId).order('sort_order').order('name').abortSignal(controller.signal)),
          read(sb.from('fnb_menu_items').select('*').eq('club_id',clubId).order('sort_order').abortSignal(controller.signal)),
          read(sb.from('fnb_ingredients').select('*').eq('club_id',clubId).order('name').abortSignal(controller.signal)),
        ]),cancelled]));
        return {categories:categories as FnbCategory[],items:items as FnbMenuItem[],ingredients:ingredients as FnbIngredient[]};
      } finally {
        signal.removeEventListener('abort',abort);controller.abort();
      }
    },
  });
}
