import type { Session } from '../core/session.js';
import { type Combo, comboChoices, combosIn, runRouteOf, worldOf } from '../core/routing/model.js';
import { hhmm } from '../shared/clock.js';
import { CONTINUE_PROMPT } from '../shared/run-failure.js';
import { comboStops, routeOf, routeWords } from '../core/routing/model.js';
import { sendAutomatic } from '../core/triage/launch.js';
import { comboReport, strongerOf } from '../core/routing/outcomes.js';
import type { Args, Method } from './api.js';

/** What each `routing.*` method does (see routing-api.ts). */

type RoutingMethod = Extract<Method, `routing.${string}`>;
type RoutingHandlers = { readonly [M in RoutingMethod]: (s: Session, ...args: Args<M>) => unknown };

/** A list to save: ids unique, each combo with a target (the schema checked the rest). */
function checked(combos: readonly Combo[]): Combo[] {
  const seen = new Set<string>();
  for (const c of combos) {
    if (seen.has(c.id)) throw new Error(`Two combos are called ${c.id}: give each its own name`);
    seen.add(c.id);
  }
  return combos.map((c) => ({ ...c, name: c.name.trim() }));
}

export const ROUTING_HANDLERS = {
  'routing.combos': (s) => {
    const st = s.store.getState();
    return { combos: comboChoices(combosIn(st), worldOf(st, Date.now(), hhmm)), custom: st.prefs.combos !== undefined };
  },
  'routing.runRoute': (s, channel, requestId) => runRouteOf(s.store.getState().log, channel, requestId),
  'routing.setCombos': (s, combos) => {
    const list = checked(combos);
    s.setPrefs({ combos: list });
    return list;
  },
  'routing.retry': (s, channel) => {
    const st = s.store.getState();
    const pick = s.workspaces?.agentIn(channel);
    const r = routeOf(st, pick, Date.now(), hhmm);
    if (!r) throw new Error('This conversation isn’t on a combo');
    if (!r.ok) throw new Error(r.why);
    const stop = comboStops(st.log, st.selfId).find((x) => x.channel === channel);
    if (stop && r.ready.agent.runtime !== stop.agent.runtime) s.workspaces?.carryOnCombo(channel, stop.agent.label);
    sendAutomatic(s, () => s.askOwnClaude(CONTINUE_PROMPT, channel, true));
    return routeWords(r.ready.agent) ?? r.ready.agent.label;
  },
  'routing.usage': (s, since) => {
    const st = s.store.getState();
    // With how its tasks went, what it saved against your baseline, and suggestions (Phase 5).
    return comboReport(st.log, st.board.issues, st.selfId, { since: since ?? 0, ...(st.prefs.savingsBaseline ? { baseline: st.prefs.savingsBaseline } : {}), ...strongerOf(st) });
  },
  'routing.resetCombos': (s) => {
    s.setPrefs({ combos: null });
    return combosIn(s.store.getState());
  },
} satisfies RoutingHandlers;
