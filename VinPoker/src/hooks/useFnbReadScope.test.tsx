import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({auth:{user:{id:'actor-a'} as {id:string}|null,loading:false,session:{access_token:'TEST_SESSION_A'} as {access_token:string}|null},read:vi.fn(),rpc:vi.fn(),removed:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbTableLink:true,fnbShifts:true}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:()=>{const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,abortSignal:()=>q,
 then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>h.read().then(resolve,reject)};return q;},rpc:h.rpc,
 channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:h.removed,
}}));
import {useFnbOrders} from './useFnbOrders';
import {useFnbServeQueue} from './useFnbServe';
import {useFnbKitchen} from './useFnbKitchen';
import {useFnbLinkTargets} from './useFnbLinkTargets';
import {useFnbReport} from './useFnbReport';
import {useFnbMenu} from './useFnbMenu';
import {useFnbShifts,useFnbShiftReport} from './useFnbShift';

describe('F&B private financial and stock cache identity',()=>{
 it.each(['list','report'])('rejects a null successful shift %s payload instead of claiming empty/zero',async(kind)=>{
  h.read.mockResolvedValue({data:null,error:null});h.rpc.mockResolvedValue({data:null,error:null});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result,unmount}=renderHook(()=>kind==='list'?useFnbShifts('club-a'):useFnbShiftReport('shift-a'),{wrapper});
  try{await waitFor(()=>expect(result.current.isFetching).toBe(false));expect(result.current.isError).toBe(true);expect(result.current.data).toBeUndefined();}
  finally{unmount();client.clear();}
 });
 const hooks={useReport:()=>useFnbReport('club-a','2026-10-01T00:00:00+07:00','2026-11-01T00:00:00+07:00'),
  useMenu:()=>useFnbMenu('club-a'),useShifts:()=>useFnbShifts('club-a'),useShiftReport:()=>useFnbShiftReport('shift-a')};
 beforeEach(()=>{
  h.auth={user:{id:'actor-a'},loading:false,session:{access_token:'TEST_SESSION_A'}};
  const row={id:'private-old',club_id:'club-a',name:'private-old',status:'open',opened_by:'actor-a',opened_at:'2026-10-01T00:00:00Z',closed_by:null,closed_at:null,opening_float_vnd:0,expected_cash_vnd:null,counted_cash_vnd:null,variance_vnd:null,note:null,
   is_active:true,sort_order:0,category_id:null,price_vnd:10000,image_url:null,stock_unit:'unit',purchase_unit:null,units_per_purchase:1,on_hand:7,avg_unit_cost:321,low_stock_threshold:2,version:1};
  h.read.mockReset().mockResolvedValue({data:[row],error:null});
  h.rpc.mockReset().mockResolvedValue({data:{shift:{...row,id:'shift-a'},revenue:12345,cogs:34,grossProfit:12311,orderCount:1,statusCounts:{paid:1},topItems:[],lowStock:[],dailyTrend:[],compCount:0,compCogs:0,byTable:[{name:'private-old',revenue:12345,cogs:34,count:1}],byPlayer:[],sales_vnd:12345,refunds_vnd:0,expected_cash_vnd:12345,expected_drawer_vnd:12345,comp_count:0,orders:[]},error:null});
 });
 for(const [name,useRead] of Object.entries(hooks))for(const change of ['actor','logout','loading','replacement','in-place']){
  it(`${name} discards cached private values during ${change}`,async()=>{
   const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
   const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
   const {result,rerender,unmount}=renderHook(()=>useRead(),{wrapper});
   try{
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(JSON.stringify(result.current.data)).toContain('private-old');
    const reads=h.read.mock.calls.length+h.rpc.mock.calls.length;
    h.read.mockImplementation(()=>new Promise(()=>{}));h.rpc.mockImplementation(()=>new Promise(()=>{}));
    if(change==='actor')h.auth={...h.auth,user:{id:'actor-b'}};
    else if(change==='logout')h.auth={...h.auth,user:null};
    else if(change==='loading')h.auth={...h.auth,loading:true};
    else if(change==='replacement')h.auth={...h.auth,session:{access_token:'TEST_SESSION_B'}};
    else h.auth.session!.access_token='TEST_SESSION_B';
    rerender();expect(result.current.data).toBeUndefined();
    if(change==='logout'||change==='loading')expect(h.read.mock.calls.length+h.rpc.mock.calls.length).toBe(reads);
    else await waitFor(()=>expect(h.read.mock.calls.length+h.rpc.mock.calls.length).toBeGreaterThan(reads));
    const keys=JSON.stringify(client.getQueryCache().getAll().map(query=>query.queryKey));
    expect(keys).not.toContain('TEST_SESSION_A');expect(keys).not.toContain('TEST_SESSION_B');
   }finally{unmount();client.clear();}
  });
 }
});
describe('private F&B reads are actor scoped',()=>{
 beforeEach(()=>{h.auth={user:{id:'actor-a'},loading:false,session:{access_token:'TEST_SESSION_A'}};h.read.mockReset().mockResolvedValue({data:[{id:'private-order-a',club_id:'club-a'}],error:null});h.rpc.mockReset().mockResolvedValue({data:{tables:[{id:'private-table-a',table_name:'PRIVATE A'}],players:[]},error:null});h.removed.mockReset();});
 const hooks={useOrders:()=>useFnbOrders('club-a',['pending']),useServe:()=>useFnbServeQueue('club-a'),useKitchen:()=>useFnbKitchen('club-a'),useLinks:()=>useFnbLinkTargets('club-a')};
 for(const payload of [null,{}, {tables:[]}, {tables:{},players:[]}, {tables:[],players:null},
  {tables:[],players:[],unavailable_player_count:-1},{tables:[],players:[],unavailable_table_count:'1'},
  {tables:[],players:[],unavailable_player_count:null}]){
  it(`link targets rejects an unverified envelope ${JSON.stringify(payload)}`,async()=>{
   h.rpc.mockResolvedValue({data:payload,error:null});
   const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
   const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
   const {result,unmount}=renderHook(()=>useFnbLinkTargets('club-a'),{wrapper});
   try{
    await waitFor(()=>expect(result.current.isFetching).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
   }finally{unmount();client.clear();}
  });
 }
 it('preserves unavailable canonical identity counts instead of reporting an empty healthy club',async()=>{
  h.rpc.mockResolvedValue({data:{tables:[],players:[],unavailable_player_count:4,unavailable_table_count:2},error:null});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result,unmount}=renderHook(()=>useFnbLinkTargets('club-a'),{wrapper});
  try{await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data).toEqual({tables:[],players:[],unavailable_player_count:4,unavailable_table_count:2});}
  finally{unmount();client.clear();}
 });
 for(const [name,useRead] of Object.entries(hooks)){
  it(`${name} does not let an old-session refetch replace the verified new session`,async()=>{
   const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
   const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
   const {result,rerender,unmount}=renderHook(()=>useRead(),{wrapper});
   try{
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    let finishOld!:(value:unknown)=>void;
    const old=new Promise(resolve=>{finishOld=resolve;});
    h.read.mockImplementationOnce(()=>old);h.rpc.mockImplementationOnce(()=>old);
    let refresh!:ReturnType<typeof result.current.refetch>;
    act(()=>{refresh=result.current.refetch();});
    h.read.mockResolvedValue({data:[{id:'verified-new-session-order',club_id:'club-a'}],error:null});
    h.rpc.mockResolvedValue({data:{tables:[{id:'verified-new-session-table'}],players:[]},error:null});
    h.auth={...h.auth,session:{access_token:'TEST_SESSION_B'}};rerender();
    expect(result.current.data).toBeUndefined();
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    const verified=structuredClone(result.current.data);
    expect(JSON.stringify(verified)).toContain('verified-new-session');
    await act(async()=>{finishOld({data:name==='useLinks'?{tables:[{id:'late-old-session-table'}],players:[]}:[{id:'late-old-session-order',club_id:'club-a'}],error:null});await refresh;});
    expect(result.current.data).toEqual(verified);
   }finally{unmount();client.clear();}
  });
  it(`${name} surfaces a rejected new session without cached orders and can explicitly retry`,async()=>{
   const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
   const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
   const {result,rerender,unmount}=renderHook(()=>useRead(),{wrapper});
   try{
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    h.read.mockResolvedValue({data:null,error:{message:'TEST_NEW_SESSION_DENIED'}});
    h.rpc.mockResolvedValue({data:null,error:{message:'TEST_NEW_SESSION_DENIED'}});
    h.auth={...h.auth,session:{access_token:'TEST_SESSION_B'}};rerender();
    await waitFor(()=>expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    h.read.mockResolvedValue({data:[],error:null});h.rpc.mockResolvedValue({data:{tables:[],players:[]},error:null});
    await act(async()=>{await result.current.refetch();});
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(name==='useLinks'?{tables:[],players:[]}:[]);
   }finally{unmount();client.clear();}
  });
  for(const change of ['replacement','in-place']){
   it(`${name} invalidates a same-actor cached read on ${change} credential change`,async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
    const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const {result,rerender,unmount}=renderHook(()=>useRead(),{wrapper});
    try{
     await waitFor(()=>expect(result.current.isSuccess).toBe(true));
     const priorCalls=h.read.mock.calls.length+h.rpc.mock.calls.length;
     h.read.mockImplementation(()=>new Promise(()=>{}));h.rpc.mockImplementation(()=>new Promise(()=>{}));
     if(change==='replacement')h.auth={...h.auth,session:{access_token:'TEST_SESSION_B'}};
     else h.auth.session!.access_token='TEST_SESSION_B';
     rerender();
     expect(result.current.data).toBeUndefined();
     await waitFor(()=>expect(h.read.mock.calls.length+h.rpc.mock.calls.length).toBeGreaterThan(priorCalls));
     const keys=JSON.stringify(client.getQueryCache().getAll().map(query=>query.queryKey));
     expect(keys).not.toContain('TEST_SESSION_A');expect(keys).not.toContain('TEST_SESSION_B');
     if(name==='useServe'||name==='useKitchen')expect(h.removed).toHaveBeenCalled();
    }finally{unmount();client.clear();}
   });
  }
  for(const change of ['actor','logout','loading']){
   it(`${name} does not expose cached actor A data during ${change}`,async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const {result,rerender,unmount}=renderHook(()=>useRead(),{wrapper});
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data).toBeDefined();
    h.read.mockImplementation(()=>new Promise(()=>{}));h.rpc.mockImplementation(()=>new Promise(()=>{}));
    h.auth=change==='actor'?{...h.auth,user:{id:'actor-b'},loading:false}:change==='logout'?{...h.auth,user:null,loading:false}:{...h.auth,user:{id:'actor-a'},loading:true};
    rerender();expect(result.current.data).toBeUndefined();
    if(name==='useServe'||name==='useKitchen')expect(h.removed).toHaveBeenCalled();
    unmount();client.clear();
   });
  }
 }

 it('rejects unavailable F&B reports instead of marking a null payload successful',async()=>{
  h.rpc.mockResolvedValue({data:null,error:null});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const v=renderHook(()=>useFnbReport('club-a','2026-10-01T00:00:00+07:00','2026-11-01T00:00:00+07:00'),{wrapper});
  try{await waitFor(()=>expect(v.result.current.isFetching).toBe(false));expect(v.result.current.isError).toBe(true);expect(v.result.current.data).toBeUndefined();}finally{v.unmount();client.clear();}
 });
 it('refreshes F&B totals on an open report without relying on a mutation in the same browser',async()=>{
  vi.useFakeTimers();h.rpc.mockResolvedValue({data:{revenue:12345,cogs:34,grossProfit:12311,orderCount:1,statusCounts:{paid:1},topItems:[],lowStock:[],dailyTrend:[],compCount:0,compCogs:0,byTable:[],byPlayer:[]},error:null});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const v=renderHook(()=>useFnbReport('club-a','2026-10-01T00:00:00+07:00','2026-11-01T00:00:00+07:00'),{wrapper});
  try{await act(async()=>vi.advanceTimersByTimeAsync(1));expect(v.result.current.data?.revenue).toBe(12345);
   h.rpc.mockResolvedValue({data:{...v.result.current.data,revenue:22345,grossProfit:22311},error:null});
   await act(async()=>vi.advanceTimersByTimeAsync(5000));
   expect(v.result.current.data?.revenue).toBe(22345);
  }finally{v.unmount();client.clear();vi.useRealTimers();}
 });

 it.each(['topItems','lowStock','dailyTrend','byTable','byPlayer','statusCounts'])('rejects malformed nested report %s before the report UI consumes it',async(field)=>{
  const data={revenue:5000,cogs:2000,grossProfit:3000,orderCount:1,statusCounts:{paid:1},topItems:[],lowStock:[],dailyTrend:[],compCount:0,compCogs:0,byTable:[],byPlayer:[],[field]:field==='statusCounts'?{paid:null}:[null]};
  h.rpc.mockResolvedValue({data,error:null});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const v=renderHook(()=>useFnbReport('club-a','2026-10-01T00:00:00+07:00','2026-11-01T00:00:00+07:00'),{wrapper});
  try{await waitFor(()=>expect(v.result.current.isFetching).toBe(false));expect(v.result.current.isError).toBe(true);expect(v.result.current.data).toBeUndefined();}finally{v.unmount();client.clear();}
 });
});
