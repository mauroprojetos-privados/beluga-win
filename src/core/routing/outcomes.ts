import type { AgentRef } from '../../protocol.js';
import { LOCAL_RUNTIME } from '../../shared/local-endpoints.js';
import { type CategoryCombos, type ComboUsage, type LimitCard, type RoutedTask, type WorkCategory, CATEGORY_INFO, comboUsage, combosIn, taskRoute, taskRouteWords } from './model.js';

/**
 * Phase 5 (docs/routing.md): did routing work, and what did it save. All of it is worked out from
 * what is already logged: the runs' cards (the target each ran on, its tokens and cost) and the
 * tasks' own history (statuses, pull-request notes, a kind you corrected). Nothing here changes
 * anything: suggestions are words for you to act on, never applied on their own.
 *
 * Pure and browser-safe (zod-free, shared/ only): the daemon answers `routing.usage` with it, the
 * Mac draws Usage › Combos from the same functions.
 */

// ---------------------------------------------------------------------------
// Prices: the one table
// ---------------------------------------------------------------------------

/**
 * What a million tokens cost on each model family, in USD (Anthropic's list prices for the current
 * Opus, Sonnet and Haiku; OpenAI's for the GPT-5 models Codex runs). Runs report tokens as one
 * number (input, output and cache writes together), so a run is priced at a blend: mostly input.
 */
export const MODEL_PRICES = {
  opus: { label: 'Claude · Opus', input: 4, output: 20 },
  sonnet: { label: 'Claude · Sonnet', input: 2, output: 10 },
  haiku: { label: 'Claude · Haiku', input: 0.1, output: 0.5 },
  codex: { label: 'Codex', input: 1.25, output: 10 },
  local: { label: 'Your own model', input: 0, output: 0 },
} as const;
export type PriceKey = keyof typeof MODEL_PRICES;

/** The share of a run's tokens taken as output when pricing it (agents read far more than they write). */
export const OUTPUT_SHARE = 0.1;

/** USD per token at a price row's blend. */
export const perToken = (key: PriceKey): number => (MODEL_PRICES[key].input * (1 - OUTPUT_SHARE) + MODEL_PRICES[key].output * OUTPUT_SHARE) / 1_000_000;

/** What savings are measured against: everything on one model (Settings picks; default Opus). */
export const SAVINGS_BASELINES = ['opus', 'sonnet', 'codex'] as const satisfies readonly PriceKey[];
export type SavingsBaseline = (typeof SAVINGS_BASELINES)[number];
export const DEFAULT_BASELINE: SavingsBaseline = 'opus';

/** "everything on Opus". */
export const baselineWords = (b: SavingsBaseline): string => `everything on ${b === 'opus' ? 'Opus' : b === 'sonnet' ? 'Sonnet' : 'Codex'}`;

/**
 * The price row a run's target is priced at: a Claude model by its family (unnamed: Opus, so an
 * unknown default never claims a saving), Codex, your own endpoint (free). Another runtime
 * (OpenCode, Copilot): unknown, priced at the baseline (no saving claimed either way).
 */
export function priceKeyOf(agent: Pick<AgentRef, 'runtime' | 'model'>): PriceKey | undefined {
  if (agent.runtime === LOCAL_RUNTIME) return 'local';
  if (agent.runtime === 'codex') return 'codex';
  if (agent.runtime !== 'claude') return undefined;
  const m = agent.model?.toLowerCase() ?? '';
  return m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : 'opus';
}

/** One run's cost as spent (its reported cost; none reported: its tokens at its target's price) and at the baseline. */
export function runCosts(tokens: number, cost: number, agent: Pick<AgentRef, 'runtime' | 'model'>, baseline: SavingsBaseline): { readonly spent: number; readonly baseline: number } {
  const base = tokens * perToken(baseline);
  const key = priceKeyOf(agent);
  const spent = cost > 0 ? cost : key ? tokens * perToken(key) : base;
  return { spent, baseline: base };
}

// ---------------------------------------------------------------------------
// Did a task go well
// ---------------------------------------------------------------------------

