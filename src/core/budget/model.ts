import { usageFor } from '../../agent/usage.js';
import { PLAN_SHIFT_PCT, PLAN_WARN_PCT, type BudgetLevel, type BudgetLine, type BudgetNear, type ResolvedBudget, budgetDay, budgetKey, budgetLine, reachedLine, resolveBudget, worstLevel } from '../../shared/budget.js';
import { decodeFailure } from '../../shared/run-failure.js';
import { type BotInfo, botBehind, botOfChannel } from '../bots/schema.js';
import type { DomainState, LogItem } from '../store.js';
import type { Project, Workspace } from '../../workspaces/types.js';

/**
 * Budgets against what was spent (shared/budget.ts), read from the app's state: the daemon decides
 * with it (core/budget/guard.ts), and the Mac and the phone show the same numbers. A workspace's
 * conversation counts its own usage (WorkspaceUsage and its days); every other conversation of
 * yours, the ledger (core/budget/store.ts). Pure; reads the state only.
 */

/** What budgets read of the state. */
export type BudgetRead = Pick<DomainState, 'prefs' | 'projects' | 'bots' | 'spend' | 'selfId' | 'self'>;

const tokensOf = (u: Workspace['usage']): number => (u ? u.input + u.output + u.cacheWrite : 0);

/** A `ws:` conversation's workspace and its project. */
function placeOf(st: Pick<BudgetRead, 'projects'>, channel: string): { readonly project: Project; readonly ws: Workspace } | undefined {
  if (!channel.startsWith('ws:')) return undefined;
  const id = channel.slice(3);
  for (const project of st.projects) {
    const ws = project.workspaces.find((w) => w.id === id);
    if (ws) return { project, ws };
  }
  return undefined;
}

/** The project a conversation works in (a `ws:` one's). */
export const projectOfChannel = (st: Pick<BudgetRead, 'projects'>, channel: string): Project | undefined => placeOf(st, channel)?.project;

/** Tokens a conversation spent over its life. */
export function conversationSpent(st: Pick<BudgetRead, 'projects' | 'spend'>, channel: string): number {
  const at = placeOf(st, channel);
  return at ? tokensOf(at.ws.usage) : (st.spend.total[channel] ?? 0);
}

const ledgerToday = (st: Pick<BudgetRead, 'spend'>, day: string): Readonly<Record<string, number>> => (st.spend.day === day ? st.spend.today : {});

/** Tokens all your conversations spent on `day`. */
export function daySpent(st: Pick<BudgetRead, 'projects' | 'spend'>, day: string): number {
  let n = 0;
  for (const p of st.projects) for (const w of p.workspaces) n += w.usage?.days?.[day]?.tokens ?? 0;
  for (const v of Object.values(ledgerToday(st, day))) n += v;
  return n;
}

/** Tokens a project's conversations spent on `day`. */
export const projectDaySpent = (project: Project, day: string): number => project.workspaces.reduce((n, w) => n + (w.usage?.days?.[day]?.tokens ?? 0), 0);

/** Tokens a bot spent on `day`: its chats, and the worktrees of work it dispatched. */
export function botDaySpent(st: Pick<BudgetRead, 'projects' | 'spend'>, bot: Pick<BotInfo, 'id' | 'channel' | 'behind'>, day: string): number {
  let n = 0;
  for (const [channel, v] of Object.entries(ledgerToday(st, day))) if (channel === bot.channel || botOfChannel(channel)?.id === bot.id || bot.behind.includes(channel)) n += v;
  for (const p of st.projects) for (const w of p.workspaces) if (bot.behind.includes(`ws:${w.id}`)) n += w.usage?.days?.[day]?.tokens ?? 0;
  return n;
}

/** The budgets on one conversation, and each against what it counts. */
export interface ChannelBudget {
  readonly resolved: ResolvedBudget;
  readonly lines: readonly BudgetLine[];
}

/** The budgets that apply to `channel` now (yours, its project's, its bot's), each against what it counted. */
export function channelBudget(st: BudgetRead, channel: string, now: number): ChannelBudget {
  const day = budgetDay(now);
  const project = projectOfChannel(st, channel);
  const bot = botBehind(st.bots.bots, channel);
  const resolved = resolveBudget(st.prefs.budget, project?.scripts?.budget, bot?.budget);
  const allow = st.prefs.budgetAllow;
  const lines: BudgetLine[] = [];
  if (resolved.conversation !== undefined) lines.push(budgetLine('conversation', channel, conversationSpent(st, channel), resolved.conversation, allow[channel]));
  if (resolved.day !== undefined) {
    const key = budgetKey('day', channel, day);
    lines.push(budgetLine('day', key, daySpent(st, day), resolved.day, allow[key]));
  }
  if (resolved.projectDay !== undefined && project) {
    const key = budgetKey('project', channel, day, project.id);
    lines.push(budgetLine('project', key, projectDaySpent(project, day), resolved.projectDay, allow[key], project.name));
  }
  if (resolved.botDay !== undefined && bot) {
    const key = budgetKey('bot', channel, day, bot.id);
    lines.push(budgetLine('bot', key, botDaySpent(st, bot, day), resolved.botDay, allow[key], bot.name));
  }
  return { resolved, lines };
}

/** Your plan's 5-hour window now (Claude's), while it hasn't reset. */
export interface PlanWindowNow {
  readonly pct: number;
  readonly resetsAt?: number;
  readonly level: BudgetLevel;
}

