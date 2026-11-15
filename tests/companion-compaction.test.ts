import { describe, expect, it } from 'vitest';
import { RefTable } from '../src/companion/files.js';
import { needsYou } from '../src/companion/needs-you.js';
import { ConvView, NeedsYou } from '../src/companion/protocol.js';
import { PHONE } from '../src/companion/coverage.js';
import { PhoneCalls } from '../src/companion/calls.js';
import { type ViewContext, viewOf } from '../src/companion/views.js';
import { lastSummary } from '../src/core/context-log.js';
import { type Action, Store, initialState } from '../src/core/store.js';
import { API } from '../src/ipc/api.js';

/**
 * Compaction on the phone (docs/compaction.md): the one-time "Turn it on?" card, the "summary is
 * still big" card with Start Fresh, and the conversation's context with where it compacts.
 */

const ME = 'me';
const T0 = 1_760_000_000_000;
const ctx = (): ViewContext => ({ refs: new RefTable(() => 'ref00001'), mac: { name: 'Mac', version: '1' } });

function state(prefs: Record<string, unknown> = {}) {
  const store = new Store(initialState('room'));
  const run = (a: Action): void => store.dispatch(a);
  run({ type: 'identity', selfId: ME, isHost: true, home: '/Users/k' });
  if (Object.keys(prefs).length) run({ type: 'prefs', prefs });
  const event = (channel: string, event: 'context' | 'compact', data: Record<string, unknown>, ts = T0): void =>
    run({ type: 'agent_event', owner: ME, requestId: `r-${ts}`, requester: ME, event, text: JSON.stringify(data), ts, channel });
  return { store, run, event };
}

describe('auto-compact, asked once', () => {
  it('waits until your agent has worked, then asks with Turn On and Keep Off, which the phone may answer', () => {
    const s = state();
    expect(needsYou(s.store.getState()).filter((n) => n.kind === 'autocompact')).toEqual([]);
    s.event('bot:clara', 'context', { used: 60_000, window: 1_000_000 });
    const [card] = needsYou(s.store.getState()).filter((n) => n.kind === 'autocompact');
    expect(NeedsYou.parse(card)).toBeTruthy();
    expect(card).toMatchObject({ id: 'autocompact', actions: [{ tone: 'main', method: 'session.chooseAutoCompact', args: [true] }, { tone: 'danger', method: 'session.chooseAutoCompact', args: [false] }] });
    expect(card!.detail).toMatch(/160k/);
    // Answering it is the phone's to do (it's a Needs You answer, not a setting screen).
    expect(PHONE['session.chooseAutoCompact']).toBe('phone');
    expect(PhoneCalls['session.chooseAutoCompact'].args.safeParse([true]).success).toBe(true);
    expect(API['session.chooseAutoCompact'].args.safeParse(['yes']).success).toBe(false);
  });

  it('never asks again once you chose, either way (or when it is on)', () => {
    for (const prefs of [{ autoCompactChosen: true }, { autoCompact: true }]) {
      const s = state(prefs);
      s.event('ws:w1', 'context', { used: 60_000, window: 200_000 });
      expect(needsYou(s.store.getState()).filter((n) => n.kind === 'autocompact')).toEqual([]);
    }
  });
});

describe('a summary still past the threshold', () => {
  it('offers Start Fresh where a conversation can start over, and leaves once it has', () => {
    const s = state({ autoCompact: true, autoCompactChosen: true });
    s.event('bot:clara', 'context', { used: 400_000, window: 1_000_000 });
    s.event('bot:clara', 'compact', { pre: 400_000, post: 180_000, trigger: 'auto', key: 'k1', window: 1_000_000, summary: 'kept the plan' }, T0 + 5);
    const [card] = needsYou(s.store.getState()).filter((n) => n.kind === 'compact');
    expect(NeedsYou.parse(card)).toBeTruthy();
    expect(card).toMatchObject({ id: 'compact:bot:clara', topic: 'conv:bot:clara', actions: [{ tone: 'main', method: 'session.freshFromSummary', args: ['bot:clara'] }] });
    expect(lastSummary(s.store.getState().log, 'bot:clara')).toBe('kept the plan');
    expect(PHONE['session.freshFromSummary']).toBe('phone');
    // Started fresh: its context starts over, the card goes.
    s.run({ type: 'context_reset', channel: 'bot:clara' });
    expect(needsYou(s.store.getState()).filter((n) => n.kind === 'compact')).toEqual([]);
  });

  it('says nothing when the summary is under the threshold, or where nothing can start fresh (the room)', () => {
    const s = state({ autoCompact: true, autoCompactChosen: true });
    s.event('ws:w1', 'context', { used: 400_000, window: 1_000_000 });
    s.event('ws:w1', 'compact', { pre: 400_000, post: 40_000, key: 'k1', window: 1_000_000 }, T0 + 5);
    s.event('room', 'context', { used: 190_000, window: 200_000 });
    s.event('room', 'compact', { pre: 190_000, post: 180_000, key: 'k2', window: 200_000 }, T0 + 6);
    expect(needsYou(s.store.getState()).filter((n) => n.kind === 'compact')).toEqual([]);
  });
});

describe('the conversation’s context on the phone', () => {
  it('has how full it is and where it compacts, in tokens (160k on a 1M window)', () => {
    const s = state({ autoCompact: true, autoCompactChosen: true });
    s.event('ws:w1', 'context', { used: 120_000, window: 1_000_000 });
    const view = ConvView.parse(viewOf(s.store.getState(), ctx(), 'conv:ws:w1'));
    expect(view.context).toEqual({ used: 120_000, window: 1_000_000, compactAt: 160_000 });
  });

  it('has no threshold with auto-compact off, and nothing before it was measured', () => {
    const s = state();
    expect((viewOf(s.store.getState(), ctx(), 'conv:ws:w1') as ConvView).context).toBeUndefined();
    s.event('ws:w1', 'context', { used: 50_000, window: 200_000 });
    expect((viewOf(s.store.getState(), ctx(), 'conv:ws:w1') as ConvView).context).toEqual({ used: 50_000, window: 200_000 });
  });
});
