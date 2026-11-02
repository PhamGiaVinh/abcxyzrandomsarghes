import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({client:{},load:vi.fn(),opsAvailability:'unavailable' as 'unavailable'|'exact',
 configured:null as number|null,open:null as number|null,rowCount:0,opsThrow:false}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>fixture.client}));
vi.mock('@/ops/finance/financeReadAdapter',async importOriginal=>({...await importOriginal<typeof import('@/ops/finance/financeReadAdapter')>(),loadFinanceSummary:fixture.load}));
vi.mock('@/ops/digest/ownerDailyDigestSupabaseSource',()=>({createOwnerDailyDigestSupabaseSource:()=>({})}));
vi.mock('@/ops/digest/ownerDailyDigestReadAdapter',()=>({loadOwnerDailyDigestReport:async()=>null}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{trackerVoiceInput:false}}));
vi.mock('./opsQuantDataHealthGate',()=>({isOpsQuantDataHealthQ0Enabled:()=>false}));
vi.mock('./opsIntelligenceQueryOptions',()=>({
 pulseQueryOptions:()=>({queryKey:['test','pulse'],queryFn:async()=>({value:null,availability:'unavailable',observedAt:new Date().toISOString(),reasonCode:'TEST_NO_PULSE'})}),
 operationsQueryOptions:()=>({queryKey:['test','ops'],queryFn:async()=>{if(fixture.opsThrow)throw Error('LOCAL_TEST_READ_FAILED');return({observedAt:new Date().toISOString(),asOf:null,availability:fixture.opsAvailability,reasonCode:'TEST_NO_OPERATIONS',
  rows:Array.from({length:fixture.rowCount},(_,index)=>({tableId:`table-${index}`,tableName:`TEST ${index}`,tableStatus:'inactive',tournamentId:null,tournamentName:null,currentLevel:null,averageStack:null,dealerName:null,dealerAssignmentState:'missing',sourceAvailability:'exact'})),
  runningTournamentIds:[],openTableCount:fixture.open,configuredTableCount:fixture.configured,operationalTableCount:fixture.open,dealersOnDutyCount:null,countComparisonEligible:false});}}),
}));
import {OpsIntelligenceCommandCenterV1} from './OpsIntelligenceCommandCenterV1';

const clients:QueryClient[]=[];
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);return render(<QueryClientProvider client={client}><OpsIntelligenceCommandCenterV1 clubId="club-test" clubName="TEST" showDataHealth={false}/></QueryClientProvider>);}
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-01T00:30:00.123+07:00'));
 fixture.load.mockReset().mockResolvedValue({revenue:{total:240000},net:240000});
 fixture.opsAvailability='unavailable';
 fixture.opsThrow=false;
 fixture.configured=null;fixture.open=null;fixture.rowCount=0;
});
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());vi.useRealTimers();});
describe('Intelligence financial as-of refresh',()=>{
 it('labels initial pending provenance without presenting a synthetic epoch receipt',()=>{
  mount();
  expect(screen.getAllByText(/receipt chưa nhận phản hồi/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/receipt.*01-01/)).not.toBeInTheDocument();
 });
 it('retains the actual observation timestamp after a source responds',async()=>{
  mount();await waitFor(()=>expect(screen.getAllByText(/receipt 00:30 01-10/).length).toBeGreaterThan(0));
 });
 it.each([0,2,null])('labels canonical open/configured counts independently of the Q0 flag and row count: %s',async(open)=>{
  fixture.opsAvailability='exact';fixture.configured=101;fixture.open=open;fixture.rowCount=101;
  mount();await waitFor(()=>expect(screen.getByText(`${open??'—'} bàn đang mở · 101 bàn cấu hình`)).toBeInTheDocument());
  expect(screen.queryByText('101 bàn')).not.toBeInTheDocument();
 });
 it('does not report zero tables when the operations source is unavailable',async()=>{
  mount();await waitFor(()=>expect(fixture.load).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('0 bàn')).not.toBeInTheDocument();
  expect(screen.getByText('Chưa xác minh số bàn')).toBeInTheDocument();
  expect(screen.getByText('Không xác minh được danh sách bàn. Hãy làm mới.')).toBeInTheDocument();
 });
 it('retains a genuine zero-table result from an exact operations source',async()=>{
  fixture.opsAvailability='exact';mount();
  await waitFor(()=>expect(screen.getByText('0 bàn')).toBeInTheDocument());
  expect(screen.getByText('Chưa có bàn vận hành được đọc từ nguồn hiện hữu.')).toBeInTheDocument();
 });
 it('advances the actual finance query cutoff and preserves UTC+7 month start',async()=>{
  mount();await waitFor(()=>expect(fixture.load).toHaveBeenCalledTimes(1));
  expect(fixture.load.mock.calls[0][2]).toEqual({from:'2026-09-30T17:00:00.000Z',to:'2026-09-30T17:30:00.123Z'});
  vi.setSystemTime(new Date('2026-10-02T01:15:22.456+07:00'));
  fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));
  await waitFor(()=>expect(fixture.load).toHaveBeenCalledTimes(2));
  expect(fixture.load.mock.calls[1][2]).toEqual({from:'2026-09-30T17:00:00.000Z',to:'2026-10-01T18:15:22.456Z'});
 });
 it('still refetches when an explicit refresh occurs in the same millisecond',async()=>{
  mount();await waitFor(()=>expect(fixture.load).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));
  await waitFor(()=>expect(fixture.load).toHaveBeenCalledTimes(2));
 });
 it('presents its finance time window in the business timezone',async()=>{
  mount();await waitFor(()=>expect(fixture.load).toHaveBeenCalledTimes(1));
  expect(screen.getByText('LIVE AGGREGATE · 00:00 01-10 → 00:30 01-10')).toBeTruthy();
 });

 it('automatically advances the finance cutoff while Owner keeps Intelligence open',async()=>{
  vi.useRealTimers();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-01T00:30:00+07:00'));mount();await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(fixture.load).toHaveBeenCalledTimes(1);await act(async()=>vi.advanceTimersByTimeAsync(5001));
  expect(fixture.load).toHaveBeenCalledTimes(2);
  expect(fixture.load.mock.calls[1][2].from).toBe('2026-09-30T17:00:00.000Z');
  expect(Date.parse(fixture.load.mock.calls[1][2].to)).toBeGreaterThanOrEqual(Date.parse('2026-09-30T17:30:05.000Z'));
  expect(Date.parse(fixture.load.mock.calls[1][2].to)).toBeLessThanOrEqual(Date.now());
 });
 it('does not present cached table counts as verified after a refresh fails',async()=>{
  fixture.opsAvailability='exact';fixture.open=2;fixture.configured=2;mount();
  await waitFor(()=>expect(screen.getByText('2 bàn đang mở · 2 bàn cấu hình')).toBeInTheDocument());
  fixture.opsThrow=true;fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));
  await waitFor(()=>expect(screen.getByText('Chưa xác minh số bàn')).toBeInTheDocument());
  expect(screen.queryByText('2 bàn đang mở · 2 bàn cấu hình')).not.toBeInTheDocument();
 });});
