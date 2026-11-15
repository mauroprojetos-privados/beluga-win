import type { AgentRef } from '../../protocol.js';
import { DEFAULT_BASELINE, type PriceKey, type SavingsBaseline, perToken, priceKeyOf } from './outcomes.js';

/**
 * Orchestrator mode, phase 5 (roadmap/modo-orquestrador.md, docs/routing.md "Lead and executors"):
 * what the lead spent and what its executors (the sub-agents it started) took off it, by
 * conversation and by day, what that saved at the price table's rates, and the fixed context cost a
 * run starts with, per project. All of it from the runs' cards (their usage, core/store.ts RunUsage):
 * no probe, nothing run for it.
 *
 * Pure and browser-safe: the daemon answers `routing.leadUsage` with it, the Mac draws Usage › Combos
 * from the same function.
 */

/** A run card as the measures read it. */
export interface MeasuredCard {
  readonly type: string;
  readonly owner?: string;
  readonly ts: number;
  readonly channel?: string;
  readonly agent?: Pick<AgentRef, 'runtime' | 'model'>;
  readonly usage?: {
    readonly tokens: number;
    readonly executorTokens?: number;
    readonly executorModel?: string;
    readonly opening?: { readonly used: number; readonly breakdown?: { readonly system: number; readonly tools: number; readonly conversation: number } };
  };
}

/** Tokens the lead spent, the executors' part, and what the executors saved (USD; negative: cost more). */
export interface LeadSplit {
  readonly lead: number;
  readonly executors: number;
  readonly saved: number;
}

export interface ConversationSplit extends LeadSplit {
  readonly channel: string;
  readonly name: string;
  readonly runs: number;
}

export interface DaySplit extends LeadSplit {
  /** Local day, "2026-11-15". */
  readonly day: string;
}

/**
 * The context a run starts with in one project, averaged over its latest runs: the first number
 * (system prompt, tools, CLAUDE.md, skills, MCP servers, and the conversation so far) and, where
 * Claude Code said, where it comes from. `system` is the fixed part trimming skills and MCPs lowers.
 */
export interface OpeningCost {
  readonly project: string;
  readonly name: string;
  /** Runs averaged (at most OPENING_RUNS). */
  readonly runs: number;
  readonly used: number;
  readonly system?: number;
  readonly tools?: number;
  readonly conversation?: number;
  /** The latest run's first number, to compare with the average after a change. */
  readonly last: number;
}

export interface LeadReport extends LeadSplit {
  readonly baseline: SavingsBaseline;
  /** The conversations that spent the most (at most CONVERSATIONS), largest first. */
  readonly conversations: readonly ConversationSplit[];
  /** The last DAYS days that spent anything, newest first. */
  readonly days: readonly DaySplit[];
  readonly openings: readonly OpeningCost[];
}

/** Where a conversation is: its name, and its project's (none: outside a project, its openings aren't averaged). */
export interface MeasuredPlace {
  readonly name: string;
  readonly project?: string;
  readonly projectName?: string;
}

export const CONVERSATIONS = 10;
export const DAYS = 14;
/** The running average of a project's opening context is over its latest runs, so a change shows soon. */
export const OPENING_RUNS = 20;

const DAY_MS = 86_400_000;

/** "2026-11-15" in local time. */
export const localDay = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * What a run's executors saved the lead: their tokens at the lead's price less at their own. The
 * lead's price is its model's; a Claude lead with no model named (the default) is priced at the
 * baseline Settings picks. Executors on an unknown model are taken as the lead's: no saving claimed.
 */
export function executorSaving(card: MeasuredCard, baseline: SavingsBaseline = DEFAULT_BASELINE): number {
  const u = card.usage;
  const ex = u ? Math.min(u.executorTokens ?? 0, u.tokens) : 0;
  if (!(ex > 0)) return 0;
  const lead: PriceKey = !card.agent || (card.agent.runtime === 'claude' && !card.agent.model) ? baseline : (priceKeyOf(card.agent) ?? baseline);
  const exec: PriceKey = u?.executorModel ? (priceKeyOf({ runtime: 'claude', model: u.executorModel }) ?? lead) : lead;
  return ex * (perToken(lead) - perToken(exec));
}

