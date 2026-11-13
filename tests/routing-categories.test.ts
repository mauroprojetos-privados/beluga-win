import { describe, expect, it } from 'vitest';
import { parseTaskDraft, parseTaskKind } from '../src/agent/task-drafter.js';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import { type LimitCard, CATEGORY_INFO, WORK_CATEGORIES, taskRoute, taskRouteWords } from '../src/core/routing/model.js';
import { type OutcomeTask, MIN_SAMPLE, comboReport, perToken, priceKeyOf, runCosts, savingsWords, taskKindLine, taskOutcomes } from '../src/core/routing/outcomes.js';
import { Store, initialState, prefsFrom } from '../src/core/store.js';
import { Settings } from '../src/shared/settings-schema.js';
import { API } from '../src/ipc/api.js';
import { TaskPageView, ComboReportView, COMPANION_PROTO, SINCE } from '../src/companion/protocol.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import type { AgentRef } from '../src/protocol.js';

const RUNTIMES: RuntimeChoice[] = [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }];

describe('Phase 3: kinds of work', () => {
  it('one list, each with a name and a hint', () => {
    expect(WORK_CATEGORIES).toEqual(['quick', 'deep', 'ultrabrain', 'visual', 'review', 'docs', 'explore']);
    for (const c of WORK_CATEGORIES) expect(CATEGORY_INFO[c].label).toBeTruthy();
  });

  it('the drafter says the kind with one line of why; a kind it made up is let go', () => {
    const d = parseTaskDraft('{"title":"Restyle the header","goal":"g","category":"visual","why":"It is about   how the header looks"}', []);
    expect(d).toMatchObject({ category: 'visual', categoryWhy: 'It is about how the header looks' });
    expect(parseTaskDraft('{"title":"T","goal":"g","category":"sculpture","why":"w"}', [])).not.toHaveProperty('category');
    const several = parseTaskDraft('{"tasks":[{"title":"A","goal":"g","category":"docs","why":"a readme"},{"title":"B","goal":"g","category":"explore"}]}', []);
    expect([several?.category, several?.more?.[0]?.category]).toEqual(['docs', 'explore']);
  });

  it('a quick look at a task made by hand reads back a kind, or nothing', () => {
    expect(parseTaskKind('Sure: {"category":"review","why":"An audit of the change"}')).toEqual({ category: 'review', why: 'An audit of the change' });
    expect(parseTaskKind('{"category":"nope"}')).toBeUndefined();
    expect(parseTaskKind('no json')).toBeUndefined();
  });

  it('resolves: its own agent › its kind’s combo › its difficulty’s › your default', () => {
    const own: AgentRef = { runtime: 'codex', label: 'Codex' };
    const st = { runtimes: RUNTIMES, prefs: { categoryCombos: { visual: { combo: 'strong', effort: 'high' as const }, docs: { combo: 'gone' } }, difficultyCombos: { hard: 'economy' } } };
    expect(taskRoute(st, { agent: own, category: 'visual', difficulty: 'hard' })).toEqual({ agent: own, from: 'agent' });
    expect(taskRoute(st, { category: 'visual', difficulty: 'hard' })).toMatchObject({ agent: { combo: 'strong' }, effort: 'high', from: 'category' });
    // A kind whose combo was deleted, or none mapped: by difficulty.
    expect(taskRoute(st, { category: 'docs', difficulty: 'hard' })).toMatchObject({ agent: { combo: 'economy' }, from: 'difficulty' });
    expect(taskRoute(st, { category: 'quick', difficulty: 'hard' })).toMatchObject({ from: 'difficulty' });
    expect(taskRoute(st, { category: 'quick' })).toEqual({ from: 'default' });
    expect(taskRouteWords('visual', taskRoute(st, { category: 'visual' }))).toBe('Visual · Strong');
    expect(taskRouteWords('quick', taskRoute(st, { category: 'quick' }))).toBe('Quick · your agent');
  });

  it('kinds and the baseline are synced prefs; a bad one is let go', () => {
    const s = Settings.parse({ categoryCombos: { visual: { combo: 'strong' }, docs: { combo: 'economy', effort: 'low' } }, savingsBaseline: 'sonnet' });
    expect(prefsFrom(s)).toMatchObject({ categoryCombos: { visual: { combo: 'strong' }, docs: { combo: 'economy', effort: 'low' } }, savingsBaseline: 'sonnet' });
    expect(Settings.parse({ categoryCombos: { visual: { combo: 'Not An Id' } } }).categoryCombos).toBeUndefined();
    expect(Settings.parse({ savingsBaseline: 'gpt-9' }).savingsBaseline).toBeUndefined();
    expect(API['board.update'].args.safeParse(['T-1', { category: 'visual' }]).success).toBe(true);
    expect(API['board.update'].args.safeParse(['T-1', { category: 'poetry' }]).success).toBe(false);
  });
});

