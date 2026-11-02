import {expect,it,vi} from 'vitest';
import type {OpsClient} from '@/ops/opsMutations';
import {callMultiDayFloorRpc} from './multiDayFloorRpc';
const payout={eventId:'event',state:'READY',rulesVersion:'rules',fundingRevision:'funding',qualificationRevision:'qualification',payoutInputHash:'input',
 directPoolVnd:100,transferPoolVnd:0,feesVnd:5,recordedOverlayVnd:0,requiredShortfallVnd:0,paidPlayerVnd:10,unpaidObligationVnd:90,
 clubRetainedTieVnd:0,unallocatedPoolVnd:0,obligations:[{playerId:'player',participationId:'participation',totalVnd:100,paidVnd:10,unpaidVnd:90}],sourceSnapshot:{payments:[]}};
const floor=(value:unknown)=>({eventId:'event',releaseEnabled:false,eventItmPercent:10,capabilities:{canFinalizePayout:false,canRequestAdjustment:false,canApproveAdjustment:false},rules:null,qualification:null,finalization:{...value as object,requestId:'request',finalizedAt:'2026-10-27T00:00:00Z'},correctionRequests:[]});
const inconsistent=[
 {...payout,paidPlayerVnd:11}, {...payout,unpaidObligationVnd:89},
 {...payout,obligations:[{...payout.obligations[0],totalVnd:101}]},
 {...payout,directPoolVnd:200,paidPlayerVnd:20,unpaidObligationVnd:180,obligations:[payout.obligations[0],payout.obligations[0]]},
 {...payout,directPoolVnd:200,paidPlayerVnd:20,unpaidObligationVnd:180,obligations:[payout.obligations[0],{...payout.obligations[0],participationId:'other-participation'}]},
 {...payout,unallocatedPoolVnd:1}, {...payout,requiredShortfallVnd:1},
];
for(const name of ['multi_day_payout_preview_v1','multi_day_floor_read_v1']){
 it.each(inconsistent)('rejects inconsistent '+name+' accounting %#',async(value)=>{
  const data=name==='multi_day_floor_read_v1'?floor(value):value;const client={rpc:vi.fn().mockResolvedValue({data,error:null})} as unknown as OpsClient;
  await expect(callMultiDayFloorRpc(client,name,{p_event_id:'event'})).rejects.toThrow('unverified');
 });
 it('preserves coherent '+name+' data and validates shortfall without counting fees as funding',async()=>{
  const values=[payout,{...payout,state:'REQUIRED_SHORTFALL',directPoolVnd:90,requiredShortfallVnd:10},{...payout,directPoolVnd:120,unallocatedPoolVnd:20}];
  for(const value of values){const data=name==='multi_day_floor_read_v1'?floor(value):value;const client={rpc:vi.fn().mockResolvedValue({data,error:null})} as unknown as OpsClient;
   await expect(callMultiDayFloorRpc(client,name,{p_event_id:'event'})).resolves.toEqual(data);}
 });
}

it.skipIf(process.env.VINPOKER_MULTIDAY1019_NATIVE!=='1')('accepts the captured original Main Event immutable finalization without recalculating current paid state',async()=>{
 const {readFileSync}=await import('node:fs');const data=JSON.parse(readFileSync('D:/Quy trình/output/reports/multiday1019-native-floor-before-local-20261027.json','utf8'));
 expect(data.eventId).toBe('dbb49f8d-7d47-4c2c-afd9-f57062c9971d');expect(data.finalization.obligations).toHaveLength(15);
 expect(data.finalization).toMatchObject({paidPlayerVnd:0,unpaidObligationVnd:2500000});const client={rpc:vi.fn().mockResolvedValue({data,error:null})} as unknown as OpsClient;
 await expect(callMultiDayFloorRpc(client,'multi_day_floor_read_v1',{p_event_id:data.eventId})).resolves.toEqual(data);
});
