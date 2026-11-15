import { z } from 'zod';
import { formatTokenCount } from './context-usage.js';

/**
 * Token budgets (docs/budget.md, roadmap "modo orquestrador" phase 4): how many tokens a
 * conversation, a day of yours, a project's day and a bot's day may spend, and what Beluga does when
 * one is reached: `downgrade` (the conversation goes on, on a cheaper target: the combo's next one,
 * else a cheaper Claude model), `ask` (the run stops and Needs You asks: go on, go on cheaper, or
 * stop) or `stop` (the run stops). Usage nearing one (80%) is said once, and so is 80% of your
 * plan's 5-hour window.
 *
 * Set in Settings › Agent › Budget (`budget`), in a project's `beluga.json` (`budget`) and in a
 * bot's `bot.json` (`budget`), the same shape in the three. A bot's (your own folder) wins over
 * yours; a project's comes with its repository, so it can only tighten yours, never loosen it.
 * The orchestrator block (core/routing/orchestrator.ts) carries the same object as
 * `orchestrator.budget`. Tokens are input, output and cache writes (cache reads are nearly free,
 * as in Usage). Pure and browser-safe: zod and shared/ only.
 */

export const BUDGET_NEAR = ['downgrade', 'ask', 'stop'] as const;
export type BudgetNear = (typeof BUDGET_NEAR)[number];

/** What a budget does when none says (asking never spends behind your back). */
export const BUDGET_NEAR_DEFAULT: BudgetNear = 'ask';

/** The smallest and largest budget one can set, in tokens. */
export const BUDGET_MIN = 1_000;
export const BUDGET_MAX = 10_000_000_000;

/** Usage at this share of a budget is said once ("80% of this conversation's budget"). */
export const BUDGET_WARN_PCT = 80;
/** Your plan's 5-hour window at this share: said once per window. */
export const PLAN_WARN_PCT = 80;
/** Your plan's 5-hour window at this share: new runs on a combo skip that plan's targets (before the limit, not after). */
export const PLAN_SHIFT_PCT = 95;

/** "Continue" on a budget's Needs You: the budget it reached grows by this share of itself. */
export const BUDGET_ALLOW_SHARE = 0.5;
/** Conversations whose budget choices are kept, at most (the oldest go first). */
export const BUDGET_CHOICES_MAX = 500;

const tokens = z.number().int().min(BUDGET_MIN).max(BUDGET_MAX);

/** The budget block: Settings, beluga.json and bot.json (and `orchestrator.budget`). Unset fields: no budget there. */
export const BudgetConfig = z.object({
  /** Tokens one conversation may spend, over its whole life. */
  conversation: tokens.optional(),
  /** Tokens a day may spend: yours (Settings), the project's (beluga.json) or the bot's (bot.json). */
  day: tokens.optional(),
  /** What happens when one is reached. */
  near: z.enum(BUDGET_NEAR).optional(),
});
export type BudgetConfig = z.infer<typeof BudgetConfig>;

/** What a budget counts: one conversation, your whole day, a project's day, a bot's day. */
export type BudgetScope = 'conversation' | 'day' | 'project' | 'bot';

/** The budgets that apply to one conversation, from the three places. */
export interface ResolvedBudget {
  readonly conversation?: number;
  readonly day?: number;
  readonly projectDay?: number;
  readonly botDay?: number;
  readonly near: BudgetNear;
}

const minOf = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b));

/**
 * Yours, the project's and the bot's, as one: the bot's conversation budget wins (your own folder),
 * a project's can only lower yours (it comes with the repository). `near`: the bot's, else yours,
 * else the project's, else asking.
 */
export function resolveBudget(yours?: BudgetConfig, project?: BudgetConfig, bot?: BudgetConfig): ResolvedBudget {
  const conversation = bot?.conversation ?? minOf(yours?.conversation, project?.conversation);
  const near = bot?.near ?? yours?.near ?? project?.near ?? BUDGET_NEAR_DEFAULT;
  return { ...(conversation !== undefined ? { conversation } : {}), ...(yours?.day !== undefined ? { day: yours.day } : {}), ...(project?.day !== undefined ? { projectDay: project.day } : {}), ...(bot?.day !== undefined ? { botDay: bot.day } : {}), near };
}

export type BudgetLevel = 'ok' | 'near' | 'over';

/** One budget against what it counted. `limit` already has what you allowed past it ("Continue"). */
export interface BudgetLine {
  readonly scope: BudgetScope;
  /** What a "Continue" is kept under: the channel, or the day's (`day:2026-11-15`, `project:<id>:…`, `bot:<id>:…`). */
  readonly key: string;
  readonly used: number;
  readonly limit: number;
  /** What you allowed past the budget you set (part of `limit`). */
  readonly allowed: number;
  readonly pct: number;
  readonly level: BudgetLevel;
  /** The project's or the bot's name. */
  readonly name?: string;
}

