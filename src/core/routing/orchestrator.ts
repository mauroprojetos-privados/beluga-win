import { z } from 'zod';
import type { AgentRef } from '../../protocol.js';
import { modelName } from '../../shared/agent-label.js';
import { COMBO_ID, type CategoryCombos, type Combo, type RouteWorld, type WorkCategory, WORK_CATEGORIES, combosIn, resolveCombo, type RoutingState } from './model.js';

/**
 * Orchestrator mode (roadmap/modo-orquestrador.md, docs/routing.md "Orchestrator mode"): a strong
 * model (the lead) thinks, decides and edits; cheap executors (Haiku, by default) do the searching,
 * reading and test runs inside the same conversation, as the SDK's sub-agents, and hand back a summary.
 *
 * The same `orchestrator` block can sit in four places, the most specific winning field by field:
 * Settings, then the project's beluga.json, then the bot's bot.json, then the conversation
 * (`/orquestrador on|off`, which only turns it on or off). Executors merge by name: a more specific
 * place's `explore` replaces the less specific one's whole.
 *
 * Pure and browser-safe (zod and routing's model only): the daemon resolves with it, and Settings on
 * the Mac shows the same answer.
 */

/** What an executor may do: read (Glob, Grep, Read, Beluga's read tools), run (also Bash: typecheck and tests), edit (also Edit and Write; only when you choose it). */
export const EXECUTOR_CAN = ['read', 'run', 'edit'] as const;
export type ExecutorCan = (typeof EXECUTOR_CAN)[number];

/** Who decides when to hand work over: the lead (suggest), or broad searches and tests never on the lead (always). */
export const DELEGATE_MODES = ['suggest', 'always'] as const;
export type DelegateMode = (typeof DELEGATE_MODES)[number];

/** An executor's name: what the lead calls it by (the SDK agent's name). */
export const EXECUTOR_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_EXECUTORS = 8;

export const ExecutorBlock = z.object({
  /** The combo it runs on; unset: the `categoryCombos` entry of the same name, else Claude · Haiku. */
  combo: z.string().regex(COMBO_ID).optional(),
  can: z.enum(EXECUTOR_CAN).optional(),
  /** When the lead should use it, in a line (unset: the role's own). */
  description: z.string().trim().min(1).max(300).optional(),
});
export type ExecutorBlock = z.infer<typeof ExecutorBlock>;

/** The budget (phase 4): parsed here so the block reads the same in every place; enforced elsewhere. */
export const OrchestratorBudget = z.object({
  conversation: z.number().int().min(0).optional(),
  day: z.number().int().min(0).optional(),
  near: z.enum(['downgrade', 'ask', 'stop']).optional(),
});

/** The `orchestrator` block, the same in settings.json, beluga.json and bot.json. Every field optional: unset defers to a less specific place. */
export const OrchestratorBlock = z.object({
  on: z.boolean().optional(),
  /** The combo that thinks (unset: the conversation's own agent). */
  lead: z.string().regex(COMBO_ID).optional(),
  /** By name; null drops one a less specific place set. */
  executors: z.record(z.string().regex(EXECUTOR_NAME), ExecutorBlock.nullable()).optional(),
  delegate: z.enum(DELEGATE_MODES).optional(),
  /** Compact at this many tokens (phase 1). */
  compactAt: z.number().int().min(10_000).max(2_000_000).optional(),
  budget: OrchestratorBudget.optional(),
});
export type OrchestratorBlock = z.infer<typeof OrchestratorBlock>;

/** As read from a file you may have edited by hand: a block that doesn't fit reads as unset. */
export const SavedOrchestrator = OrchestratorBlock.optional().catch(undefined);

/** The executors you get when no place names any: explore and docs read, test reads and runs. */
export const DEFAULT_EXECUTORS: Readonly<Record<string, ExecutorBlock>> = {
  explore: { can: 'read' },
  test: { can: 'run' },
  docs: { can: 'read' },
};

/** What an executor without a combo, and without a category of its name, runs on. */
export const FALLBACK_EXECUTOR = { runtime: 'claude', model: 'haiku' } as const;

