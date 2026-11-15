import { describe, expect, it } from 'vitest';
import { executorSaving, leadReport, localDay, placesIn, type MeasuredCard } from '../src/core/routing/measure.js';
import { perToken } from '../src/core/routing/outcomes.js';
import { Store, initialState, type LogItem } from '../src/core/store.js';

/** Orchestrator mode, phase 5 (roadmap/modo-orquestrador.md): lead against executors, and the opening context. */
const NOW = new Date(2026, 10, 15, 18, 0).getTime();
const HOUR = 3_600_000;
const sonnet = { runtime: 'claude', model: 'sonnet' };
const card = (over: Partial<MeasuredCard> & { usage: MeasuredCard['usage'] }): MeasuredCard => ({ type: 'agent', owner: 'me', ts: NOW - HOUR, channel: 'ws:a', agent: sonnet, ...over });
const places = placesIn({
  projects: [
    { id: 'erp', name: 'erp-rewrite', workspaces: [{ id: 'a', name: 'Fix the login' }, { id: 'b', name: 'Reports' }] },
    { id: 'site', name: 'site', workspaces: [{ id: 'c', name: 'Landing' }] },
  ],
});

describe('lead and executors', () => {
  it('prices what the executors took off the lead at the lead’s rate less theirs', () => {
    const c = card({ usage: { tokens: 10_000, executorTokens: 4000, executorModel: 'claude-haiku-4-5' } });
    expect(executorSaving(c)).toBeCloseTo(4000 * (perToken('sonnet') - perToken('haiku')));
    // A lead with no model named is priced at the baseline Settings picks.
    expect(executorSaving({ ...c, agent: { runtime: 'claude' } }, 'opus')).toBeCloseTo(4000 * (perToken('opus') - perToken('haiku')));
    // Executors on an unknown model: no saving claimed.
    expect(executorSaving(card({ usage: { tokens: 10_000, executorTokens: 4000 } }))).toBe(0);
    // Never more than the whole.
    expect(executorSaving(card({ usage: { tokens: 100, executorTokens: 4000, executorModel: 'haiku' } }))).toBeCloseTo(100 * (perToken('sonnet') - perToken('haiku')));
  });

  it('splits your runs by conversation and by day, largest first, newest day first', () => {
    const log: MeasuredCard[] = [
      card({ usage: { tokens: 1000, executorTokens: 600, executorModel: 'haiku' } }),
      card({ ts: NOW - 30 * HOUR, usage: { tokens: 500 } }),
      card({ channel: 'ws:b', usage: { tokens: 5000, executorTokens: 1000, executorModel: 'haiku' } }),
      card({ channel: 'bot:clara', usage: { tokens: 50 } }),
      // A friend's run, and one too old for the days.
      card({ owner: 'friend', usage: { tokens: 99_999, executorTokens: 99_999 } }),
      card({ ts: NOW - 40 * 24 * HOUR, usage: { tokens: 7 } }),
    ];
    const r = leadReport(log, 'me', { now: NOW, place: places });
    expect(r).toMatchObject({ lead: 4957, executors: 1600, baseline: 'opus' });
    expect(r.saved).toBeCloseTo(1600 * (perToken('sonnet') - perToken('haiku')));
    expect(r.conversations.map((c) => [c.name, c.lead, c.executors, c.runs])).toEqual([
      ['Reports', 4000, 1000, 1],
      ['Fix the login', 907, 600, 3],
      ['bot:clara', 50, 0, 1],
    ]);
    expect(r.days.map((d) => [d.day, d.lead, d.executors])).toEqual([
      [localDay(NOW), 4450, 1600],
      [localDay(NOW - 30 * HOUR), 500, 0],
    ]);
  });

  it('averages the context a run starts with per project, over its latest runs', () => {
    const opening = (used: number, system?: number) => ({ used, ...(system !== undefined ? { breakdown: { system, tools: 0, conversation: used - system } } : {}) });
    const log: MeasuredCard[] = [
      card({ ts: NOW - 3 * HOUR, usage: { tokens: 10, opening: opening(53_800, 44_000) } }),
      card({ ts: NOW - 2 * HOUR, channel: 'ws:b', usage: { tokens: 10, opening: opening(41_200, 31_400) } }),
      card({ ts: NOW - HOUR, usage: { tokens: 10, opening: opening(40_000) } }),
      card({ channel: 'ws:c', usage: { tokens: 10, opening: opening(20_000, 15_000) } }),
      // Outside a project: not averaged.
      card({ channel: 'bot:clara', usage: { tokens: 10, opening: opening(90_000, 80_000) } }),
    ];
    const r = leadReport(log, 'me', { now: NOW, place: places });
    expect(r.openings).toEqual([
      { project: 'erp', name: 'erp-rewrite', runs: 3, used: 45_000, system: 37_700, tools: 0, conversation: 9800, last: 40_000 },
      { project: 'site', name: 'site', runs: 1, used: 20_000, system: 15_000, tools: 0, conversation: 5000, last: 20_000 },
    ]);
  });
});

describe('a run’s card', () => {
  const start = (store: Store) => store.dispatch({ type: 'agent_event', owner: 'me', requestId: 'r1', requester: 'me', event: 'started', text: '', ts: 1, channel: 'ws:a' });
  const event = (store: Store, kind: 'usage' | 'context', text: unknown) => store.dispatch({ type: 'agent_event', owner: 'me', requestId: 'r1', requester: 'me', event: kind, text: JSON.stringify(text), ts: 2, channel: 'ws:a' });
  const usageOf = (store: Store) => (store.getState().log.find((l) => l.type === 'agent') as Extract<LogItem, { type: 'agent' }>).usage;

  it('keeps its first context number and the first breakdown, and the executors’ model', () => {
    const store = new Store({ ...initialState('room'), selfId: 'me' });
    start(store);
    event(store, 'context', { used: 41_200, window: 200_000 });
    event(store, 'context', { used: 60_000, window: 200_000 });
    event(store, 'usage', { tokens: 1261, cost: 0.01, executorTokens: 900, executorModel: 'claude-haiku-4-5' });
    event(store, 'context', { used: 62_000, window: 200_000, breakdown: { system: 31_400, tools: 20_900, conversation: 9700 } });
    event(store, 'context', { used: 70_000, window: 200_000, breakdown: { system: 1, tools: 1, conversation: 1 } });
    expect(usageOf(store)).toEqual({ tokens: 1261, cost: 0.01, executorTokens: 900, executorModel: 'claude-haiku-4-5', opening: { used: 41_200, breakdown: { system: 31_400, tools: 20_900, conversation: 9700 } } });
  });
});
