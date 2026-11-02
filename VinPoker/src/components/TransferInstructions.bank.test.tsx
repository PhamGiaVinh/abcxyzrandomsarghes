import {render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:h.from,rpc:h.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'e5150000-0000-4000-8000-000000000001'}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{error:h.error,success:vi.fn()}}));
import {TransferInstructions} from './TransferInstructions';
beforeEach(()=>{
 vi.clearAllMocks();
 h.from.mockImplementation(()=>{
  const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{id:'global-bank',
   bank_name:'WRONG_GLOBAL_BANK',account_number:'WRONG_ACCOUNT',account_holder:'OTHER_CLUB',qr_code_url:null,notes:null},error:null})};return q;
 });
});
it('does not fall back to a global bank for a legacy purchase lacking a receipt',async()=>{
 h.rpc.mockReturnValue({abortSignal:async()=>({data:{state:'needs_attention',
  purchase_id:'e5150000-0000-4000-8000-000000000003',deal_id:'e5150000-0000-4000-8000-000000000002'},error:null})});
 render(<TransferInstructions dealId="e5150000-0000-4000-8000-000000000002"
  purchaseId="e5150000-0000-4000-8000-000000000003" amount={100000} reference="LOCAL_ONLY" committedAt="2026-10-23T00:00:00Z"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Thiếu chứng cứ');
 expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.from).not.toHaveBeenCalled();
 expect(screen.queryByText('WRONG_GLOBAL_BANK')).not.toBeInTheDocument();
});
it('renders the verified receipt bank without fetching an unrelated global account',async()=>{
 const props={dealId:'e5150000-0000-4000-8000-000000000002',purchaseId:'e5150000-0000-4000-8000-000000000003',
  amount:100000,reference:'LOCAL_ONLY',committedAt:new Date().toISOString(),
  escrowAccount:{bank_name:'EXACT_RECEIPT_BANK',account_number:'EXACT_RECEIPT_ACCOUNT',account_holder:'TEST_CLUB',qr_code_url:null,notes:null}};
 render(<TransferInstructions {...props}/>);
 expect(await screen.findByText('EXACT_RECEIPT_BANK')).toBeInTheDocument();
 expect(screen.queryByText('WRONG_GLOBAL_BANK')).not.toBeInTheDocument();expect(h.from).not.toHaveBeenCalled();
});
