import path from 'node:path';
import { type Key, t } from '../../shared/i18n/index.js';
import type { NoticeEvent } from '../notify.js';
import type { Store } from '../store.js';
import { blackbox } from '../blackbox/recorder.js';
import { DEFAULT_COMBOS } from '../routing/model.js';
import {
  type ChecklistItem,
  type ChecklistItemId,
  type ChecklistPlace,
  type StackChecklist,
  type StackCheck,
  type StackCheckId,
  type StackView,
  checklistProblems,
  isService,
  stackKey,
  stackProblems,
} from '../stack-store.js';
import { type BootstrapDeps, type BootstrapReport, bootstrapProject } from './bootstrap.js';
import {
  ASK_FIX,
  AUTO_FIX,
  type ChecklistContext,
  type ChecklistDeps,
  type FixResult,
  type PlaceInput,
  askFix,
  autoFix,
  excludesItem,
  machineChecklist,
  placeChecklist,
  rebuildCommand,
  registryItem,
} from './checklist.js';
import { type StackDeps, findTool, lookAll, serviceUp, startService } from './probe.js';

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
  /** The checklist (docs/stack.md › Checklist): unset, it never runs (the demo). */
  readonly checklist?: {
    readonly deps: ChecklistDeps;
    /** Each project's main checkout and its worktrees, as they are now. */
    readonly places: () => readonly PlaceInput[];
    /** Each bot's folder (its `.claude/agents`). */
    readonly botDirs?: () => readonly string[];
    /** Where it remembers when each project's docs went to OpenViking (unset: only in memory). */
    readonly recordFile?: string;
  };
}

