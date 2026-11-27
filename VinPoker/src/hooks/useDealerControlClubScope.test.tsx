import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),names:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 rpc:(...args:unknown[])=>{const result=h.rpc(...args);return Object.assign(result,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return result;}});},
 from:()=>({select:()=>({in:(...args:unknown[])=>{const result=h.names(...args);return Object.assign(result,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return result;}});}})}),
}}));
import {useDealerControlClubScope} from './useDealerControlClubScope';
const a='17390000-0000-4000-8000-000000000011',b='17390000-0000-4000-8000-000000000012';
const row=(club_id:string,flags:Record<string,boolean>)=>({club_id,can_owner:false,can_cashier:false,can_floor:false,can_tracker:false,can_dealer_control:false,can_accountant:false,can_chip_master:false,can_marketer:false,can_fnb_cashier:false,can_fnb_server:false,can_fnb_kitchen:false,...flags});
describe('Dealer Control current club authority',()=>{
 afterEach(()=>{cleanup();vi.useRealTimers();});
 beforeEach(()=>{
  h.signals=[];h.rpc.mockReset();h.names.mockReset();
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_my_ops_global_capability'?[{is_super_admin:false}]:[row(a,{can_dealer_control:true}),row(b,{can_cashier:true})],error:null}));
  h.names.mockImplementation(async(_field:string,ids:string[])=>({data:ids.map(id=>({id,name:id===a?'Club A':'Club B'})),error:null}));
 });
 it('does not turn Dealer Control A plus Cashier B into payroll A access',async()=>{
  const {result}=renderHook(()=>useDealerControlClubScope('receiver',1,true));
  await waitFor(()=>expect(result.current.scopeVerified).toBe(true));
  expect(result.current.dealerClubIds).toEqual([a]);expect(result.current.payrollClubIds).toEqual([]);
  expect(result.current.clubs).toEqual([{id:a,name:'Club A'}]);
  expect(result.current.isAdmin).toBe(false);
 });
 it('preserves verified superadmin authority with no assigned or owned club',async()=>{
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_my_ops_global_capability'?[{is_super_admin:true}]:[],error:null}));
  const {result}=renderHook(()=>useDealerControlClubScope('admin',1,true));await waitFor(()=>expect(result.current.scopeVerified).toBe(true));
  expect(result.current.isAdmin).toBe(true);expect(result.current.dealerClubIds).toEqual([]);expect(result.current.clubs).toEqual([]);
  expect(h.rpc).toHaveBeenCalledWith('dealer_control_club_ids',{_user_id:'admin'});
 });
 it('rechecks an open workspace without discarding unchanged scope, then removes revoked A',async()=>{
  vi.useFakeTimers();const {result}=renderHook(()=>useDealerControlClubScope('receiver',1,true));
  await act(async()=>{});expect(result.current.scopeVerified).toBe(true);const initial=result.current.clubs;
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(result.current.clubs).toBe(initial);
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_my_ops_global_capability'?[{is_super_admin:false}]:[row(b,{can_cashier:true})],error:null}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(result.current.dealerClubIds).toEqual([]);expect(result.current.payrollClubIds).toEqual([]);
 });
 it('discards revoked authority before optional club labels finish',async()=>{
  vi.useFakeTimers();const {result}=renderHook(()=>useDealerControlClubScope('receiver',1,true));await act(async()=>{});
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_my_ops_global_capability'?[{is_super_admin:false}]:[row(b,{can_dealer_control:true,can_cashier:true})],error:null}));h.names.mockImplementation(()=>new Promise(()=>{}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(result.current.dealerClubIds).toEqual([]);expect(result.current.clubs).toBeNull();
 });
 it('does not leak old scope on the first render of a new actor or session',async()=>{
  let actor='first',epoch=1;const seen:{actor:string;epoch:number;ids:string[]}[]=[];
  const {result,rerender}=renderHook(()=>{const scope=useDealerControlClubScope(actor,epoch,true);seen.push({actor,epoch,ids:scope.dealerClubIds});return scope;});
  await waitFor(()=>expect(result.current.scopeVerified).toBe(true));h.rpc.mockImplementation(()=>new Promise(()=>{}));actor='second';rerender();
  expect(seen.filter(s=>s.actor==='second').every(s=>s.ids.length===0)).toBe(true);epoch=2;rerender();expect(result.current.dealerClubIds).toEqual([]);
 });
 it('expires a hung read, aborts it, prevents overlapping polls and allows retry',async()=>{
  vi.useFakeTimers();h.rpc.mockImplementation(()=>new Promise(()=>{}));const {result}=renderHook(()=>useDealerControlClubScope('receiver',1,true));
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(h.rpc).toHaveBeenCalledTimes(2);
  await act(async()=>{await vi.advanceTimersByTimeAsync(4001);});expect(result.current.error).not.toBeNull();expect(h.signals.slice(0,2).every(s=>s.aborted)).toBe(true);
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_my_ops_global_capability'?[{is_super_admin:false}]:[],error:null}));
  await act(async()=>{result.current.refresh();});expect(result.current.scopeVerified).toBe(true);expect(result.current.error).toBeNull();
 });
 it('fails closed on malformed roles and never treats an error as verified empty scope',async()=>{
  h.rpc.mockResolvedValue({data:null,error:{message:'offline'}});const {result}=renderHook(()=>useDealerControlClubScope('receiver',1,true));
  await waitFor(()=>expect(result.current.error).not.toBeNull());expect(result.current.scopeVerified).toBe(false);expect(result.current.clubs).toBeNull();
 });
});