/** Where the block came from, least specific first. */
export const ORCHESTRATOR_SOURCES = ['settings', 'project', 'bot', 'conversation'] as const;
export type OrchestratorSource = (typeof ORCHESTRATOR_SOURCES)[number];

export type OrchestratorLayers = Partial<Record<OrchestratorSource, OrchestratorBlock | undefined>>;

/** The block that applies: each field from the most specific place that sets it; executors merged by name. */
export function mergeOrchestrator(layers: OrchestratorLayers): OrchestratorBlock & { readonly from?: OrchestratorSource } {
  const out: { -readonly [K in keyof OrchestratorBlock]: OrchestratorBlock[K] } & { from?: OrchestratorSource } = {};
  let executors: Record<string, ExecutorBlock | null> | undefined;
  for (const source of ORCHESTRATOR_SOURCES) {
    const b = layers[source];
    if (!b) continue;
    if (b.on !== undefined) {
      out.on = b.on;
      out.from = source;
    }
    if (b.lead !== undefined) out.lead = b.lead;
    if (b.delegate !== undefined) out.delegate = b.delegate;
    if (b.compactAt !== undefined) out.compactAt = b.compactAt;
    if (b.budget !== undefined) out.budget = { ...out.budget, ...b.budget };
    if (b.executors) executors = { ...executors, ...b.executors };
  }
  if (executors) out.executors = executors;
  return out;
}

/** One executor, resolved: the runtime and model its combo would run now, or why it can't. */
export interface ResolvedExecutor {
  readonly name: string;
  readonly can: ExecutorCan;
  readonly description?: string;
  /** The combo it went through (unset: the Claude · Haiku fallback). */
  readonly combo?: string;
  readonly runtime: string;
  readonly model?: string;
  /** "Claude · Haiku", "Ollama · qwen3". */
  readonly label: string;
  /** Nothing in its combo can run now: why (it's left out of the run). */
  readonly why?: string;
}

export interface ResolvedOrchestrator {
  readonly on: boolean;
  /** Which place turned it on or off (unset: nobody did; it's off). */
  readonly from?: OrchestratorSource;
  /** The lead's target now, when a lead combo is set and can run. */
  readonly lead?: { readonly combo: string; readonly agent: AgentRef; readonly model?: string; readonly label: string; readonly why?: string };
  readonly executors: readonly ResolvedExecutor[];
  readonly delegate: DelegateMode;
  readonly compactAt?: number;
  readonly budget?: z.infer<typeof OrchestratorBudget>;
}

/** What resolving reads of the app's state. */
export type OrchestratorState = Pick<RoutingState, 'runtimes' | 'prefs'> & { readonly prefs: { readonly categoryCombos?: CategoryCombos; readonly orchestrator?: OrchestratorBlock } };

const isCategory = (name: string): name is WorkCategory => (WORK_CATEGORIES as readonly string[]).includes(name);

/** "Claude · Haiku": a resolved target in words. */
export const labelOf = (agent: AgentRef, model?: string): string => (model && agent.runtime !== 'local' ? `${agent.label} · ${modelName(model)}` : agent.label);

/**
 * The orchestrator for a run: the places merged (Settings' block read from `st.prefs.orchestrator`
 * unless `layers.settings` is given), and each executor on the first target of its combo that can
 * run now, as a combo run would be (routePlace). Off: no executors.
 */
