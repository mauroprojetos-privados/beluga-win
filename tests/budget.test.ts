import { describe, expect, it } from 'vitest';
import type { AgentPlace } from '../src/agent/types.js';
import { AutoContinue, resumeOf } from '../src/core/auto-continue.js';
import { BudgetGuard } from '../src/core/budget/guard.js';
import { budgetAsks, budgetDecision, budgetView, channelBudget, dayBudgets } from '../src/core/budget/model.js';
import { EMPTY_SPEND, addSpend, readSpend } from '../src/core/budget/store.js';
import type { NoticeEvent } from '../src/core/notify.js';
import { ComboFailover } from '../src/core/routing/failover.js';
import { Store, initialState } from '../src/core/store.js';
import { needsYou } from '../src/companion/needs-you.js';
import { NeedsYou, ConvView, HomeView } from '../src/companion/protocol.js';
import { PHONE } from '../src/companion/coverage.js';
import { BUDGET_HANDLERS } from '../src/ipc/budget-handlers.js';
import { allowMore, budgetDay, budgetLine, cheaperModel, resolveBudget } from '../src/shared/budget.js';
import { CONTINUE_PROMPT, decodeFailure, encodeFailure } from '../src/shared/run-failure.js';
import { Settings } from '../src/shared/settings-schema.js';
import { ProjectFile } from '../src/workspaces/scripts.js';
import { parseBotFile } from '../src/core/bots/schema.js';
import type { Project, Workspace, WorkspaceUsage } from '../src/workspaces/types.js';
import type { Session } from '../src/core/session.js';

/** Token budgets (roadmap "modo orquestrador", phase 4; docs/budget.md). */

const MIN = 60_000;
const T0 = new Date(2026, 10, 15, 12, 0).getTime();
const TODAY = budgetDay(T0);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/** A workspace that spent `tokens` (all of it today). */
const usage = (tokens: number): WorkspaceUsage => ({ input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, runs: 1, days: { [TODAY]: { tokens, cost: 0 } } });
const ws = (id: string, tokens = 0): Workspace => ({ id, projectId: 'p', name: id, path: `/tmp/${id}`, kind: 'worktree', projectRoot: '/tmp/p', branch: `beluga/${id}`, createdAt: 0, external: false, sessionId: 's1', ...(tokens ? { usage: usage(tokens) } : {}) }) as unknown as Workspace;

const STRONG = { id: 'strong', name: 'Strong', targets: [{ runtime: 'claude', model: 'opus' }, { runtime: 'claude', model: 'sonnet' }] };

function world(spent: { w1?: number; w2?: number } = {}, projectBudget?: Project['scripts']) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'identity', selfId: 'p-me', isHost: true });
  store.dispatch({ type: 'runtimes', runtimes: [{ id: 'claude', label: 'Claude', available: true }] } as never);
  const setSpent = (w1: number, w2 = spent.w2 ?? 0): void =>
    store.dispatch({ type: 'projects', projects: [{ id: 'p', name: 'api', root: '/tmp/p', base: 'main', workspaces: [ws('w1', w1), ws('w2', w2)], ...(projectBudget ? { scripts: projectBudget } : {}) } as unknown as Project] });
  setSpent(spent.w1 ?? 0);
  let now = T0;
  const cancelled: Array<{ requestId: string; note: string }> = [];
  const notices: NoticeEvent[] = [];
  const carried: Array<[string, string]> = [];
  const guard = new BudgetGuard({ store, cancel: (requestId, note) => (cancelled.push({ requestId, note }), true), carry: (ch, from) => carried.push([ch, from]), notify: (e) => notices.push(e), now: () => now });
  const asked: Array<{ prompt: string; channel: string }> = [];
  const ask = (prompt: string, channel: string): string => (asked.push({ prompt, channel }), `ask${asked.length}`);
  const failover = new ComboFailover({ store, ask, now: () => now });
  const auto = new AutoContinue({ store, ask, now: () => now });
  const prefs = (p: Record<string, unknown>): void => store.dispatch({ type: 'prefs', prefs: p });
  const run = (requestId: string, channel: string, event: 'started' | 'error' | 'done' | 'usage', text = ''): void => store.dispatch({ type: 'agent_event', owner: 'p-me', requestId, requester: 'p-me', event, text, ts: now, channel });
  const stopAll = (): void => {
    guard.stop();
    failover.stop();
    auto.stop();
  };
  return { store, guard, failover, auto, cancelled, notices, carried, asked, prefs, run, setSpent, stopAll, at: (t: number) => void (now = t) };
}

