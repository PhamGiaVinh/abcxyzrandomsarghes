import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
const state=vi.hoisted(()=>{const rpc=vi.fn();return{rpc,client:{rpc},inventory:vi.fn()};});
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>state.client}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{floorTableControlV3:true,floorRedrawSeatLockV1:true}}));
vi.mock('@/lib/floorTableControlV3',()=>({createFloorTableControlV3Client:()=>({enabled:true,redrawSeatLockEnabled:true,getTournamentTableInventory:state.inventory})}));
import {OpenTableDialog} from '@/components/cashier/tournament-live/OpenTableDialog';
afterEach(cleanup);
it('keeps a large unresolved legacy inventory collapsed without hiding its warning or enabling those tables',async()=>{
 state.inventory.mockResolvedValue({ok:true,data:[{gameTableId:'valid',tableNumber:1,tableName:'Valid TEST',availabilityStatus:'available',operationalStatus:'available'},
  ...Array.from({length:100},(_,i)=>({gameTableId:`legacy-${i}`,tableNumber:null,tableName:`Bàn ${i+1}`,availabilityStatus:'preflight_required',operationalStatus:null}))]});
 render(<OpenTableDialog open onOpenChange={()=>{}} tournamentId='test-tour' onDone={()=>{}}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Bàn 1 — Có thể mở'})).toBeInTheDocument());
 const summary=screen.getByText('Xem 100 bàn cần đối soát');
 expect(summary.closest('details')).not.toHaveAttribute('open');
 expect(summary.closest('details')).toHaveTextContent('Bàn 100');
 expect(screen.getByRole('status')).toHaveTextContent('100 bàn cũ chưa có số chuẩn');
 expect(screen.queryByRole('button',{name:/Bàn 100 —/})).not.toBeInTheDocument();
 expect(state.rpc).not.toHaveBeenCalled();
});