/** What an outcome reads of a task (core/board/model.ts Issue). */
export interface OutcomeTask {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly labels: readonly string[];
  readonly related: readonly string[];
  readonly blockedBy: readonly string[];
  readonly parent?: string;
  readonly worktrees: readonly string[];
  readonly createdAt: number;
  readonly category?: WorkCategory;
  /** Who set its kind: `you` with `categoryWas` set is a correction. */
  readonly categoryBy?: string;
  readonly categoryWas?: WorkCategory;
  readonly activity: ReadonlyArray<{ readonly kind: string; readonly text: string; readonly at: number; readonly now?: string }>;
}

/** A run card as outcomes read it. */
type RunCard = LimitCard & { readonly agent?: AgentRef; readonly channel?: string };

/** How a task went (undefined `ok`: not judged yet, it hasn't reached In Review). */
export interface TaskOutcome {
  readonly id: string;
  readonly key: string;
  readonly category?: WorkCategory;
  /** The combo its first run on a combo went through. */
  readonly combo?: string;
  readonly comboName?: string;
  readonly reachedReview: boolean;
  /** A later task fixes it (related to it, or under it, a bug or titled "Fix…"). */
  readonly fixedLater: boolean;
  /** Its pull request's checks failed at some point (first try didn't pass). */
  readonly checksFailed: boolean;
  /** You switched its model (its runs picked different agents) or corrected its kind. */
  readonly switched: boolean;
  readonly ok?: boolean;
  readonly runs: number;
  readonly tokens: number;
}

const IN_REVIEW = 'In Review';
const FIX = /^\s*fix(es|ed)?\b/i;

/** When a task first reached In Review (or undefined). Done or In Review now with no such line (older history): its creation. */
function reviewAt(t: OutcomeTask): number | undefined {
  const line = t.activity.find((a) => a.kind === 'status' && a.now === IN_REVIEW);
  if (line) return line.at;
  return t.status === 'in_review' || t.status === 'done' ? t.createdAt : undefined;
}

/** The pick a run made: its combo, or its runtime and model. A combo's hand-on to another target is the same pick. */
const pickOf = (a: Pick<AgentRef, 'runtime' | 'model' | 'combo'>): string => (a.combo ? `combo:${a.combo}` : `${a.runtime}|${a.model ?? ''}`);

/**
 * Each task's outcome: went well when it reached In Review, no later task fixes it, its checks never
 * failed, and you didn't switch its model or correct its kind. Only tasks some run of yours worked.
 */
export function taskOutcomes(tasks: readonly OutcomeTask[], log: readonly RunCard[], selfId: string, since = 0): TaskOutcome[] {
  const byChannel = new Map<string, RunCard[]>();
  for (const item of log) {
    if (item.type !== 'agent' || item.owner !== selfId || !item.channel || !item.agent || item.ts < since) continue;
    const list = byChannel.get(item.channel) ?? [];
    list.push(item);
    byChannel.set(item.channel, list);
  }
  const out: TaskOutcome[] = [];
  for (const t of tasks) {
    const runs = t.worktrees.flatMap((w) => byChannel.get(`ws:${w}`) ?? []).sort((a, b) => a.ts - b.ts);
    if (!runs.length) continue;
    const at = reviewAt(t);
    const reachedReview = at !== undefined;
    const fixedLater = reachedReview && tasks.some((o) => o.id !== t.id && o.createdAt > at && (o.related.includes(t.id) || t.related.includes(o.id) || o.blockedBy.includes(t.id) || o.parent === t.id) && (FIX.test(o.title) || o.labels.includes('bug')));
    const checksFailed = t.activity.some((a) => a.kind === 'pr' && /checks are failing/.test(a.text));
    const corrected = t.categoryBy === 'you' && t.categoryWas !== undefined && t.categoryWas !== t.category;
    const switched = corrected || new Set(runs.map((r) => pickOf(r.agent!))).size > 1;
    const first = runs.find((r) => r.agent?.combo)?.agent;
    const judged = reachedReview || t.status === 'canceled';
    out.push({
      id: t.id,
      key: t.key,
      ...(t.category ? { category: t.category } : {}),
      ...(first?.combo ? { combo: first.combo, comboName: first.comboName ?? first.combo } : {}),
      reachedReview,
      fixedLater,
      checksFailed,
      switched,
      ...(judged ? { ok: reachedReview && !fixedLater && !checksFailed && !switched } : {}),
      runs: runs.length,
      tokens: runs.reduce((n, r) => n + (r.usage?.tokens ?? 0), 0),
    });
  }
  return out;
}

