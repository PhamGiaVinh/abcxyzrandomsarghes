const kinds=['finalize','qualify','approve','correction','rules','end-flight','bag-release','prize-configuration','individual-results'] as const;
type Kind=typeof kinds[number];
export const eventJournalKey=(kind:Kind,actor:string,event:string)=>`vinpoker:multiday-${kind}:v1:${actor}:${event}`;
/** Synchronous storage fence shared by retained event write consumers. */
export function persistEventJournal(storage:Pick<Storage,'getItem'|'setItem'>,kind:Kind,actor:string,event:string,raw:string){
 const key=eventJournalKey(kind,actor,event);
 const previous=storage.getItem(key);
 if(kinds.some(other=>other!==kind&&storage.getItem(eventJournalKey(other,actor,event))!==null)
  ||(previous!==null&&previous!==raw))throw Error('MULTIDAY_EVENT_JOURNAL_PENDING');
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('MULTIDAY_EVENT_JOURNAL_SAVE_FAILED');
}
export function clearEventJournal(storage:Pick<Storage,'getItem'|'removeItem'>,kind:Kind,actor:string,event:string,raw:string){
 const key=eventJournalKey(kind,actor,event);
 if(storage.getItem(key)!==raw)throw Error('MULTIDAY_EVENT_JOURNAL_CHANGED');
 storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('MULTIDAY_EVENT_JOURNAL_CLEAR_FAILED');
}
