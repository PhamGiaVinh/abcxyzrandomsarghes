import type {ReactNode} from 'react';
import {renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>({from:vi.fn(),select:vi.fn(),eq:vi.fn(),in:vi.fn()}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({from:calls.from})}));
import {useTournaments,useActiveTournaments} from './useTournaments';
beforeEach(()=>{
 vi.clearAllMocks();
 const query={select:calls.select,eq:calls.eq,in:calls.in,order:()=>Promise.resolve({data:[],error:null})};
 calls.from.mockReturnValue(query);calls.select.mockReturnValue(query);calls.eq.mockReturnValue(query);calls.in.mockReturnValue(query);
});
function wrapper(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 return ({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
it('both tournament readers disambiguate the existing table_id relationship and retain club scope',async()=>{
 const all=renderHook(()=>useTournaments('club-a'),{wrapper:wrapper()});
 await waitFor(()=>expect(all.result.current.isSuccess).toBe(true));
 const active=renderHook(()=>useActiveTournaments('club-b'),{wrapper:wrapper()});
 await waitFor(()=>expect(active.result.current.isSuccess).toBe(true));
 expect(calls.select).toHaveBeenCalledTimes(2);
 for(const [projection] of calls.select.mock.calls)expect(projection).toContain('game_tables!tournament_tables_table_id_fkey');
 expect(calls.eq).toHaveBeenCalledWith('club_id','club-a');expect(calls.eq).toHaveBeenCalledWith('club_id','club-b');
 expect(calls.in).toHaveBeenCalledWith('status',['active','live','break','final_table']);
});
it('does not fetch an unscoped tournament list',()=>{
 renderHook(()=>useTournaments(undefined),{wrapper:wrapper()});
 expect(calls.from).not.toHaveBeenCalled();
});
