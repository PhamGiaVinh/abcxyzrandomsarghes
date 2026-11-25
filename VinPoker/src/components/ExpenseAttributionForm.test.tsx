import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({submit:vi.fn(),session:{access_token:'static-test-session'},reply:new Promise(()=>{}) as Promise<{data:unknown;error:unknown}>}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{clubExpenses:true,clubExpenseAttribution:true}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'test-owner'},session:f.session,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{const q={select:()=>q,eq:()=>q,ilike:()=>q,order:()=>q,limit:()=>f.reply};return q;}}}));
import {ExpenseEntryForm} from '@/pages/ClubExpenses';
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(){render(<ExpenseEntryForm clubId="18100000-0000-4000-8000-000000000001" disabled={false} pending={false} preview={false} onSubmit={f.submit}/>);fireEvent.change(screen.getByLabelText('Số tiền'),{target:{value:'100000'}});fireEvent.change(screen.getByLabelText('Phạm vi khoản chi'),{target:{value:'tournament'}});}
it('never writes a common expense while a selected tournament list is still loading',()=>{
 f.reply=new Promise(()=>{});mount();fireEvent.submit(screen.getByLabelText('Số tiền').closest('form')!);expect(f.submit).not.toHaveBeenCalled();
});
it('never turns a failed selected target lookup into an unallocated expense',async()=>{
 f.reply=Promise.resolve({data:null,error:Error('denied')});mount();await screen.findByRole('alert');fireEvent.submit(screen.getByLabelText('Số tiền').closest('form')!);await waitFor(()=>expect(f.submit).not.toHaveBeenCalled());
});
