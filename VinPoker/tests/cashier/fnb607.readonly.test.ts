import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createFnb384Kitchen} from './fnb384.kitchen-browser.local.mjs';
const f={actor:'actor',club:'club',tour:'tour',order:'order',ingredient:'ingredient',lines:['line']};
beforeEach(()=>{
 vi.stubEnv('VINPOKER_FNB385_READONLY','1');vi.stubEnv('VINPOKER_FNB607_SESSION_READ','1');
 vi.stubEnv('VINPOKER_FNB607_EXPECTED_FACTS','b'.repeat(32));
});
afterEach(()=>vi.unstubAllEnvs());
function setup(){
 let full='c'.repeat(32);
 const sql=vi.fn((input:string)=>{
  if(input==='SELECT fixture FROM floor_private.fnb384_fixture;')return JSON.stringify(f);
  if(input.includes('FROM pg_proc'))return '31b85897c490845913ab864bdfd5320c';
  if(input.includes('SELECT on_hand'))return '7';
  if(input.startsWith('SELECT md5('))return input.includes(' WHERE ')?'b'.repeat(32):full;
  throw Error('unexpected test SQL');
 });
 const query=vi.fn(()=>[]);
 const create=()=>createFnb384Kitchen({sql,query,log:[],fixture:{tour:f.tour,club:f.club},actor:f.actor});
 return{create,query,setFull:(value:string)=>{full=value;}};
}
it('requires read-only mode before a session probe can initialize',()=>{
 vi.stubEnv('VINPOKER_FNB385_READONLY','0');expect(()=>setup().create()).toThrow('session probe must be read-only');
});
it('requires the explicitly observed current facts rather than ignoring a historical guard',()=>{
 vi.stubEnv('VINPOKER_FNB607_EXPECTED_FACTS','a'.repeat(32));expect(()=>setup().create()).toThrow();
});
it('keeps the legacy historical guard when the new read-only mode is absent',()=>{
 vi.stubEnv('VINPOKER_FNB607_SESSION_READ','0');expect(()=>setup().create()).toThrow();
});
it('never exposes shipping and does not execute a shipping RPC',()=>{
 const s=setup(),b=s.create();expect(b.paths).not.toContain('/rest/v1/rpc/fnb_mark_shipped');
 expect(()=>b.handle(new URL('http://127.0.0.1/rest/v1/rpc/fnb_mark_shipped'),'POST',{p_order_id:'order',p_line_id:null})).toThrow('layout review cannot ship');
 expect(s.query).not.toHaveBeenCalled();
});
it('injects a queue fault only after the actual read seam, then can recover',()=>{
 const s=setup(),b=s.create();const url=new URL('http://127.0.0.1/rest/v1/fnb_orders?select=*&club_id=eq.club&status=eq.paid&order=paid_at.asc&limit=100');
 b.setQueueFault(true);expect(b.handle(url,'GET',{}).status).toBe(503);expect(s.query).toHaveBeenCalledOnce();
 b.setQueueFault(false);expect(b.handle(url,'GET',{}).value).toEqual([]);b.verify();
});
it('detects changes even inside the previously excluded fixture rows',()=>{
 const s=setup(),b=s.create();s.setFull('d'.repeat(32));expect(()=>b.verify()).toThrow();
});
