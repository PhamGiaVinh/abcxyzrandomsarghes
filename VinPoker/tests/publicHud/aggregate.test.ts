import {describe,it,expect,vi} from 'vitest';
import {readPublicHudAggregate} from '../../supabase/functions/public-player-hud/aggregate';
import {emptyPublicHudCounters} from '../../supabase/functions/_shared/publicHudContribution';
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
describe('aggregate public HUD adapter',()=>{
  it('uses exactly one prepared summary RPC and calculates ratios from counters',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{access:'public',state:'current',tournamentId:tour,playerId:player,counters:emptyPublicHudCounters()},error:null});
    const value=await readPublicHudAggregate({rpc},tour,player,'summary');
    expect(rpc).toHaveBeenCalledTimes(1);expect(value.analytics.metrics.vpip.percentage).toBeNull();
    expect(rpc.mock.calls[0][0]).toBe('get_public_player_hud_summary_v1');
  });
  it('never disguises warming or withdrawn access as zero hands',async()=>{
    for(const data of [{access:'public',state:'warming'},{access:'revoked'}]){
      const rpc=vi.fn().mockResolvedValue({data,error:null});
      expect(await readPublicHudAggregate({rpc},tour,player,'summary')).toEqual(data);
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects stale scope and malformed counters',async()=>{
    for(const data of [
      {access:'public',state:'current',tournamentId:player,playerId:player},
      {access:'public',state:'current',tournamentId:tour,playerId:player,counters:{}},
    ])await expect(readPublicHudAggregate({rpc:async()=>({data,error:null})},tour,player,'summary')).rejects.toThrow();
  });
  it('accepts a null-timestamp keyset cursor and rejects an invalid cursor before RPC',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{access:'public',state:'current',tournamentId:tour,playerId:player,handHistory:[],nextCursor:null},error:null});
    await readPublicHudAggregate({rpc},tour,player,'history',{playedAt:null,handId:player});
    expect(rpc.mock.calls[0][1]).toMatchObject({p_after_time:null,p_after_hand:player});
    rpc.mockClear();
    await expect(readPublicHudAggregate({rpc},tour,player,'history',{playedAt:'bad',handId:player})).rejects.toThrow('PUBLIC_CURSOR_INVALID');
    expect(rpc).not.toHaveBeenCalled();
  });
});
