import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {StrictMode,type ReactNode} from 'react';
const h=vi.hoisted(()=>({rpc:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('sonner',()=>({toast:{error:h.error}}));
import {useChipSetupMetadata} from './useChipSetupMetadata';
import {createChipSetupWriteGate} from '@/lib/chipSetupWriteGate';
import {persistChipSetupMetadataIntent,readChipSetupMetadataIntent,type ChipSetupMetadataIntent} from '@/lib/chipSetupMetadataIntent';
const scope={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',tournamentId:'33333333-3333-4333-8333-333333333333'},set='44444444-4444-4444-8444-444444444444',denom='55555555-5555-4555-8555-555555555555';
const payload={operation:'delete' as const,chip_set_id:set,denomination_id:denom};
const receipt=(i:ChipSetupMetadataIntent,outcome='applied')=>({status:outcome==='rejected'?'rejected':'ok',outcome,actor_id:i.actorId,club_id:i.clubId,tournament_id:i.tournamentId,request_id:i.requestId,payload:i.payload,error:outcome==='rejected'?'DENOM_IN_USE':null,result:outcome==='applied'?{status:'ok',denomination_id:denom}:null});
const options=()=>({scope,busy:false,acquireWrite:createChipSetupWriteGate(vi.fn()),onPendingChange:vi.fn(),onResolved:vi.fn()});
beforeEach(()=>{sessionStorage.clear();vi.restoreAllMocks();vi.clearAllMocks();h.rpc.mockResolvedValue({data:null,error:null});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('persists before one RPC, synchronously fences duplicates and clears only an exact receipt',async()=>{
 const p=options();let finish!:(v:unknown)=>void;h.rpc.mockImplementation(()=>{expect(readChipSetupMetadataIntent(sessionStorage,scope)).not.toBeNull();return new Promise(resolve=>{finish=resolve;});});
 const hook=renderHook(()=>useChipSetupMetadata(p));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
 act(()=>{hook.result.current.submit(payload);hook.result.current.submit(payload);});expect(h.rpc).toHaveBeenCalledTimes(1);
 const i=readChipSetupMetadataIntent(sessionStorage,scope)!;await act(async()=>finish({data:receipt(i),error:null}));expect(p.onResolved).toHaveBeenCalledTimes(1);expect(readChipSetupMetadataIntent(sessionStorage,scope)).toBeNull();
});
it('reloads an unresolved journal and looks up without creating a new mutation',async()=>{
 const i=persistChipSetupMetadataIntent(sessionStorage,scope,payload),p=options();h.rpc.mockResolvedValue({data:receipt(i),error:null});
 renderHook(()=>useChipSetupMetadata(p));await waitFor(()=>expect(p.onResolved).toHaveBeenCalledTimes(1));expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.rpc.mock.calls[0][0]).toBe('get_chip_setup_metadata_receipt_v1');expect(h.rpc.mock.calls[0][1].p_request_id).toBe(i.requestId);
});
it('unknown lookup keeps original payload for explicit retry and cancellation',async()=>{
 const i=persistChipSetupMetadataIntent(sessionStorage,scope,payload),p=options(),hook=renderHook(()=>useChipSetupMetadata(p));await waitFor(()=>expect(hook.result.current.error).toBeTruthy());
 act(()=>hook.result.current.retry());await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(2));
 expect(h.rpc.mock.calls[1][1]).toEqual(h.rpc.mock.calls[0][1]);expect(readChipSetupMetadataIntent(sessionStorage,scope)).toEqual(i);
 h.rpc.mockResolvedValue({data:receipt(i,'cancelled'),error:null});act(()=>hook.result.current.cancel());await waitFor(()=>expect(p.onResolved).toHaveBeenCalledTimes(1));expect(readChipSetupMetadataIntent(sessionStorage,scope)).toBeNull();
});
it('does not persist when another Setup writer owns the lock',async()=>{
 const p=options(),release=p.acquireWrite()!,hook=renderHook(()=>useChipSetupMetadata(p));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
 act(()=>hook.result.current.submit(payload));expect(h.rpc).not.toHaveBeenCalled();expect(readChipSetupMetadataIntent(sessionStorage,scope)).toBeNull();release();
});
it('late actor A receipt cannot resolve the actor B UI or clear actor A journal',async()=>{
 const p=options();let finish!:(v:unknown)=>void;h.rpc.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(props=>useChipSetupMetadata(props),{initialProps:p});await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>hook.result.current.submit(payload));const i=readChipSetupMetadataIntent(sessionStorage,scope)!;
 hook.rerender({...p,scope:{...scope,actorId:denom}});await act(async()=>finish({data:receipt(i),error:null}));expect(p.onResolved).not.toHaveBeenCalled();expect(readChipSetupMetadataIntent(sessionStorage,scope)).toEqual(i);
});
it('disposed StrictMode lookup cannot clear a newer effect lifetime',async()=>{
 const p=options(),i=persistChipSetupMetadataIntent(sessionStorage,scope,payload);let finish!:(v:unknown)=>void;h.rpc.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({data:null,error:{code:'503'}});
 const wrapper=({children}:{children:ReactNode})=><StrictMode>{children}</StrictMode>;
 const hook=renderHook(()=>useChipSetupMetadata(p),{wrapper});await waitFor(()=>expect(hook.result.current.error).toBeTruthy());expect(h.rpc).toHaveBeenCalledTimes(2);
 await act(async()=>finish({data:receipt(i),error:null}));expect(p.onResolved).not.toHaveBeenCalled();expect(readChipSetupMetadataIntent(sessionStorage,scope)).toEqual(i);
});
it('blocks writes when the journal is corrupted rather than forgetting the request',async()=>{
 const p=options();vi.spyOn(Storage.prototype,'getItem').mockReturnValue('{broken');const hook=renderHook(()=>useChipSetupMetadata(p));await waitFor(()=>expect(hook.result.current.error).toBeTruthy());
 act(()=>hook.result.current.submit(payload));expect(h.rpc).not.toHaveBeenCalled();expect(p.onPendingChange).toHaveBeenLastCalledWith(true);
});