/** "Went well", or why not ("checks failed", "fixed by a later task", "you switched its model"). */
export function outcomeWords(o: Pick<TaskOutcome, 'ok' | 'reachedReview' | 'fixedLater' | 'checksFailed' | 'switched'>): string {
  if (o.ok === undefined) return 'Not judged yet: it hasn’t reached In Review';
  if (o.ok) return 'Went well: In Review, checks passed first time, no fix after, no switch';
  const why = [!o.reachedReview ? 'canceled before review' : '', o.checksFailed ? 'checks failed' : '', o.fixedLater ? 'a later task fixes it' : '', o.switched ? 'you switched its model or kind' : ''].filter(Boolean);
  return `Didn’t go well: ${why.join(', ')}`;
}

// ---------------------------------------------------------------------------
// The report: usage, success and savings by combo, and suggestions
// ---------------------------------------------------------------------------

/** How tasks of one kind went on a combo. */
export interface CategoryOutcome {
  readonly category: WorkCategory;
  /** Tasks judged (reached In Review, or canceled). */
  readonly judged: number;
  readonly good: number;
}

/** A combo's usage (comboUsage), with how its tasks went and what it saved against the baseline. */
export interface ComboReport extends ComboUsage {
  /** Tasks judged, and how many went well. */
  readonly judged: number;
  readonly good: number;
  readonly categories: readonly CategoryOutcome[];
  /** Its runs at the baseline's price, what they cost (as reported, else estimated), and the difference. */
  readonly baselineCost: number;
  readonly spent: number;
  readonly saved: number;
  /** The baseline the savings are against. */
  readonly baseline: SavingsBaseline;
  /** Read-only suggestions for this combo ("docs tasks on Economy went well 95% of the time (20 tasks); try Haiku directly?"). */
  readonly suggestions: readonly string[];
}

/** How many judged tasks a suggestion needs before it is made. */
export const MIN_SAMPLE = 10;
/** At least this share gone well: try something cheaper. At most this: try something stronger. */
const WELL = 0.9;
const BADLY = 0.6;

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * Usage › Combos in full: each combo's runs, tokens and cost by target, how its tasks went (by kind
 * too), what it saved against `baseline`, and the suggestions its record supports (at least
 * MIN_SAMPLE tasks of a kind). `stronger`: the name of a combo to suggest when a kind goes badly.
 */
export function comboReport(log: readonly RunCard[], tasks: readonly OutcomeTask[], selfId: string, opts: { readonly since?: number; readonly baseline?: SavingsBaseline; readonly stronger?: string } = {}): ComboReport[] {
  const since = opts.since ?? 0;
  const baseline = opts.baseline ?? DEFAULT_BASELINE;
  const usage = comboUsage(log, selfId, since);
  const outcomes = taskOutcomes(tasks, log, selfId, since);
  const money = new Map<string, { base: number; spent: number; cheapest?: PriceKey }>();
  for (const item of log) {
    const a = item.agent;
    if (item.type !== 'agent' || item.owner !== selfId || !a?.combo || item.ts < since || !item.status || !['done', 'error', 'denied'].includes(item.status)) continue;
    const m = money.get(a.combo) ?? { base: 0, spent: 0 };
    const c = runCosts(item.usage?.tokens ?? 0, item.usage?.cost ?? 0, a, baseline);
    m.base += c.baseline;
    m.spent += c.spent;
    money.set(a.combo, m);
  }
  return usage.map((u) => {
    const mine = outcomes.filter((o) => o.combo === u.combo && o.ok !== undefined);
    const byCat = new Map<WorkCategory, { judged: number; good: number }>();
    for (const o of mine) {
      if (!o.category) continue;
      const c = byCat.get(o.category) ?? { judged: 0, good: 0 };
      c.judged += 1;
      if (o.ok) c.good += 1;
      byCat.set(o.category, c);
    }
    const categories = [...byCat].map(([category, c]) => ({ category, ...c })).sort((x, y) => y.judged - x.judged);
    const m = money.get(u.combo) ?? { base: 0, spent: 0 };
    // The target most of its runs went to: what a cheaper suggestion has to beat.
    const main = u.targets[0];
    const mainKey = main ? priceKeyOf({ runtime: main.runtime, model: main.target.toLowerCase() }) : undefined;
    const suggestions = categories.flatMap((c) => {
      if (c.judged < MIN_SAMPLE) return [];
      const rate = c.good / c.judged;
      const said = `${CATEGORY_INFO[c.category].label} tasks on ${u.name} went well ${pct(rate)} of the time (${c.judged} tasks)`;
      if (rate >= WELL && mainKey && mainKey !== 'haiku' && mainKey !== 'local' && perToken(mainKey) > perToken('haiku')) return [`${said}; try Haiku directly?`];
      if (rate <= BADLY && opts.stronger && opts.stronger !== u.name) return [`${said}; try ${opts.stronger}?`];
      if (rate <= BADLY) return [`${said}; try a stronger combo?`];
      return [];
    });
    return { ...u, judged: mine.length, good: mine.filter((o) => o.ok).length, categories, baselineCost: m.base, spent: m.spent, saved: m.base - m.spent, baseline, suggestions };
  });
}

