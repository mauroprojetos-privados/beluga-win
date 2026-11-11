import { describe, expect, it } from 'vitest';
import { comboForDifficulty, comboForRole, comboUsage, comboUsageWords, type LimitCard } from '../src/core/routing/model.js';
import { parseTaskDraft } from '../src/agent/task-drafter.js';
import { Settings } from '../src/shared/settings-schema.js';
import { prefsFrom } from '../src/core/store.js';
import { encodeFailure } from '../src/shared/run-failure.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import type { AgentRef } from '../src/protocol.js';
import { PHONE } from '../src/companion/coverage.js';

const RUNTIMES: RuntimeChoice[] = [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }];

describe('Phase 3: how hard a task is', () => {
  it('the drafter says it; anything else is let go', () => {
    expect(parseTaskDraft('{"title":"Fix a typo","goal":"g","difficulty":"simple"}', [])?.difficulty).toBe('simple');
    expect(parseTaskDraft('{"title":"Fix a typo","goal":"g","difficulty":"epic"}', [])).toMatchObject({ title: 'Fix a typo' });
    expect(parseTaskDraft('{"title":"Fix a typo","goal":"g","difficulty":"epic"}', [])?.difficulty).toBeUndefined();
    const several = parseTaskDraft('{"tasks":[{"title":"A","goal":"g","difficulty":"hard"},{"title":"B","goal":"g","difficulty":"normal"}]}', []);
    expect([several?.difficulty, several?.more?.[0]?.difficulty]).toEqual(['hard', 'normal']);
  });

  it('maps a difficulty to a combo, or to none', () => {
    const st = { runtimes: RUNTIMES, prefs: { difficultyCombos: { hard: 'strong', simple: 'gone' } } };
    expect(comboForDifficulty(st, 'hard')).toMatchObject({ combo: 'strong' });
    expect(comboForDifficulty(st, 'simple')).toBeUndefined();
    expect(comboForDifficulty(st, 'normal')).toBeUndefined();
    expect(comboForDifficulty(st, undefined)).toBeUndefined();
  });
});

describe('Phase 4: a combo per role', () => {
  it('each role its own combo, unset roles as before', () => {
    const st = { runtimes: RUNTIMES, prefs: { roleCombos: { checker: 'economy', reviewer: 'strong' } } };
    expect(comboForRole(st, 'checker')).toMatchObject({ combo: 'economy' });
    expect(comboForRole(st, 'reviewer')).toMatchObject({ combo: 'strong' });
    expect(comboForRole(st, 'milestone')).toBeUndefined();
    expect(comboForRole({ runtimes: RUNTIMES, prefs: {} }, 'planHead')).toBeUndefined();
  });

  it('both maps are prefs: kept from settings.json, a bad one let go', () => {
    const s = Settings.parse({ difficultyCombos: { hard: 'strong' }, roleCombos: { checker: 'economy' } });
    expect(prefsFrom(s)).toMatchObject({ difficultyCombos: { hard: 'strong' }, roleCombos: { checker: 'economy' } });
    expect(Settings.parse({ roleCombos: { checker: 'Not An Id' } }).roleCombos).toBeUndefined();
  });
});

describe('Phase 5: usage by combo and target', () => {
  const me = 'me';
  const run = (agent: AgentRef, status: string, ts: number, ms: number, limited = false): LimitCard & { agent: AgentRef } => ({ type: 'agent', owner: me, status, ts, endTs: ts + ms, agent, ...(limited ? { text: encodeFailure({ kind: 'usage_limit', detail: 'x' }) } : { text: 'ok' }) });
  const claude: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet', combo: 'economy', comboName: 'Economy' };
  const codex: AgentRef = { runtime: 'codex', label: 'Codex', combo: 'economy', comboName: 'Economy' };

  it('splits runs by combo and the target each went to, limits and time too', () => {
    const log = [run(claude, 'error', 10, 5, true), run(codex, 'done', 20, 7), run(codex, 'done', 40, 3), run({ ...codex, combo: 'strong', comboName: 'Strong' }, 'done', 50, 1), { ...run(codex, 'done', 60, 1), owner: 'friend' }, run({ runtime: 'claude', label: 'Claude' }, 'done', 70, 1), run(codex, 'started', 80, 0)];
    const u = comboUsage(log, me);
    expect(u.map((c) => [c.combo, c.runs, c.limited, c.ms])).toEqual([['economy', 3, 1, 15], ['strong', 1, 0, 1]]);
    expect(u[0]!.targets.map((t) => [t.target, t.runs])).toEqual([['Codex', 2], ['Claude · Sonnet', 1]]);
    expect(comboUsageWords(u[0]!)).toBe('3 runs: Codex 2, Claude · Sonnet 1 (1 at its limit)');
    expect(comboUsage(log, me, 30)[0]!.runs).toBe(1);
    expect(PHONE['routing.usage']).toBe('phone');
  });
});

describe('tokens and cost by combo and target', () => {
  it('a run’s usage reports add up on its card; reports for no card, or none, change nothing', async () => {
    const { Store, initialState } = await import('../src/core/store.js');
    const store = new Store(initialState('room'));
    const me = store.getState().selfId;
    const ev = (event: string, text: string, requestId = 'r1') => store.dispatch({ type: 'agent_event', owner: me, requestId, requester: me, event, text, ts: 1, channel: 'ws:w1' } as never);
    ev('started', '');
    ev('usage', JSON.stringify({ tokens: 1200, cost: 0.02 }));
    ev('usage', JSON.stringify({ tokens: 800, cost: 0.01 }));
    ev('usage', 'not json');
    ev('usage', JSON.stringify({ tokens: 5 }), 'other');
    const card = store.getState().log.find((l) => l.type === 'agent');
    expect(card).toMatchObject({ usage: { tokens: 2000 } });
    expect((card as { usage: { cost: number } }).usage.cost).toBeCloseTo(0.03);
  });

  it('adds them up by combo and target, and says them short', () => {
    const agent = (runtime: string, label: string, model?: string): AgentRef => ({ runtime, label, ...(model ? { model } : {}), combo: 'economy', comboName: 'Economy' });
    const card = (a: AgentRef, tokens: number, cost: number, status = 'done'): LimitCard => ({ type: 'agent', owner: 'me', status, ts: 1, endTs: 2, agent: a, text: status === 'error' ? encodeFailure({ kind: 'usage_limit', detail: 'x' }) : 'ok', usage: { tokens, cost } });
    const u = comboUsage([card(agent('codex', 'Codex'), 800_000, 0), card(agent('claude', 'Claude', 'sonnet'), 350_000, 3.4, 'error'), card(agent('codex', 'Codex'), 50_000, 0)], 'me');
    expect(u[0]).toMatchObject({ tokens: 1_200_000, runs: 3, limited: 1 });
    expect(u[0]!.cost).toBeCloseTo(3.4);
    expect(u[0]!.targets.map((t) => [t.target, t.tokens])).toEqual([['Codex', 850_000], ['Claude · Sonnet', 350_000]]);
    expect(comboUsageWords(u[0]!)).toBe('3 runs · 1.2M tokens · $3.40: Codex 2 (850k), Claude · Sonnet 1 (350k, 1 at its limit)');
  });
});