export function planWindow(st: Pick<BudgetRead, 'self'>, now: number): PlanWindowNow | undefined {
  const w = usageFor(st.self, 'claude')?.fiveHour;
  if (!w || (w.resetsAt !== undefined && w.resetsAt <= now)) return undefined;
  return { pct: w.pct, ...(w.resetsAt !== undefined ? { resetsAt: w.resetsAt } : {}), level: w.pct >= PLAN_SHIFT_PCT ? 'over' : w.pct >= PLAN_WARN_PCT ? 'near' : 'ok' };
}

/** What a run in a conversation does about its budgets now. */
export type BudgetDecision =
  | { readonly kind: 'go' }
  /** A budget is reached and it goes on cheaper (`downgrade`, or you chose Cheaper on its Needs You). */
  | { readonly kind: 'downgrade'; readonly line: BudgetLine }
  /** A budget is reached: the run doesn't start (or stops), and Needs You asks (`ask`) or not (`stop`). */
  | { readonly kind: 'ask' | 'stop'; readonly line: BudgetLine }
  /** No budget reached, but your plan's 5-hour window is nearly used up: a combo skips that plan's targets. */
  | { readonly kind: 'shift'; readonly resetsAt?: number };

export function budgetDecision(st: BudgetRead, channel: string, now: number): BudgetDecision {
  const { resolved, lines } = channelBudget(st, channel, now);
  const line = reachedLine(lines);
  if (line) {
    const near: BudgetNear = st.prefs.budgetCheaper.includes(channel) ? 'downgrade' : resolved.near;
    return near === 'downgrade' ? { kind: 'downgrade', line } : { kind: near, line };
  }
  const plan = planWindow(st, now);
  return plan?.level === 'over' ? { kind: 'shift', ...(plan.resetsAt !== undefined ? { resetsAt: plan.resetsAt } : {}) } : { kind: 'go' };
}

/** A budget reached in `channel` (nothing restarts there on its own past one): the line, or undefined. */
export const budgetReached = (st: BudgetRead, channel: string, now: number): BudgetLine | undefined => reachedLine(channelBudget(st, channel, now).lines);

/** A conversation's budgets as the screens show them (undefined: none set and the plan's window isn't near). */
export interface BudgetView {
  readonly channel: string;
  readonly near: BudgetNear;
  readonly lines: readonly BudgetLine[];
  readonly level: BudgetLevel;
  /** Past a budget, it goes on cheaper. */
  readonly cheaper: boolean;
  readonly plan?: PlanWindowNow;
}

export function budgetView(st: BudgetRead, channel: string, now: number): BudgetView | undefined {
  const { resolved, lines } = channelBudget(st, channel, now);
  const plan = planWindow(st, now);
  const shownPlan = plan && plan.level !== 'ok' ? plan : undefined;
  if (!lines.length && !shownPlan) return undefined;
  const level = worstLevel(lines);
  return { channel, near: resolved.near, lines, level, cheaper: level === 'over' && (resolved.near === 'downgrade' || st.prefs.budgetCheaper.includes(channel)), ...(shownPlan ? { plan: shownPlan } : {}) };
}

/** Your day's budgets, for Usage: yours, each project's and each bot's that has one. */
export interface DayBudgets {
  readonly day: string;
  readonly spent: number;
  readonly lines: readonly BudgetLine[];
  readonly plan?: PlanWindowNow;
  /** Settings' budget (none: unset). */
  readonly yours?: ResolvedBudget;
}

export function dayBudgets(st: BudgetRead, now: number): DayBudgets {
  const day = budgetDay(now);
  const allow = st.prefs.budgetAllow;
  const lines: BudgetLine[] = [];
  const yours = st.prefs.budget;
  if (yours?.day !== undefined) {
    const key = budgetKey('day', '', day);
    lines.push(budgetLine('day', key, daySpent(st, day), yours.day, allow[key]));
  }
  for (const p of st.projects) {
    const d = p.scripts?.budget?.day;
    if (d === undefined) continue;
    const key = budgetKey('project', '', day, p.id);
    lines.push(budgetLine('project', key, projectDaySpent(p, day), d, allow[key], p.name));
  }
  for (const b of st.bots.bots) {
    if (b.budget?.day === undefined) continue;
    const key = budgetKey('bot', '', day, b.id);
    lines.push(budgetLine('bot', key, botDaySpent(st, b, day), b.budget.day, allow[key], b.name));
  }
  const plan = planWindow(st, now);
  return { day, spent: daySpent(st, day), lines, ...(plan ? { plan } : {}), ...(yours ? { yours: resolveBudget(yours) } : {}) };
}

type AgentCard = Extract<LogItem, { type: 'agent' }>;

/** A conversation whose newest run of yours stopped at a budget set to ask, still reached: Needs You asks what now. */
export interface BudgetAsk {
  readonly channel: string;
  readonly requestId: string;
  readonly at: number;
  readonly line: BudgetLine;
}

export function budgetAsks(st: BudgetRead & Pick<DomainState, 'log'>, now: number): BudgetAsk[] {
  const last = new Map<string, AgentCard>();
  for (const item of st.log) if (item.type === 'agent' && item.owner === st.selfId) last.set(item.channel, item);
  const out: BudgetAsk[] = [];
  for (const [channel, card] of last) {
    if (card.status !== 'error') continue;
    const f = decodeFailure(card.text);
    if (f?.kind !== 'budget' || f.budget?.near !== 'ask') continue;
    const line = budgetReached(st, channel, now);
    if (!line || st.prefs.budgetCheaper.includes(channel)) continue;
    out.push({ channel, requestId: card.requestId, at: card.endTs ?? card.lastAt ?? card.ts, line });
  }
  return out;
}
