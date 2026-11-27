import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const h=vi.hoisted(()=>({actor:'actor-a',clubs:['club-a','club-b'],reads:new Map<string,Promise<{data:unknown;error:unknown}>>(),invoke:vi.fn()}));
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>({user:{id:h.actor},session:null,loading:false})}));
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:false,scopeError:null,hasOwnerAccess:true,scope:h.clubs.map(club_id=>({club_id,can_owner:true})),clubs:h.clubs.map(id=>({id,name:id}))})}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>client}));
vi.mock('@/components/ui/select',()=>({
 Select:({value,onValueChange,children}:{value:string;onValueChange:(value:string)=>void;children:ReactNode})=><select aria-label="CLB" value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>,
 SelectTrigger:()=>null,SelectValue:()=>null,SelectContent:({children}:{children:ReactNode})=><>{children}</>,SelectItem:({value,children}:{value:string;children:ReactNode})=><option value={value}>{children}</option>,
}));
const client={functions:{invoke:(...args:unknown[])=>h.invoke(...args)},from:()=>({select:()=>({eq:(_key:string,id:string)=>({order:()=>h.reads.get(id)??Promise.resolve({data:[],error:null})})})})};
import OpsClubAccounts from './OpsClubAccounts';
const row=(club:string)=>({id:'invite-'+club,club_id:club,email_normalized:club+'@example.test',operator_role:'floor',status:'pending'});
const ready=(club:string)=>Promise.resolve({data:[row(club)],error:null});
const deferred=()=>{let resolve!:(value:{data:unknown;error:unknown})=>void;const promise=new Promise<{data:unknown;error:unknown}>(r=>{resolve=r;});return {promise,resolve};};
const tree=()=> <MemoryRouter><OpsClubAccounts/></MemoryRouter>;
async function select(club:string){await act(async()=>{fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:club}});});}
beforeEach(()=>{h.actor='actor-a';h.clubs=['club-a','club-b'];h.reads.clear();h.invoke.mockReset();h.invoke.mockResolvedValue({data:{status:'INVITED'},error:null});});
afterEach(cleanup);
describe('club account workspace ownership',()=>{
 it('clears A rows and revoke controls when B read fails',async()=>{
  h.reads.set('club-a',ready('club-a'));h.reads.set('club-b',Promise.resolve({data:null,error:{message:'offline'}}));
  render(tree());await select('club-a');expect(await screen.findByText('club-a@example.test')).toBeInTheDocument();
  await select('club-b');expect(screen.queryByText('club-a@example.test')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Thu hồi'})).not.toBeInTheDocument();
 });
 it('ignores an A response arriving after successful B read',async()=>{
  const old=deferred();h.reads.set('club-a',old.promise);h.reads.set('club-b',ready('club-b'));
  render(tree());await select('club-a');await select('club-b');expect(await screen.findByText('club-b@example.test')).toBeInTheDocument();
  await act(async()=>old.resolve({data:[row('club-a')],error:null}));
  expect(screen.queryByText('club-a@example.test')).not.toBeInTheDocument();expect(screen.getByText('club-b@example.test')).toBeInTheDocument();
 });
 it('disposes the old actor workspace before showing the new actor',async()=>{
  h.clubs=['club-a'];h.reads.set('club-a',ready('club-a'));const view=render(tree());expect(await screen.findByText('club-a@example.test')).toBeInTheDocument();
  h.actor='actor-b';h.clubs=['club-b'];h.reads.set('club-b',ready('club-b'));await act(async()=>view.rerender(tree()));
  expect(screen.queryByText('club-a@example.test')).not.toBeInTheDocument();expect(await screen.findByText('club-b@example.test')).toBeInTheDocument();
 });
 it('rejects rows belonging to a different club before offering revoke',async()=>{
  h.clubs=['club-b'];h.reads.set('club-b',ready('club-a'));render(tree());await act(async()=>{});
  expect(screen.queryByText('club-a@example.test')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Thu hồi'})).not.toBeInTheDocument();
 });
 it('shows read failure instead of an empty list and retries the same club',async()=>{
  h.clubs=['club-b'];h.reads.set('club-b',Promise.resolve({data:null,error:{message:'offline'}}));render(tree());
  expect(await screen.findByRole('alert')).toHaveTextContent('Chưa tải được');expect(screen.queryByText('Chưa có lời mời nào cho CLB này.')).not.toBeInTheDocument();
  h.reads.set('club-b',Promise.resolve({data:[{...row('club-b'),status:'active'}],error:null}));
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Thử lại'})));
  expect(await screen.findByText('club-b@example.test')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText(/Đang có quyền/)).toBeInTheDocument();
 });
 it('does not deliver an old actor revoke result to the new workspace',async()=>{
  const old=deferred();h.invoke.mockReturnValue(old.promise);h.clubs=['club-a'];h.reads.set('club-a',ready('club-a'));
  const view=render(tree());await screen.findByText('club-a@example.test');fireEvent.click(screen.getByRole('button',{name:'Thu hồi'}));
  expect(h.invoke).toHaveBeenCalledWith('ops-club-accounts',{body:{action:'revoke',invite_id:'invite-club-a'}});
  h.actor='actor-b';h.clubs=['club-b'];h.reads.set('club-b',ready('club-b'));await act(async()=>view.rerender(tree()));
  await screen.findByText('club-b@example.test');await act(async()=>old.resolve({data:{status:'REVOKED'},error:null}));
  expect(screen.queryByText(/Đã thu hồi quyền/)).not.toBeInTheDocument();expect(screen.getByText('club-b@example.test')).toBeInTheDocument();
 });
 it('removes a selected club when its owner capability is withdrawn',async()=>{
  h.clubs=['club-a'];h.reads.set('club-a',ready('club-a'));const view=render(tree());await screen.findByText('club-a@example.test');
  h.clubs=['club-b'];h.reads.set('club-b',ready('club-b'));await act(async()=>view.rerender(tree()));
  expect(screen.queryByText('club-a@example.test')).not.toBeInTheDocument();await screen.findByText('club-b@example.test');
 });
});

