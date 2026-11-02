import {beforeEach,expect,it,vi} from 'vitest';
import {pendingStakingRefunds,persistStakingRefundIntent,clearStakingRefundIntent} from './stakingRefundIntent';
const actor='e5310000-0000-4000-8000-000000000001',deal='e5310000-0000-4000-8000-000000000002';
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
it('persists and reuses the identical actor/deal/reason request after reload',()=>{
 const first=persistStakingRefundIntent(actor,deal,'club',' TEST ');
 expect(pendingStakingRefunds(actor)).toEqual([first]);expect(persistStakingRefundIntent(actor,deal,'club','TEST')).toEqual(first);
 expect(()=>persistStakingRefundIntent(actor,deal,'club','OTHER')).toThrow();
 expect(pendingStakingRefunds(deal)).toEqual([]);clearStakingRefundIntent(first);expect(pendingStakingRefunds(actor)).toEqual([]);
});
it('does not overwrite corrupt or changed evidence',()=>{
 const first=persistStakingRefundIntent(actor,deal,'club','TEST');
 localStorage.setItem(`vinpoker:staking-refund:v1:${actor}:${deal}`,'corrupt');
 expect(()=>persistStakingRefundIntent(actor,deal,'club','TEST')).toThrow();expect(()=>clearStakingRefundIntent(first)).toThrow();
 expect(localStorage.getItem(`vinpoker:staking-refund:v1:${actor}:${deal}`)).toBe('corrupt');
});
it('fails before invoking when durable storage is unavailable',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL quota');});
 expect(()=>persistStakingRefundIntent(actor,deal,'club','TEST')).toThrow();expect(pendingStakingRefunds(actor)).toEqual([]);
});
