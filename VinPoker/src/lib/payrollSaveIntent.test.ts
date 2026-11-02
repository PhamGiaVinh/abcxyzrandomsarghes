import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readPayrollSaveIntent,persistPayrollSaveIntent,clearPayrollSaveIntent,parsePayrollSaveReceipt} from './payrollSaveIntent';
const scope={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',year:2026,month:10};
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);});afterEach(()=>vi.unstubAllGlobals());
it('persists one nonce across reload without payroll rows or money',()=>{
 const first=persistPayrollSaveIntent(sessionStorage,scope);
 expect(readPayrollSaveIntent(sessionStorage,scope)).toEqual(first);
 expect(persistPayrollSaveIntent(sessionStorage,scope)).toEqual(first);
 expect(readPayrollSaveIntent(sessionStorage,{...scope,month:9})).toBeNull();
 expect(readPayrollSaveIntent(sessionStorage,{...scope,actorId:'33333333-3333-4333-8333-333333333333'})).toBeNull();
 expect(Object.keys(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).sort()).toEqual(['actorId','clubId','month','requestId','version','year']);
});
it('preserves corrupt evidence instead of generating another nonce',()=>{
 persistPayrollSaveIntent(sessionStorage,scope);const key=sessionStorage.key(0)!;sessionStorage.setItem(key,'CORRUPT');
 expect(()=>persistPayrollSaveIntent(sessionStorage,scope)).toThrow();expect(sessionStorage.getItem(key)).toBe('CORRUPT');
});
it('fails before mutation when storage cannot retain the nonce',()=>{
 expect(()=>persistPayrollSaveIntent({getItem:()=>null,setItem:()=>{}},scope)).toThrow('PAYROLL_INTENT_SAVE_FAILED');
});
it('clears only an exact terminal receipt for the pending intent',()=>{
 const intent=persistPayrollSaveIntent(sessionStorage,scope);
 const receipt={ok:true,outcome:'saved',requestId:intent.requestId,periodId:'44444444-4444-4444-8444-444444444444',clubId:scope.clubId,year:2026,month:10,savedCount:6};
 expect(()=>clearPayrollSaveIntent(sessionStorage,intent,null)).toThrow();
 expect(()=>clearPayrollSaveIntent(sessionStorage,intent,{...receipt,month:9})).toThrow();
 expect(readPayrollSaveIntent(sessionStorage,scope)).toEqual(intent);
 clearPayrollSaveIntent(sessionStorage,intent,receipt);expect(readPayrollSaveIntent(sessionStorage,scope)).toBeNull();
});
it('accepts cancellation without treating it as payroll saved',()=>{
 const intent=persistPayrollSaveIntent(sessionStorage,scope);
 const receipt={ok:true,outcome:'cancelled',requestId:intent.requestId,periodId:null,clubId:scope.clubId,year:2026,month:10,savedCount:0};
 expect(parsePayrollSaveReceipt(receipt,intent).outcome).toBe('cancelled');
 expect(()=>parsePayrollSaveReceipt({...receipt,periodId:'44444444-4444-4444-8444-444444444444'},intent)).toThrow();
 clearPayrollSaveIntent(sessionStorage,intent,receipt);
});
it('does not clear a replacement request from another action',()=>{
 const intent=persistPayrollSaveIntent(sessionStorage,scope);const key=sessionStorage.key(0)!;
 sessionStorage.setItem(key,JSON.stringify({...intent,requestId:'55555555-5555-4555-8555-555555555555'}));
 expect(()=>clearPayrollSaveIntent(sessionStorage,intent,{ok:true,outcome:'cancelled',requestId:intent.requestId,periodId:null,clubId:scope.clubId,year:2026,month:10,savedCount:0})).toThrow('PAYROLL_INTENT_CHANGED');
});
