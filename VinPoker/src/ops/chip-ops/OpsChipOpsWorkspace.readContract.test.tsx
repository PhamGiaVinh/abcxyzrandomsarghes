import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
const h=vi.hoisted(()=>({invalid:'issuance',healthy:false,rpc:vi.fn()}));
const client={from:(table:string)=>{const data=table==='tournaments'
 ?(!h.healthy&&h.invalid==='tournaments'?null:[{id:'tour',name:'TEST Tour',status:'active',start_time:null,phase:null}])
 :table==='stack_template'?(!h.healthy&&h.invalid==='templates'?null:[{id:'template',name:'TEST Stack',stack_value:20000}])
 :!h.healthy&&h.invalid==='issuance'?null:[{stack_template_id:'template',issued_count:1}];
 const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,in:()=>q,limit:()=>q,abortSignal:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve)};return q;},rpc:h.rpc};
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>client}));
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>({user:{id:'owner'},loading:false})}));
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:false,scopeError:null,isSuperAdmin:false,moduleClubIds:()=>['club'],clubs:[{id:'club',name:'TEST Club'}]})}));
vi.mock('@/ops/workspace/OpsWorkspaceProvider',()=>({useOpsWorkspace:()=>({selectedClubId:'club'})}));
import OpsChipOpsWorkspace from './OpsChipOpsWorkspace';
beforeEach(()=>{h.healthy=false;h.rpc.mockReset();h.rpc.mockImplementation(()=>{const result={data:{tournament_id:'tour',denominations:[{denomination_id:'denom',value:100,color:'red',issued_count_total:200}],total_value:20000,reconciliation_value:20000,reconciled:true},error:null};return {abortSignal:()=>Promise.resolve(result)};});});
afterEach(cleanup);
it.each(['tournaments','templates','issuance'])('uses the actual adapter to reject null %s instead of displaying zero and refreshes safely',async(kind)=>{
 h.invalid=kind;render(<MemoryRouter initialEntries={['/?t=tour']}><OpsChipOpsWorkspace/></MemoryRouter>);
 await screen.findByText('Không tải được tồn chip');
 expect(screen.queryByText('Bộ stack đã phát')).not.toBeInTheDocument();
 expect(screen.queryByText('0 bộ')).not.toBeInTheDocument();
 h.healthy=true;fireEvent.click(screen.getByRole('button',{name:'Làm mới Chip Ops'}));
 await screen.findByText('1 bộ');expect(screen.queryByText('Không tải được tồn chip')).not.toBeInTheDocument();
 expect(h.rpc.mock.calls.every(([name])=>name==='get_issued_chip_inventory')).toBe(true);
});