/** The combo a suggestion names when a kind of work goes badly: the one Ultrabrain work starts on, else Strong. */
export function strongerOf(st: Parameters<typeof combosIn>[0] & { readonly prefs: { readonly categoryCombos?: CategoryCombos } }): { stronger?: string } {
  const id = st.prefs.categoryCombos?.ultrabrain?.combo ?? 'strong';
  const name = combosIn(st).find((c) => c.id === id)?.name;
  return name ? { stronger: name } : {};
}

/** "Saved $12.40 against everything on Opus", "Cost $1.20 more than everything on Opus". */
export function savingsWords(saved: number, baseline: SavingsBaseline): string {
  const usd = (n: number): string => (n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
  if (Math.abs(saved) < 0.005) return `About the same as ${baselineWords(baseline)}`;
  return saved > 0 ? `Saved ~${usd(saved)} against ${baselineWords(baseline)}` : `Cost ~${usd(-saved)} more than ${baselineWords(baseline)}`;
}

/** "18 of 20 went well (90%)", or nothing judged yet. */
export const successWords = (judged: number, good: number): string => (judged ? `${good} of ${judged} went well (${pct(good / judged)})` : 'No task judged yet');

// ---------------------------------------------------------------------------
// A task's kind and record, as its page shows it (the Mac and the phone)
// ---------------------------------------------------------------------------

/** A task's page line: its kind, why, what it starts on ("Visual · Strong"), and how it went. */
export interface TaskKindLine {
  readonly category?: WorkCategory;
  readonly label?: string;
  readonly why?: string;
  /** "Visual · Strong", "Docs · your agent". */
  readonly words: string;
  /** You changed the kind it was given. */
  readonly corrected?: boolean;
  readonly ok?: boolean;
  readonly outcome?: string;
}

/** What a task's line reads of the app's state (the daemon's and the screens' are the same shape). */
export interface TaskKindState {
  readonly runtimes: Parameters<typeof taskRoute>[0]['runtimes'];
  readonly prefs: Parameters<typeof taskRoute>[0]['prefs'] & { readonly combos?: Parameters<typeof taskRoute>[0]['prefs']['combos'] };
  readonly log: readonly RunCard[];
  readonly selfId: string;
  readonly board: { readonly issues: readonly (OutcomeTask & RoutedTask & { readonly categoryWhy?: string })[] };
}

/** A task's kind of work and record (undefined: nothing to say, no kind and no run). */
export function taskKindLine(st: TaskKindState, issue: OutcomeTask & RoutedTask & { readonly categoryWhy?: string }): TaskKindLine | undefined {
  const route = taskRoute(st, issue);
  const outcome = taskOutcomes(st.board.issues.some((i) => i.id === issue.id) ? st.board.issues : [...st.board.issues, issue], st.log, st.selfId).find((o) => o.id === issue.id);
  if (!issue.category && !outcome) return undefined;
  const corrected = issue.categoryBy === 'you' && issue.categoryWas !== undefined && issue.categoryWas !== issue.category;
  return {
    ...(issue.category ? { category: issue.category, label: CATEGORY_INFO[issue.category].label } : {}),
    ...(issue.categoryWhy ? { why: issue.categoryWhy } : {}),
    words: taskRouteWords(issue.category, route),
    ...(corrected ? { corrected } : {}),
    ...(outcome?.ok !== undefined ? { ok: outcome.ok } : {}),
    ...(outcome ? { outcome: outcomeWords(outcome) } : {}),
  };
}