/** A budget line: `set` the budget, `allowed` what Continue added. */
export function budgetLine(scope: BudgetScope, key: string, used: number, set: number, allowed = 0, name?: string): BudgetLine {
  const limit = set + Math.max(0, allowed);
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const level: BudgetLevel = used >= limit ? 'over' : pct >= BUDGET_WARN_PCT ? 'near' : 'ok';
  return { scope, key, used, limit, allowed: Math.max(0, allowed), pct, level, ...(name ? { name } : {}) };
}

/** The worst of some lines. */
export const worstLevel = (lines: readonly Pick<BudgetLine, 'level'>[]): BudgetLevel => (lines.some((l) => l.level === 'over') ? 'over' : lines.some((l) => l.level === 'near') ? 'near' : 'ok');

/** The line that's reached (the first over), if one is. */
export const reachedLine = <L extends Pick<BudgetLine, 'level'>>(lines: readonly L[]): L | undefined => lines.find((l) => l.level === 'over');

/** What's allowed past a budget after "Continue": half of the budget again, on top of what's spent already. */
export function allowMore(line: Pick<BudgetLine, 'limit' | 'allowed' | 'used'>): number {
  const set = line.limit - line.allowed;
  return Math.max(line.allowed, line.used - set) + Math.ceil(set * BUDGET_ALLOW_SHARE);
}

/** The local day a moment falls on ("2026-11-15"), as usage-days.ts and stats.json name them. */
export function budgetDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The key a scope's "Continue" is kept under. */
export function budgetKey(scope: BudgetScope, channel: string, day: string, id?: string): string {
  if (scope === 'conversation') return channel;
  if (scope === 'day') return `day:${day}`;
  return `${scope}:${id ?? ''}:${day}`;
}

/** How a budget's Needs You is answered: go on (half the budget again), go on cheaper, or stay stopped. */
export const BUDGET_ANSWERS = ['continue', 'cheaper', 'stop'] as const;
export type BudgetAnswer = (typeof BUDGET_ANSWERS)[number];

/** Choices kept from Needs You: what Continue allowed (by key) and the conversations that go on cheaper. */
export interface BudgetChoices {
  readonly budgetAllow: Readonly<Record<string, number>>;
  readonly budgetCheaper: readonly string[];
}

/** The allowances kept: today's and conversations', at most BUDGET_CHOICES_MAX (older days' fall away). */
export function keptAllowances(allow: Readonly<Record<string, number>>, today: string): Record<string, number> {
  const entries = Object.entries(allow).filter(([k]) => !/:\d{4}-\d{2}-\d{2}$/.test(k) || k.endsWith(`:${today}`));
  return Object.fromEntries(entries.slice(-BUDGET_CHOICES_MAX));
}

/** The conversations that go on cheaper, with `channel` added (newest last). */
export const cheaperChats = (list: readonly string[], channel: string): string[] => [...list.filter((c) => c !== channel), channel].slice(-BUDGET_CHOICES_MAX);

// ---------------------------------------------------------------------------------- downgrading

/**
 * A cheaper Claude model than `model`: Opus → Sonnet → Haiku. Unset (Claude Code's default, Opus on
 * the plans that have it): Sonnet. Already the cheapest, or not Claude's: undefined.
 */
export function cheaperModel(model: string | undefined, runtime = 'claude'): string | undefined {
  if (runtime !== 'claude') return undefined;
  if (!model) return 'sonnet';
  const m = model.toLowerCase();
  if (m.includes('opus') || m === 'best' || m.startsWith('opusplan')) return 'sonnet';
  if (m.includes('sonnet')) return 'haiku';
  return undefined;
}

// ---------------------------------------------------------------------------------- words

/** "2.0M", "350k". */
export const budgetTokens = (n: number): string => formatTokenCount(n);

/** "1.6M of 2.0M (80%)". English: what the daemon says in a chat; screens use their own words. */
export const budgetUse = (line: Pick<BudgetLine, 'used' | 'limit' | 'pct'>): string => `${budgetTokens(line.used)} of ${budgetTokens(line.limit)} (${line.pct}%)`;

const SCOPE_WORDS: Readonly<Record<BudgetScope, string>> = { conversation: 'this conversation’s', day: 'your daily', project: 'the project’s daily', bot: 'the bot’s daily' };

/** "this conversation’s budget", "Supa’s daily budget". English (the chat's lines). */
export const budgetName = (line: Pick<BudgetLine, 'scope' | 'name'>): string => (line.scope === 'project' || line.scope === 'bot') && line.name ? `${line.name}’s daily budget` : `${SCOPE_WORDS[line.scope]} token budget`;
