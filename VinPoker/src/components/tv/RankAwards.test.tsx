import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useMockTvData} from '@/lib/tv/mockTvData';
import {mapTvDataToClock} from '@/lib/tv/mapClockData';
import {VinPokerTournamentClock} from '@/components/tournament-clock/VinPokerTournamentClock';
import {TvPayoutsScreen} from './TvPayoutsScreen';
import {TvTicker} from './TvTicker';
vi.mock('react-i18next',async()=>{
 const en=(await import('@/i18n/locales/en.json')).default;
 return {useTranslation:()=>({t:(key:string)=>key.split('.').reduce<unknown>((value,part)=>value&&typeof value==='object'?(value as Record<string,unknown>)[part]:undefined,en)??key})};
});
vi.mock('@/lib/featureFlags',()=>({FEATURES:{tvPayoutBandedDisplay:false,payoutSatelliteManual:true}}));
// Animation/branding mechanics are not under test; the actual prize markup is.
vi.mock('@/components/tournament-clock/ClockRing',()=>({ClockRing:()=>null}));
vi.mock('@/components/tournament-clock/TvBrandingOverlay',()=>({TvBrandingOverlay:()=>null}));
afterEach(cleanup);
const hint='Additional entitlements, if any, are reconciled separately in Cashier.';
function Surface({kind,satellite=false}:{kind:'clock'|'payouts'|'ticker';satellite?:boolean}){
 const base=useMockTvData(false);
 const data={...base,satellitePayout:satellite?{rows:[{label:'1–3',prize:'TEST ticket'}]}:null,prizes:[{position:1,amount:570000},{position:2,amount:300000},{position:3,amount:200000},{position:4,amount:110000}]};
 return kind==='clock'?<VinPokerTournamentClock data={mapTvDataToClock(data)}/>:kind==='payouts'?<TvPayoutsScreen data={data}/>:<TvTicker data={data}/>;
}
it.each(['clock','payouts','ticker'] as const)('%s explains rank awards without claiming they include every event entitlement',kind=>{
 render(<Surface kind={kind}/>);
 expect(screen.getByText('Rank awards')).toBeInTheDocument();
 expect(screen.getByText(hint)).toBeInTheDocument();
 expect(screen.queryByText('Prizes',{exact:true})).not.toBeInTheDocument();
 // No client allocation of floors/bag awards or fabricated recipient list.
 expect(screen.queryByText('220.000',{exact:true})).not.toBeInTheDocument();
 for(const amount of kind==='clock'?['570.000','300.000','200.000','110.000']:['570K','300K','200K','110K'])expect(screen.getByText(amount,{exact:true})).toBeInTheDocument();
});
it('keeps the distinct satellite ticket layout without a cash-rank disclaimer',()=>{
 render(<Surface kind="payouts" satellite/>);
 expect(screen.getByText('🎟️ Satellite')).toBeInTheDocument();
 expect(screen.getByText('TEST ticket')).toBeInTheDocument();
 expect(screen.queryByText(hint)).not.toBeInTheDocument();
 expect(screen.queryByText('570K',{exact:false})).not.toBeInTheDocument();
});
