import {
  computePotBreakdown,
  contributionsFromActions,
  type PotBreakdown,
} from "./potEngine";

export interface LiveDisplayAction {
  player_id: string;
  action_type: string;
  action_amount: number | null;
}

export function deriveLiveStreet(handNumber:number|null,boardCount:number,revealed:boolean,inProgress:boolean){
  if(!handNumber)return null;
  // Players may expose their hole cards before an all-in board has run out.
  if(revealed&&(!inProgress||boardCount>=5))return 'showdown';
  if(boardCount>=5)return 'river';
  if(boardCount===4)return 'turn';
  if(boardCount>=3)return 'flop';
  return 'preflop';
}

export function deriveLiveHandDisplay(args: {
  startingStacks: Map<string, number>;
  actions: LiveDisplayAction[];
  inProgress: boolean;
}): {
  remainingStacks: Map<string, number>;
  contributions: Map<string, number>;
  potBreakdown: PotBreakdown;
  potSize: number;
} {
  const contributionRows = contributionsFromActions(args.actions);
  const contributions = new Map(contributionRows.map((row) => [row.player_id, row.total_bet]));
  const remainingStacks = new Map<string, number>();
  for (const [playerId, startingStack] of args.startingStacks) {
    remainingStacks.set(playerId, Math.max(0, startingStack - (contributions.get(playerId) ?? 0)));
  }
  const potBreakdown = computePotBreakdown(contributionRows);
  return {
    remainingStacks,
    contributions,
    potBreakdown,
    potSize: args.inProgress ? potBreakdown.totalCommitted : potBreakdown.totalPot,
  };
}
