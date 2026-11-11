import { z } from 'zod';
import type { AgentRef } from '../../protocol.js';
import type { RuntimeChoice, RuntimeModel } from '../../shared/agent-runtimes.js';
import { modelName } from '../../shared/agent-label.js';
import { limitResumeAt } from '../../shared/auto-continue.js';
import { LOCAL_RUNTIME, OLLAMA_ID, parseLocalModel } from '../../shared/local-endpoints.js';
import { decodeFailure } from '../../shared/run-failure.js';

/**
 * Combos (docs/routing.md): named, ordered fallback chains of agent and model targets that a
 * conversation picks instead of one model. A run on a combo goes to its first target that can run
 * now: its runtime is set up and signed in, its endpoint answers, it isn't at a usage limit, and the
 * combo's privacy allows it. Per-request retries and key rotation stay with a gateway you plug in as
 * an endpoint (Settings › Local models); subscriptions (Claude Code, Codex) always run on their own
 * runtime, never behind a proxy.
 *
 * Pure and browser-safe (zod and shared/ only): the daemon resolves with it, and the Mac and the
 * phone show the same answer from the same state.
 */

/** The effort levels (settings-schema.ts EFFORTS, repeated: that file imports this one). */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORT_LEVELS)[number];

/** Who may see a combo's work: anyone its targets send it to; only the agents' own vendors (and endpoints on this Mac); or this Mac alone. */
export const COMBO_PRIVACY = ['any', 'no-third-party', 'local-only'] as const;
export type ComboPrivacy = (typeof COMBO_PRIVACY)[number];

/** How many combos, and targets in one, Settings keeps. */
export const MAX_COMBOS = 20;
export const MAX_TARGETS = 8;