/** An index's rebuild, by place and item. */
const rebuildKey = (dir: string, id: ChecklistItemId): string => `${dir}\0${id}`;
const INDEX_ITEMS: ReadonlySet<ChecklistItemId> = new Set(['gitnexusIndex', 'graphifyIndex', 'tokenGoatMap']);
/** An index may take a while on a big repository (graphify ~4 min, token-goat ~3 min on 440 files). */
const REBUILD_MS = 30 * 60_000;
const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'it failed';

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
  /** Checklist runs, one after another. */
  private listing: Promise<unknown> = Promise.resolve();
  /** Indexes rebuilding now, or whose last rebuild failed (by `rebuildKey`). */
  private readonly rebuilds = new Map<string, { running?: boolean; failed?: string }>();
  private docsSent: Record<string, number> | undefined;
  /** The checklist's problem set last told about. */
  private toldList: string | undefined;

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
    const view: StackView = { ...this.view(), checks, checkedAt: (this.deps.now ?? Date.now)(), checking: false };
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
      if (report.ran.includes('openviking')) this.markDocs(root);
      void this.runChecklist([root]);
      return report;
    } catch (err) {
      this.deps.toast?.(t('stack.toast.failed', { name, why: err instanceof Error ? err.message : String(err) }), 'error');
      return undefined;
    } finally {
      this.settingUp.delete(root);
    }
  }

  // ---- the checklist (docs/stack.md › Checklist) --------------------------------------------------

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** When each project's docs last went to OpenViking (by folder). */
  private docs(): Record<string, number> {
    if (this.docsSent) return this.docsSent;
    const cl = this.deps.checklist;
    let read: Record<string, number> = {};
    try {
      const raw = cl?.recordFile ? cl.deps.readFile(cl.recordFile) : undefined;
      const docs = raw ? (JSON.parse(raw) as { docsSentAt?: unknown }).docsSentAt : undefined;
      if (docs && typeof docs === 'object') read = docs as Record<string, number>;
    } catch {
      // Unreadable: sent again.
    }
    this.docsSent = read;
    return read;
  }

  private markDocs(dir: string): void {
    const docs = { ...this.docs(), [dir]: this.now() };
    this.docsSent = docs;
    const cl = this.deps.checklist;
    if (!cl?.recordFile) return;
    try {
      let record: Record<string, unknown> = {};
      try {
        record = JSON.parse(cl.deps.readFile(cl.recordFile) ?? '{}') as Record<string, unknown>;
      } catch {
        // Start over.
      }
      cl.deps.writeFile(cl.recordFile, `${JSON.stringify({ ...record, docsSentAt: docs }, null, 2)}\n`);
    } catch {
      // Not kept: sent again after a restart.
    }
  }

  private context(quick = false): ChecklistContext {
    const cl = this.deps.checklist;
    return {
      ...(quick ? { quick: true } : {}),
      checks: this.view().checks,
      combos: this.deps.store.getState().prefs.combos ?? DEFAULT_COMBOS,
      botDirs: cl?.botDirs?.() ?? [],
      docsSentAt: (dir) => this.docs()[dir],
      rebuild: (dir, id) => this.rebuilds.get(rebuildKey(dir, id)),
    };
  }

  private publishList(list: StackChecklist): void {
    this.publish({ ...this.view(), checklist: list });
  }

  /**
   * Run the checklist: this computer's items, and each place in `only` (a project's or worktree's id,
   * or its folder; `[]`: none), else every project's main checkout. Runs one after another; resolves
   * when this one is done.
   *
   * Asked (`manual`: Check Again, Fix, Settings › Stack) it does everything: `claude mcp list`, each
   * place's `gls index --check`, and what's the project's own fixes itself (indexes rebuild in the
   * background). By itself (at start, daily, after a rebuild) it stays light, because on a busy
   * computer the heavy part was the problem: it never starts Claude Code, never rebuilds an index nor
   * sends docs, and without `only` it looks at this computer only. A rebuild that ends re-checks its
   * place lightly, so one rebuild never leads to another.
   */
  runChecklist(only?: readonly string[], opts: { readonly manual?: boolean } = {}): Promise<StackChecklist | undefined> {
    const next = this.listing.then(() => this.list(only, opts.manual === true));
    this.listing = next.catch(() => undefined);
    return next;
  }

  private async list(only: readonly string[] | undefined, manual: boolean): Promise<StackChecklist | undefined> {
    const cl = this.deps.checklist;
    if (!cl || this.stopped) return undefined;
    const started = this.now();
    if (manual && only === undefined) for (const [key, r] of this.rebuilds) if (r.failed) this.rebuilds.delete(key); // asked again: try again
    const all = cl.places();
    const places = only ? all.filter((p) => only.includes(p.id) || only.includes(p.dir)) : manual ? all.filter((p) => !p.worktree) : [];
    const before = this.view().checklist;
    const ordered = (done: ReadonlyMap<string, ChecklistPlace>): ChecklistPlace[] =>
      all.flatMap((p) => {
        const place = done.get(p.id) ?? before?.places.find((b) => b.id === p.id);
        return place ? [place] : [];
      });
    this.publishList({ machine: before?.machine ?? [], places: before?.places ?? [], ...(before?.checkedAt ? { checkedAt: before.checkedAt } : {}), checking: true });
    const ctx = this.context(!manual);
    // A light look after a rebuild keeps this computer's items as they were.
    const machine = !manual && only?.length && before?.machine.length ? before.machine : await machineChecklist(ctx, cl.deps);
    const done = new Map<string, ChecklistPlace>();
    for (const place of places) {
      if (this.stopped) return undefined;
      const checked = await placeChecklist(place, ctx, cl.deps);
      const items = manual ? await this.selfFix(place, checked) : await this.selfFix(place, checked, { light: true });
      done.set(place.id, { id: place.id, projectId: place.projectId, name: place.name, dir: place.dir, items });
      this.publishList({ machine, places: ordered(done), checking: true });
    }
    const list: StackChecklist = { machine, places: ordered(done), checkedAt: this.now(), checking: false };
    this.publishList(list);
    this.tellList(list);
    const open = checklistProblems(list).reduce((n, g) => n + g.items.length, 0);
    blackbox.record('log', `stack checklist: ${places.length} place(s), ${open} open`, { ms: this.now() - started, places: places.length, open });
    return list;
  }

  /** What's the place's own fixes itself now: excludes, docs, GitNexus's leftovers; indexes start rebuilding. */
  private async selfFix(place: PlaceInput, items: readonly ChecklistItem[], opts: { readonly light?: boolean } = {}): Promise<ChecklistItem[]> {
    const cl = this.deps.checklist!;
    const out: ChecklistItem[] = [];
    for (const item of items) {
      // Light: only what costs nothing (the excludes, GitNexus's registry); indexes and docs wait for Fix.
      const heavy = INDEX_ITEMS.has(item.id) || item.id === 'docs';
      if (item.fix !== 'auto' || (item.state !== 'warn' && item.state !== 'fail') || item.fixing || (opts.light && heavy)) {
        out.push(item);
        continue;
      }
      if (INDEX_ITEMS.has(item.id)) {
        if (this.rebuilds.get(rebuildKey(place.dir, item.id))?.failed) out.push(item);
        else out.push(this.rebuild(place, item));
        continue;
      }
      const r = await autoFix(item.id, place, cl.deps).catch((err: unknown): FixResult => ({ ok: false, changed: [], why: err instanceof Error ? err.message : String(err) }));
      if (!r.ok) {
        out.push({ ...item, state: 'fail', ...(item.id === 'docs' ? { why: 'sendFailed' } : {}), ...(r.why ? { detail: r.why } : {}) });
        continue;
      }
      if (item.id === 'docs') this.markDocs(place.dir);
      out.push(item.id === 'excludes' ? excludesItem(place, cl.deps) : item.id === 'gitnexusRegistry' ? registryItem(place, cl.deps) : { id: item.id, state: 'ok' });
    }
    return out;
  }

  /** Rebuild one index in the background (never in the agents' run queue); the place is checked again when it ends. */
  private rebuild(place: PlaceInput, item: ChecklistItem): ChecklistItem {
    const cl = this.deps.checklist!;
    const key = rebuildKey(place.dir, item.id);
    const fixing: ChecklistItem = { ...item, state: 'warn', why: 'rebuilding', fixing: true };
    if (this.rebuilds.get(key)?.running) return fixing;
    this.rebuilds.set(key, { running: true });
    const cmd = rebuildCommand(item.id as 'gitnexusIndex' | 'graphifyIndex' | 'tokenGoatMap', item.why);
    const started = this.now();
    void cl.deps
      .run(findTool(cmd.bin, cl.deps) ?? cmd.bin, cmd.args, { cwd: place.dir, timeoutMs: REBUILD_MS })
      .catch((err: unknown) => ({ code: 1, out: err instanceof Error ? err.message : String(err) }))
      .then((r) => {
        if (r.code === 0) this.rebuilds.delete(key);
        else this.rebuilds.set(key, { failed: tail(r.out) });
        blackbox.record('log', `stack rebuild ${item.id} ${r.code === 0 ? 'done' : 'failed'}`, { ms: this.now() - started, code: r.code });
        if (!this.stopped) void this.runChecklist([place.id]);
      });
    return fixing;
  }

  /**
   * Fix one item (Settings › Stack › Fix): what changes a file of yours (its backup kept), only from
   * here; what's the project's own, at once. `placeId`: the project's or worktree's id, for 8–16.
   */
  async fix(id: ChecklistItemId, placeId?: string): Promise<FixResult> {
    const cl = this.deps.checklist;
    if (!cl) return { ok: false, changed: [] };
    const place = placeId ? cl.places().find((p) => p.id === placeId || p.dir === placeId) : undefined;
    if (placeId && !place) throw new Error(t('stack.toast.noProject'));
    let result: FixResult;
    if (ASK_FIX.has(id)) result = await askFix(id, this.context(), cl.deps, place);
    else if (AUTO_FIX.has(id) && place) {
      if (INDEX_ITEMS.has(id)) {
        this.rebuilds.delete(rebuildKey(place.dir, id));
        const item = this.view().checklist?.places.find((p) => p.id === place.id)?.items.find((i) => i.id === id);
        this.rebuild(place, item ?? { id, state: 'warn' });
        result = { ok: true, changed: [] };
      } else {
        result = await autoFix(id, place, cl.deps);
        if (result.ok && id === 'docs') this.markDocs(place.dir);
      }
    } else result = { ok: false, changed: [], why: `${id} has no fix` };
    blackbox.record('log', `stack fix ${id}: ${result.ok ? 'ok' : 'failed'}${result.changed.length ? ` (${result.changed.length} file(s), backed up)` : ''}`);
    void this.runChecklist(place ? [place.id] : [], { manual: true });
    return result;
  }

  /** One notice for a new set of checklist problems (none for what's fixing itself). */
  private tellList(list: StackChecklist): void {
    const groups = checklistProblems(list);
    if (!groups.length) {
      this.toldList = undefined;
      return;
    }
    const key = groups.flatMap((g) => g.items.map((i) => `${g.place?.id ?? ''}:${i.id}`)).sort().join(',');
    if (key === this.toldList) return;
    this.toldList = key;
    const names = [...new Set(groups.flatMap((g) => g.items.map((i) => t(`stack.item.${i.id}` as Key))))];
    this.deps.notify?.({ kind: 'problems', title: t('stack.notice.title'), body: t('stack.notice.checklist', { list: names.join(', ') }), need: 'stack', key: `stack:list:${this.now()}` });
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
