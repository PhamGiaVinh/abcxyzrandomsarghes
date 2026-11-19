import { describe, expect, it } from 'vitest';
import { applyAction, createHand, makeDeck, shuffledDeck } from '@engine/index.ts';
import { deserializeAuthoritative, serializeAuthoritative } from '../../supabase/functions/_shared/pokerAdapter/index.ts';
import { mulberry32, si, totalChips } from './fixtures';

const config = { handId: 'ante', tableId: 'table', handNo: 1, buttonSeat: 1, sb: 5n, bb: 10n };

describe('explicit big-blind-first ante', () => {
  it('pays only the remaining chips after the live blind and persists the dead ante', () => {
    const { state, events } = createHand({ ...config, bigBlindAnte: 10n }, makeDeck(), si([100n, 14n]));
    expect(state.seats.find(seat => seat.seat === 2)).toMatchObject({
      stack: 0n, committed: 10n, totalCommitted: 14n, deadAnte: 4n, status: 'allin',
    });
    expect(state.currentBet).toBe(10n);
    expect(state.pot).toBe(19n);
    expect(events.find(event => event.type === 'blinds_posted')?.payload).toMatchObject({ bbSeat: 2, ante: '4' });

    const wire = serializeAuthoritative(state);
    const hydrated = deserializeAuthoritative(wire.stateJson, wire.liveDeck, wire.holes);
    expect(hydrated.config.bigBlindAnte).toBe(10n);
    expect(hydrated.seats.find(seat => seat.seat === 2)?.deadAnte).toBe(4n);

    const folded = applyAction(hydrated, { type: 'fold', seat: 1 });
    expect(folded.error).toBeUndefined();
    expect(folded.state.result?.refund).toEqual({ seat: 2, amount: 5n });
    expect(folded.state.result?.potTotal).toBe(14n);
    expect(totalChips(folded.state)).toBe(114n);
  });

  it('leaves no ante when the big blind exhausts that stack', () => {
    const { state, events } = createHand({ ...config, bigBlindAnte: 10n }, makeDeck(), si([100n, 7n]));
    expect(state.seats.find(seat => seat.seat === 2)).toMatchObject({ committed: 7n, totalCommitted: 7n });
    expect(events.find(event => event.type === 'blinds_posted')?.payload.ante).toBe('0');
    expect(state.currentBet).toBe(10n);
  });

  it('leaves the full ante in the main pot and keeps it out of side-pot thresholds and refunds', () => {
    let { state } = createHand({ ...config, bigBlindAnte: 10n }, shuffledDeck(mulberry32(1977)), si([10n, 30n, 50n]));
    for (const seat of [1, 2, 3]) {
      const result = applyAction(state, { type: 'allin', seat });
      expect(result.error).toBeUndefined();
      state = result.state;
    }
    expect(state.status).toBe('complete');
    expect(state.result?.refund).toEqual({ seat: 3, amount: 10n });
    expect(state.result?.potAwards.map(pot => pot.amount)).toEqual([40n, 40n]);
    expect(totalChips(state)).toBe(90n);
  });
});