const onSession = (): void => undefined;
const place = (extra: Partial<AgentPlace> = {}): AgentPlace => ({ cwd: '/tmp/w1', additionalDirectories: [], autoEdit: true, onSession, agent: { runtime: 'claude', label: 'Claude' }, model: 'opus', ...extra });

describe('the rules', () => {
  it('reads the same block in Settings, beluga.json and bot.json', () => {
    const block = { conversation: 2_000_000, day: 15_000_000, near: 'downgrade' };
    expect(Settings.parse({ budget: block }).budget).toEqual(block);
    expect(Settings.parse({}).budget).toBeUndefined();
    expect(Settings.parse({ budget: { conversation: 5 } }).budget).toBeUndefined();
    expect(ProjectFile.parse({ budget: block }).budget).toEqual(block);
    expect(ProjectFile.parse({ budget: 'lots' }).budget).toBeUndefined();
    expect(parseBotFile(JSON.stringify({ version: 1, budget: { day: 1_000_000, near: 'stop' } })).bot.budget).toEqual({ day: 1_000_000, near: 'stop' });
  });

  it('a bot’s wins, a project’s can only tighten yours, and asking is the default', () => {
    expect(resolveBudget()).toEqual({ near: 'ask' });
    expect(resolveBudget({ conversation: 2_000_000 }, { conversation: 5_000_000 })).toMatchObject({ conversation: 2_000_000 });
    expect(resolveBudget({ conversation: 2_000_000 }, { conversation: 1_000_000 })).toMatchObject({ conversation: 1_000_000 });
    expect(resolveBudget({ conversation: 2_000_000, near: 'stop' }, { near: 'downgrade' }, { conversation: 9_000_000 })).toMatchObject({ conversation: 9_000_000, near: 'stop' });
    expect(resolveBudget(undefined, { day: 3_000_000 }, { day: 1_000_000, near: 'downgrade' })).toEqual({ projectDay: 3_000_000, botDay: 1_000_000, near: 'downgrade' });
  });

  it('warns at 80%, is reached at 100%, and Continue gives half the budget again', () => {
    expect(budgetLine('conversation', 'ws:w1', 1_500_000, 2_000_000).level).toBe('ok');
    expect(budgetLine('conversation', 'ws:w1', 1_600_000, 2_000_000).level).toBe('near');
    const over = budgetLine('conversation', 'ws:w1', 2_100_000, 2_000_000);
    expect(over).toMatchObject({ level: 'over', pct: 105 });
    expect(allowMore(over)).toBe(1_100_000);
    expect(budgetLine('conversation', 'ws:w1', 2_100_000, 2_000_000, allowMore(over)).level).toBe('ok');
  });

  it('a cheaper Claude: Opus → Sonnet → Haiku, nothing past it or for another runtime', () => {
    expect(cheaperModel('opus')).toBe('sonnet');
    expect(cheaperModel('claude-opus-4-6')).toBe('sonnet');
    expect(cheaperModel(undefined)).toBe('sonnet');
    expect(cheaperModel('sonnet')).toBe('haiku');
    expect(cheaperModel('haiku')).toBeUndefined();
    expect(cheaperModel('gpt-5', 'codex')).toBeUndefined();
  });
});

