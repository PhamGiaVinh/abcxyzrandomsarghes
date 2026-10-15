// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import i18n from '@/i18n';
import ClubDetail from './ClubDetail';
const state=vi.hoisted(()=>({images:true}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({select:()=>({
 eq:()=>({maybeSingle:async()=>({data:{id:'club-test',name:'Schedule TEST',region:'TEST',updated_at:'2035-12-31T23:59:59Z',daily_schedule_image_url:state.images?'https://example.test/daily.png':null,weekly_schedule_image_url:state.images?'https://example.test/weekly.png':null}}),
 gte:()=>({order:async()=>({data:[]})}),order:async()=>({data:[]})}),
})})}}));
afterEach(cleanup);beforeEach(async()=>{state.images=true;await i18n.changeLanguage('vi');});
function mount(){render(<MemoryRouter initialEntries={['/club/club-test']}><Routes><Route path="/club/:id" element={<ClubDetail/>}/></Routes></MemoryRouter>);}
it('shows an unavailable-metadata disclosure for each legacy daily/weekly image, not club update date',async()=>{
 mount();const notes=await screen.findAllByRole('note');expect(notes).toHaveLength(2);
 for(const note of notes)expect(note).toHaveTextContent(i18n.t('legacyScheduleEvidence'));
 expect(screen.queryByText(/2035/)).toBeNull();
});
it('does not show schedule evidence notices when no legacy image is supplied',async()=>{
 state.images=false;mount();await screen.findByText('Schedule TEST');expect(screen.queryByRole('note')).toBeNull();
});
