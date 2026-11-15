import { hhmm } from '../../shared/clock.js';
import { autoContinues } from '../../shared/auto-continue.js';
import { CONTINUE_PROMPT, decodeFailure } from '../../shared/run-failure.js';
import { budgetReached } from '../budget/model.js';
import type { NoticeEvent } from '../notify.js';
import type { Store } from '../store.js';
import { comboStops, limitKeyOf, routeOf, routeWords } from './model.js';

export interface ComboFailoverDeps {
  readonly store: Store;
  /** Your agent, told to go on in `channel`: its request's id, or undefined when it couldn't be asked. */
  readonly ask: (prompt: string, channel: string) => string | undefined;
  /** The next run is on another runtime: it gets the recent conversation (a quiet switch's carry), said as from `from`. */
  readonly carry?: (channel: string, from: string) => void;
  /** Tell you (the combo is used up). */
  readonly notify?: (e: NoticeEvent) => void;
  /** A chat not to send on (a child thread a stop reached). */
  readonly skip?: (channel: string) => boolean;
  readonly now?: () => number;
  readonly warn?: (text: string) => void;
}

/**
 * Phase 2 of routing (docs/routing.md): a run on a combo that stops on its usage limit is handed to
 * the combo's next target that can run (the limited one is skipped now: its card is the record), told
 * to continue, with the recent conversation when it's another runtime. Nothing left in the combo: you
 * hear so once, and the conversation waits in Needs You (needs-you.ts) until a target can run again
 * (auto-continue.ts sends it on at the reset, as for any limit). Each stopped run is handed on once.
 * Off with Settings' "Continue after the limit".
 *
 * A run a token budget stopped to go on cheaper (near: downgrade, docs/budget.md) is handed on the
 * same way: told to continue, and its next run passes the budget's gate on the combo's next target
 * (or a cheaper Claude model). That one goes whether Continue after the limit is on or not: it's
 * what the budget is set to do.
 */
export class ComboFailover {
  private readonly seen = new Set<string>();
  private readonly off: () => void;

  constructor(private readonly deps: ComboFailoverDeps) {
    // The ones there at start were stopped before: their reset is auto-continue's.
    const st = deps.store.getState();
    for (const s of comboStops(st.log, st.selfId)) this.seen.add(s.requestId);
    for (const s of budgetDowngrades(st.log, st.selfId)) this.seen.add(s.requestId);
    this.off = deps.store.onAction((a) => {
      if (a.type === 'agent_event' && a.event === 'error') setTimeout(() => this.tick(), 0).unref?.();
    });
  }

  stop(): void {
    this.off();
  }

  tick(): void {
    try {
      this.handOn();
    } catch (err) {
      this.deps.warn?.(`Moving a combo on after a usage limit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private handOn(): void {
    const st = this.deps.store.getState();
    const now = this.deps.now?.() ?? Date.now();
    for (const stop of budgetDowngrades(st.log, st.selfId)) {
      if (this.seen.has(stop.requestId)) continue;
      this.seen.add(stop.requestId);
      if (this.deps.skip?.(stop.channel)) continue;
      if (this.deps.ask(CONTINUE_PROMPT, stop.channel) === undefined) continue;
      this.deps.store.dispatch({ type: 'system', channel: stop.channel, text: 'Past its token budget: it goes on cheaper.', level: 'info' });
    }
    for (const stop of comboStops(st.log, st.selfId)) {
      if (this.seen.has(stop.requestId)) continue;
      this.seen.add(stop.requestId);
      if (!st.prefs.autoContinue || this.deps.skip?.(stop.channel) || budgetReached(st, stop.channel, now)) continue;
      const pick = st.projects.flatMap((p) => p.workspaces).find((w) => `ws:${w.id}` === stop.channel)?.agent;
      if (!pick?.combo || pick.combo !== stop.agent.combo) continue;
      const r = routeOf(st, pick, now, hhmm);
      if (!r) continue;
      const name = r.combo.name;
      if (!r.ok) {
        this.deps.notify?.({ kind: 'needsYou', tag: 'question', title: `Nothing in ${name} can run now`, body: `${stop.agent.label} is at its usage limit, and so is the rest of ${name}`, channel: stop.channel, need: `combo:${stop.channel}`, key: `combo:${stop.requestId}` });
        continue;
      }
      if (limitKeyOf(r.ready.agent) === limitKeyOf(stop.agent)) continue;
      if (r.ready.agent.runtime !== stop.agent.runtime) this.deps.carry?.(stop.channel, stop.agent.label);
      if (this.deps.ask(CONTINUE_PROMPT, stop.channel) === undefined) continue;
      this.deps.store.dispatch({ type: 'system', channel: stop.channel, text: `${stop.agent.label} is at its usage limit: ${routeWords(r.ready.agent) ?? r.ready.agent.label} goes on (${name}).`, level: 'info' });
    }
  }
}

/** Your conversations whose newest run a token budget stopped to go on cheaper (shared/run-failure.ts: kind budget, near downgrade). */
export function budgetDowngrades(log: ReadonlyArray<{ readonly type: string; readonly channel?: string; readonly owner?: string; readonly status?: string; readonly text?: string; readonly requestId?: string }>, selfId: string): Array<{ readonly channel: string; readonly requestId: string }> {
  const last = new Map<string, (typeof log)[number]>();
  for (const item of log) if (item.type === 'agent' && item.channel && item.owner === selfId && autoContinues(item.channel)) last.set(item.channel, item);
  const out: Array<{ channel: string; requestId: string }> = [];
  for (const [channel, card] of last) {
    if (card.status !== 'error' || !card.requestId) continue;
    const f = decodeFailure(card.text);
    if (f?.kind === 'budget' && f.budget?.near === 'downgrade') out.push({ channel, requestId: card.requestId });
  }
  return out;
}
