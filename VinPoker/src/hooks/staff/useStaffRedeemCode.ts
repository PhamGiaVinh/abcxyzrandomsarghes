import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { z } from "zod";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn:'staff_redeem_link_code',args:{p_code:string})=>
  PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>;
const linkedReceipt=z.object({status:z.literal('ok'),staff_id:z.string().uuid(),club_id:z.string().uuid()});
const denial=z.object({error:z.string().min(1),detail:z.string().optional()});

const ERRORS: Record<string, string> = {
  NOT_FOUND: "Mã không đúng hoặc đã dùng. Kiểm tra lại với chủ CLB.",
  ALREADY_LINKED: "Hồ sơ này đã liên kết với tài khoản khác.",
  ALREADY_LINKED_ELSEWHERE: "Tài khoản của bạn đã gắn với một hồ sơ khác trong CLB này rồi.",
  EXPIRED: "Mã đã hết hạn — nhờ chủ CLB tạo mã mới.",
  INVALID_INPUT: "Mã không hợp lệ (tối thiểu 6 ký tự).",
  Unauthorized: "Bạn cần đăng nhập trước.",
};

/**
 * Staff self-link: the signed-in user redeems an invite code to bind their OWN account to a
 * staff row (staff_redeem_link_code — server binds auth.uid(), first-link-wins, one-time).
 * On success, invalidate the staff link query so the portal re-reads as linked.
 */
export function useStaffRedeemCode() {
  const qc = useQueryClient();
  const {user,session}=useAuth();
  const scope=JSON.stringify([user?.id,sessionReadEpoch(session)]);
  const currentScope=useRef(scope);currentScope.current=scope;
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=(context:{scope:string}|undefined)=>alive.current&&context?.scope===currentScope.current;
  return useMutation({
    retry:false,
    onMutate:()=>({scope}),
    mutationFn: async (code: string) => {
      const { data, error } = await rpc("staff_redeem_link_code", { p_code: code.trim() });
      if (error) {
        if (error.code === "42883" || `${error.message ?? ""}`.toLowerCase().includes("could not find the function")) {
          throw new Error("Tính năng mã mời chưa mở — báo chủ CLB.");
        }
        throw error;
      }
      const rejected=denial.safeParse(data);
      if(rejected.success)throw new Error(ERRORS[rejected.data.error]??rejected.data.detail??rejected.data.error);
      const confirmed=linkedReceipt.safeParse(data);
      if(!confirmed.success)throw new Error('Chưa xác minh được kết quả liên kết. Hãy tải lại hồ sơ trước khi thử tiếp.');
      return confirmed.data;
    },
    onSuccess: (_data,_variables,context) => {
      if(!current(context))return;
      toast.success("Đã liên kết! Đang mở cổng nhân viên…");
      qc.invalidateQueries({ queryKey: staffKeys.all });
    },
    onError: (error:unknown,_variables,context) => {
      if(current(context))toast.error(error && typeof error==='object' && 'message' in error
        && typeof error.message==='string'?error.message:"Không liên kết được.");
    },
  });
}
