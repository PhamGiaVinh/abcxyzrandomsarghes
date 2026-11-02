import { act,cleanup,renderHook } from '@testing-library/react';
import { QueryClient,QueryClientProvider,useQuery } from '@tanstack/react-query';
import { afterEach,expect,it,vi } from 'vitest';
import type {PropsWithChildren} from 'react';
import {contextQueryOptions} from './opsIntelligenceContextQuery';
const club='11111111-1111-4111-8111-111111111111';const clients:QueryClient[]=[];
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();});
const packet=(asOf='2026-10-31T00:00:00.000Z')=>({version:'ops-intelligence-context-v1',clubId:club,asOf,dailyTournaments:[],festivals:[]});
function mount(rpc:ReturnType<typeof vi.fn>){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
 const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 return renderHook(()=>useQuery(contextQueryOptions({rpc} as unknown as Parameters<typeof contextQueryOptions>[0],club)),{wrapper});}
it('updates the available tournament context without navigating away',async()=>{
 vi.useFakeTimers();const rpc=vi.fn().mockResolvedValue({data:packet(),error:null});const view=mount(rpc);
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(view.result.current.data?.value.asOf).toBe('2026-10-31T00:00:00.000Z');
 rpc.mockResolvedValue({data:packet('2026-10-31T00:00:05.000Z'),error:null});
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(view.result.current.data?.value.asOf).toBe('2026-10-31T00:00:05.000Z');
});
it('recovers a hung context read and does not accept its late payload',async()=>{
 vi.useFakeTimers();let late!:(v:unknown)=>void;
 const rpc=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;})).mockResolvedValue({data:packet('2026-10-31T00:00:15.000Z'),error:null});
 const view=mount(rpc);await act(async()=>vi.advanceTimersByTimeAsync(16001));expect(rpc.mock.calls.length).toBeGreaterThan(1);
 expect(view.result.current.data?.value.asOf).toBe('2026-10-31T00:00:15.000Z');
 await act(async()=>late({data:packet(),error:null}));expect(view.result.current.data?.value.asOf).toBe('2026-10-31T00:00:15.000Z');
});
