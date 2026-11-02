import {describe,it,expect} from 'vitest';
import {getReadySwingDuration} from '../../supabase/functions/_shared/readySwingDuration.ts';
import type {DealerOperationalTable} from '../../supabase/functions/_shared/dealerOperationalTables.ts';
const table={id:'physical',table_session_id:'session',table_type:'tournament',tournament_id:'tour'} as DealerOperationalTable;
function client({override=null,tour=20,club=30,error=null}:{override?:number|null;tour?:number|null;club?:number|null;error?:string|null}={}){
 const queries:{name:string;filters:Record<string,unknown>}[]=[];
 return {queries,from(name:string){const filters:Record<string,unknown>={};queries.push({name,filters});const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q;},
  maybeSingle:async()=>({data:(name==='tournaments'&&tour===null)?null:{swing_duration_minutes:({swing_configs:override,tournaments:tour,swing_config:club} as Record<string,number|null>)[name]},error:name===error?{code:'503'}:null})};return q;}};
}
describe('Ready uses configured exact-session duration',()=>{
 it.each([{override:25,tour:20,club:30,expected:25},{override:null,tour:20,club:30,expected:20}])('table override then exact tournament: $expected',async options=>{
  const admin=client(options);expect(await getReadySwingDuration(admin,'club',table)).toBe(options.expected);
  expect(admin.queries.find(q=>q.name==='tournaments')?.filters).toEqual({club_id:'club',id:'tour'});
  expect(admin.queries.find(q=>q.name==='swing_configs')?.filters).toEqual({club_id:'club',scope_type:'table',scope_id:'physical'});
 });
 it.each(['cash','vip'])('uses own %s config without tournament lookup',async type=>{
  const admin=client({club:type==='cash'?35:null,override:type==='vip'?35:null});expect(await getReadySwingDuration(admin,'club',{...table,table_type:type,tournament_id:null})).toBe(35);
  expect(admin.queries.map(q=>q.name)).not.toContain('tournaments');
  expect(admin.queries.find(q=>q.name==='swing_config')?.filters.table_type).toBe(type);
 });
 it('preserves default30 when optional cash configuration is absent',async()=>{
  expect(await getReadySwingDuration(client({club:null}),'club',{...table,table_type:'cash',tournament_id:null})).toBe(30);
 });
 it.each(['swing_configs','swing_config','tournaments'])('failed %s read cannot become default or success',async error=>{
  await expect(getReadySwingDuration(client({error}),'club',table)).rejects.toThrow('swing_duration_unverified');
 });
 it('missing canonical tournament fails closed',async()=>{
  await expect(getReadySwingDuration(client({tour:null}),'club',table)).rejects.toThrow('swing_duration_unverified');
 });
 it.each([0,-1,NaN,Infinity,1.5])('invalid configured value %s is rejected',async override=>{
  await expect(getReadySwingDuration(client({override}),'club',table)).rejects.toThrow('swing_duration_invalid');
 });
});
