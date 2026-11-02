import {describe,expect,it} from 'vitest';
import {parseOnlineCreateReceipt,parseOnlineCreateResolution} from '@/lib/onlinePoker/createReceipt';
const key='8bebc4cd-2246-4835-b006-d62d191618bb',table='e217f4bd-d708-4ea5-93c3-f64371a8afff';
const payload={name:'TEST',sb:'25',bb:'50',buyin:'5000',maxSeats:9};
const receipt={outcome:'ok',request_id:key,replayed:false,table_id:table,seat_no:1};
const found={outcome:'found',request_id:key,payload:{...payload,sb:25,bb:50,buyin:5000},receipt};
describe('online create strict receipt contract',()=>{
 it.each([null,{},[],{...receipt,request_id:'other'},{...receipt,outcome:'unknown'},{...receipt,replayed:null},{...receipt,table_id:'not-uuid'},{...receipt,seat_no:2}])('rejects malformed or unrelated receipt %j',value=>{
  expect(()=>parseOnlineCreateReceipt(value,key)).toThrow('ONLINE_CREATE_RECEIPT_INVALID');
 });
 it('validates creation, replay and known terminal business denial',()=>{
  expect(parseOnlineCreateReceipt(receipt,key)).toEqual(receipt);
  expect(parseOnlineCreateReceipt({...receipt,replayed:true},key).replayed).toBe(true);
  expect(parseOnlineCreateReceipt({outcome:'disabled',request_id:key,replayed:false},key).outcome).toBe('disabled');
 });
 it('distinguishes absence from a matching committed receipt without issuing a write',()=>{
  expect(parseOnlineCreateResolution({outcome:'not_found',request_id:key},key,payload)).toEqual({state:'missing'});
  expect(parseOnlineCreateResolution(found,key,payload)).toEqual({state:'resolved',receipt});
 });
 it.each(['name','sb','bb','buyin','maxSeats'])('requires exact frozen payload field %s',field=>{
  expect(()=>parseOnlineCreateResolution({...found,payload:{...found.payload,[field]:field==='name'?'different':999}},key,payload)).toThrow();
 });
 it('rejects a mismatched nested request identity',()=>{
  expect(()=>parseOnlineCreateResolution({...found,receipt:{...receipt,request_id:'different'}},key,payload)).toThrow();
 });
 it('rejects an ambiguous not-found response containing a receipt',()=>{
  expect(()=>parseOnlineCreateResolution({outcome:'not_found',request_id:key,receipt},key,payload)).toThrow();
 });
});
