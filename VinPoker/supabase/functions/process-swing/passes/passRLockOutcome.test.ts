import { assertEquals } from "jsr:@std/assert@1";
const source=(await Deno.readTextFile(new URL("./passR-rotation-planner.ts",import.meta.url))).replaceAll("\r","");
const start=source.indexOf("    const outcome = (lockResult as any)?.outcome;");
const end=source.indexOf("\n    locked++;",start);
if(start<0||end<=start)throw Error("actual rotation lock outcome seam missing");
const body=source.slice(start,end).replace("(lockResult as any)","lockResult");
for(const outcome of ["error","unknown",null,"race_lost","dealer_unavailable","rest_guard","locked"]){
 Deno.test(`actual rotation lock handler classifies ${outcome}`,()=>{
  const errors: Array<{scope:string;error:string}>=[];
  new Function("lockResult","errors","row","console",`for(const once of [1]){${body}}`)(
   outcome===null?null:{outcome,detail:"fixture SQL failure"},errors,{table_id:"table"},{log(){}},
  );
  assertEquals(errors.length,["error","unknown",null].includes(outcome)?1:0);
  if(errors.length)assertEquals(errors[0].error.includes("fixture SQL failure"),false);
 });
}