describe('a conversation over its budget', () => {
  it('stop: the run doesn’t start, its card says why, and you hear so', () => {
    const w = world({ w1: 2_100_000 });
    w.prefs({ budget: { conversation: 2_000_000, near: 'stop' } });
    const out = w.guard.gate('ws:w1', place(), 'r1');
    expect('refuse' in out).toBe(true);
    const f = decodeFailure('refuse' in out ? out.refuse : '');
    expect(f).toMatchObject({ kind: 'budget', budget: { scope: 'conversation', near: 'stop', used: 2_100_000, limit: 2_000_000 } });
    expect(w.notices).toEqual([expect.objectContaining({ kind: 'problems', channel: 'ws:w1' })]);
    // Another conversation, under its budget, runs as it is.
    expect(w.guard.gate('ws:w2', place(), 'r2')).toEqual({ place: place() });
    w.stopAll();
  });

  it('ask: Needs You with Continue, Go On Cheaper and Stop, which reach the phone', () => {
    const w = world({ w1: 2_100_000 });
    w.prefs({ budget: { conversation: 2_000_000, near: 'ask' } });
    const out = w.guard.gate('ws:w1', place(), 'r1');
    expect(w.notices).toEqual([expect.objectContaining({ kind: 'needsYou', need: 'budget:ws:w1', channel: 'ws:w1' })]);
    // The run's card is the record the item reads (agent-host emits the refusal as its error).
    w.run('r1', 'ws:w1', 'error', 'refuse' in out ? out.refuse : '');
    const item = needsYou(w.store.getState()).find((n) => n.kind === 'budget')!;
    expect(NeedsYou.parse(item)).toMatchObject({ id: 'budget:ws:w1:r1', topic: 'conv:ws:w1', title: 'This conversation reached its token budget' });
    expect(item.actions.map((a) => [a.label, a.method, a.args])).toEqual([
      ['Continue', 'budget.answer', ['ws:w1', 'continue']],
      ['Go On Cheaper', 'budget.answer', ['ws:w1', 'cheaper']],
      ['Stop', 'budget.answer', ['ws:w1', 'stop']],
    ]);
    expect(PHONE['budget.answer']).toBe('phone');
    expect(PHONE['budget.status']).toBe('phone');
    // The budget raised in Settings: nothing waits any more.
    w.prefs({ budget: { conversation: 5_000_000, near: 'ask' } });
    expect(budgetAsks(w.store.getState(), T0)).toEqual([]);
    w.stopAll();
  });

  it('Continue and Go On Cheaper from Needs You: allowed past it, and told to continue', () => {
    const w = world({ w1: 2_100_000 });
    w.prefs({ budget: { conversation: 2_000_000, near: 'ask' } });
    const sent: string[] = [];
    const s = { store: w.store, setPrefs: (p: Record<string, unknown>) => w.prefs(p), askOwnClaude: (prompt: string, channel: string) => (sent.push(`${channel}:${prompt}`), 'q') } as unknown as Session;
    expect(BUDGET_HANDLERS['budget.answer'](s, 'ws:w1', 'continue')).toBe('Continuing');
    expect(w.store.getState().prefs.budgetAllow['ws:w1']).toBeGreaterThan(100_000);
    expect(budgetDecision(w.store.getState(), 'ws:w1', Date.now()).kind).not.toBe('ask');
    expect(sent).toEqual([`ws:w1:${CONTINUE_PROMPT}`]);
    // Cheaper: past its budget it goes on downgraded, whatever `near` says.
    w.prefs({ budgetAllow: {} });
    expect(budgetDecision(w.store.getState(), 'ws:w1', Date.now()).kind).toBe('ask');
    BUDGET_HANDLERS['budget.answer'](s, 'ws:w1', 'cheaper');
    expect(budgetDecision(w.store.getState(), 'ws:w1', Date.now()).kind).toBe('downgrade');
    w.stopAll();
  });

  it('downgrade: on a cheaper Claude model, or the combo’s next target', () => {
    const w = world({ w1: 2_100_000 });
    w.prefs({ budget: { conversation: 2_000_000, near: 'downgrade' }, combos: [STRONG] });
    const plain = w.guard.gate('ws:w1', place(), 'r1');
    expect(plain).toEqual({ place: { ...place(), model: 'sonnet' } });
    const onCombo = place({ agent: { runtime: 'claude', label: 'Claude', combo: 'strong', comboName: 'Strong' }, model: 'opus', route: { combo: 'strong', index: 0 } });
    const routed = w.guard.gate('ws:w1', onCombo, 'r2');
    expect('place' in routed && routed.place).toMatchObject({ model: 'sonnet', route: { combo: 'strong', index: 1 }, agent: { combo: 'strong' } });
    expect(w.store.getState().log.some((l) => l.type === 'system' && /goes on cheaper/.test(l.text))).toBe(true);
    // Nothing cheaper: it goes on as it is (Haiku is the floor).
    expect(w.guard.gate('ws:w1', place({ model: 'haiku' }), 'r3')).toEqual({ place: place({ model: 'haiku' }) });
    w.stopAll();
  });

  it('mid-run: usage that reaches it stops the run, and the failover sends it on cheaper', async () => {
    const w = world({ w1: 1_000_000 });
    w.prefs({ budget: { conversation: 2_000_000, near: 'downgrade' } });
    w.run('r1', 'ws:w1', 'started');
    // 80%: said once in the conversation.
    w.setSpent(1_700_000);
    w.run('r1', 'ws:w1', 'usage', JSON.stringify({ tokens: 700_000, cost: 0 }));
    await tick();
    expect(w.cancelled).toEqual([]);
    expect(w.store.getState().log.filter((l) => l.type === 'system' && /token budget: 1\.7M of 2M \(85%\)/.test(l.text))).toHaveLength(1);
    // Past it: the run stops, its card says it goes on cheaper.
    w.setSpent(2_200_000);
    w.run('r1', 'ws:w1', 'usage', JSON.stringify({ tokens: 500_000, cost: 0 }));
    await tick();
    expect(w.cancelled).toHaveLength(1);
    expect(decodeFailure(w.cancelled[0]!.note)).toMatchObject({ kind: 'budget', budget: { near: 'downgrade' } });
    w.run('r1', 'ws:w1', 'error', w.cancelled[0]!.note);
    await tick();
    expect(w.asked).toEqual([{ prompt: CONTINUE_PROMPT, channel: 'ws:w1' }]);
    // Its next run passes the gate on Sonnet.
    expect(w.guard.gate('ws:w1', place(), 'r2')).toEqual({ place: { ...place(), model: 'sonnet' } });
    w.stopAll();
  });

  it('mid-run with ask or stop: the run stops once, and ask waits in Needs You', async () => {
    const w = world({ w1: 1_000_000 });
    w.prefs({ budget: { conversation: 2_000_000, near: 'ask' } });
    w.run('r1', 'ws:w1', 'started');
    w.setSpent(2_500_000);
    w.run('r1', 'ws:w1', 'usage', JSON.stringify({ tokens: 1_500_000, cost: 0 }));
    w.run('r1', 'ws:w1', 'usage', JSON.stringify({ tokens: 1, cost: 0 }));
    await tick();
    expect(w.cancelled).toHaveLength(1);
    expect(w.notices.filter((n) => n.kind === 'needsYou')).toHaveLength(1);
    w.run('r1', 'ws:w1', 'error', w.cancelled[0]!.note);
    await tick();
    // Ask doesn't go on by itself.
    expect(w.asked).toEqual([]);
    expect(budgetAsks(w.store.getState(), T0).map((a) => a.channel)).toEqual(['ws:w1']);
    w.stopAll();
  });

  it('your day, a project’s day: each counts what it should', () => {
    const w = world({ w1: 3_000_000, w2: 4_000_000 }, { budget: { day: 6_000_000 } });
    w.prefs({ budget: { day: 10_000_000 } });
    const lines = channelBudget(w.store.getState(), 'ws:w1', T0).lines;
    expect(lines.map((l) => [l.scope, l.used, l.limit, l.level])).toEqual([
      ['day', 7_000_000, 10_000_000, 'ok'],
      ['project', 7_000_000, 6_000_000, 'over'],
    ]);
    expect(budgetDecision(w.store.getState(), 'ws:w1', T0)).toMatchObject({ kind: 'ask', line: { scope: 'project', name: 'api' } });
    expect(dayBudgets(w.store.getState(), T0)).toMatchObject({ spent: 7_000_000, lines: [{ scope: 'day' }, { scope: 'project', name: 'api' }] });
    w.stopAll();
  });
});

