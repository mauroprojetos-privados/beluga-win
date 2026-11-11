import type { Session } from '../core/session.js';
import { type Combo, comboChoices, combosIn, runRouteOf, worldOf } from '../core/routing/model.js';
import { hhmm } from '../shared/clock.js';
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
  'routing.resetCombos': (s) => {
    s.setPrefs({ combos: null });
    return combosIn(s.store.getState());
  },
} satisfies RoutingHandlers;
