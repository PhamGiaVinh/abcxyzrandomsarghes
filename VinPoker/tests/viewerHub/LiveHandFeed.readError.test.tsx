import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@/i18n';
const {state,flags}=vi.hoisted(()=>({state:{items:[],loading:false,hasMore:false,error:'TEST read failed',reload:vi.fn(),loadMore:vi.fn()},flags:{liveViewerRPTShell:false,liveSpotlightPosts:false}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:flags}));
vi.mock('@/components/cashier/tournament-live/viewer-hub/useCompletedHandsFeed',()=>({useCompletedHandsFeed:()=>state}));
import {LiveHandFeed} from '@/components/cashier/tournament-live/viewer-hub/LiveHandFeed';
afterEach(()=>{cleanup();state.reload.mockClear();});
it.each([false,true])('renders failure instead of false empty and offers retry (shell=%s)',rpt=>{
 flags.liveViewerRPTShell=rpt;
 render(<LiveHandFeed tournamentId="tour"/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được lịch sử hand');
 expect(screen.queryByText('Chưa có ván nào hoàn tất')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại lịch sử'}));
 expect(state.reload).toHaveBeenCalledTimes(1);
});
