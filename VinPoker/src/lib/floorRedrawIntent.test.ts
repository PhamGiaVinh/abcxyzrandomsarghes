import { describe, expect, it } from 'vitest';
import { floorRedrawJournalKey, readFloorRedrawJournal, saveFloorRedrawJournal, clearFloorRedrawJournal,
  type FloorRedrawJournal, type FloorRedrawScope } from './floorRedrawIntent';

const actorId='10000000-0000-4000-8000-000000000001';
const tournamentId='10000000-0000-4000-8000-000000000002';
const requestId='10000000-0000-4000-8000-000000000003';
const table='10000000-0000-4000-8000-000000000004';
const batchId='10000000-0000-4000-8000-000000000005';
const scope:FloorRedrawScope={actorId,tournamentId,backendScope:'http://127.0.0.1:54329'};
const journal=():FloorRedrawJournal=>({version:1,backendScope:scope.backendScope,
  planIntent:{actorId,tournamentId,requestId,operation:'plan',targetMaxSeats:9,gameTableIds:[table]}});
const storage=()=>{const values=new Map<string,string>();return {
  getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,value:string)=>{values.set(key,value);},
  removeItem:(key:string)=>{values.delete(key);},
};};

describe('normal redraw durable intent boundary',()=>{
  it('persists only immutable intents, reloads all stages and clears by exact CAS',()=>{
    const s=storage(),key=floorRedrawJournalKey(scope),j=journal();
    const first=saveFloorRedrawJournal(s,scope,j,null);
    expect(readFloorRedrawJournal(s.getItem(key)!,scope)).toEqual(j);
    const next:FloorRedrawJournal={...j,applyIntent:{actorId,tournamentId,requestId:table,operation:'apply',batchId},
      continueIntent:{actorId,tournamentId,requestId:batchId,operation:'continue',batchId,expectedRedrawRevision:1}};
    const second=saveFloorRedrawJournal(s,scope,next,first);
    expect(readFloorRedrawJournal(second,scope)).toEqual(next);
    clearFloorRedrawJournal(s,scope,second);expect(s.getItem(key)).toBeNull();
  });
  it.each([
    (j:Record<string,unknown>)=>({...j,result:{status:'applied'}}),
    (j:Record<string,unknown>)=>({...j,version:2}),
    (j:Record<string,unknown>)=>({...j,backendScope:'http://other'}),
    (j:Record<string,unknown>)=>({...j,planIntent:{...journal().planIntent,actorId:table}}),
    (j:Record<string,unknown>)=>({...j,planIntent:{...journal().planIntent,tournamentId:table}}),
    (j:Record<string,unknown>)=>({...j,planIntent:{...journal().planIntent,gameTableIds:[table,table.toUpperCase()]}}),
    (j:Record<string,unknown>)=>({...j,planIntent:{...journal().planIntent,gameTableIds:[]}}),
    (j:Record<string,unknown>)=>({...j,planIntent:{...journal().planIntent,targetMaxSeats:10}}),
    (j:Record<string,unknown>)=>({...j,planIntent:{...journal().planIntent,requestId:'not-a-uuid'}}),
    (j:Record<string,unknown>)=>({...j,continueIntent:{actorId,tournamentId,requestId,operation:'continue',batchId,expectedRedrawRevision:1}}),
    (j:Record<string,unknown>)=>({...j,applyIntent:{actorId,tournamentId,requestId,operation:'apply',batchId},
      continueIntent:{actorId,tournamentId,requestId,operation:'continue',batchId:table,expectedRedrawRevision:1}}),
    (j:Record<string,unknown>)=>({...j,applyIntent:{actorId,tournamentId,requestId,operation:'apply',batchId},
      continueIntent:{actorId,tournamentId,requestId,operation:'continue',batchId,expectedRedrawRevision:-1}}),
  ])('rejects malformed/cross-scope journals without inventing a fresh intent (%#)',change=>{
    expect(()=>readFloorRedrawJournal(JSON.stringify(change(journal() as unknown as Record<string,unknown>)),scope)).toThrow();
  });
  it('separates backend, actor and tournament storage scopes',()=>{
    const key=floorRedrawJournalKey(scope);
    expect(floorRedrawJournalKey({...scope,backendScope:'http://127.0.0.1:54330'})).not.toBe(key);
    expect(floorRedrawJournalKey({...scope,actorId:table})).not.toBe(key);
    expect(floorRedrawJournalKey({...scope,tournamentId:table})).not.toBe(key);
  });
  it('refuses to overwrite or erase a journal changed by another workspace',()=>{
    const s=storage(),key=floorRedrawJournalKey(scope),raw=saveFloorRedrawJournal(s,scope,journal(),null);
    s.setItem(key,'another intent');
    expect(()=>saveFloorRedrawJournal(s,scope,journal(),raw)).toThrow('REDRAW_JOURNAL_CHANGED');
    expect(()=>clearFloorRedrawJournal(s,scope,raw)).toThrow('REDRAW_JOURNAL_CHANGED');
    expect(s.getItem(key)).toBe('another intent');
  });
  it('does not accept a storage write or clear which did not persist',()=>{
    const s=storage(),raw=JSON.stringify(journal()),key=floorRedrawJournalKey(scope);
    expect(()=>saveFloorRedrawJournal({...s,setItem:()=>{}},scope,journal(),null)).toThrow('REDRAW_JOURNAL_SAVE_FAILED');
    s.setItem(key,raw);
    expect(()=>clearFloorRedrawJournal({...s,removeItem:()=>{}},scope,raw)).toThrow('REDRAW_JOURNAL_CLEAR_FAILED');
  });
});
