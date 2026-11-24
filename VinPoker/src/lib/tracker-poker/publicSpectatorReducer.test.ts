import { describe, expect, it } from "vitest";
import { reducePublicSpectatorPayload } from "../../../supabase/functions/_shared/publicSpectatorReducer";

describe("reducePublicSpectatorPayload", () => {
  it("moves committed chips from live stacks into pot without changing ranking or input", () => {
    const payload = { items: [{ trackerState: "live", buttonSeat: 1, pot: 0,
      players: [
        { playerId: "A", entryNumber: 2, seatNumber: 1, startingStack: 1000, stack: 1000 },
        { playerId: "B", entryNumber: 1, seatNumber: 2, startingStack: 1000, stack: 1000 },
      ], actions: [
        { playerId: "A", entryNumber: 2, street: "preflop", actionType: "post_sb", amount: 50, order: 1 },
        { playerId: "B", entryNumber: 1, street: "preflop", actionType: "post_bb", amount: 100, order: 2 },
        { playerId: "A", entryNumber: 2, street: "preflop", actionType: "all_in", amount: 950, order: 3 },
        { playerId: "B", entryNumber: 1, street: "preflop", actionType: "call", amount: 900, order: 4 },
      ] }] };
    const result = reducePublicSpectatorPayload("tables", payload) as typeof payload;
    expect(result.items[0].pot).toBe(2000);
    expect(result.items[0].players.map(p => p.stack)).toEqual([0, 0]);
    expect(result.items[0]).not.toHaveProperty("actions");
    expect(payload.items[0].pot).toBe(0);
    expect(reducePublicSpectatorPayload("ranking", payload)).toBe(payload);
    expect(reducePublicSpectatorPayload("tables", payload)).toEqual(result);
    payload.items[0].actions[0].entryNumber = 1;
    expect((reducePublicSpectatorPayload("tables", payload) as typeof payload).items[0].pot).toBeNull();
  });

  it("groups adjacent open payout bands without turning prize into a total", () => {
    const result = reducePublicSpectatorPayload("payout", { published: true, items: [
      { fromPlace: 3, toPlace: 3, amountPerPlayer: 100, playerName: null, avatarUrl: null, resultStatus: "open" },
      { fromPlace: 4, toPlace: 4, amountPerPlayer: 100, playerName: null, avatarUrl: null, resultStatus: "open" },
      { fromPlace: 5, toPlace: 5, amountPerPlayer: 80, playerName: null, avatarUrl: null, resultStatus: "open" },
    ] }) as { items: Array<{ fromPlace: number; toPlace: number; amountPerPlayer: number }> };
    expect(result.items).toEqual([
      expect.objectContaining({ fromPlace: 3, toPlace: 4, amountPerPlayer: 100 }),
      expect.objectContaining({ fromPlace: 5, toPlace: 5, amountPerPlayer: 80 }),
    ]);
  });

  it("does not group confirmed recipients", () => {
    const item = { fromPlace: 1, toPlace: 1, amountPerPlayer: 100, playerName: "A", avatarUrl: null, resultStatus: "official" } as const;
    const result = reducePublicSpectatorPayload("payout", { items: [item] }) as { items: unknown[] };
    expect(result.items).toEqual([item]);
  });
});

it('projects main and every side layer on the server without changing committed chips', () => {
  const payload={items:[{trackerState:'live',buttonSeat:1,players:[1000,400,1000].map((stack,i)=>({playerId:String(i),entryNumber:1,seatNumber:i+1,startingStack:stack})),actions:[1000,400,1000].map((amount,i)=>({playerId:String(i),entryNumber:1,street:'preflop',actionType:'all_in',amount,order:i+1}))}]};
  const result=reducePublicSpectatorPayload('tables',payload) as {items:{pot:number;potLayers:number[]}[]};
  expect(result.items[0].pot).toBe(2400);
  expect(result.items[0].potLayers).toEqual([1200,1200]);
});

it('keeps dead BB ante in the main layer and does not guess a missing ante rule', () => {
  const table={trackerState:'live',buttonSeat:1,bigBlindAnteOnly:true,players:[{playerId:'a',entryNumber:1,seatNumber:1,startingStack:1000},{playerId:'b',entryNumber:1,seatNumber:2,startingStack:1000}],actions:[
    {playerId:'a',entryNumber:1,street:'preflop',actionType:'call',amount:200,order:1},
    {playerId:'b',entryNumber:1,street:'preflop',actionType:'post_ante',amount:200,order:2},
    {playerId:'b',entryNumber:1,street:'preflop',actionType:'post_bb',amount:200,order:3},
  ]};
  const project=(row:unknown)=>(reducePublicSpectatorPayload('tables',{items:[row]}) as {items:{pot:number;potLayers:number[]|null}[]}).items[0];
  expect(project(table)).toMatchObject({pot:600,potLayers:[600]});
  expect(project({...table,bigBlindAnteOnly:undefined})).toMatchObject({pot:600,potLayers:null});
  const completed={...table,trackerState:'last_completed',pot:600,players:table.players.map((player,i)=>({...player,stack:i===0?1400:600}))};
  const historical=project(completed);
  expect(historical.potLayers).toEqual([600]);
  expect(historical).toMatchObject({players:[{stack:1400},{stack:600}]});
  expect(project({...completed,actions:undefined})).toMatchObject({pot:600,potLayers:null,players:[{stack:1400},{stack:600}]});
  expect(project({...completed,bigBlindAnteOnly:false})).toMatchObject({pot:600,potLayers:null,players:[{stack:1400},{stack:600}]});
});

it("publishes each seat's last confirmed action and fold state without changing chip totals", () => {
  const players = [{ playerId: 'a', entryNumber: 1, seatNumber: 1, startingStack: 1000 }, { playerId: 'b', entryNumber: 1, seatNumber: 2, startingStack: 1000 }];
  const payload = { items: [{ tableId: '1', trackerState: 'live', buttonSeat: 1, players, actions: [
    { playerId: 'a', entryNumber: 1, street: 'preflop', actionType: 'post_sb', amount: 50, order: 1 },
    { playerId: 'b', entryNumber: 1, street: 'preflop', actionType: 'post_bb', amount: 100, order: 2 },
    { playerId: 'a', entryNumber: 1, street: 'preflop', actionType: 'fold', amount: 0, order: 3 },
  ] }, { tableId: '2', trackerState: 'live', buttonSeat: 1, players, actions: [] }] };
  const result = reducePublicSpectatorPayload('tables', payload) as { items: { pot: number; players: { stack: number; isFolded: boolean; lastAction: unknown }[] }[] };
  expect(result.items[0].players[0]).toMatchObject({ isFolded: true, stack: 950, lastAction: { actionType: 'fold', amount: 0 } });
  expect(result.items[1].players[0]).toMatchObject({ isFolded: false, stack: 1000, lastAction: null });
  for (const table of result.items) expect(table.pot + table.players.reduce((sum, player) => sum + player.stack, 0)).toBe(2000);
});