describe('auto-continue respects the budgets', () => {
  const limited = (w: ReturnType<typeof world>, requestId: string, channel: string): void => {
    w.run(requestId, channel, 'started');
    w.run(requestId, channel, 'error', encodeFailure({ kind: 'usage_limit', detail: 'limit', resetsAt: T0 + 60 * MIN }, T0));
  };

  it('doesn’t restart a conversation past the daily budget after the reset', () => {
    const w = world({ w1: 12_000_000, w2: 4_000_000 });
    w.prefs({ budget: { day: 15_000_000, near: 'downgrade' } });
    limited(w, 'r1', 'ws:w1');
    expect(resumeOf(w.store.getState(), 'ws:w1', T0)).toBeUndefined();
    w.at(T0 + 62 * MIN);
    w.auto.tick();
    expect(w.asked).toEqual([]);
    expect(w.store.getState().log.at(-1)).toMatchObject({ type: 'system', channel: 'ws:w1', text: expect.stringMatching(/your daily token budget is reached \(16M of 15M/) });
    // Once: the next tick says nothing more.
    const n = w.store.getState().log.length;
    w.auto.tick();
    expect(w.store.getState().log).toHaveLength(n);
    w.stopAll();
  });

  it('under the budget, it continues as before', () => {
    const w = world({ w1: 2_000_000 });
    w.prefs({ budget: { day: 15_000_000 } });
    limited(w, 'r1', 'ws:w1');
    expect(resumeOf(w.store.getState(), 'ws:w1', T0)).toBeDefined();
    w.at(T0 + 62 * MIN);
    w.auto.tick();
    expect(w.asked).toEqual([{ prompt: CONTINUE_PROMPT, channel: 'ws:w1' }]);
    w.stopAll();
  });
});

describe('where it shows', () => {
  it('the phone gets a conversation’s and the day’s budget', async () => {
    const w = world({ w1: 1_700_000 });
    w.prefs({ budget: { conversation: 2_000_000, day: 15_000_000 } });
    const v = budgetView(w.store.getState(), 'ws:w1', T0)!;
    expect(v).toMatchObject({ level: 'near', near: 'ask', cheaper: false });
    const { convView, homeView } = await import('../src/companion/views.js');
    const ctx = { mac: { name: 'Mac', version: '1' }, refs: new Map() } as never;
    const home = HomeView.shape.budget.parse(homeView(w.store.getState(), ctx).budget);
    expect(home?.lines.map((l) => l.scope)).toEqual(['day']);
    const conv = ConvView.shape.budget.parse(convView(w.store.getState(), ctx, 'conv:ws:w1').budget);
    expect(conv?.lines.map((l) => [l.scope, l.level])).toEqual([['conversation', 'near'], ['day', 'ok']]);
    w.stopAll();
  });

  it('nothing set: nothing shows', () => {
    const w = world({ w1: 1_700_000 });
    expect(budgetView(w.store.getState(), 'ws:w1', T0)).toBeUndefined();
    w.stopAll();
  });
});

describe('the ledger (outside a workspace)', () => {
  it('counts your runs in a bot’s chat by day and over its life, and reads back what it saved', () => {
    let l = addSpend(EMPTY_SPEND, 'bot:supa', 1000, T0);
    l = addSpend(l, 'bot:supa', 500, T0 + MIN);
    l = addSpend(l, 'ws:w1', 999, T0);
    expect(l).toEqual({ day: TODAY, today: { 'bot:supa': 1500 }, total: { 'bot:supa': 1500 } });
    const tomorrow = addSpend(l, 'mac:assistant', 10, T0 + 24 * 60 * MIN);
    expect(tomorrow.today).toEqual({ 'mac:assistant': 10 });
    expect(tomorrow.total).toEqual({ 'bot:supa': 1500, 'mac:assistant': 10 });
    expect(readSpend(JSON.parse(JSON.stringify(tomorrow)))).toEqual(tomorrow);
    expect(readSpend('nonsense')).toEqual(EMPTY_SPEND);
  });

  it('the store adds a run’s usage there, yours only', () => {
    const w = world();
    w.run('r1', 'bot:supa', 'started');
    w.store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: 'r1', requester: 'p-me', event: 'usage', text: JSON.stringify({ tokens: 4000, cost: 0.1 }), ts: Date.now(), channel: 'bot:supa' });
    w.store.dispatch({ type: 'agent_event', owner: 'p-friend', requestId: 'r2', requester: 'p-friend', event: 'usage', text: JSON.stringify({ tokens: 9000, cost: 0 }), ts: Date.now(), channel: 'bot:supa' });
    expect(w.store.getState().spend.total).toEqual({ 'bot:supa': 4000 });
    w.stopAll();
  });
});
