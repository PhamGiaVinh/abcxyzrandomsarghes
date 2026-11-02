import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
const h=vi.hoisted(()=>({read:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 const q={select:()=>q,order:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve(h.read()).then(resolve,reject)};return q;
}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({isAdmin:false})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
vi.mock('@/components/DocumentUploadDialog',()=>({DocumentUploadDialog:()=>null}));
vi.mock('@/components/DocumentViewerDialog',()=>({DocumentViewerDialog:()=>null}));
import Documents from './Documents';
beforeEach(()=>{h.signals=[];h.read.mockReset().mockResolvedValue({data:[],error:null});});
afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<MemoryRouter><Documents/></MemoryRouter>);
it('reserves empty state for verified empty data',async()=>{mount();expect(await screen.findByText('documentsPage.empty')).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();});
it('shows unavailable instead of empty and supports explicit retry',async()=>{
 h.read.mockResolvedValueOnce({data:null,error:{message:'503'}});mount();
 expect(await screen.findByRole('alert')).toHaveTextContent('documentsPage.readError');expect(screen.queryByText('documentsPage.empty')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'documentsPage.retry'}));expect(await screen.findByText('documentsPage.empty')).toBeInTheDocument();
});
it('rejects malformed success',async()=>{h.read.mockResolvedValue({data:null,error:null});mount();expect(await screen.findByRole('alert')).toBeInTheDocument();expect(screen.queryByText('documentsPage.empty')).toBeNull();});
it('bounds a hung read and ignores its late result',async()=>{
 vi.useFakeTimers();let finish!:(v:unknown)=>void;h.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));mount();
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('alert')).toBeInTheDocument();expect(h.signals.every(s=>s.aborted)).toBe(true);
 await act(async()=>finish({data:[],error:null}));expect(screen.queryByText('documentsPage.empty')).toBeNull();
});
it('aborts the owned read on unmount',()=>{h.read.mockImplementation(()=>new Promise(()=>{}));const view=mount();view.unmount();expect(h.signals.length).toBe(1);expect(h.signals[0].aborted).toBe(true);});
it('catches a rejected read without an unhandled promise or false empty',async()=>{h.read.mockRejectedValueOnce(new TypeError('Failed to fetch'));mount();expect(await screen.findByRole('alert')).toHaveTextContent('documentsPage.readError');expect(screen.queryByText('documentsPage.empty')).toBeNull();});
it('does not render malformed rows as a successful document collection',async()=>{h.read.mockResolvedValue({data:[{id:'bad',kind:'file',title:null}],error:null});mount();expect(await screen.findByRole('alert')).toBeInTheDocument();expect(screen.queryByText('documentsPage.empty')).toBeNull();});
it('renders a verified file and filters it without replacing it with unavailable state',async()=>{h.read.mockResolvedValue({data:[{id:'file-1',kind:'file',title:'LOCAL Study',description:null,tags:[],file_url:'/local-test.pdf',thumbnail_url:null,mime_type:'application/pdf',size_bytes:1024,is_public:true,subtitle_url:null,created_at:'2026-10-26T00:00:00Z'}],error:null});mount();expect(await screen.findByText('LOCAL Study')).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();fireEvent.change(screen.getByRole('textbox'),{target:{value:'missing'}});expect(screen.getByText('documentsPage.empty')).toBeInTheDocument();});
