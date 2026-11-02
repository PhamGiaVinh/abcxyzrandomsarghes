import {useEffect,useRef} from "react";
import {act,cleanup,renderHook} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {waitForManualPlayerResponse} from "@/lib/floorManualPlayerIntent";
import {initialAssignmentKey,listInitialAssignmentIntents} from "@/lib/dealerInitialAssignmentIntent";
const source=readFileSync("src/components/cashier/DealerSwingTab.tsx","utf8");
const start=source.indexOf("  // Confirm assignment"),end=source.indexOf("  // Send dealer to break",start);
if(start<0||end<=start)throw new Error("manual assignment source seam missing");
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const actual=new Function("useRef","useEffect","context",`
const {modalTable,tables,user,activeClubId,selectedTour,supabase,toast,isSubmitting,manualAssignRequests,
setAssigning,setModalTable,refetchAssignments,refetchDealers,triggerSwingAnimation,FunctionsHttpError,waitForManualPlayerResponse,
initialAssignmentKey,listInitialAssignmentIntents,setManualAssignJournalRevision}=context;
${code}
return {confirmAssign};`);
const id=(n:number)=>`e1800000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function context(){return {modalTable:id(3),tables:[{id:id(3),club_id:id(2),table_session_id:id(4)}],user:{id:id(1)},activeClubId:id(2),selectedTour:id(5),
 supabase:{functions:{invoke:vi.fn()}},toast:{error:vi.fn(),success:vi.fn(),info:vi.fn(),warning:vi.fn()},isSubmitting:{current:false},manualAssignRequests:{current:new Map<string,string>()},
 setAssigning:vi.fn(),setModalTable:vi.fn(),refetchAssignments:vi.fn(),refetchDealers:vi.fn(),triggerSwingAnimation:vi.fn(),FunctionsHttpError:class extends Error{},waitForManualPlayerResponse,initialAssignmentKey,listInitialAssignmentIntents,setManualAssignJournalRevision:vi.fn()};}
const scope=JSON.stringify([id(1),id(2),id(3),id(4),id(6)]),key=`vinpoker:manual-assign:${scope}`;
beforeEach(()=>sessionStorage.clear());afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
it("does not send if the journal silently failed to persist",async()=>{
 const ctx=context();ctx.supabase.functions.invoke.mockResolvedValue({data:{status:"success",assignment:{id:id(7)}},error:null});
 const hook=renderHook(()=>actual(useRef,useEffect,ctx));vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{});
 await act(async()=>hook.result.current.confirmAssign(id(6)));expect(ctx.supabase.functions.invoke).not.toHaveBeenCalled();
});
it("does not clear a replaced journal or close the modal on a late acknowledgement",async()=>{
 const ctx=context();let finish!:(v:unknown)=>void;ctx.supabase.functions.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(()=>actual(useRef,useEffect,ctx));let a!:Promise<void>;act(()=>{a=hook.result.current.confirmAssign(id(6));});
 sessionStorage.setItem(key,id(88));await act(async()=>{finish({data:{status:"success",assignment:{id:id(7)}},error:null});await a;});
 expect(sessionStorage.getItem(key)).toBe(id(88));expect(ctx.toast.success).not.toHaveBeenCalled();expect(ctx.setModalTable).not.toHaveBeenCalled();
});
it("does not accept a response from the previous club or clear the new flight",async()=>{
 const old=context(),next=context();next.activeClubId=id(22);next.modalTable=id(23);next.tables=[{id:id(23),club_id:id(22),table_session_id:id(24)}];
 next.isSubmitting=old.isSubmitting;next.manualAssignRequests=old.manualAssignRequests;
 let finishOld!:(v:unknown)=>void,finishNew!:(v:unknown)=>void;
 old.supabase.functions.invoke.mockImplementation(()=>new Promise(resolve=>{finishOld=resolve;}));next.supabase.functions.invoke.mockImplementation(()=>new Promise(resolve=>{finishNew=resolve;}));
 const hook=renderHook(({ctx})=>actual(useRef,useEffect,ctx),{initialProps:{ctx:old}});let a!:Promise<void>,b!:Promise<void>;
 act(()=>{a=hook.result.current.confirmAssign(id(6));});hook.rerender({ctx:next});act(()=>{b=hook.result.current.confirmAssign(id(6));});next.setAssigning.mockClear();
 await act(async()=>{finishOld({data:{status:"success",assignment:{id:id(7)}},error:null});await a;});
 expect(old.toast.success).not.toHaveBeenCalled();expect(old.setModalTable).not.toHaveBeenCalled();expect(next.setAssigning).not.toHaveBeenCalled();
 await act(async()=>{finishNew({data:{status:"success",assignment:{id:id(77)}},error:null});await b;});expect(next.toast.success).toHaveBeenCalledOnce();
});
it("bounds a hung write and preserves its key for an explicit retry",async()=>{
 vi.useFakeTimers();const ctx=context();let finish!:(v:unknown)=>void;ctx.supabase.functions.invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(()=>actual(useRef,useEffect,ctx));let a!:Promise<void>;act(()=>{a=hook.result.current.confirmAssign(id(6));void hook.result.current.confirmAssign(id(6));});
 expect(ctx.supabase.functions.invoke).toHaveBeenCalledTimes(1);const original=ctx.supabase.functions.invoke.mock.calls[0][1];
 expect(original.body).toMatchObject({mode:"assign",expected_actor_id:id(1),expected_club_id:id(2)});
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);await a;});expect(ctx.isSubmitting.current).toBe(false);expect(ctx.setAssigning).toHaveBeenLastCalledWith(false);
 await act(async()=>finish({data:{status:"success",assignment:{id:id(7)}},error:null}));expect(ctx.toast.success).not.toHaveBeenCalled();
 ctx.supabase.functions.invoke.mockResolvedValue({data:{status:"success",assignment:{id:id(7)}},error:null});
 await act(async()=>hook.result.current.confirmAssign(id(6)));expect(ctx.supabase.functions.invoke.mock.calls[1][1]).toEqual(original);expect(sessionStorage.getItem(key)).toBeNull();
});
it("ignores success after unmount without discarding the journal",async()=>{
 const ctx=context();let finish!:(v:unknown)=>void;ctx.supabase.functions.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(()=>actual(useRef,useEffect,ctx));let a!:Promise<void>;act(()=>{a=hook.result.current.confirmAssign(id(6));});const saved=sessionStorage.getItem(key);hook.unmount();
 await act(async()=>{finish({data:{status:"success",assignment:{id:id(7)}},error:null});await a;});expect(sessionStorage.getItem(key)).toBe(saved);expect(ctx.toast.success).not.toHaveBeenCalled();expect(ctx.setModalTable).not.toHaveBeenCalled();
});
it("blocks corrupt and superseded journal keys before dispatch",async()=>{
 const ctx=context();ctx.supabase.functions.invoke.mockResolvedValue({data:null,error:{message:"unknown"}});
 const hook=renderHook(()=>actual(useRef,useEffect,ctx));sessionStorage.setItem(key,"invalid");
 await act(async()=>hook.result.current.confirmAssign(id(6)));expect(ctx.supabase.functions.invoke).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe("invalid");
 sessionStorage.setItem(key,id(81));await act(async()=>hook.result.current.confirmAssign(id(6)));expect(ctx.supabase.functions.invoke).toHaveBeenCalledTimes(1);
 sessionStorage.setItem(key,id(82));await act(async()=>hook.result.current.confirmAssign(id(6)));expect(ctx.supabase.functions.invoke).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(key)).toBe(id(82));
});
it("actor A-B-A cannot accept the original A response",async()=>{
 const old=context(),other=context();other.user={id:id(99)};other.isSubmitting=old.isSubmitting;other.manualAssignRequests=old.manualAssignRequests;
 let finish!:(v:unknown)=>void;old.supabase.functions.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(({ctx})=>actual(useRef,useEffect,ctx),{initialProps:{ctx:old}});let a!:Promise<void>;act(()=>{a=hook.result.current.confirmAssign(id(6));});
 const saved=sessionStorage.getItem(key);hook.rerender({ctx:other});hook.rerender({ctx:old});
 await act(async()=>{finish({data:{status:"success",assignment:{id:id(7)}},error:null});await a;});expect(sessionStorage.getItem(key)).toBe(saved);expect(old.toast.success).not.toHaveBeenCalled();
});
it("same physical table with a new session rejects the prior session acknowledgement",async()=>{
 const old=context(),next=context();next.tables=[{id:id(3),club_id:id(2),table_session_id:id(44)}];next.isSubmitting=old.isSubmitting;next.manualAssignRequests=old.manualAssignRequests;
 let finish!:(v:unknown)=>void;old.supabase.functions.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(({ctx})=>actual(useRef,useEffect,ctx),{initialProps:{ctx:old}});let a!:Promise<void>;act(()=>{a=hook.result.current.confirmAssign(id(6));});
 const saved=sessionStorage.getItem(key);hook.rerender({ctx:next});await act(async()=>{finish({data:{status:"success",assignment:{id:id(7)}},error:null});await a;});
 expect(sessionStorage.getItem(key)).toBe(saved);expect(old.toast.success).not.toHaveBeenCalled();expect(old.setModalTable).not.toHaveBeenCalled();
});
it("blocks a new session/dealer intent while another journal remains unresolved",async()=>{
 sessionStorage.setItem(key,id(88));const ctx=context();ctx.tables[0].table_session_id=id(44);
 const hook=renderHook(()=>actual(useRef,useEffect,ctx));await act(async()=>hook.result.current.confirmAssign(id(66)));
 expect(ctx.supabase.functions.invoke).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe(id(88));expect(ctx.toast.error).toHaveBeenCalled();
});
