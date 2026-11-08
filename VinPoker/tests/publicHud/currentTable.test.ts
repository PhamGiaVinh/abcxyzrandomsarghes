import {expect,it,vi} from 'vitest';
import {readPublicCurrentTable} from '../../supabase/functions/public-player-hud/currentTable';
const tour='10000000-0000-4000-8000-000000000001',table='50000000-0000-4000-8000-000000000001';
const input={mode:'current_table',tournament_id:tour,table_id:table};
it.each(['live','last_completed','waiting','inactive','closed'])('preserves canonical %s table state and only sends public scope',async state=>{
 const value={access:'public',tableId:table,state,tableSessionId:'session',hand:null};
 const rpc=vi.fn().mockResolvedValue({data:value,error:null});
 expect(await readPublicCurrentTable({rpc},input)).toEqual(value);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('get_public_tournament_table_live_or_last_hand_v2',{p_tournament_id:tour,p_tournament_table_id:table});
});
it.each([null,[],{...input,table_id:'invalid'},{...input,tournament_id:'invalid'},
 {...input,actor:'private'},{...input,table_session_id:table},{...input,mode:'summary'}])('rejects malformed or widened scope before calling DB',async value=>{
 const rpc=vi.fn();await expect(readPublicCurrentTable({rpc},value)).rejects.toThrow('PUBLIC_TABLE_SCOPE_INVALID');expect(rpc).not.toHaveBeenCalled();
});
it('keeps withdrawal and table removal distinct from empty public data',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{access:'revoked',privateUnexpected:'withheld'},error:null})
  .mockResolvedValueOnce({data:{error:'table_out_of_scope'},error:null});
 expect(await readPublicCurrentTable({rpc},input)).toEqual({access:'revoked'});
 expect(await readPublicCurrentTable({rpc},input)).toEqual({error:'table_out_of_scope'});
});
it.each([{data:null,error:{code:'42501'}},{data:null,error:null},{data:[],error:null},
 {data:{access:'public',state:'live',tableId:tour},error:null},
 {data:{access:'public',state:'live',tableId:table,tournamentId:table},error:null},
 {data:{access:'public',state:'unknown',tableId:table},error:null}])('fails closed on RPC failure or mismatched response',async reply=>{
 const rpc=vi.fn().mockResolvedValue(reply);await expect(readPublicCurrentTable({rpc},input)).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(1);
});
