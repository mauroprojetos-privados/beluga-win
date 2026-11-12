import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findViking } from '../bots/knowledge.js';
import { belugaHome } from '../home.js';
import { claudeByKind } from '../routing/presets.js';
import type { Session } from '../session.js';
import type { Store } from '../store.js';
import { StackMonitor } from './monitor.js';
import { realStackDeps } from './probe.js';

/** Which stack monitor serves a session (the daemon's), so the API and the projects reach it. */
const all = new WeakMap<object, StackMonitor>();
export const stackOf = (session: object): StackMonitor | undefined => all.get(session);

/** What the stack did once on this computer (~/.beluga/stack.json). */
interface StackRecord {
  /** "Claude by kind of work" was set for you, the first time you had none of your own. */
  readonly claudeByKind?: number;
}

function readRecord(file: string): StackRecord {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StackRecord;
  } catch {
    return {};
  }
}

/**
 * Your routing by kind of work, set once (docs/stack.md): only if you never chose combos for kinds
 * of work nor for a plan's roles, and never again after (clearing them later is your choice).
 */
export function claudeByKindOnce(session: Pick<Session, 'setPrefs'>, store: Store, file = path.join(belugaHome(), 'stack.json')): boolean {
  const record = readRecord(file);
  if (record.claudeByKind) return false;
  const { prefs } = store.getState();
  if (prefs.categoryCombos === undefined && prefs.roleCombos === undefined) session.setPrefs(claudeByKind(prefs.combos));
  try {
    writeFileSync(file, `${JSON.stringify({ ...record, claudeByKind: Date.now() }, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Not written: asked again next start, still only while you have none.
  }
  return true;
}

/**
 * Keep your stack looked at for the daemon (docs/stack.md), set new projects up for it, and let
 * GitNexus forget each worktree that goes. Not in the demo: it would start programs on a pretend Mac.
 */
export function launchStack(host: { readonly session: Session; readonly store: Store }): () => void {
  const { session, store } = host;
  const stack = realStackDeps();
  const monitor = new StackMonitor({
    store,
    stack,
    bootstrap: { ...stack, viking: () => findViking() },
    notify: (e) => session.notifier.notify(e),
    toast: (text, level) => session.toast(text, level),
  });
  all.set(session, monitor);
  claudeByKindOnce(session, store);
  const offAdded = session.workspaces?.onProjectAdded((root) => monitor.projectAdded(root));
  // Only a worktree's index: the project's own (its main checkout) stays.
  const offGoing = session.workspaces?.onWorktreeGoing((ws) => ws.kind === 'worktree' && monitor.worktreeGone(ws.path));
  monitor.start();
  return () => {
    offAdded?.();
    offGoing?.();
    all.delete(session);
    monitor.stop();
  };
}
