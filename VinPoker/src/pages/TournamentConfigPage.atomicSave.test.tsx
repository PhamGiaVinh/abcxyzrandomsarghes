import {fireEvent, render, screen, waitFor, cleanup} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:null,loading:false,isAdmin:false,roles:[]})}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({rpc:api.rpc})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,options?:{defaultValue?:string})=>options?.defaultValue??key})}));
import {TournamentDialog} from './TournamentConfigPage';
import {tournamentConfigJournalKey} from '@/lib/tournamentConfigSave';

const actor='ee800000-0000-4000-8000-000000000001';
const club='ee800000-0000-4000-8000-000000000002';
const success={ok:true,tournament:{id:'ee800000-0000-4000-8000-000000000003',club_id:club,updated_at:'2026-10-15T00:00:00Z'}};
function show(actorId=actor){
 const close=vi.fn();
 const client=new QueryClient({defaultOptions:{mutations:{retry:false},queries:{retry:false,gcTime:0}}});
 const view=render(<QueryClientProvider client={client}><TournamentDialog open actorId={actorId}
   clubId={club} allTables={[]} inventoryReady onOpenChange={close}/></QueryClientProvider>);
 return {...view,close};
}
beforeEach(()=>{sessionStorage.clear();vi.resetAllMocks();});
afterEach(cleanup);
it('late commit after unmount does not close a new dialog or discard recovery intent',async()=>{
 let resolve!:(v:unknown)=>void;
 api.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const old=show();
 fireEvent.change(screen.getByPlaceholderText('tournamentConfig.namePh'),{target:{value:'Late TEST'}});
 fireEvent.click(screen.getByRole('button',{name:'tournamentConfig.create'}));
 await waitFor(()=>expect(api.rpc).toHaveBeenCalledTimes(1));
 old.unmount();
 const next=show('ee800000-0000-4000-8000-000000000098');
 resolve({data:success,error:null});
 await new Promise(r=>setTimeout(r,30));
 expect(old.close).not.toHaveBeenCalled();expect(next.close).not.toHaveBeenCalled();
 expect(sessionStorage.getItem(tournamentConfigJournalKey(actor,club,null))).not.toBeNull();
 expect(screen.getByPlaceholderText('tournamentConfig.namePh')).toHaveValue('');
});
it('double-click emits a single atomic mutation and no legacy writes',async()=>{
 let resolve!:(v:unknown)=>void;
 api.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const view=show();
 fireEvent.change(screen.getByPlaceholderText('tournamentConfig.namePh'),{target:{value:'Atomic TEST'}});
 const submit=screen.getByRole('button',{name:'tournamentConfig.create'});
 fireEvent.click(submit);fireEvent.click(submit);
 await waitFor(()=>expect(api.rpc).toHaveBeenCalledTimes(1));
 expect(api.rpc.mock.calls[0][0]).toBe('save_tournament_config_v1');
 const key=api.rpc.mock.calls[0][1].p_request_id;
 expect(JSON.parse(sessionStorage.getItem(tournamentConfigJournalKey(actor,club,null))!).p_request_id).toBe(key);
 resolve({data:success,error:null});
 await waitFor(()=>expect(view.close).toHaveBeenCalledWith(false));
 expect(sessionStorage.getItem(tournamentConfigJournalKey(actor,club,null))).toBeNull();
});
it('reload retains unknown intent and only queries the existing receipt',async()=>{
 api.rpc.mockResolvedValueOnce({data:null,error:{message:'lost response'}})
  .mockResolvedValueOnce({data:{ok:false,error:'receipt_not_found'},error:null});
 const first=show();
 fireEvent.change(screen.getByPlaceholderText('tournamentConfig.namePh'),{target:{value:'Unknown TEST'}});
 fireEvent.click(screen.getByRole('button',{name:'tournamentConfig.create'}));
 await screen.findByRole('button',{name:'Kiểm tra kết quả'});
 const saved=JSON.parse(sessionStorage.getItem(tournamentConfigJournalKey(actor,club,null))!);
 expect(first.close).not.toHaveBeenCalled();
 first.unmount();
 api.rpc.mockResolvedValueOnce({data:success,error:null});
 const restored=show();
 expect(screen.getByPlaceholderText('tournamentConfig.namePh')).toHaveValue('Unknown TEST');
 expect(screen.getByPlaceholderText('tournamentConfig.namePh')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Kiểm tra kết quả'}));
 await waitFor(()=>expect(restored.close).toHaveBeenCalledWith(false));
 expect(api.rpc.mock.calls.map(c=>c[0])).toEqual(['save_tournament_config_v1','get_tournament_config_save_receipt_v1','get_tournament_config_save_receipt_v1']);
 expect(api.rpc.mock.calls[2][1]).toEqual({p_request_id:saved.p_request_id,p_expected_actor_id:actor});
});
it('another actor does not load the previous actor pending intent',()=>{
 sessionStorage.setItem(tournamentConfigJournalKey(actor,club,null),JSON.stringify({
  p_expected_actor_id:actor,p_request_id:'ee800000-0000-4000-8000-000000000081',p_club_id:club,p_tournament_id:null,
  p_config:{name:'Private previous TEST',description:null,swing_duration_minutes:45,warn_at_minutes:5,crit_at_minutes:2},
  p_table_ids:[],p_expected_updated_at:null,p_expected_active_table_ids:[],
 }));
 show('ee800000-0000-4000-8000-000000000098');
 expect(screen.getByPlaceholderText('tournamentConfig.namePh')).toHaveValue('');
 expect(screen.queryByRole('button',{name:'Kiểm tra kết quả'})).toBeNull();
 expect(api.rpc).not.toHaveBeenCalled();
});
it('explicit CAS failure stays in dialog without a second request',async()=>{
 api.rpc.mockResolvedValue({data:{ok:false,error:'STALE_CONFIG'},error:null});
 const view=show();
 fireEvent.change(screen.getByPlaceholderText('tournamentConfig.namePh'),{target:{value:'Conflict TEST'}});
 fireEvent.click(screen.getByRole('button',{name:'tournamentConfig.create'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('STALE_CONFIG');
 expect(view.close).not.toHaveBeenCalled();expect(api.rpc).toHaveBeenCalledTimes(1);
});
