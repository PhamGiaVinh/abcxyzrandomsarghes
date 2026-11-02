import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearGroupInviteIntent, persistGroupInviteIntent, readGroupInviteIntent } from './groupInviteIntent';
const group='33333333-3333-4333-8333-333333333333';
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>vi.unstubAllGlobals());
it('persists one scoped request without storing the raw bearer token',async()=>{
 const token='LOCAL_SECRET_INVITE_VALUE';const first=await persistGroupInviteIntent(sessionStorage,'actor-a',token,group);
 expect(await persistGroupInviteIntent(sessionStorage,'actor-a',token,group)).toEqual(first);
 expect(await readGroupInviteIntent(sessionStorage,'actor-b',token)).toBeNull();
 expect(await readGroupInviteIntent(sessionStorage,'actor-a','OTHER_TOKEN')).toBeNull();
 expect(sessionStorage.key(0)).not.toContain(token);expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain(token);
 clearGroupInviteIntent(sessionStorage,first);expect(await readGroupInviteIntent(sessionStorage,'actor-a',token)).toBeNull();
});
it('rejects group changes and preserves corrupt recovery evidence',async()=>{
 await persistGroupInviteIntent(sessionStorage,'actor-a','TOKEN',group);
 await expect(persistGroupInviteIntent(sessionStorage,'actor-a','TOKEN','44444444-4444-4444-8444-444444444444')).rejects.toThrow('INVITE_INTENT_PENDING');
 const key=sessionStorage.key(0)!;sessionStorage.setItem(key,'CORRUPT');
 await expect(readGroupInviteIntent(sessionStorage,'actor-a','TOKEN')).rejects.toThrow();expect(sessionStorage.getItem(key)).toBe('CORRUPT');
});
it('does not claim persistence when storage drops the write',async()=>{
 await expect(persistGroupInviteIntent({getItem:()=>null,setItem:()=>{}},'actor-a','TOKEN',group)).rejects.toThrow('INVITE_INTENT_SAVE_FAILED');
});
