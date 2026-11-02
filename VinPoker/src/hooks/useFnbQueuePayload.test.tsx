import {renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor-a'},loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:(table:string)=>{const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,
 then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>h.read(table).then(resolve,reject)};return q;},
 channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn(),
}}));
import {useFnbOrders} from './useFnbOrders';
import {useFnbServeQueue} from './useFnbServe';
import {useFnbKitchen} from './useFnbKitchen';

describe('F&B queue response integrity',()=>{
 beforeEach(()=>h.read.mockReset());
 const hooks={useCounter:()=>useFnbOrders('club-a',['pending']),useServe:()=>useFnbServeQueue('club-a'),useKitchen:()=>useFnbKitchen('club-a')};
 for(const [name,useRead] of Object.entries(hooks)){
  for(const stage of ['orders','items'])it(`${name}: null ${stage} is an error, explicit retry can recover`,async()=>{
   let broken=true;
   h.read.mockImplementation(async(table:string)=>({data:broken&&table===`fnb_order${stage==='items'?'_items':'s'}`?null:
    table==='fnb_orders'?[{id:'order-a',club_id:'club-a'}]:[],error:null}));
   const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
   const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
   const {result,unmount}=renderHook(()=>useRead(),{wrapper});
   try{
    await waitFor(()=>expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    broken=false;await result.current.refetch();
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{id:'order-a',club_id:'club-a',items:[]}]);
   }finally{unmount();client.clear();}
  });
  it(`${name}: successful empty array is genuinely empty`,async()=>{
   h.read.mockResolvedValue({data:[],error:null});
   const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
   const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
   const {result,unmount}=renderHook(()=>useRead(),{wrapper});
   try{await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data).toEqual([]);expect(h.read).toHaveBeenCalledTimes(1);}
   finally{unmount();client.clear();}
  });
 }
});
