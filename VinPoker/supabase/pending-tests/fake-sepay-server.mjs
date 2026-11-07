import http from 'node:http';
import {pathToFileURL} from 'node:url';
export const fixtureAccountId='a9000000-0000-4000-8000-000000000001';
export function createFakeSePayServer(referenceCode){
 if(!referenceCode)throw Error('missing REFERENCE_CODE');
 const transactionDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()-1000));
 const pagination={total:1,current_page:1,last_page:1,has_more:false};
 return http.createServer((request,response)=>{
  const url=new URL(request.url,'http://fake-sepay');
  const send=(status,body={})=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(body));};
  if(!['/v2/bank-accounts','/v2/transactions'].includes(url.pathname))return send(404);
  if(request.headers.authorization!=='Bearer cashier-edge-fake-token')return send(401);
  if(request.method!=='GET'||url.searchParams.get('page')!=='1')return send(400);
  if(url.pathname==='/v2/bank-accounts'){
   if(url.searchParams.get('q')!=='999100001')return send(400);
   return send(200,{data:[{id:fixtureAccountId,account_number:'999100001',active:true}],meta:{pagination}});
  }
  if(url.searchParams.get('bank_account_id')!==fixtureAccountId||url.searchParams.get('transaction_date_sort')!=='asc'||!url.searchParams.get('transaction_date_from')||!url.searchParams.get('transaction_date_to'))return send(400);
  return send(200,{data:[{id:'cashier-edge-bank-1',bank_account_id:fixtureAccountId,account_number:'999100001',bank_brand_name:'TEST BANK',amount_in:6600000,amount_out:0,transfer_type:'in',transaction_content:referenceCode,reference_number:'EDGE-TEST-REF-1',transaction_date:transactionDate}],meta:{pagination}});
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createFakeSePayServer(process.env.REFERENCE_CODE).listen(8787,'0.0.0.0');