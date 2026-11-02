import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {classifyProcessSwingResult} from '@/lib/dealerSwingOutcome';

// Execute the actual final response expression, NOT the whole handler/DB worker.
// Inputs are modeled. This locks the Edge-to-UI contract without enabling Auto.
const source=readFileSync(resolve('supabase/functions/process-swing/index.ts'),'utf8').replaceAll('\r','');
const anchor='    return new Response(\n      JSON.stringify({\n        ok: true,\n        // Direct internal/manual invocations';
const start=source.indexOf(anchor);
const end=source.indexOf('\n  } catch (err)',start);
if(start<0||end<=start||source.indexOf(anchor,start+1)>=0)throw Error('Actual final response seam changed; inspect current contract');
const respond=new Function('dispatchFinalState','dispatchErrorCode','dispatchContext','totalExecutionMs','metricsPerClub','dispatchDiagnostics','dryRun','corsHeaders',source.slice(start,end));

it.each([false,true])('classifies the actual completed Edge response with dry_run=%s without pretending mixed success means swings',async dryRun=>{
 const response:Response=respond('completed',null,null,12,{TEST:{total:3,success:3,failed:0,no_dealer:0,tg_failed:0,skipped:0}},[],dryRun,{});
 const data=await response.json();
 expect(data).not.toHaveProperty('processed_count');
 expect(data.metrics.TEST.success).toBe(3);
 expect(classifyProcessSwingResult(data)).toEqual(dryRun
  ?{kind:'info',message:'Đã hoàn tất mô phỏng Swing; đây không phải xác nhận đổi dealer.'}
  :{kind:'success',message:'Đợt xử lý Swing đã hoàn tất. Đang cập nhật trạng thái bàn.'});
});
it.each(['partial','locked','business_failed','dependency_unavailable'])('does not toast success for actual Edge state %s',async status=>{
 const response:Response=respond(status,'TEST_FAILURE',null,12,{},[],false,{});
 expect(classifyProcessSwingResult(await response.json()).kind).toBe(status==='locked'?'warning':'error');
});
