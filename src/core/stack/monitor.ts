import path from 'node:path';
import { type Key, t } from '../../shared/i18n/index.js';
import type { NoticeEvent } from '../notify.js';
import type { Store } from '../store.js';
import { type StackCheck, type StackCheckId, type StackView, isService, stackKey, stackProblems } from '../stack-store.js';
import { type BootstrapDeps, type BootstrapReport, bootstrapProject } from './bootstrap.js';
import { type StackDeps, lookAll, serviceUp, startService } from './probe.js';

/**
 * Your stack, kept looked at (docs/stack.md): at start, every few minutes, and when asked. A service
 * that's down is started once per outage (Settings › Stack › Repair services automatically), then
 * looked at again for a while; what's still down or missing is one Needs You item and one notice,
 * cleared when it's back. New projects are set up for the stack as they're added
 * (`projectAdded`, Settings › Stack › Set up new projects automatically).
 */

export interface StackMonitorDeps {
  readonly store: Store;
  readonly stack: StackDeps;
  readonly bootstrap: BootstrapDeps;
  readonly notify?: (e: NoticeEvent) => void;
  readonly toast?: (text: string, level: 'info' | 'success' | 'warn' | 'error') => void;
  /** How often it looks again (default 5 minutes). */
  readonly everyMs?: number;
  /** How long a started service gets to answer (default 30 s), looked at every `pollMs` (default 2 s). */
  readonly settleMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const EVERY_MS = 5 * 60_000;

/** "Ollama, gitnexus": checks by their names, in the app's language. */
export const stackNames = (checks: readonly Pick<StackCheck, 'id'>[]): string => checks.map((c) => t(`stack.name.${stackKey(c.id)}` as Key)).join(', ');

export class StackMonitor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private looking: Promise<StackView> | undefined;
  /** Services started during their current outage (tried once until they're up again). */
  private readonly tried = new Set<StackCheckId>();
  /** The problem set last told about (told again only when it changes, or after everything was fine). */
  private told: string | undefined;
  /** Projects being set up right now (by root). */
  private readonly settingUp = new Set<string>();
  private stopped = false;

  constructor(private readonly deps: StackMonitorDeps) {}

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.deps.everyMs ?? EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private view(): StackView {
    return this.deps.store.getState().stack;
  }

  private publish(view: StackView): void {
    if (!this.stopped) this.deps.store.dispatch({ type: 'stack', stack: view });
  }

  /** Look now (one look at a time: a second ask shares the first). */
  check(): Promise<StackView> {
    this.looking ??= this.look().finally(() => {
      this.looking = undefined;
    });
    return this.looking;
  }

  private async look(): Promise<StackView> {
    this.publish({ ...this.view(), checking: true });
    let checks = await lookAll(this.deps.stack);
    for (const c of checks) if (c.state === 'up') this.tried.delete(c.id);
    if (this.deps.store.getState().prefs.stackRepair !== false) checks = await this.repair(checks);
    const view: StackView = { checks, checkedAt: (this.deps.now ?? Date.now)(), checking: false };
    this.publish(view);
    this.tell(view);
    return view;
  }

  /** Start each service that's down (once per outage), and give it a while to answer. */
  private async repair(checks: StackCheck[]): Promise<StackCheck[]> {
    const down = checks.filter((c) => c.kind === 'service' && c.state === 'down' && !this.tried.has(c.id));
    if (!down.length) return checks;
    const started = new Set<StackCheckId>();
    for (const c of down) {
      this.tried.add(c.id);
      if (isService(c.id) && (await startService(c.id, this.deps.stack).catch(() => false))) started.add(c.id);
    }
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const up = new Set<StackCheckId>();
    const until = (this.deps.now ?? Date.now)() + (this.deps.settleMs ?? 30_000);
    while (started.size > up.size && (this.deps.now ?? Date.now)() < until && !this.stopped) {
      await sleep(this.deps.pollMs ?? 2000);
      for (const id of started) if (!up.has(id) && isService(id) && (await serviceUp(id, this.deps.stack))) up.add(id);
    }
    return checks.map((c): StackCheck => (up.has(c.id) ? { ...c, state: 'up', started: true } : started.has(c.id) ? { ...c, started: true } : c));
  }

  /** One notice for a new set of problems; a fixed stack forgets it, so the next outage is told again. */
  private tell(view: StackView): void {
    const problems = stackProblems(view);
    if (!problems.length) {
      this.told = undefined;
      return;
    }
    const key = problems.map((p) => p.id).sort().join(',');
    if (key === this.told) return;
    this.told = key;
    this.deps.notify?.({ kind: 'problems', title: t('stack.notice.title'), body: t('stack.notice.body', { list: stackNames(problems) }), need: 'stack', key: `stack:${key}:${(this.deps.now ?? Date.now)()}` });
  }

  /** A project was added or made: set it up for the stack when that's on (never blocks the add). */
  projectAdded(root: string): void {
    if (this.deps.store.getState().prefs.stackBootstrap === false) return;
    void this.setUp(root);
  }

  /** Set a project up for the stack now (also by hand: Set Up Stack in its ••• menu). */
  async setUp(root: string): Promise<BootstrapReport | undefined> {
    if (this.settingUp.has(root)) return undefined;
    this.settingUp.add(root);
    const name = path.basename(root);
    this.deps.toast?.(t('stack.toast.settingUp', { name }), 'info');
    try {
      const report = await bootstrapProject(root, this.deps.bootstrap);
      this.deps.toast?.(setUpWords(name, report), report.failed.length ? 'warn' : 'success');
      return report;
    } catch (err) {
      this.deps.toast?.(t('stack.toast.failed', { name, why: err instanceof Error ? err.message : String(err) }), 'error');
      return undefined;
    } finally {
      this.settingUp.delete(root);
    }
  }

  /** A worktree is going: GitNexus forgets its index, so its registry doesn't grow with every worktree (best effort). */
  worktreeGone(dir: string): void {
    void this.deps.stack.run('gitnexus', ['remove', dir], { timeoutMs: 60_000 }).catch(() => undefined);
  }
}

/** "erp is set up: GitNexus, graphify. beluga.json and CLAUDE.md are new and not committed." */
export function setUpWords(name: string, r: BootstrapReport): string {
  const ran = r.ran.map((s) => t(`stack.step.${s}`)).join(', ');
  const parts = [ran ? t('stack.toast.done', { name, list: ran }) : t('stack.toast.doneNothing', { name })];
  if (r.wrote.length) parts.push(t('stack.toast.wrote', { files: r.wrote.join(', ') }));
  if (r.failed.length) parts.push(t('stack.toast.someFailed', { list: r.failed.map((f) => `${t(`stack.step.${f.step}`)} (${f.why})`).join('; ') }));
  return parts.join(' ');
}