export function resolveOrchestrator(st: OrchestratorState, world: RouteWorld, layers: Omit<OrchestratorLayers, 'settings'> & { readonly settings?: OrchestratorBlock } = {}): ResolvedOrchestrator {
  const merged = mergeOrchestrator({ settings: st.prefs.orchestrator, ...layers });
  const delegate = merged.delegate ?? 'suggest';
  const base = { delegate, ...(merged.compactAt ? { compactAt: merged.compactAt } : {}), ...(merged.budget ? { budget: merged.budget } : {}), ...(merged.from ? { from: merged.from } : {}) };
  if (!merged.on) return { on: false, executors: [], ...base };
  const combos = combosIn(st);
  const find = (id: string | undefined): Combo | undefined => (id ? combos.find((c) => c.id === id) : undefined);
  const named = merged.executors ?? DEFAULT_EXECUTORS;
  const executors: ResolvedExecutor[] = [];
  for (const [name, block] of Object.entries(named).slice(0, MAX_EXECUTORS)) {
    if (!block) continue;
    const can = block.can ?? 'read';
    const comboId = block.combo ?? (isCategory(name) ? st.prefs.categoryCombos?.[name]?.combo : undefined);
    const combo = find(comboId);
    const own = { name, can, ...(block.description ? { description: block.description } : {}) };
    if (!combo) {
      // A combo since deleted reads as unset: the fallback, never a silent Opus.
      executors.push({ ...own, runtime: FALLBACK_EXECUTOR.runtime, model: FALLBACK_EXECUTOR.model, label: `Claude · ${modelName(FALLBACK_EXECUTOR.model)}` });
      continue;
    }
    const r = resolveCombo(combo, world);
    if (!r.ok) {
      executors.push({ ...own, combo: combo.id, runtime: combo.targets[0]?.runtime ?? 'claude', label: combo.name, why: r.why });
      continue;
    }
    executors.push({ ...own, combo: combo.id, runtime: r.ready.agent.runtime, ...(r.ready.model ? { model: r.ready.model } : {}), label: labelOf(r.ready.agent, r.ready.model) });
  }
  const leadCombo = find(merged.lead);
  let lead: ResolvedOrchestrator['lead'];
  if (leadCombo) {
    const r = resolveCombo(leadCombo, world);
    lead = r.ok
      ? { combo: leadCombo.id, agent: r.ready.agent, ...(r.ready.model ? { model: r.ready.model } : {}), label: labelOf(r.ready.agent, r.ready.model) }
      : { combo: leadCombo.id, agent: { runtime: leadCombo.targets[0]?.runtime ?? 'claude', label: leadCombo.name }, label: leadCombo.name, why: r.why };
  }
  return { on: true, executors, ...(lead ? { lead } : {}), ...base };
}

/** The executors a Claude run hands to the SDK: Claude ones that can run now. */
export const claudeExecutors = (o: Pick<ResolvedOrchestrator, 'executors'>): ResolvedExecutor[] => o.executors.filter((e) => e.runtime === 'claude' && !e.why);

/**
 * The executors on another runtime (phase 3): their combo's target now is Codex, a local endpoint,
 * OpenCode… The lead hands them a task through the delegate tool (core/routing/delegate.ts), which
 * goes through the combo again at the time. One whose combo can't run now is left out, as in phase 2.
 */
export const delegateExecutors = (o: Pick<ResolvedOrchestrator, 'executors'>): Array<ResolvedExecutor & { readonly combo: string }> => o.executors.filter((e): e is ResolvedExecutor & { readonly combo: string } => e.runtime !== 'claude' && !e.why && e.combo !== undefined);

/** "Opus pensa · 3 executores": the conversation header's words (English; screens translate). */
export function orchestratorWords(o: ResolvedOrchestrator): string | undefined {
  if (!o.on) return undefined;
  const n = o.executors.filter((e) => !e.why).length;
  const who = o.lead && !o.lead.why ? o.lead.label : 'Your agent';
  return `${who} leads · ${n} executor${n === 1 ? '' : 's'}`;
}

/**
 * Your runs' tokens split between the lead and its executors (orchestrator mode), from `since` on:
 * each run's card keeps the executors' part (core/store.ts RunUsage). Runs without executors count
 * as the lead's.
 */
export function orchestratorUsage(log: ReadonlyArray<{ readonly type: string; readonly owner?: string; readonly ts: number; readonly usage?: { readonly tokens: number; readonly executorTokens?: number } }>, selfId: string, since = 0): { readonly lead: number; readonly executors: number } {
  let lead = 0;
  let executors = 0;
  for (const item of log) {
    if (item.type !== 'agent' || item.owner !== selfId || item.ts < since || !item.usage) continue;
    const ex = Math.min(item.usage.executorTokens ?? 0, item.usage.tokens);
    executors += ex;
    lead += item.usage.tokens - ex;
  }
  return { lead, executors };
}

/** "explore · Haiku": a sub-agent's name and the model it runs on, for the sub-agent rows. */
export const executorLabel = (name: string, model?: string): string => (model ? `${name} · ${modelName(model)}` : name);
