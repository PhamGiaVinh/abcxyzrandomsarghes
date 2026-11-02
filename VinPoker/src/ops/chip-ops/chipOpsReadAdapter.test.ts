import { describe, expect, it } from "vitest";
import { loadIssuedChipInventory,loadChipOpsTournamentOptions,loadIssuedStackSummary,parseIssuedChipInventory, parseIssuedStackSummary } from "./chipOpsReadAdapter";

describe("Chip Master issued snapshot", () => {
  it("keeps stack sets, physical chip counts and chip values separate", () => {
    const stacks = parseIssuedStackSummary(
      [
        { id: "standard", name: "Standard", stack_value: 50000 },
        { id: "deep", name: "Deep", stack_value: 100000 },
      ],
      [{ stack_template_id: "standard", issued_count: 10 }, { stack_template_id: "deep", issued_count: 2 }],
    );
    const inventory = parseIssuedChipInventory({
      tournament_id: "tour-1",
      denominations: [
        { denomination_id: "d1", value: 100, color: "red", issued_count_total: 20 },
        { denomination_id: "d2", value: 1000, color: "blue", issued_count_total: 50 },
      ],
      total_value: 52000,
      reconciliation_value: 52000,
      reconciled: true,
    }, "tour-1");
    expect(stacks.totalIssuedStacks).toBe(12);
    expect(inventory.totalIssuedChips).toBe(70);
    expect(inventory.totalValue).toBe(52000);
  });

  it("rejects an issuance row outside the selected template set", () => {
    expect(() => parseIssuedStackSummary(
      [{ id: "standard", name: "Standard", stack_value: 50000 }],
      [{ stack_template_id: "other-tour", issued_count: 1 }],
    )).toThrow("CHIP_OPS_ISSUANCE_MALFORMED");
  });
});

function readClient(...data:unknown[]){return {from:()=>{const value=data.shift();const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,in:()=>q,limit:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:value,error:null}).then(resolve)};return q;}} as unknown as Parameters<typeof loadIssuedStackSummary>[0];}
it('does not turn an unverified tournament list into a verified empty selection',async()=>{
 await expect(loadChipOpsTournamentOptions(readClient(null),'club')).rejects.toThrow('CHIP_OPS_TOURNAMENT_READ_FAILED');
});
it('does not turn a null template response into zero issued stacks',async()=>{
 await expect(loadIssuedStackSummary(readClient(null),'tour')).rejects.toThrow('CHIP_OPS_TEMPLATE_MALFORMED');
});
it('does not turn a null issuance response into zero issued stacks',async()=>{
 await expect(loadIssuedStackSummary(readClient([{id:'template',name:'TEST',stack_value:20000}],null),'tour')).rejects.toThrow('CHIP_OPS_ISSUANCE_MALFORMED');
});
it('preserves a genuinely verified empty template list as zero',async()=>{
 await expect(loadIssuedStackSummary(readClient([]),'tour')).resolves.toEqual({templates:[],totalIssuedStacks:0});
});


it("passes one owned abort signal to every issued-inventory read", async () => {
 const controller=new AbortController();const calls:{table:string;signal:AbortSignal}[]=[];
 const client={from:(table:string)=>{const data=table==='tournaments'?[]:table==='stack_template'?[{id:'t',name:'TEST',stack_value:20000}]:[];
 const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,in:()=>q,limit:()=>q,abortSignal:(signal:AbortSignal)=>{calls.push({table,signal});return q;},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve)};return q;},rpc:()=>({abortSignal:(signal:AbortSignal)=>{calls.push({table:'inventory',signal});return Promise.resolve({data:{tournament_id:'tour',denominations:[],total_value:0,reconciliation_value:0,reconciled:true},error:null});}})} as unknown as Parameters<typeof loadIssuedStackSummary>[0];
 await loadChipOpsTournamentOptions(client,'club',controller.signal);
 await loadIssuedChipInventory(client,'tour',controller.signal);
 await loadIssuedStackSummary(client,'tour',controller.signal);
 expect(calls.map(c=>c.table)).toEqual(['tournaments','inventory','stack_template','stack_template_issuance']);
 expect(calls.every(c=>c.signal===controller.signal)).toBe(true);
});

it("does not launch an issuance read when a late template result arrives after abort", async () => {
 const controller=new AbortController();let reads=0;
 const client={from:()=>{reads++;const q={select:()=>q,eq:()=>q,order:()=>q,abortSignal:()=>q,then:(resolve:(v:unknown)=>unknown)=>{controller.abort();return Promise.resolve({data:[{id:'t',name:'TEST',stack_value:20000}],error:null}).then(resolve);}};return q;}} as unknown as Parameters<typeof loadIssuedStackSummary>[0];
 await expect(loadIssuedStackSummary(client,'tour',controller.signal)).rejects.toThrow('Aborted');
 expect(reads).toBe(1);
});
