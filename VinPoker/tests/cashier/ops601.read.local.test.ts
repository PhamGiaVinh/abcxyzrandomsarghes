import {expect,it,vi} from 'vitest';
import {createOps601Read} from './ops601.read.local.mjs';

it('does not intercept sign-in, mutations or unknown RPCs',()=>{
 const query=vi.fn();const reader=createOps601Read({query,club:'club',log:[]});
 for(const path of ['/auth/v1/token','/rest/v1/rpc/delete_last_action','/rest/v1/game_tables'])
  expect(reader.accepts(new URL('http://127.0.0.1'+path),'POST')).toBe(false);
 expect(query).not.toHaveBeenCalled();
});
it.each(['wrong-club','wrong-select'])('rejects scope/contract drift before any native query: %s',kind=>{
 const query=vi.fn();const reader=createOps601Read({query,club:'club',log:[]});
 const url=new URL('http://127.0.0.1/rest/v1/game_tables');
 url.searchParams.set('club_id',kind==='wrong-club'?'eq.other':'eq.club');
 url.searchParams.set('select',kind==='wrong-select'?'*':'id,table_name,status,current_blind_level');
 expect(()=>reader.handle(url,'GET',{})).toThrow();expect(query).not.toHaveBeenCalled();
});
it('keeps the shared inventory RPC exact-scoped',()=>{
 const query=vi.fn(()=>[]);const reader=createOps601Read({query,club:'club',log:[]});
 const url=new URL('http://127.0.0.1/rest/v1/rpc/get_club_table_inventory');
 expect(()=>reader.handle(url,'POST',{p_club_id:'other'})).toThrow();expect(query).not.toHaveBeenCalled();
 expect(reader.handle(url,'POST',{p_club_id:'club'})).toEqual({value:[]});
 expect(query).toHaveBeenCalledOnce();
});