describe('Phase 3: a task keeps its kind, and your change is a correction', () => {
  function setup(classify?: (t: { title: string }) => Promise<{ category: (typeof WORK_CATEGORIES)[number]; why?: string } | undefined>) {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'bob-api', root: '/tmp/bob-api', base: 'main', workspaces: [] }] });
    const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
    const work = new BoardWork({ store, board, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined, ...(classify ? { classifyTask: classify } : {}) });
    return { board, work };
  }

  it('a draft’s kind goes on the task; changing it keeps what it was', () => {
    const { board, work } = setup();
    const [made] = work.addDraft('api', { title: 'Write the README', goal: 'g', acceptance: [], labels: [], category: 'docs', categoryWhy: 'Writing' });
    expect(made).toMatchObject({ category: 'docs', categoryWhy: 'Writing', categoryBy: 'drafter' });
    const changed = board.update(made!.id, { category: 'explore' }, work.me());
    expect(changed).toMatchObject({ category: 'explore', categoryBy: 'you', categoryWas: 'docs' });
    expect(changed.categoryWhy).toBeUndefined();
    expect(changed.activity.at(-1)?.text).toBe('called this Explore work');
    // Clicking on to another keeps the first kind it had.
    expect(board.update(made!.id, { category: 'review' }, work.me())).toMatchObject({ category: 'review', categoryWas: 'docs' });
  });

  it('a task made by hand gets its kind from a quick look, unless one is set meanwhile', async () => {
    let answer: (v: { category: 'quick'; why: string }) => void = () => undefined;
    const { board, work } = setup(() => new Promise((r) => (answer = r)));
    const a = board.create({ projectId: 'api', title: 'Fix a typo' }, work.me());
    work.classifyLater(a.id);
    answer({ category: 'quick', why: 'A one-word fix' });
    await new Promise((r) => setTimeout(r, 0));
    expect(board.get(a.id)).toMatchObject({ category: 'quick', categoryWhy: 'A one-word fix', categoryBy: 'classifier' });
    const b = board.create({ projectId: 'api', title: 'Other' }, work.me());
    work.classifyLater(b.id);
    board.update(b.id, { category: 'deep' }, work.me());
    answer({ category: 'quick', why: 'late' });
    await new Promise((r) => setTimeout(r, 0));
    expect(board.get(b.id)).toMatchObject({ category: 'deep', categoryBy: 'you' });
  });

  it('open tasks from before classifying get a kind too, one at a time; finished ones and ones with a kind are left alone', async () => {
    let busy = 0;
    let most = 0;
    const asked: string[] = [];
    const { board, work } = setup(async (t) => {
      asked.push(t.title);
      most = Math.max(most, ++busy);
      await new Promise((r) => setTimeout(r, 1));
      busy--;
      return t.title === 'Unsure' ? undefined : { category: 'deep', why: 'Real work' };
    });
    const old = board.create({ projectId: 'api', title: 'Old task' }, work.me());
    const unsure = board.create({ projectId: 'api', title: 'Unsure' }, work.me());
    const kinded = board.create({ projectId: 'api', title: 'Has one' }, work.me());
    board.update(kinded.id, { category: 'docs' }, work.me());
    const done = board.create({ projectId: 'api', title: 'Shipped' }, work.me());
    board.update(done.id, { status: 'done' }, work.me());
    expect(await work.classifyOpen()).toBe(1);
    expect(asked.sort()).toEqual(['Old task', 'Unsure']);
    expect(most).toBe(1);
    expect(board.get(old.id)).toMatchObject({ category: 'deep', categoryBy: 'classifier' });
    expect(board.get(unsure.id)?.category).toBeUndefined();
    expect(board.get(kinded.id)).toMatchObject({ category: 'docs', categoryBy: 'you' });
    // Nothing to look with: nothing happens.
    expect(await setup().work.classifyOpen()).toBe(0);
  });
});

