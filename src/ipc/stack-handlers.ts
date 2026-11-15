import type { Session } from '../core/session.js';
import { stackOf } from '../core/stack/launch.js';
import { t } from '../shared/i18n/index.js';
import type { Args, Method } from './api.js';

/** What each `stack.*` method does (see stack-api.ts). */

type StackMethod = Extract<Method, `stack.${string}`>;
type StackHandlers = { readonly [M in StackMethod]: (s: Session, ...args: Args<M>) => unknown };

export const STACK_HANDLERS = {
  // The demo has no monitor: what the state says (nothing looked at).
  'stack.check': (s) => stackOf(s)?.check() ?? s.store.getState().stack,
  'stack.setupProject': (s, projectId) => {
    const root = s.store.getState().projects.find((p) => p.id === projectId)?.root;
    if (!root) throw new Error(t('stack.toast.noProject'));
    return stackOf(s)?.setUp(root);
  },
  // Started, not waited for (indexes are slow): the state follows as each place is done. Asked, so the whole look.
  'stack.checklist': (s, placeId) => {
    void stackOf(s)?.runChecklist(placeId ? [placeId] : undefined, { manual: true });
    return s.store.getState().stack.checklist ?? { machine: [], places: [], checking: true };
  },
  'stack.fix': (s, itemId, placeId) => {
    const monitor = stackOf(s);
    if (!monitor) return { ok: false, changed: [] };
    return monitor.fix(itemId, placeId);
  },
} satisfies StackHandlers;
