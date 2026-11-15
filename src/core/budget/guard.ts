import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentPlace } from '../../agent/types.js';
import { hhmm } from '../../shared/clock.js';
import { type BudgetLine, budgetName, budgetUse, cheaperModel, PLAN_WARN_PCT } from '../../shared/budget.js';
import { encodeFailure } from '../../shared/run-failure.js';
import type { NoticeEvent } from '../notify.js';
import { type ReadyTarget, combosIn, resolveCombo, worldOf } from '../routing/model.js';
import { type Store, isRunning } from '../store.js';
import { budgetDecision, budgetReached, channelBudget, planWindow } from './model.js';
import { type SpendLedger, readSpend } from './store.js';

/** How long the ledger waits before it's saved (usage comes in bursts). */
const SAVE_MS = 4_000;

export interface BudgetGuardDeps {
  readonly store: Store;
  /** Stop one of your runs, its card saying `note` (agent-host cancelRun). → whether it was running. */
  readonly cancel: (requestId: string, note: string) => boolean;
  /** A conversation's next run moves to another runtime: it carries the recent conversation once (workspace-controller). */
  readonly carry?: (channel: string, from: string) => void;
  /** Tell you (a budget asks, or stopped a run; your plan's window is nearly used up). */
  readonly notify?: (e: NoticeEvent) => void;
  /** Where the ledger is kept (~/.beluga/spend.json); unset: only in memory. */
  readonly file?: string;
  readonly now?: () => number;
  readonly warn?: (text: string) => void;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A run's place on a combo's target (as agent-host's routePlace sets one). */
function onTarget(place: AgentPlace, ready: ReadyTarget, combo: string, index: number): AgentPlace {
  const { model: _m, effort: _e, ...rest } = place;
  return { ...rest, agent: ready.agent, ...(ready.model ? { model: ready.model } : {}), ...((ready.effort ?? place.effort) ? { effort: ready.effort ?? place.effort } : {}), route: { combo, index } };
}

/**
 * Token budgets, kept (docs/budget.md): every run of yours passes `gate` as it starts, and each usage
 * report is checked as it comes. Nearing a budget (80%) is said once in the conversation; reaching
 * one does what it's set to: `downgrade` (the run stops and the failover sends it on, on the
 * combo's next target or a cheaper Claude model: core/routing/failover.ts), `ask` (it stops and
 * Needs You asks, companion/needs-you.ts) or `stop`. Your plan's 5-hour window at 80% is said once
 * per window; at 95%, a run on a combo skips that plan's targets. The ledger of what your runs
 * outside a workspace spent is loaded and saved here.
 */
export class BudgetGuard {
  /** Warnings said: a budget's key and limit (a raised budget warns again). */
  private readonly warned = new Set<string>();
  /** Runs stopped at a budget, or running cheaper already (not stopped again). */
  private readonly acted = new Set<string>();
  private readonly off: () => void;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saved: SpendLedger | undefined;

  constructor(private readonly deps: BudgetGuardDeps) {
    if (deps.file) {
      try {
        const spend = readSpend(JSON.parse(readFileSync(deps.file, 'utf8')));
        deps.store.dispatch({ type: 'spend', spend });
        this.saved = spend;
      } catch {
        // None yet, or unreadable: it starts empty.
      }
    }
    this.off = deps.store.onAction((a) => {
      if (a.type === 'agent_event' && a.event === 'usage' && a.channel && a.owner === deps.store.getState().selfId) {
        const { channel, requestId } = a;
        setTimeout(() => this.checkSafe(channel, requestId), 0).unref?.();
      }
      if (deps.file && deps.store.getState().spend !== this.saved) this.scheduleSave();
    });
  }

  stop(): void {
    this.off();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.save();
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // ------------------------------------------------------------------ as a run starts

  /** A run of yours as it starts in `channel`: on `place`, on a cheaper one, or refused (its card's words). */
  gate(channel: string, place: AgentPlace, requestId: string): { readonly place: AgentPlace } | { readonly refuse: string } {
    const st = this.deps.store.getState();
    const now = this.now();
    const d = budgetDecision(st, channel, now);
    if (d.kind === 'go') return { place };
    if (d.kind === 'shift') {
      const shifted = this.shiftPlace(place, now, d.resetsAt);
      if (!shifted) return { place };
      this.say(channel, `plan:${d.resetsAt ?? 0}:${channel}`, `Your plan’s 5-hour window is nearly used up: ${shifted.agent?.label ?? 'the next target'} runs this instead (${shifted.agent?.comboName ?? 'combo'}).`);
      return { place: this.moved(channel, place, shifted) };
    }
    if (d.kind === 'downgrade') {
      this.acted.add(requestId);
      const cheaper = this.cheaperPlace(place, now);
      if (!cheaper) {
        this.say(channel, `cheapest:${d.line.key}:${d.line.limit}`, `${capital(budgetName(d.line))} is reached (${budgetUse(d.line)}), and there’s nothing cheaper to go on with: it goes on as it is.`);
        return { place };
      }
      this.say(channel, `cheaper:${d.line.key}:${d.line.limit}:${cheaper.model ?? cheaper.agent?.label ?? ''}`, `${capital(budgetName(d.line))} is reached (${budgetUse(d.line)}): it goes on cheaper, on ${this.placeWords(cheaper)}.`);
      return { place: this.moved(channel, place, cheaper) };
    }
    this.told(channel, requestId, d.kind, d.line);
    return { refuse: this.failure(d.kind, d.line) };
  }

  /** Whether nothing should restart `channel` on its own (auto-continue, a combo's failover): a budget there is reached. */
  blocksAuto(channel: string): boolean {
    return budgetReached(this.deps.store.getState(), channel, this.now()) !== undefined;
  }

  // ------------------------------------------------------------------ as usage comes in

  private checkSafe(channel: string, requestId: string): void {
    try {
      this.check(channel, requestId);
    } catch (err) {
      this.deps.warn?.(`Checking a token budget failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** A usage report in `channel` for `requestId`: warn near a budget, act at one. */
  check(channel: string, requestId: string): void {
    const st = this.deps.store.getState();
    const now = this.now();
    for (const line of channelBudget(st, channel, now).lines) {
      if (line.level === 'near') this.say(channel, `near:${line.key}:${line.limit}`, `${capital(budgetName(line))}: ${budgetUse(line)}.`, 'warn');
    }
    this.planWarning(now);
    if (this.acted.has(requestId)) return;
    const card = st.log.find((l) => l.type === 'agent' && l.requestId === requestId && l.owner === st.selfId);
    if (card?.type !== 'agent' || !isRunning(card.status)) return;
    const d = budgetDecision(st, channel, now);
    if (d.kind === 'go' || d.kind === 'shift') return;
    this.acted.add(requestId);
    // Downgrade: this run stops, and the failover sends the conversation on (its next run passes the gate, cheaper).
    if (d.kind === 'downgrade') {
      this.deps.cancel(requestId, this.failure('downgrade', d.line));
      return;
    }
    if (this.deps.cancel(requestId, this.failure(d.kind, d.line))) this.told(channel, requestId, d.kind, d.line);
  }

  /** Your plan's 5-hour window at 80%: said once per window. */
  private planWarning(now: number): void {
    const plan = planWindow(this.deps.store.getState(), now);
    if (!plan || plan.pct < PLAN_WARN_PCT) return;
    const key = `plan:${plan.resetsAt ?? 'now'}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    const when = plan.resetsAt ? ` (resets at ${hhmm(plan.resetsAt)})` : '';
    this.deps.notify?.({ kind: 'problems', title: `Your plan’s 5-hour window is ${plan.pct}% used`, body: `Long conversations and parallel runs use it up fastest${when}. Budgets: Settings › Agent › Budget.`, key: `budget-plan:${plan.resetsAt ?? Math.floor(now / 3_600_000)}` });
  }

  // ------------------------------------------------------------------ helpers

  private failure(near: 'downgrade' | 'ask' | 'stop', line: BudgetLine): string {
    const detail = `${capital(budgetName(line))} is reached: ${budgetUse(line)}. Settings › Agent › Budget changes it.`;
    return encodeFailure({ kind: 'budget', detail, budget: { scope: line.scope, used: line.used, limit: line.limit, near, ...(line.name ? { name: line.name } : {}) } }, this.now());
  }

  /** A run stopped (or didn't start) at a budget: you hear so; `ask` waits in Needs You (`budget:<channel>`). */
  private told(channel: string, requestId: string, near: 'ask' | 'stop', line: BudgetLine): void {
    const title = `${capital(budgetName(line))} is reached`;
    if (near === 'ask') this.deps.notify?.({ kind: 'needsYou', tag: 'question', title, body: `${budgetUse(line)}. Continue, go on cheaper, or stop?`, channel, need: `budget:${channel}`, key: `budget:${requestId}` });
    else this.deps.notify?.({ kind: 'problems', title, body: `${budgetUse(line)}: the agent stopped.`, channel, key: `budget:${requestId}` });
  }

  /** A line in the conversation, once per key. */
  private say(channel: string, key: string, text: string, level: 'info' | 'warn' = 'info'): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.deps.store.dispatch({ type: 'system', channel, text, level });
  }

  private placeWords(place: AgentPlace): string {
    if (place.agent?.comboName) return `${place.agent.comboName} · ${place.agent.label}`;
    const model = place.model ? capital(place.model) : undefined;
    return model ? `${place.agent?.label ?? 'Claude'} · ${model}` : (place.agent?.label ?? 'Claude');
  }

  /**
   * The place a run moves to on another runtime: it can't resume the other's session, so it takes
   * its own (when the conversation has one of that runtime) or starts with the recent conversation.
   */
  private moved(channel: string, from: AgentPlace, to: AgentPlace): AgentPlace {
    const was = from.agent?.runtime ?? 'claude';
    const now = to.agent?.runtime ?? 'claude';
    if (was === now) return to;
    const ws = channel.startsWith('ws:') ? this.deps.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === channel.slice(3)) : undefined;
    const { resume: _r, forkSession: _f, ...rest } = to;
    if (ws?.sessionId && (ws.sessionRuntime ?? 'claude') === now) return { ...rest, resume: ws.sessionId };
    this.deps.carry?.(channel, from.agent?.label ?? 'Claude');
    return rest;
  }

  /** A cheaper place than `place`: the combo's next target that can run, else a cheaper Claude model. */
  cheaperPlace(place: AgentPlace, now: number): AgentPlace | undefined {
    const st = this.deps.store.getState();
    const route = place.route;
    if (route && route.index >= 0) {
      const combo = combosIn(st).find((c) => c.id === route.combo);
      const start = route.index + 1;
      if (combo && start < combo.targets.length) {
        const r = resolveCombo({ ...combo, targets: combo.targets.slice(start) }, worldOf(st, now, hhmm));
        if (r.ok) return onTarget(place, { ...r.ready, agent: { ...r.ready.agent, combo: combo.id, comboName: combo.name } }, combo.id, r.index + start);
      }
    }
    const runtime = place.agent?.runtime ?? 'claude';
    const model = cheaperModel(place.model ?? (runtime === 'claude' ? st.prefs.model : undefined), runtime);
    return model ? { ...place, model } : undefined;
  }

  /** Your plan's window nearly used up: a combo's run on that plan goes to the first target on another one (none: as it is). */
  private shiftPlace(place: AgentPlace, now: number, resetsAt: number | undefined): AgentPlace | undefined {
    const st = this.deps.store.getState();
    const route = place.route;
    if (!route || route.index < 0 || (place.agent?.runtime ?? 'claude') !== 'claude') return undefined;
    const combo = combosIn(st).find((c) => c.id === route.combo);
    if (!combo) return undefined;
    const world = worldOf(st, now, hhmm);
    const limits = new Map(world.limits);
    limits.set('claude', resetsAt ?? now + 5 * 3_600_000);
    const r = resolveCombo(combo, { ...world, limits });
    if (!r.ok || r.index === route.index) return undefined;
    return onTarget(place, r.ready, combo.id, r.index);
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, SAVE_MS);
    this.saveTimer.unref?.();
  }

  private save(): void {
    const file = this.deps.file;
    if (!file) return;
    const spend = this.deps.store.getState().spend;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(spend), { mode: 0o600 });
      renameSync(tmp, file);
      this.saved = spend;
    } catch (err) {
      this.deps.warn?.(`Saving what your runs spent failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