/** A combo's id: short, safe in a value (`combo:<id>`). */
export const COMBO_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * One step of a combo: a runtime ("claude", "codex", "local"…), the model it runs (unset: the
 * runtime's own default; on a local endpoint, its first model), the effort, and for `local` the
 * endpoint by id ("ollama"; unset: any endpoint you added, Ollama last).
 */
export const RouteTarget = z.object({
  runtime: z.string().regex(/^[a-z][\w-]{0,31}$/),
  model: z.string().min(1).max(64).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  endpoint: z.string().regex(/^[a-z0-9][a-z0-9-]{0,19}$/).optional(),
});
export type RouteTarget = z.infer<typeof RouteTarget>;

export const Combo = z.object({
  id: z.string().regex(COMBO_ID),
  name: z.string().trim().min(1).max(40),
  targets: z.array(RouteTarget).min(1).max(MAX_TARGETS),
  privacy: z.enum(COMBO_PRIVACY).optional(),
});
export type Combo = z.infer<typeof Combo>;

/**
 * Combos as saved in settings.json: a malformed one (an older or newer Beluga's, a hand edit) is
 * dropped alone, a duplicate id keeps its first, and an unreadable list reads as unset (the defaults).
 */
export const SavedCombos = z
  .array(z.unknown())
  .max(MAX_COMBOS * 2)
  .transform((list) => {
    const seen = new Set<string>();
    return list.flatMap((raw) => {
      const c = Combo.safeParse(raw);
      if (!c.success || seen.has(c.data.id)) return [];
      seen.add(c.data.id);
      return [c.data];
    }).slice(0, MAX_COMBOS);
  })
  .optional()
  .catch(undefined);

/**
 * How hard a task is (Phase 3, docs/routing.md): the task drafter says, and Settings › Agent ›
 * Combos says which combo a task of each starts on when it names no agent of its own.
 */
export const DIFFICULTIES = ['simple', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Which combo a task of each difficulty starts on (unset: your agent, as before). */
export const DifficultyCombos = z.object({ simple: z.string().regex(COMBO_ID).optional(), normal: z.string().regex(COMBO_ID).optional(), hard: z.string().regex(COMBO_ID).optional() });
export type DifficultyCombos = z.infer<typeof DifficultyCombos>;

/** The combo a task starts on by how hard it is, as the agent its worktree picks; undefined: none set (your agent). */
export function comboForDifficulty(st: Pick<RoutingState, 'runtimes' | 'prefs'> & { readonly prefs: { readonly difficultyCombos?: DifficultyCombos } }, difficulty: Difficulty | undefined): AgentRef | undefined {
  const id = difficulty ? st.prefs.difficultyCombos?.[difficulty] : undefined;
  const combo = id ? combosIn(st).find((c) => c.id === id) : undefined;
  return combo ? comboAgent(combo) : undefined;
}

/**
 * Roles (Phase 4, docs/routing.md): the plan's head (its own conversation), the agent working a
 * milestone or a plan's task, the checker (a milestone's check, a draft's review: pick a combo of
 * another vendor for a cross-vendor check), and the pull-request reviewer. Each may run on a combo of
 * its own; unset, as before (the plan's agent, else yours).
 */
export const ROLES = ['planHead', 'milestone', 'checker', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];
export const RoleCombos = z.object({ planHead: z.string().regex(COMBO_ID).optional(), milestone: z.string().regex(COMBO_ID).optional(), checker: z.string().regex(COMBO_ID).optional(), reviewer: z.string().regex(COMBO_ID).optional() });
export type RoleCombos = z.infer<typeof RoleCombos>;

/** The combo a role runs on, as an agent; undefined: none set (the role's agent as before). */
export function comboForRole(st: Pick<RoutingState, 'runtimes' | 'prefs'> & { readonly prefs: { readonly roleCombos?: RoleCombos } }, role: Role): AgentRef | undefined {
  const id = st.prefs.roleCombos?.[role];
  const combo = id ? combosIn(st).find((c) => c.id === id) : undefined;
  return combo ? comboAgent(combo) : undefined;
}

/** The value a picker uses for a combo (agent-choice.ts's `runtime:model` for the rest). */
export const COMBO_PREFIX = 'combo:';
export const comboValue = (id: string): string => `${COMBO_PREFIX}${id}`;
export const comboOfValue = (value: string): string | undefined => (value.startsWith(COMBO_PREFIX) ? value.slice(COMBO_PREFIX.length) || undefined : undefined);

/**
 * The defaults, before you change any (Settings › Agents › Combos): cheap first, strong first, and
 * this Mac first. `{ runtime: 'local' }` is an endpoint you added (a gateway, LiteLLM…), Ollama its own.
 */
export const DEFAULT_COMBOS: readonly Combo[] = [
  { id: 'economy', name: 'Economy', targets: [{ runtime: 'claude', model: 'sonnet' }, { runtime: 'codex' }, { runtime: LOCAL_RUNTIME }, { runtime: LOCAL_RUNTIME, endpoint: OLLAMA_ID }] },
  { id: 'strong', name: 'Strong', targets: [{ runtime: 'claude', model: 'opus' }, { runtime: 'codex', effort: 'high' }, { runtime: 'claude', model: 'sonnet' }] },
  { id: 'local-first', name: 'Local first', targets: [{ runtime: LOCAL_RUNTIME, endpoint: OLLAMA_ID }, { runtime: LOCAL_RUNTIME }, { runtime: 'claude', model: 'haiku' }] },
];

/** A local model row's endpoint ("ollama" of "ollama/qwen3"). */
const endpointOf = (m: Pick<RuntimeModel, 'value'>): string | undefined => parseLocalModel(m.value)?.id;

/** The local model rows a target can take, in the order it tries them: its endpoint's, or (none named) yours first, Ollama last. */
function localRows(t: RouteTarget, runtimes: readonly RuntimeChoice[]): RuntimeModel[] {
  const rows = (runtimes.find((r) => r.id === LOCAL_RUNTIME)?.models ?? []).filter((m) => endpointOf(m));
  if (t.endpoint) {
    const own = rows.filter((m) => endpointOf(m) === t.endpoint);
    if (!t.model) return own;
    const exact = own.filter((m) => parseLocalModel(m.value)?.model === t.model);
    return exact.length ? exact : own.slice(0, 1).map((m) => ({ ...m, value: `${t.endpoint}/${t.model}` }));
  }
  const ordered = [...rows.filter((m) => endpointOf(m) !== OLLAMA_ID), ...rows.filter((m) => endpointOf(m) === OLLAMA_ID)];
  return t.model ? ordered.filter((m) => parseLocalModel(m.value)?.model === t.model) : ordered;
}

/** Whether this Mac could run the target at all (set up, maybe signed out): what the defaults keep. */
export function runsHere(t: RouteTarget, runtimes: readonly RuntimeChoice[]): boolean {
  if (t.runtime === LOCAL_RUNTIME) {
    const rows = localRows(t, runtimes);
    return t.endpoint ? rows.length > 0 : rows.some((m) => endpointOf(m) !== OLLAMA_ID);
  }
  const r = runtimes.find((x) => x.id === t.runtime);
  return Boolean(r && (r.available || r.state === 'signed_out'));
}

/** The defaults as this Mac has them: every target it can't run left out, a combo left with none dropped. */
export function defaultCombos(runtimes: readonly RuntimeChoice[]): Combo[] {
  return DEFAULT_COMBOS.flatMap((c) => {
    const targets = c.targets.filter((t) => runsHere(t, runtimes));
    return targets.length ? [{ ...c, targets }] : [];
  });
}

/** Your combos: the ones you saved, else the defaults as this Mac has them. */
export const combosOf = (saved: readonly Combo[] | undefined, runtimes: readonly RuntimeChoice[]): readonly Combo[] => saved ?? defaultCombos(runtimes);

/** What a target is called: "Claude · Sonnet", "Codex · High", "Ollama", "Your endpoint". */
export function targetLabel(t: RouteTarget, runtimes: readonly RuntimeChoice[] = []): string {
  const runtime = runtimes.find((r) => r.id === t.runtime)?.label ?? RUNTIME_LABELS[t.runtime] ?? t.runtime;
  if (t.runtime === LOCAL_RUNTIME) {
    const row = t.endpoint ? localRows({ runtime: t.runtime, endpoint: t.endpoint }, runtimes)[0] : undefined;
    const where = t.endpoint ? (row ? endpointName(row) : t.endpoint === OLLAMA_ID ? 'Ollama' : t.endpoint) : 'Your endpoint';
    return t.model ? `${where} · ${t.model}` : where;
  }
  const parts = [runtime, t.model ? modelName(t.model) : '', t.effort ? EFFORT_WORDS[t.effort] : ''].filter(Boolean);
  return parts.join(' · ');
}

const RUNTIME_LABELS: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', copilot: 'Copilot', local: 'Local model' };
const EFFORT_WORDS: Readonly<Record<Effort, string>> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };

/** A local row's endpoint name: "Ollama" of "Ollama · qwen3". */
const endpointName = (m: Pick<RuntimeModel, 'label'>): string => m.label.split(' · ')[0] ?? m.label;

/** A combo as one line: "Claude · Sonnet → Codex → Ollama". */
export const comboSummary = (c: Pick<Combo, 'targets'>, runtimes: readonly RuntimeChoice[] = []): string => c.targets.map((t) => targetLabel(t, runtimes)).join(' → ');

// ---------------------------------------------------------------------------
// Usage limits: a target that stopped on its limit waits until it resets
// ---------------------------------------------------------------------------

/**
 * What a usage limit counts against: a runtime's plan (Claude's, Codex's: every model of it), or a
 * local endpoint ("local:work-proxy"), each endpoint its own.
 */
export function limitKey(runtime: string, model?: string): string {
  if (runtime !== LOCAL_RUNTIME) return runtime;
  const id = parseLocalModel(model)?.id;
  return id ? `${LOCAL_RUNTIME}:${id}` : LOCAL_RUNTIME;
}

/** The part of a log item limits are read from (core/store.ts's agent card). */
export interface LimitCard {
  /** What the run spent (core/store.ts RunUsage). */
  readonly usage?: { readonly tokens: number; readonly cost: number };
  readonly type: string;
  readonly owner?: string;
  readonly status?: string;
  readonly text?: string;
  readonly agent?: Pick<AgentRef, 'runtime' | 'model'>;
  readonly ts: number;
  readonly endTs?: number;
  readonly lastAt?: number;
}

/**
 * Which targets are at their usage limit now, and until when: each of your runs that stopped on one
 * (its card is the record: the agent it ran on, the reset the limit named, else
 * shared/auto-continue.ts's guess), until a later run on the same plan finished, or the reset passed.
 */
export function limitsOf(log: readonly LimitCard[], selfId: string, now: number): ReadonlyMap<string, number> {
  const until = new Map<string, number>();
  for (const item of log) {
    if (item.type !== 'agent' || item.owner !== selfId) continue;
    const key = limitKey(item.agent?.runtime ?? 'claude', item.agent?.model);
    if (item.status === 'done') {
      const stoppedAt = until.get(key);
      if (stoppedAt !== undefined && item.ts >= stoppedAt) until.delete(key);
      continue;
    }
    if (item.status !== 'error') continue;
    const failure = decodeFailure(item.text);
    if (failure?.kind !== 'usage_limit') continue;
    const at = limitResumeAt(failure, item.endTs ?? item.lastAt ?? item.ts);
    until.set(key, Math.max(at, until.get(key) ?? 0));
  }
  for (const [key, at] of until) if (at <= now) until.delete(key);
  return until;
}

// ---------------------------------------------------------------------------
// Resolution: the first target that can run now
// ---------------------------------------------------------------------------

/** What resolving reads: the runtimes as the pickers have them, and the limits now. */
export interface RouteWorld {
  readonly runtimes: readonly RuntimeChoice[];
  readonly limits: ReadonlyMap<string, number>;
  /** For the words of a limit ("until 14:05"). */
  readonly clock?: (at: number) => string;
}

/** The runtimes whose work goes only to their own vendor (no provider of your choosing behind them). */
const FIRST_PARTY = new Set(['claude', 'codex', 'copilot']);

/** Why a privacy setting keeps a target out, or undefined when it may run. `onThisMac`: a local row's endpoint is on this computer. */
function privacyWhy(privacy: ComboPrivacy | undefined, t: RouteTarget, onThisMac?: boolean): string | undefined {
  if (!privacy || privacy === 'any') return undefined;
  if (t.runtime === LOCAL_RUNTIME) return onThisMac ? undefined : privacy === 'local-only' ? 'Not on this Mac (this combo stays local)' : 'Not on this Mac (this combo keeps work off third parties)';
  if (privacy === 'local-only') return 'Runs off this Mac (this combo stays local)';
  return FIRST_PARTY.has(t.runtime) ? undefined : 'Sends work to a provider of its own (this combo keeps work off third parties)';
}

/** One target, ready to run: the agent it is and the model and effort the run gets. */
export interface ReadyTarget {
  readonly agent: AgentRef;
  readonly model?: string;
  readonly effort?: Effort;
}

/** Whether a target can run now: ready, or why not ("Codex isn't signed in", "At its usage limit until 14:05"). */
export function targetNow(t: RouteTarget, world: RouteWorld, privacy?: ComboPrivacy): { readonly ok: true; readonly ready: ReadyTarget } | { readonly ok: false; readonly why: string } {
  const r = world.runtimes.find((x) => x.id === t.runtime);
  const name = r?.label ?? RUNTIME_LABELS[t.runtime] ?? t.runtime;
  if (t.runtime === LOCAL_RUNTIME) {
    const rows = localRows(t, world.runtimes);
    if (!rows.length) return { ok: false, why: t.endpoint ? `${t.endpoint === OLLAMA_ID ? 'Ollama' : t.endpoint} isn't set up` : 'No endpoint of yours is set up' };
    let why = '';
    for (const row of rows) {
      const kept = privacyWhy(privacy, t, row.onThisMac);
      const until = world.limits.get(limitKey(LOCAL_RUNTIME, row.value));
      const rowWhy = kept ?? row.why ?? (until !== undefined ? limitWords(until, world) : undefined);
      if (rowWhy) {
        why ||= rowWhy;
        continue;
      }
      return { ok: true, ready: { agent: { runtime: LOCAL_RUNTIME, label: endpointName(row), model: row.value }, model: row.value } };
    }
    return { ok: false, why };
  }
  if (!r || !r.available) return { ok: false, why: r?.why ?? r?.fix ?? `${name} isn't set up on this Mac` };
  if (r.state === 'signed_out') return { ok: false, why: r.fix ?? `${name} isn't signed in` };
  if (r.state === 'missing') return { ok: false, why: r.fix ?? `${name} isn't installed` };
  const kept = privacyWhy(privacy, t);
  if (kept) return { ok: false, why: kept };
  const until = world.limits.get(limitKey(t.runtime));
  if (until !== undefined) return { ok: false, why: limitWords(until, world) };
  return { ok: true, ready: { agent: { runtime: t.runtime, label: name, ...(t.model ? { model: t.model } : {}) }, ...(t.model ? { model: t.model } : {}), ...(t.effort ? { effort: t.effort } : {}) } };
}

const limitWords = (until: number, world: RouteWorld): string => (world.clock ? `At its usage limit until ${world.clock(until)}` : 'At its usage limit');

/** A combo's target as resolving saw it. */
export interface TargetCheck {
  readonly target: RouteTarget;
  readonly label: string;
  readonly why?: string;
}

/** Where a run on a combo goes: its first target that can run (`index`), and why each one before it couldn't. */
export type Resolved =
  | { readonly ok: true; readonly combo: Combo; readonly index: number; readonly ready: ReadyTarget; readonly checks: readonly TargetCheck[] }
  | { readonly ok: false; readonly combo: Combo; readonly why: string; readonly checks: readonly TargetCheck[] };

/** The first target of `combo` that can run now, in order. None: why, target by target. */
export function resolveCombo(combo: Combo, world: RouteWorld): Resolved {
  const checks: TargetCheck[] = [];
  for (const [index, target] of combo.targets.entries()) {
    const now = targetNow(target, world, combo.privacy);
    const label = targetLabel(target, world.runtimes);
    if (now.ok) {
      checks.push({ target, label });
      return { ok: true, combo, index, ready: { ...now.ready, agent: { ...now.ready.agent, combo: combo.id, comboName: combo.name } }, checks };
    }
    checks.push({ target, label, why: now.why });
  }
  const why = `Nothing in ${combo.name} can run now: ${checks.map((c) => `${c.label}: ${c.why}`).join('; ')}.`;
  return { ok: false, combo, why: why.length > 600 ? `${why.slice(0, 597)}…` : why, checks };
}

/**
 * The agent a picker sets for a combo: the combo by id, named as it, on its first target's runtime
 * (what an older Beluga, or a path that doesn't resolve, runs it on).
 */
export function comboAgent(combo: Pick<Combo, 'id' | 'name' | 'targets'>): AgentRef {
  const first = combo.targets[0];
  return { runtime: first?.runtime ?? 'claude', label: combo.name.slice(0, 64), combo: combo.id, comboName: combo.name.slice(0, 64) };
}

/** A combo a picker shows: can it run now, on what, or why not. */
export interface ComboChoice {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly privacy: ComboPrivacy;
  /** The target it would run on now ("Codex"), when one can. */
  readonly now?: string;
  /** Nothing in it can run now: why. */
  readonly why?: string;
  readonly targets: readonly TargetCheck[];
}

/** Every combo as the pickers and Settings show it. */
export function comboChoices(combos: readonly Combo[], world: RouteWorld): ComboChoice[] {
  return combos.map((c) => {
    const r = resolveCombo(c, world);
    const all = c.targets.map((target, i) => r.checks[i] ?? { target, label: targetLabel(target, world.runtimes) });
    return { id: c.id, name: c.name, summary: comboSummary(c, world.runtimes), privacy: c.privacy ?? 'any', targets: all, ...(r.ok ? { now: r.checks[r.index]!.label } : { why: r.why }) };
  });
}

/** "Economy · Codex": the combo a run went through and the target it ran on, or undefined when it ran on no combo. */
export function routeWords(agent: Pick<AgentRef, 'label' | 'comboName'> | undefined): string | undefined {
  return agent?.comboName ? `${agent.comboName} · ${agent.label}` : undefined;
}

/** A new combo's id from its name, not one of `taken`. */
export function comboIdFor(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'combo';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

// ---------------------------------------------------------------------------
// From the app's state (the daemon's and the screens' are the same shape)
// ---------------------------------------------------------------------------

/** What routing reads of the app's state. */
export interface RoutingState {
  readonly runtimes: readonly RuntimeChoice[];
  readonly log: readonly LimitCard[];
  readonly selfId: string;
  readonly prefs: { readonly combos?: readonly Combo[] };
}

/** The runtimes and the limits now. */
export const worldOf = (st: Pick<RoutingState, 'runtimes' | 'log' | 'selfId'>, now: number, clock?: (at: number) => string): RouteWorld => ({ runtimes: st.runtimes, limits: limitsOf(st.log, st.selfId, now), ...(clock ? { clock } : {}) });

/** Your combos now: saved, or the defaults as this computer has them. */
export const combosIn = (st: Pick<RoutingState, 'runtimes' | 'prefs'>): readonly Combo[] => combosOf(st.prefs.combos, st.runtimes);

/**
 * Where a run for `agent` goes when it picked a combo: resolved against your combos now. Undefined:
 * it picked no combo (it runs on `agent` itself). A combo since deleted can't run: it says so.
 */
export function routeOf(st: RoutingState, agent: Pick<AgentRef, 'combo' | 'comboName'> | undefined, now: number, clock?: (at: number) => string): Resolved | undefined {
  if (!agent?.combo) return undefined;
  const combo = combosIn(st).find((c) => c.id === agent.combo);
  if (!combo) {
    const name = agent.comboName ?? agent.combo;
    return { ok: false, combo: { id: agent.combo, name, targets: [] }, why: `The combo ${name} isn't in Settings › Agents › Combos any more. Pick another agent for this conversation.`, checks: [] };
  }
  return resolveCombo(combo, worldOf(st, now, clock));
}

/** The combo and target a conversation's newest run on a combo used (by its card), or the one `requestId` names. */
export interface RunRoute {
  readonly requestId: string;
  readonly combo: string;
  readonly name: string;
  readonly runtime: string;
  readonly model?: string;
  readonly target: string;
  /** "Economy · Codex". */
  readonly words: string;
}

export function runRouteOf(log: ReadonlyArray<LimitCard & { readonly channel?: string; readonly requestId?: string; readonly agent?: AgentRef }>, channel: string, requestId?: string): RunRoute | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const item = log[i]!;
    if (item.type !== 'agent' || item.channel !== channel || !item.requestId) continue;
    if (requestId && item.requestId !== requestId) continue;
    const a = item.agent;
    if (!a?.combo) {
      if (requestId) return undefined;
      continue;
    }
    const name = a.comboName ?? a.combo;
    return { requestId: item.requestId, combo: a.combo, name, runtime: a.runtime, ...(a.model ? { model: a.model } : {}), target: a.label, words: `${name} · ${a.label}` };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// A run on a combo that stopped on its limit (Phase 2: the next target goes on)
// ---------------------------------------------------------------------------

/** A worktree conversation whose newest run, on a combo, stopped on its usage limit. */
export interface ComboStop {
  readonly channel: string;
  readonly requestId: string;
  /** When it stopped. */
  readonly at: number;
  /** The target it ran on, with the combo. */
  readonly agent: AgentRef;
}

/** Your conversations whose newest run went through a combo and stopped on its usage limit. */
export function comboStops(log: ReadonlyArray<LimitCard & { readonly channel?: string; readonly requestId?: string; readonly agent?: AgentRef }>, selfId: string): ComboStop[] {
  const last = new Map<string, (typeof log)[number]>();
  for (const item of log) if (item.type === 'agent' && item.channel?.startsWith('ws:')) last.set(item.channel, item);
  const out: ComboStop[] = [];
  for (const [channel, card] of last) {
    if (card.owner !== selfId || card.status !== 'error' || !card.agent?.combo || !card.requestId) continue;
    if (decodeFailure(card.text)?.kind !== 'usage_limit') continue;
    out.push({ channel, requestId: card.requestId, at: card.endTs ?? card.lastAt ?? card.ts, agent: card.agent });
  }
  return out;
}

/** The plan or endpoint a target's limit counts against (limitKey of its agent). */
export const limitKeyOf = (agent: Pick<AgentRef, 'runtime' | 'model'>): string => limitKey(agent.runtime, agent.model);

/** What routing reads to find a combo that's used up: the state and its worktrees' picks. */
export interface ExhaustState extends Omit<RoutingState, 'log'> {
  readonly log: ReadonlyArray<LimitCard & { readonly channel?: string; readonly requestId?: string; readonly agent?: AgentRef }>;
  readonly projects: ReadonlyArray<{ readonly workspaces: ReadonlyArray<{ readonly id: string; readonly agent?: AgentRef }> }>;
}

/** A combo whose every target is out (its run stopped on a limit, and nothing else can run now): why. */
export interface Exhausted {
  readonly stop: ComboStop;
  readonly name: string;
  readonly why: string;
}

/** The conversations that still pick a combo whose run stopped on its limit, with nothing in the combo able to go on now. */
export function exhaustedCombos(st: ExhaustState, now: number, clock?: (at: number) => string): Exhausted[] {
  const picks = new Map<string, AgentRef | undefined>(st.projects.flatMap((p) => p.workspaces.map((w) => [`ws:${w.id}`, w.agent] as const)));
  return comboStops(st.log, st.selfId).flatMap((stop) => {
    const pick = picks.get(stop.channel);
    if (!pick?.combo || pick.combo !== stop.agent.combo) return [];
    const r = routeOf(st, pick, now, clock);
    return r && !r.ok ? [{ stop, name: r.combo.name, why: r.why }] : [];
  });
}

// ---------------------------------------------------------------------------
// Usage by combo and target (Phase 5)
// ---------------------------------------------------------------------------

/** One target's share of a combo's runs. */
export interface TargetUsage {
  readonly target: string;
  readonly runtime: string;
  readonly runs: number;
  /** Runs that stopped on a usage limit. */
  readonly limited: number;
  /** Time its runs took, start to end. */
  readonly ms: number;
  /** Tokens its runs spent (input, output, cache writes), and their cost in USD (0 on your own endpoint or a plan that doesn't say). */
  readonly tokens: number;
  readonly cost: number;
}

/** A combo's runs, split by the target each went to (most runs first). */
export interface ComboUsage {
  readonly combo: string;
  readonly name: string;
  readonly runs: number;
  readonly limited: number;
  readonly ms: number;
  readonly tokens: number;
  readonly cost: number;
  readonly targets: readonly TargetUsage[];
}

const FINAL = new Set(['done', 'error', 'denied']);

/**
 * Your runs that went through a combo, by combo and by target (the run's card is the record: the
 * target it ran on, the combo, when it began and ended, whether it stopped on a limit). From `since` on.
 */
export function comboUsage(log: ReadonlyArray<LimitCard & { readonly agent?: AgentRef }>, selfId: string, since = 0): ComboUsage[] {
  const by = new Map<string, { name: string; targets: Map<string, { target: string; runtime: string; runs: number; limited: number; ms: number; tokens: number; cost: number }> }>();
  for (const item of log) {
    const a = item.agent;
    if (item.type !== 'agent' || item.owner !== selfId || !a?.combo || !item.status || !FINAL.has(item.status) || item.ts < since) continue;
    const combo = by.get(a.combo) ?? { name: a.comboName ?? a.combo, targets: new Map() };
    by.set(a.combo, combo);
    const key = `${a.runtime}|${a.model ?? ''}`;
    const t = combo.targets.get(key) ?? { target: a.model ? `${a.label} · ${modelName(a.model)}` : a.label, runtime: a.runtime, runs: 0, limited: 0, ms: 0, tokens: 0, cost: 0 };
    t.runs += 1;
    if (item.status === 'error' && decodeFailure(item.text)?.kind === 'usage_limit') t.limited += 1;
    t.ms += Math.max(0, (item.endTs ?? item.ts) - item.ts);
    t.tokens += item.usage?.tokens ?? 0;
    t.cost += item.usage?.cost ?? 0;
    combo.targets.set(key, t);
  }
  return [...by].map(([id, c]) => {
    const targets = [...c.targets.values()].sort((x, y) => y.runs - x.runs);
    const sum = (k: 'runs' | 'limited' | 'ms' | 'tokens' | 'cost') => targets.reduce((n, t) => n + t[k], 0);
    return { combo: id, name: c.name, runs: sum('runs'), limited: sum('limited'), ms: sum('ms'), tokens: sum('tokens'), cost: sum('cost'), targets };
  }).sort((x, y) => y.runs - x.runs);
}

/** "1.2M", "340k", "812": tokens, short. */
export const shortTokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

/** "$3.40", "<$0.01"; nothing for 0 (your own endpoint, or a plan that doesn't price it). */
export const shortCost = (usd: number): string => (usd <= 0 ? '' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

/** "12 runs · 1.2M tokens · $3.40: Codex 8 (800k), Claude · Sonnet 4 (400k, 1 at its limit)". */
export function comboUsageWords(u: ComboUsage): string {
  const spent = (tokens: number, cost: number): string[] => [tokens ? `${shortTokens(tokens)} tokens` : '', shortCost(cost)].filter(Boolean);
  const parts = u.targets.map((t) => {
    const more = [t.tokens ? shortTokens(t.tokens) : '', t.limited ? `${t.limited} at its limit` : ''].filter(Boolean);
    return `${t.target} ${t.runs}${more.length ? ` (${more.join(', ')})` : ''}`;
  });
  return `${[`${u.runs} run${u.runs === 1 ? '' : 's'}`, ...spent(u.tokens, u.cost)].join(' · ')}: ${parts.join(', ')}`;
}