describe('Phase 5: success, savings and suggestions', () => {
  const me = 'me';
  const economy: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet', combo: 'economy', comboName: 'Economy' };
  const run = (channel: string, agent: AgentRef, ts: number, tokens = 1_000_000, cost = 0): LimitCard & { agent: AgentRef; channel: string } => ({ type: 'agent', owner: me, status: 'done', ts, endTs: ts + 1, agent, channel, usage: { tokens, cost }, text: 'ok' });
  const task = (id: string, over: Partial<OutcomeTask> = {}): OutcomeTask => ({ id, key: id.toUpperCase(), title: `Task ${id}`, status: 'in_review', labels: [], related: [], blockedBy: [], worktrees: [`w-${id}`], createdAt: 10, category: 'docs', activity: [{ kind: 'status', text: 'moved this to In Review', at: 100, now: 'In Review' }], ...over });

  it('a task went well: In Review, checks passed first time, no fix after it, no switch', () => {
    const tasks = [
      task('a'),
      task('b', { activity: [{ kind: 'status', text: '', at: 100, now: 'In Review' }, { kind: 'pr', text: 'checks are failing', at: 110 }] }),
      task('c'),
      task('fix', { title: 'Fix the README links', related: ['c'], createdAt: 200, status: 'todo', worktrees: [] }),
      task('d'),
      task('e', { categoryBy: 'you', categoryWas: 'quick' }),
      task('f', { status: 'in_progress', activity: [] }),
      task('g', { worktrees: ['nothing'] }),
    ];
    const log = [run('ws:w-a', economy, 1), run('ws:w-b', economy, 1), run('ws:w-c', economy, 1), run('ws:w-d', economy, 1), run('ws:w-d', { runtime: 'codex', label: 'Codex' }, 2), run('ws:w-e', economy, 1), run('ws:w-f', economy, 1)];
    const by = new Map(taskOutcomes(tasks, log, me).map((o) => [o.id, o]));
    expect(by.get('a')).toMatchObject({ ok: true, combo: 'economy', category: 'docs' });
    expect(by.get('b')).toMatchObject({ ok: false, checksFailed: true });
    expect(by.get('c')).toMatchObject({ ok: false, fixedLater: true });
    expect(by.get('d')).toMatchObject({ ok: false, switched: true });
    expect(by.get('e')).toMatchObject({ ok: false, switched: true });
    expect(by.get('f')?.ok).toBeUndefined();
    expect(by.has('g')).toBe(false);
  });

  it('a combo’s hand-on to its next target is no switch', () => {
    const tasks = [task('a')];
    const log = [run('ws:w-a', economy, 1), run('ws:w-a', { ...economy, runtime: 'codex', label: 'Codex', model: undefined }, 2)];
    expect(taskOutcomes(tasks, log, me)[0]).toMatchObject({ ok: true, switched: false });
  });

  it('prices runs from one table: reported cost, else tokens at the target, against the baseline', () => {
    expect(priceKeyOf({ runtime: 'claude', model: 'claude-haiku-5-5' })).toBe('haiku');
    expect(priceKeyOf({ runtime: 'claude' })).toBe('opus');
    expect(priceKeyOf({ runtime: 'local', model: 'ollama/qwen3' })).toBe('local');
    expect(priceKeyOf({ runtime: 'opencode' })).toBeUndefined();
    expect(perToken('opus')).toBeGreaterThan(perToken('sonnet'));
    expect(runCosts(1_000_000, 0, { runtime: 'claude', model: 'sonnet' }, 'opus')).toEqual({ spent: perToken('sonnet') * 1e6, baseline: perToken('opus') * 1e6 });
    expect(runCosts(1_000_000, 1.5, { runtime: 'claude', model: 'sonnet' }, 'opus').spent).toBe(1.5);
    // Unknown price: as the baseline, no saving claimed.
    const unknown = runCosts(1000, 0, { runtime: 'copilot' }, 'opus');
    expect(unknown.spent).toBe(unknown.baseline);
    expect(savingsWords(2.5, 'opus')).toBe('Saved ~$2.50 against everything on Opus');
    expect(savingsWords(-1, 'sonnet')).toBe('Cost ~$1.00 more than everything on Sonnet');
  });

  it('suggests, only past the minimum sample: a kind that goes well tries cheaper, one that goes badly stronger', () => {
    const many = (n: number, over: (i: number) => Partial<OutcomeTask>) => Array.from({ length: n }, (_, i) => task(`t${i}`, over(i)));
    const good = many(MIN_SAMPLE, () => ({}));
    const log = good.map((t) => run(`ws:${t.worktrees[0]}`, economy, 1));
    const r = comboReport(log, good, me, { stronger: 'Strong' });
    expect(r[0]).toMatchObject({ combo: 'economy', judged: MIN_SAMPLE, good: MIN_SAMPLE, baseline: 'opus' });
    expect(r[0]!.saved).toBeGreaterThan(0);
    expect(r[0]!.suggestions).toEqual([`Docs tasks on Economy went well 100% of the time (${MIN_SAMPLE} tasks); try Haiku directly?`]);
    // One short of the sample: nothing suggested.
    expect(comboReport(log.slice(1), good.slice(1), me)[0]!.suggestions).toEqual([]);
    const bad = many(MIN_SAMPLE, () => ({ category: 'ultrabrain', activity: [{ kind: 'status', text: '', at: 100, now: 'In Review' }, { kind: 'pr', text: 'checks are failing', at: 101 }] }));
    const badLog = bad.map((t) => run(`ws:${t.worktrees[0]}`, economy, 1));
    expect(comboReport(badLog, bad, me, { stronger: 'Strong' })[0]!.suggestions).toEqual([`Ultrabrain tasks on Economy went well 0% of the time (${MIN_SAMPLE} tasks); try Strong?`]);
    // The phone's shape takes it as it is.
    expect(ComboReportView.safeParse(r[0]).success).toBe(true);
  });

  it('a task’s page line: its kind, what it starts on and how it went', () => {
    const t = { ...task('a'), categoryWhy: 'A README' };
    const st = { runtimes: RUNTIMES, prefs: { categoryCombos: { docs: { combo: 'economy' } } }, log: [run('ws:w-a', economy, 1)], selfId: me, board: { issues: [t] } };
    const line = taskKindLine(st, t);
    expect(line).toMatchObject({ category: 'docs', label: 'Docs', why: 'A README', words: 'Docs · Economy', ok: true });
    expect(TaskPageView.shape.kind.safeParse(line).success).toBe(true);
    expect(COMPANION_PROTO.minor).toBeGreaterThanOrEqual(SINCE.routing);
  });
});
