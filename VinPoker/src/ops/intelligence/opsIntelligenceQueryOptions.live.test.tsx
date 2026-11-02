import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
const f=vi.hoisted(()=>({pulse:vi.fn(),operations:vi.fn(),registration:vi.fn(),sepay:vi.fn()}));
vi.mock('@/lib/series-intelligence/seriesClubLivePulseClient',()=>({getSeriesClubLivePulseV1WithClient:f.pulse}));
vi.mock('./opsLiveOperationsAdapter',()=>({loadOpsLiveOperations:f.operations}));
vi.mock('./opsQuantDataHealthAdapter',()=>({loadOpsRegistrationPaceQ0:f.registration,loadOpsSepayReadStateQ0:f.sepay}));
import {pulseQueryOptions,operationsQueryOptions,registrationQ0QueryOptions,sepayQ0QueryOptions,type OpsIntelligenceClient} from './opsIntelligenceQueryOptions';
const clients:QueryClient[]=[];
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();vi.resetAllMocks();});
it.each(['pulse','operations','registration','sepay'] as const)('refreshes %s without manual interaction and removes polling on unmount',async name=>{
 vi.useFakeTimers();
 f[name].mockResolvedValue({value:null,observedAt:new Date().toISOString()});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
 const source={} as OpsIntelligenceClient;
 const factories={pulse:()=>pulseQueryOptions(source,'club'),operations:()=>operationsQueryOptions(source,'club',false),registration:()=>registrationQ0QueryOptions(source,'club'),sepay:()=>sepayQ0QueryOptions(source,'club')};
 const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 // Each option family has a different result contract; freshness is tested independently.
 const view=renderHook(()=>useQuery(factories[name]() as ReturnType<typeof operationsQueryOptions>),{wrapper});
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(f[name]).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(f[name]).toHaveBeenCalledTimes(2);
 view.unmount();await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(f[name]).toHaveBeenCalledTimes(2);
});

it.each(['pulse','operations','registration','sepay'] as const)('recovers a hung %s read and ignores its late result',async name=>{
 vi.useFakeTimers();let late!:(value:unknown)=>void;
 f[name].mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;})).mockResolvedValue({value:'CURRENT',availability:'exact',observedAt:new Date().toISOString()});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const source={} as OpsIntelligenceClient;
 const factories={pulse:()=>pulseQueryOptions(source,'club'),operations:()=>operationsQueryOptions(source,'club',false),registration:()=>registrationQ0QueryOptions(source,'club'),sepay:()=>sepayQ0QueryOptions(source,'club')};
 const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const view=renderHook(()=>useQuery(factories[name]() as ReturnType<typeof operationsQueryOptions>),{wrapper});
 await act(async()=>vi.advanceTimersByTimeAsync(16001));expect(f[name].mock.calls.length).toBeGreaterThan(1);
 const current=view.result.current.data;expect(current).toBeDefined();
 await act(async()=>late({value:'STALE',availability:'exact',observedAt:'2020-01-01T00:00:00Z'}));
 expect(view.result.current.data).toBe(current);view.unmount();
});
