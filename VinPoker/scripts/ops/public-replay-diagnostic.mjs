const names=new Set(['get_public_tournament_viewer_snapshot_v2','get_public_tournament_clock_summary','get_public_tournament_table_clock_v1','get_public_tournament_table_live_or_last_hand_v2','get_public_tournament_table_hand_v2','get_public_tournament_hand_v2']);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000?value:null;
const access=value=>value==='public'||value==='revoked'?value:'other';
/** Artifact trust boundary: never return IDs, rows, names, error text or tokens. */
export function publicReplayDiagnostic(name,value,status,scope){
 if(!names.has(name))return null;
 const object=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const row={rpc:name,httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,
  errorCode:typeof object.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(object.code)?object.code:null};
 if(name==='get_public_tournament_viewer_snapshot_v2')return {...row,ok:object.ok===true,access:access(object.access),
  tourMatches:typeof object.tournamentId==='string'&&object.tournamentId===scope.tour,
  tablesSection:!!object.sections?.tables&&typeof object.sections.tables==='object',
  catalogCount:Array.isArray(object.sections?.tables?.catalog)?count(object.sections.tables.catalog.length):null};
 if(name==='get_public_tournament_clock_summary')return {...row,rows:Array.isArray(value)?count(value.length):null,
  tourMatches:Array.isArray(value)&&value.some(item=>typeof item?.tournament_id==='string'&&item.tournament_id===scope.tour),
  runningFieldValid:Array.isArray(value)&&value.some(item=>item?.tournament_id===scope.tour&&typeof item.is_running==='boolean')};
 const table=name==='get_public_tournament_table_clock_v1'?object.table:object;
 return {...row,access:access(table?.access),tableMatches:typeof table?.tableId==='string'&&table.tableId===scope.table,
  handMatches:typeof table?.id==='string'&&table.id===scope.hand,
  state:['live','last_completed','waiting','inactive','closed'].includes(table?.state)?table.state:'other',
  actions:Array.isArray(table?.actions)?count(table.actions.length):null,
  players:Array.isArray(table?.players)?count(table.players.length):null};
}