/** Your runs' tokens split between the lead and its executors, by conversation and by day, and the opening context per project. */
export function leadReport(log: readonly MeasuredCard[], selfId: string, opts: { readonly since?: number; readonly baseline?: SavingsBaseline; readonly now?: number; readonly place?: (channel: string) => MeasuredPlace | undefined } = {}): LeadReport {
  const since = opts.since ?? 0;
  const baseline = opts.baseline ?? DEFAULT_BASELINE;
  const now = opts.now ?? Date.now();
  const firstDay = now - (DAYS - 1) * DAY_MS;
  const total = { lead: 0, executors: 0, saved: 0 };
  const byChannel = new Map<string, { lead: number; executors: number; saved: number; runs: number }>();
  const byDay = new Map<string, { lead: number; executors: number; saved: number }>();
  const openings = new Map<string, { name: string; runs: MeasuredCard[] }>();
  const places = new Map<string, MeasuredPlace | undefined>();
  const placeOf = (channel: string): MeasuredPlace | undefined => {
    if (!places.has(channel)) places.set(channel, opts.place?.(channel));
    return places.get(channel);
  };
  for (const card of log) {
    if (card.type !== 'agent' || card.owner !== selfId || card.ts < since || !card.usage) continue;
    const u = card.usage;
    const executors = Math.min(Math.max(0, u.executorTokens ?? 0), u.tokens);
    const lead = Math.max(0, u.tokens - executors);
    const saved = executorSaving(card, baseline);
    const add = (to: { lead: number; executors: number; saved: number }): void => {
      to.lead += lead;
      to.executors += executors;
      to.saved += saved;
    };
    if (u.tokens > 0) {
      add(total);
      const channel = card.channel ?? 'room';
      const c = byChannel.get(channel) ?? { lead: 0, executors: 0, saved: 0, runs: 0 };
      add(c);
      c.runs += 1;
      byChannel.set(channel, c);
      if (card.ts >= firstDay - DAY_MS) {
        const day = localDay(card.ts);
        const d = byDay.get(day) ?? { lead: 0, executors: 0, saved: 0 };
        add(d);
        byDay.set(day, d);
      }
    }
    const project = u.opening && u.opening.used > 0 && card.channel ? placeOf(card.channel) : undefined;
    if (project?.project) {
      const o = openings.get(project.project) ?? { name: project.projectName ?? project.project, runs: [] };
      o.runs.push(card);
      openings.set(project.project, o);
    }
  }
  const days = [...byDay].map(([day, d]) => ({ day, ...d })).filter((d) => d.day >= localDay(firstDay)).sort((a, b) => (a.day < b.day ? 1 : -1));
  const conversations = [...byChannel]
    .map(([channel, c]) => ({ channel, name: placeOf(channel)?.name ?? channel, ...c }))
    .sort((a, b) => b.lead + b.executors - (a.lead + a.executors))
    .slice(0, CONVERSATIONS);
  return { ...total, baseline, conversations, days, openings: [...openings].map(([project, o]) => openingCost(project, o.name, o.runs)).sort((a, b) => b.used - a.used) };
}

/** A project's opening context: the average of its latest runs (and of the breakdowns among them). */
function openingCost(project: string, name: string, cards: readonly MeasuredCard[]): OpeningCost {
  const recent = [...cards].sort((a, b) => a.ts - b.ts).slice(-OPENING_RUNS);
  const avg = (ns: readonly number[]): number => Math.round(ns.reduce((n, x) => n + x, 0) / ns.length);
  const opened = recent.map((c) => c.usage!.opening!);
  const broken = opened.flatMap((o) => (o.breakdown ? [o.breakdown] : []));
  return {
    project,
    name,
    runs: recent.length,
    used: avg(opened.map((o) => o.used)),
    ...(broken.length ? { system: avg(broken.map((b) => b.system)), tools: avg(broken.map((b) => b.tools)), conversation: avg(broken.map((b) => b.conversation)) } : {}),
    last: opened.at(-1)!.used,
  };
}

/** What `placesIn` reads of the app's state (the daemon's and the Mac's are the same shape). */
export interface PlacesState {
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string; readonly workspaces: ReadonlyArray<{ readonly id: string; readonly name: string }> }>;
}

/** Each conversation's name and project: a workspace's channel `ws:<id>`; others (a bot's chat, Your Mac's) by their channel, outside any project. */
export function placesIn(st: PlacesState): (channel: string) => MeasuredPlace | undefined {
  const byChannel = new Map<string, MeasuredPlace>();
  for (const p of st.projects) for (const w of p.workspaces) byChannel.set(`ws:${w.id}`, { name: w.name, project: p.id, projectName: p.name });
  return (channel) => byChannel.get(channel);
}

/** The executors' share of a split's tokens, 0–100. */
export const executorShare = (s: Pick<LeadSplit, 'lead' | 'executors'>): number => Math.round((s.executors / Math.max(1, s.lead + s.executors)) * 100);

/** "$4.10", "<$0.01": an amount saved (or lost), unsigned. */
export const savedUsd = (n: number): string => (Math.abs(n) < 0.01 ? '<$0.01' : `$${Math.abs(n).toFixed(2)}`);
