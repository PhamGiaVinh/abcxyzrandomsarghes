import {expect,it,vi} from 'vitest';
import {createTournament,updateTournament,type OpsClient} from './opsMutations';
const id='10010000-0000-4000-8000-000000000001';
const input={clubId:'10010000-0000-4000-8000-000000000002',name:'TEST',startTime:'2026-10-19T17:32:41.520568+07:00',buyIn:100000,startingStack:20000,minutesPerLevel:20,lateRegCloseLevel:6};
const client=(data:unknown,error:unknown=null)=>{
 const rpc=vi.fn().mockResolvedValue({data,error});
 return {rpc,testRpc:rpc} as unknown as OpsClient & {testRpc:typeof rpc};
};
it.each([null,[],{},{ok:true},{success:true,tournament_id:id},{ok:true,tournament_id:'bad-id'}])('does not acknowledge an unverified create/update result %j',async(data)=>{
 await expect(createTournament(client(data),input)).rejects.toThrow();
 await expect(updateTournament(client(data),id,input)).rejects.toThrow();
});
it('rejects an update confirmation for another tournament',async()=>{
 await expect(updateTournament(client({ok:true,tournament_id:input.clubId}),id,input)).rejects.toThrow();
});
it('accepts the exact native result and preserves timestamp precision in the sent intent',async()=>{
 const c=client({ok:true,tournament_id:id});
 await expect(createTournament(c,input)).resolves.toEqual({ok:true,tournament_id:id});
 await expect(updateTournament(c,id,input)).resolves.toEqual({ok:true,tournament_id:id});
 for(const [,args] of c.testRpc.mock.calls)expect(args).toEqual(expect.objectContaining({p_start_time:input.startTime}));
});
it('keeps transport and explicit business failure as errors',async()=>{
 await expect(createTournament(client(null,{message:'HTTP unavailable'}),input)).rejects.toThrow('HTTP unavailable');
 await expect(updateTournament(client({ok:false,error:'tournament_not_open'}),id,input)).rejects.toThrow('tournament_not_open');
});
