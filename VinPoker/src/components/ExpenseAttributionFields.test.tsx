import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({session:{access_token:'fake-static-token'},from:vi.fn(),reply:Promise.resolve({data:[],error:null}) as Promise<{data:unknown;error:unknown}>,filters:[] as string[]}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'test-owner'},session:f.session,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{f.from(table);const q={select:()=>q,eq:(k:string,v:string)=>{f.filters.push(k+':'+v);return q;},ilike:()=>q,order:()=>q,limit:()=>f.reply};return q;}}}));
import {FEATURES} from '@/lib/featureFlags';
import {ExpenseAttributionFields,ExpenseAttributionSummary,type ExpenseAttribution} from './ExpenseAttributionFields';
const club='18100000-0000-4000-8000-000000000001',tour='18100000-0000-4000-8000-000000000071';
function Form(){const [value,onChange]=useState<ExpenseAttribution>({});return <ExpenseAttributionFields clubId={club} value={value} onChange={onChange}/>;}
afterEach(()=>{cleanup();vi.clearAllMocks();f.filters=[];});
it('loads only same-club targets and keeps common costs unallocated by default',async()=>{
 f.reply=Promise.resolve({data:[{id:tour,club_id:club,name:'TEST tournament'}],error:null});render(<Form/>);
 expect(f.from).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('Phạm vi khoản chi'),{target:{value:'tournament'}});
 await screen.findByRole('option',{name:'TEST tournament'});expect(f.from).toHaveBeenCalledWith('tournaments');expect(f.filters).toContain('club_id:'+club);
 fireEvent.change(screen.getByLabelText('Giải nhận chi phí'),{target:{value:tour}});expect((screen.getByLabelText('Giải nhận chi phí') as HTMLSelectElement).value).toBe(tour);
});
it('fails closed on a foreign target packet instead of displaying it',async()=>{
 f.reply=Promise.resolve({data:[{id:tour,club_id:'18100000-0000-4000-8000-000000000002',name:'FOREIGN'}],error:null});render(<Form/>);
 fireEvent.change(screen.getByLabelText('Phạm vi khoản chi'),{target:{value:'tournament'}});await screen.findByRole('alert');expect(screen.queryByRole('option',{name:'FOREIGN'})).toBeNull();
});
it('does not revive a late target read after switching club',async()=>{
 let resolve!:(v:{data:unknown;error:unknown})=>void;f.reply=new Promise(r=>{resolve=r;});
 const view=render(<ExpenseAttributionFields clubId={club} value={{tournamentId:tour}} onChange={()=>{}}/>);await waitFor(()=>expect(f.from).toHaveBeenCalled());
 f.reply=Promise.resolve({data:[],error:null});view.rerender(<ExpenseAttributionFields clubId="18100000-0000-4000-8000-000000000002" value={{}} onChange={()=>{}}/>);
 await act(async()=>resolve({data:[{id:tour,club_id:club,name:'OLD CLUB'}],error:null}));expect(screen.queryByRole('option',{name:'OLD CLUB'})).toBeNull();
});
it('restores an unresolved link read-only without replacing it with an empty selection',()=>{
 render(<ExpenseAttributionFields clubId={club} value={{tournamentId:tour,attachmentUrl:'https://example.test/evidence.pdf'}} onChange={()=>{}} locked/>);
 expect((screen.getByLabelText('Giải nhận chi phí') as HTMLSelectElement).value).toBe(tour);expect(f.from).not.toHaveBeenCalled();
 expect((screen.getByLabelText('Đường dẫn chứng từ (nếu có)') as HTMLInputElement).disabled).toBe(true);
});

it('keeps new expense attribution default OFF pending guarded release',()=>{expect(FEATURES.clubExpenseAttribution).toBe(false);});

it('renders source and evidence links without opening unsafe historical URLs',()=>{
 const view=render(<ExpenseAttributionSummary row={{tournamentId:tour,attachmentUrl:'https://example.test/receipt.pdf'}}/>);
 expect(screen.getByRole('link',{name:'Mở giải đã liên kết'}).getAttribute('href')).toBe('/tournament/'+tour);
 expect(screen.getByRole('link',{name:'Xem chứng từ'}).getAttribute('href')).toBe('https://example.test/receipt.pdf');
 view.rerender(<ExpenseAttributionSummary row={{tournamentId:'bad/id',attachmentUrl:'javascript:alert(1)'}}/>);
 expect(screen.queryByRole('link')).toBeNull();expect(screen.getByText('Liên kết chứng từ cần kiểm tra')).toBeTruthy();
});
