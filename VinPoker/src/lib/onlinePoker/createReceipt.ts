export type OnlineCreatePayload={name:string;sb:string;bb:string;buyin:string;maxSeats:number};
export type OnlineCreateReceipt={request_id:string;replayed:boolean}&(
 {outcome:'ok';table_id:string;seat_no:1}|{outcome:'disabled'|'bad_blinds'|'bad_buyin'|'bad_max_seats'});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
function requireValue(value:unknown):asserts value {if(!value)throw Error('ONLINE_CREATE_RECEIPT_INVALID');}
export function parseOnlineCreateReceipt(value:unknown,requestId:string):OnlineCreateReceipt {
 requireValue(uuid(requestId)&&object(value)&&value.request_id===requestId&&typeof value.replayed==='boolean');
 requireValue(value.outcome==='ok'?uuid(value.table_id)&&value.seat_no===1:
  ['disabled','bad_blinds','bad_buyin','bad_max_seats'].includes(String(value.outcome)));
 return value as OnlineCreateReceipt;
}
export function parseOnlineCreateResolution(value:unknown,requestId:string,payload:OnlineCreatePayload):
 {state:'missing'}|{state:'resolved';receipt:OnlineCreateReceipt}{
 requireValue(uuid(requestId)&&object(value)&&value.request_id===requestId);
 if(value.outcome==='not_found'){requireValue(!('receipt' in value)&&!('payload' in value));return {state:'missing'};}
 requireValue(value.outcome==='found'&&object(value.payload));
 const returned=value.payload;
 const expected={name:payload.name,sb:Number(payload.sb),bb:Number(payload.bb),buyin:Number(payload.buyin),maxSeats:payload.maxSeats};
 requireValue([payload.sb,payload.bb,payload.buyin].every(v=>/^[1-9][0-9]*$/.test(v)&&Number.isSafeInteger(Number(v)))
  &&Object.keys(returned).length===Object.keys(expected).length
  &&Object.entries(expected).every(([key,v])=>returned[key]===v));
 return {state:'resolved',receipt:parseOnlineCreateReceipt(value.receipt,requestId)};
}
