import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@/integrations/supabase/client',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 return {supabase:createClient('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(...args)=>h.fetch(...args)}})};
});
vi.mock('@/lib/onlinePoker/types',async original=>({...await original<typeof import('@/lib/onlinePoker/types')>(),RUNTIME_LIVE:true}));
import {listTablesLive,loadHandStateLive,loadTableMetaLive,loadBuyinsLive,onlinePokerClient} from '@/lib/onlinePoker/client';
beforeEach(()=>{h.fetch.mockReset();});
it('does not turn a failed buy-in ledger read into an empty history',async()=>{
 h.fetch.mockResolvedValue(new Response(JSON.stringify({message:'LOCAL_BUYINS_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json'}}));
 await expect(loadBuyinsLive('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({code:'buyins_load_failed'});
});
it('accepts a verified empty buy-in ledger without a profiles query',async()=>{
 h.fetch.mockResolvedValue(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));
 await expect(loadBuyinsLive('11111111-1111-4111-8111-111111111111')).resolves.toEqual([]);
 expect(h.fetch).toHaveBeenCalledTimes(1);
});
it('sends a caller-owned create key and resolves it through a read-only Edge operation',async()=>{
 const key='8bebc4cd-2246-4835-b006-d62d191618bb';
 const actor='63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43';
 const payload={name:'TEST',sb:'25',bb:'50',buyin:'5000',maxSeats:9};
 const receipt={outcome:'ok',request_id:key,replayed:false,table_id:'e217f4bd-d708-4ea5-93c3-f64371a8afff',seat_no:1};
 const bodies:Record<string,unknown>[]=[];
 h.fetch.mockImplementation(async(_url:unknown,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));bodies.push(body);
  return new Response(JSON.stringify(body.op==='get_create_receipt'?{outcome:'found',request_id:key,payload:{...payload,sb:25,bb:50,buyin:5000},receipt}:receipt),{status:200,headers:{'Content-Type':'application/json'}});
 });
 expect(await onlinePokerClient.createOpenTableWithRequest(payload,key,actor)).toEqual(receipt);
 expect(await onlinePokerClient.getCreateReceipt(payload,key,actor)).toEqual({state:'resolved',receipt});
 expect(bodies).toEqual([{op:'create_open_table',...payload,requestId:key,expectedActorId:actor},{op:'get_create_receipt',requestId:key,expectedActorId:actor}]);
 expect(h.fetch).toHaveBeenCalledTimes(2);
});
it('does not turn a failed seat-count read into zero players at every open table',async()=>{
 h.fetch.mockImplementation(async(url:unknown)=>String(url).includes('/online_poker_seats')
  ?new Response(JSON.stringify({message:'LOCAL_SEAT_READ_UNAVAILABLE'}),{status:403,headers:{'Content-Type':'application/json'}})
  :new Response(JSON.stringify([{id:'11111111-1111-4111-8111-111111111111',name:'TEST open table',sb:100,bb:200,max_seats:9,status:'open'}]),{status:200,headers:{'Content-Type':'application/json'}}));
 await expect(listTablesLive()).rejects.toMatchObject({code:'seats_load_failed',message:'LOCAL_SEAT_READ_UNAVAILABLE'});
});
it('accepts a successfully verified empty seat list as zero players',async()=>{
 h.fetch.mockImplementation(async(url:unknown)=>new Response(JSON.stringify(String(url).includes('/online_poker_seats')?[]:
  [{id:'11111111-1111-4111-8111-111111111111',name:'TEST open table',sb:100,bb:200,max_seats:9,status:'open'}]),{status:200,headers:{'Content-Type':'application/json'}}));
 const tables=await listTablesLive();expect(tables).toHaveLength(1);expect(tables[0].seatedCount).toBe(0);
});
it('passes the same lobby cancellation to both actual SDK rail reads',async()=>{
 const sent:AbortSignal[]=[];
 h.fetch.mockImplementation((_url:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{
  const signal=init.signal as AbortSignal;sent.push(signal);
  signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 }));
 const controller=new AbortController();
 const outcome=expect(listTablesLive(controller.signal)).rejects.toMatchObject({code:'tables_load_failed'});
 for(let i=0;i<40&&sent.length<2;i++)await Promise.resolve();
 expect(sent).toEqual([controller.signal,controller.signal]);controller.abort();await outcome;
 expect(h.fetch).toHaveBeenCalledTimes(2);
});
it.each(['hand','metadata'])('passes %s read abort through the actual Supabase PostgREST client without making an external request',async(kind)=>{
 let sent:AbortSignal|undefined;
 h.fetch.mockImplementation((_url:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{
  sent=init.signal as AbortSignal;sent.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 }));
 const controller=new AbortController();const id='11111111-1111-4111-8111-111111111111';
 const outcome=kind==='hand'?expect(loadHandStateLive(id,controller.signal)).rejects.toMatchObject({code:'hand_load_failed'})
  :expect(loadTableMetaLive(id,controller.signal)).resolves.toBeNull();
 // Await the SDK's microtask before abort, never sleep or open a real socket.
 for(let i=0;i<20&&!sent;i++)await Promise.resolve();
 expect(sent).toBe(controller.signal);controller.abort();await outcome;expect(h.fetch).toHaveBeenCalledTimes(1);
});
