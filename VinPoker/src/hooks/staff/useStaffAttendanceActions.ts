import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { mockStaffCheckIn, mockStaffCheckOut } from "@/lib/staffApp/mockStaffData";
import type { StaffDataSource, StaffProfileView } from "@/types/staffApp";

type Profile = Pick<StaffProfileView,"staffId"|"userId"|"clubId">;
type Intent = { action:"in"|"out"; profile:Profile; source:StaffDataSource; actorId:string|undefined; epoch:number; scope:string };
const commit = z.object({outcome:z.enum(['checked_in','already_checked_in','checked_out']),attendance_id:z.string().uuid()});
const checkout = z.object({check_out_time:z.string().refine(v=>Number.isFinite(Date.parse(v))),total_worked_minutes_today:z.number().int().min(0).max(1440)});
function message(error:unknown) {
  return error && typeof error==='object' && 'message' in error && typeof error.message==='string' ? error.message : 'Không thể xác minh chấm công.';
}

export function useStaffAttendanceActions(profile:Profile|null) {
  const queryClient = useQueryClient();
  const source = staffDataSource();
  const {user,session,loading:authLoading} = useAuth();
  const epoch=sessionReadEpoch(session);
  const scope=JSON.stringify([source,user?.id,profile?.staffId,profile?.userId,profile?.clubId,epoch]);
  const currentScope=useRef(scope);currentScope.current=scope;
  const alive=useRef(true),flight=useRef<Intent|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=(intent:Intent)=>alive.current&&currentScope.current===intent.scope;
  const invalidate=(intent:Intent)=>Promise.all([staffKeys.attendance(intent.profile.staffId),staffKeys.salary(intent.profile.staffId)].map(key=>
    queryClient.invalidateQueries({queryKey:[...key,intent.source,intent.actorId,intent.profile.clubId,intent.epoch],exact:true,refetchType:current(intent)?'active':'none'})));
  const mutation=useMutation({
    retry:false,
    mutationFn:async(intent:Intent):Promise<unknown>=>{
      if(!current(intent))throw new Error('staff_attendance_scope_expired');
      if(intent.source==='mock')return intent.action==='in'?mockStaffCheckIn(intent.profile.staffId):mockStaffCheckOut(intent.profile.staffId);
      // Legacy checkout has no durable request/expected-attendance fence. Do
      // not release the flight on an artificial deadline and invite a retry.
      const {data,error}=await supabase.rpc(intent.action==='in'?'staff_check_in':'staff_check_out',{p_staff_id:intent.profile.staffId});
      if(error)throw error;
      if(data && typeof data==='object' && 'outcome' in data && data.outcome==='no_open_shift')throw new Error('Không có ca đang mở. Hãy đọc lại chấm công.');
      const parsed=commit.safeParse(data);
      if(!parsed.success || (intent.action==='in' ? !['checked_in','already_checked_in'].includes(parsed.data.outcome)
        : parsed.data.outcome!=='checked_out'||!checkout.safeParse(data).success))throw new Error('Chưa xác minh được kết quả chấm công. Hãy đọc lại trạng thái.');
      return data;
    },
    onSuccess:async(_data,intent)=>{
      if(current(intent))toast.success(intent.action==='in'?'Đã check-in.':'Đã check-out.');
      await invalidate(intent);
    },
    onError:async(error,intent)=>{
      if(current(intent))toast.error(message(error));
      await invalidate(intent);
    },
  });
  const run=async(action:Intent['action'])=>{
    if(flight.current)throw new Error('staff_attendance_action_in_flight');
    if(!profile || authLoading || (source==='live'&&(!user||profile.userId!==user.id)))throw new Error('Chưa xác minh được hồ sơ chấm công.');
    const intent:Intent={action,profile:{...profile},source,actorId:user?.id,epoch,scope};
    flight.current=intent;
    try{return await mutation.mutateAsync(intent);}finally{if(flight.current===intent)flight.current=null;}
  };
  return {
    checkIn:{...mutation,mutate:()=>{void run('in').catch(()=>{});},mutateAsync:()=>run('in')},
    checkOut:{...mutation,mutate:()=>{void run('out').catch(()=>{});},mutateAsync:()=>run('out')},
    isPending:mutation.isPending,
  };
}

