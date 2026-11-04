import {it,expect,vi} from 'vitest';
import {readPublicTable} from '../../supabase/functions/public-player-hud/table';
const tournament_id='10000000-0000-4000-8000-000000000001',table_id='50000000-0000-4000-8000-000000000001';
const input={mode:'table',tournament_id,table_id};
it('passes only the public table scope and preserves DB denial without fallback',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{access:'public',tableId:table_id,hand:{id:'fixture'}},error:null});
 expect(await readPublicTable({rpc},input)).toMatchObject({access:'public',tableId:table_id});
 expect(rpc).toHaveBeenLastCalledWith('get_public_tournament_table_live_or_last_hand_v2',{p_tournament_id:tournament_id,p_tournament_table_id:table_id});
 rpc.mockResolvedValue({data:{access:'revoked'},error:null});expect(await readPublicTable({rpc},input)).toEqual({access:'revoked'});
 rpc.mockResolvedValue({data:null,error:{message:'private'}});await expect(readPublicTable({rpc},input)).rejects.toThrow('PUBLIC_TABLE_UNAVAILABLE');expect(rpc).toHaveBeenCalledTimes(3);
});
it('rejects malformed scope, extra arguments and mismatched table replies',async()=>{
 const rpc=vi.fn();
 for(const body of [{...input,table_id:null},{...input,tournament_id:'bad'},{...input,player_id:table_id},{mode:'table',table_id}])await expect(readPublicTable({rpc},body)).rejects.toThrow('PUBLIC_TABLE_INPUT');
 expect(rpc).not.toHaveBeenCalled();rpc.mockResolvedValue({data:{access:'public',tableId:tournament_id},error:null});
 await expect(readPublicTable({rpc},input)).rejects.toThrow('PUBLIC_TABLE_SCOPE');
});
