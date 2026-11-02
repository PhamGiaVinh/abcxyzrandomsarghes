import {beforeEach,expect,it,vi} from 'vitest';
import {pendingListingArchives,persistListingArchive,clearListingArchive,assertListingArchiveReceipt} from './stakingListingArchiveIntent';
const actor='e5730000-0000-4000-8000-000000000001',deal='e5730000-0000-4000-8000-000000000002';
const intent={actor_id:actor,deal_id:deal,expected_review:'rejected' as const};
const key=`vinpoker:staking-listing-archive:v1:${actor}:${deal}`;
beforeEach(()=>localStorage.clear());
it('persists/replays one exact actor/deal/review intent without a new request identity',()=>{
 expect(persistListingArchive(intent)).toEqual(intent);expect(persistListingArchive(intent)).toEqual(intent);expect(pendingListingArchives(actor)).toEqual([intent]);expect(localStorage.length).toBe(1);expect(pendingListingArchives(deal)).toEqual([]);
});
it('rejects review-payload drift and preserves original evidence',()=>{
 persistListingArchive(intent);expect(()=>persistListingArchive({...intent,expected_review:'approved'})).toThrow();expect(pendingListingArchives(actor)).toEqual([intent]);
});
it.each(['CORRUPT',JSON.stringify({...intent,actor_id:deal})])('preserves corrupt or foreign-actor data %s',encoded=>{
 localStorage.setItem(key,encoded);expect(()=>pendingListingArchives(actor)).toThrow();expect(localStorage.getItem(key)).toBe(encoded);
});
it('clears only the exact unchanged intent',()=>{
 persistListingArchive(intent);localStorage.setItem(key,JSON.stringify({...intent,expected_review:'approved'}));expect(()=>clearListingArchive(intent)).toThrow();expect(localStorage.length).toBe(1);
 localStorage.setItem(key,JSON.stringify(intent));clearListingArchive(intent);expect(localStorage.length).toBe(0);
});
it('rejects a silent storage write failure',()=>{
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});try{expect(()=>persistListingArchive(intent)).toThrow('Chưa gửi');}finally{spy.mockRestore();}
});
it('does not claim cleared evidence if removal fails silently',()=>{
 persistListingArchive(intent);const spy=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{});try{expect(()=>clearListingArchive(intent)).toThrow();expect(localStorage.length).toBe(1);}finally{spy.mockRestore();}
});
it.each([null,{}, {success:true,deal_id:actor,status:'cancelled',archived:true},{success:true,deal_id:deal,status:'listing',archived:true},
 {success:true,deal_id:deal,status:'cancelled',archived:true,error:'denied'}])('does not verify receipt %j',value=>expect(()=>assertListingArchiveReceipt(value,deal)).toThrow());
it('verifies only the matching canonical archive receipt',()=>expect(assertListingArchiveReceipt({success:true,deal_id:deal,status:'cancelled',archived:true},deal).archived).toBe(true));
it('does not accept a matching but malformed deal identity',()=>expect(()=>assertListingArchiveReceipt({success:true,deal_id:'not-a-uuid',status:'cancelled',archived:true},'not-a-uuid')).toThrow());
