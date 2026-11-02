import {expect,it} from 'vitest';
import {getReadyRestThreshold} from '../../supabase/functions/_shared/readySwingDuration.ts';
import type {DealerOperationalTable} from '../../supabase/functions/_shared/dealerOperationalTables.ts';
const table:DealerOperationalTable={id:'physical',table_session_id:'session',table_type:'tournament',tournament_id:'tour',table_name:'TEST',shift_id:null,current_blind_level:null,opened_at:null,dealer_open_operation_id:null};
function client(data:unknown,error:unknown=null){
 const filters:Record<string,unknown>={};const calls:string[]=[];
 const q={select:(columns:string)=>{calls.push(columns);return q;},eq:(key:string,value:unknown)=>{filters[key]=value;return q;},maybeSingle:async()=>({data,error})};
 return {filters,calls,from:(name:string)=>{expect(name).toBe('swing_config');return q;}};
}
it('uses tournament default15 independently of another cash policy',async()=>{
 const admin=client(null);expect(await getReadyRestThreshold(admin,'club',table)).toBe(15);
 expect(admin.filters).toEqual({club_id:'club',table_type:'tournament'});
 expect(admin.calls).toEqual(['break_duration_minutes,min_inter_swing_rest_minutes']);
});
it.each(['cash','vip'])('binds the configured %s rest policy to the verified session',async type=>{
 const admin=client({break_duration_minutes:20,min_inter_swing_rest_minutes:10});
 expect(await getReadyRestThreshold(admin,'club',{...table,table_type:type,tournament_id:null})).toBe(20);
 expect(admin.filters.table_type).toBe(type);
});
it.each([
 {break_duration_minutes:null,min_inter_swing_rest_minutes:null,expected:15},
 {break_duration_minutes:0,min_inter_swing_rest_minutes:10,expected:15},
 {break_duration_minutes:25,min_inter_swing_rest_minutes:30,expected:30},
])('keeps the hard floor and larger configured minimum: $expected',async({expected,...row})=>{
 expect(await getReadyRestThreshold(client(row),'club',table)).toBe(expected);
});
it('does not replace a failed policy read with the default15',async()=>{
 await expect(getReadyRestThreshold(client(null,{message:'503'}),'club',table)).rejects.toThrow('ready_rest_policy_unverified');
});
it.each([undefined,[],{},'bad',{break_duration_minutes:20},
 {break_duration_minutes:-1,min_inter_swing_rest_minutes:15},
 {break_duration_minutes:15,min_inter_swing_rest_minutes:1.5},
 {break_duration_minutes:'20',min_inter_swing_rest_minutes:15},
 {break_duration_minutes:Infinity,min_inter_swing_rest_minutes:15},
 {break_duration_minutes:15,min_inter_swing_rest_minutes:Number.MAX_SAFE_INTEGER+1},
])('rejects malformed successful policy data %j',async row=>{
 await expect(getReadyRestThreshold(client(row),'club',table)).rejects.toThrow('ready_rest_policy_invalid');
});
it.each([{...table,table_session_id:''},{...table,tournament_id:null},{...table,table_type:'unknown'}])('rejects an unbound or unknown table context',async row=>{
 const admin=client(null);await expect(getReadyRestThreshold(admin,'club',row)).rejects.toThrow('ready_rest_context_invalid');
 expect(admin.calls).toEqual([]);
});
