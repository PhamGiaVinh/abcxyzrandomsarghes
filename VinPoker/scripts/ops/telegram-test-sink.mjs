import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

// Disposable provider HTTP sink. There is no Telegram token,provider call or
// credential/environment lookup. Both attached Docker networks remain fenced.
export function createTelegramTestSink(){
 const messages=[];let failGroup=false;
 const json=(response,status,body)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(body));};
 return createServer(async(request,response)=>{
  const path=new URL(request.url,'http://fixture.invalid').pathname;
  if(request.method==='GET'&&path==='/health')return json(response,200,{ok:true});
  if(request.method==='GET'&&path==='/snapshot')return json(response,200,{messages:[...messages]});
  if(request.method!=='POST'||!['/sendMessage','/control'].includes(path))return json(response,404,{ok:false});
  if(request.headers.authorization||request.headers.apikey)return json(response,400,{ok:false,error:'credential_header_denied'});
  let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>16384){request.destroy();return;}}
  let body;try{body=JSON.parse(raw);}catch{return json(response,400,{ok:false,error:'invalid_json'});}
  if(path==='/control'){
   if(typeof body?.failGroup!=='boolean'||Object.keys(body).length!==1)return json(response,400,{ok:false});
   failGroup=body.failGroup;return json(response,200,{ok:true});
  }
  if(typeof body?.chat_id!=='string'||!['-1000000000001',...Array.from({length:22},(_,n)=>String(9900000000001+n))].includes(body.chat_id)
   ||typeof body.text!=='string'||body.text.length>4096||body.parse_mode!=='HTML')return json(response,400,{ok:false,error:'fixture_scope_denied'});
  const accepted=!(failGroup&&body.chat_id==='-1000000000001');
  messages.push({chatId:body.chat_id,text:body.text,parseMode:body.parse_mode,accepted,receivedAt:Date.now()});
  return json(response,accepted?200:503,accepted?{ok:true,result:{message_id:messages.length}}:{ok:false,description:'ISOLATED_TEST_PROVIDER_UNAVAILABLE'});
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.VINPOKER_TELEGRAM_TEST_SINK!=='isolated-cashier-only')throw Error('Explicit isolated sink required');
 createTelegramTestSink().listen(8788,'0.0.0.0');
}
