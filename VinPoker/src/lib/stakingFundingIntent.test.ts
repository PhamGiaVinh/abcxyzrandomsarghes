import {beforeEach,expect,it,vi} from 'vitest';
import {clearStakingFundingIntent,pendingStakingFunding,persistStakingFundingIntent} from './stakingFundingIntent';
const actor='e5620000-0000-4000-8000-000000000001',purchase='e5620000-0000-4000-8000-000000000002';
const intent={actor_id:actor,purchase_id:purchase,club_id:'LOCAL_CLUB',reference:'LOCAL562'};
beforeEach(()=>localStorage.clear());
it('persists the exact actor/purchase without generating a new monetary request identity',()=>{
 expect(persistStakingFundingIntent(intent)).toEqual(intent);expect(persistStakingFundingIntent(intent)).toEqual(intent);
 expect(localStorage.length).toBe(1);expect(pendingStakingFunding(actor)).toEqual([intent]);
 expect(pendingStakingFunding('e5620000-0000-4000-8000-000000000003')).toEqual([]);
});
it('keeps the existing intent when another club payload conflicts',()=>{
 persistStakingFundingIntent(intent);expect(()=>persistStakingFundingIntent({...intent,club_id:'OTHER'})).toThrow();expect(pendingStakingFunding(actor)).toEqual([intent]);
});
it('preserves corrupt recovery evidence and fails closed',()=>{
 localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,'INVALID');expect(()=>pendingStakingFunding(actor)).toThrow();expect(localStorage.length).toBe(1);
});
it('rejects a foreign actor embedded in the actor namespace',()=>{
 localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,JSON.stringify({...intent,actor_id:purchase}));expect(()=>pendingStakingFunding(actor)).toThrow();
});
it('does not clear an intent replaced since it was read',()=>{
 persistStakingFundingIntent(intent);localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,JSON.stringify({...intent,reference:'CHANGED'}));expect(()=>clearStakingFundingIntent(intent)).toThrow();expect(localStorage.length).toBe(1);
});
it('clears only an exact verified intent',()=>{
 persistStakingFundingIntent(intent);clearStakingFundingIntent(intent);expect(pendingStakingFunding(actor)).toEqual([]);
});
it('preserves an explicit null club for server-authorized global Admin deals, without inventing a club',()=>{
 expect(persistStakingFundingIntent({...intent,club_id:null}).club_id).toBeNull();
 expect(()=>persistStakingFundingIntent(intent)).toThrow();expect(pendingStakingFunding(actor)[0].club_id).toBeNull();
});
it('surfaces storage failure before any consumer can submit',()=>{
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL quota');});try{expect(()=>persistStakingFundingIntent(intent)).toThrow();}finally{spy.mockRestore();}
});
it('rejects a storage implementation that silently drops the pending intent',()=>{
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});
 try{expect(()=>persistStakingFundingIntent(intent)).toThrow('Chưa gửi xác nhận tiền');expect(localStorage.length).toBe(0);}finally{spy.mockRestore();}
});
it('does not report evidence cleared when storage silently retains it',()=>{
 persistStakingFundingIntent(intent);
 const spy=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{});
 try{expect(()=>clearStakingFundingIntent(intent)).toThrow('Không xóa được');expect(pendingStakingFunding(actor)).toEqual([intent]);}finally{spy.mockRestore();}
});
it('surfaces unavailable storage reads without deleting evidence',()=>{
 persistStakingFundingIntent(intent);
 const spy=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('LOCAL storage denied');});
 try{expect(()=>pendingStakingFunding(actor)).toThrow('LOCAL storage denied');}finally{spy.mockRestore();}
 expect(pendingStakingFunding(actor)).toEqual([intent]);
});
