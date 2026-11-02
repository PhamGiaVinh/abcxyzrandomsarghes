import {cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({read:vi.fn(),session:{access_token:'LOCAL_TV_A'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'TEST_OWNER'},session:h.session,loading:false})}));
vi.mock('@/hooks/useTournamentTvDataCore',()=>({useTournamentTvDataCore:(...args:unknown[])=>h.read(...args)}));
import {useTournamentTvData} from './useTournamentTvData';
beforeEach(()=>{vi.clearAllMocks();h.session={access_token:'LOCAL_TV_A'};});
afterEach(cleanup);
it('passes a non-secret credential incarnation and changes it for in-place token replacement',()=>{
 const view=renderHook(()=>useTournamentTvData('TEST_TOUR'));
 const first=h.read.mock.calls.at(-1)![1];
 expect(first.authEpoch).toBeTypeOf('number');
 h.session.access_token='LOCAL_TV_B';view.rerender();
 const second=h.read.mock.calls.at(-1)![1];
 expect(second.authEpoch).not.toBe(first.authEpoch);
 expect(JSON.stringify(second)).not.toContain('LOCAL_TV_');
});
