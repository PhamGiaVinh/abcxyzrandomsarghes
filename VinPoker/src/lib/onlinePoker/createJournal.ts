import type {OnlineCreatePayload} from './createReceipt';
export type OnlineCreateJournal={version:1;actorId:string;backend:string;requestId:string;payload:OnlineCreatePayload};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function requireValue(value:unknown):asserts value {if(!value)throw Error('ONLINE_CREATE_JOURNAL_INVALID');}
export function sameOnlineCreateJournal(a:OnlineCreateJournal,b:OnlineCreateJournal):boolean{
 return a.actorId===b.actorId&&a.backend===b.backend&&a.requestId===b.requestId
  &&(['name','sb','bb','buyin','maxSeats'] as const).every(key=>a.payload[key]===b.payload[key]);
}
export function onlineCreateJournalKey(actorId:string,backend:string):string{
 requireValue(uuid(actorId)&&typeof backend==='string');
 const url=new URL(backend);
 requireValue(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash);
 return `vinpoker:online-create:v1:${encodeURIComponent(backend)}:${actorId}`;
}
export function parseOnlineCreateJournal(raw:string,actorId:string,backend:string):OnlineCreateJournal{
 onlineCreateJournalKey(actorId,backend);
 const value:unknown=JSON.parse(raw);
 requireValue(object(value)&&value.version===1&&value.actorId===actorId&&value.backend===backend&&uuid(value.requestId)&&object(value.payload));
 const p=value.payload;
 requireValue(Object.keys(p).length===5&&typeof p.name==='string'&&p.name.length<=40
  &&[p.sb,p.bb,p.buyin].every(v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&Number.isSafeInteger(Number(v)))
  &&typeof p.maxSeats==='number'&&Number.isInteger(p.maxSeats)&&p.maxSeats>=2&&p.maxSeats<=10);
 return {version:1,actorId,backend,requestId:value.requestId,payload:{name:p.name,sb:p.sb as string,bb:p.bb as string,buyin:p.buyin as string,maxSeats:p.maxSeats}};
}
export function readOnlineCreateJournal(storage:Store,actorId:string,backend:string):{raw:string|null;intent:OnlineCreateJournal|null}{
 const raw=storage.getItem(onlineCreateJournalKey(actorId,backend));
 return {raw,intent:raw===null?null:parseOnlineCreateJournal(raw,actorId,backend)};
}
export function saveOnlineCreateJournal(storage:Store,intent:OnlineCreateJournal):string{
 const key=onlineCreateJournalKey(intent.actorId,intent.backend),raw=JSON.stringify(intent);
 parseOnlineCreateJournal(raw,intent.actorId,intent.backend);
 if(storage.getItem(key)!==null)throw Error('ONLINE_CREATE_JOURNAL_EXISTS');
 storage.setItem(key,raw);
 if(storage.getItem(key)!==raw)throw Error('ONLINE_CREATE_JOURNAL_SAVE_FAILED');
 return raw;
}
export function clearOnlineCreateJournal(storage:Store,intent:OnlineCreateJournal,expectedRaw:string):void{
 const key=onlineCreateJournalKey(intent.actorId,intent.backend);
 if(storage.getItem(key)!==expectedRaw)throw Error('ONLINE_CREATE_JOURNAL_CHANGED');
 const stored=parseOnlineCreateJournal(expectedRaw,intent.actorId,intent.backend);
 if(!sameOnlineCreateJournal(stored,intent))throw Error('ONLINE_CREATE_JOURNAL_CHANGED');
 storage.removeItem(key);
 if(storage.getItem(key)!==null)throw Error('ONLINE_CREATE_JOURNAL_CLEAR_FAILED');
}
