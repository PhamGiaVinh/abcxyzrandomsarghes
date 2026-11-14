// Artifact boundary: retain scope/shape evidence, never rows, names or messages.
export function cashierWorklistDiagnostic(request,body,httpStatus,scope){
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const args=object(request)?request:{};
 const data=object(body)?body:{};
 const rows=Array.isArray(data.rows)?data.rows:[];
 const target=rows.find(row=>object(row)&&row.id===scope.registrationId);
 const bucket=value=>['counter','completed','waiting_seat','needs_review','all'].includes(value)?value:'other';
 const integer=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000?value:null;
 return {
  httpStatus:Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?httpStatus:null,
  clubMatches:args.p_club_id===scope.clubId,tourMatches:args.p_tournament_id===scope.tournamentId,
  queryEmpty:args.p_query==='',queryIsTarget:args.p_query===scope.registrationId,
  bucket:bucket(args.p_bucket),page:integer(args.p_page),limit:integer(args.p_limit),
  ok:data.ok===true,enabled:data.enabled===true,rowCount:Math.min(rows.length,1000000),
  targetPresent:!!target,targetStatus:target?(['pending','confirmed'].includes(target.status)?target.status:'other'):'missing',
  targetBucket:target?bucket(target.bucket):'missing',targetNameMatches:!!target&&target.player_name===scope.expectedName,
  errorCode:typeof data.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(data.code)?data.code:null,
 };
}
