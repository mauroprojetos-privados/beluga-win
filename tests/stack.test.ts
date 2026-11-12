import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsYou } from '../src/companion/needs-you.js';
import { CLAUDE_KIND_CATEGORIES, CLAUDE_KIND_COMBOS, CLAUDE_KIND_ROLES, claudeByKind } from '../src/core/routing/presets.js';
import { DEFAULT_COMBOS, MAX_COMBOS } from '../src/core/routing/model.js';
import { STACK_EXCLUDES, bootstrapProject, docPaths, stackSetup, vikingParent } from '../src/core/stack/bootstrap.js';
import { claudeByKindOnce } from '../src/core/stack/launch.js';
import { StackMonitor, setUpWords } from '../src/core/stack/monitor.js';
import { type RunResult, type StackDeps, findTool, lookAll, openVikingUrl } from '../src/core/stack/probe.js';
import { STACK_CHECKS, stackProblems } from '../src/core/stack-store.js';
import { Store, initialState } from '../src/core/store.js';
import type { NoticeEvent } from '../src/core/notify.js';

const HOME = '/home/me';
const BIN = `${HOME}/.local/bin`;

/** A machine where `up` services answer (with `status`), `tools` are installed, and every call is kept. */
function machine(o: { up?: Partial<Record<string, number>>; tools?: readonly string[]; inWsl?: boolean; platform?: NodeJS.Platform; files?: Record<string, string> } = {}) {
  const runs: { bin: string; args: readonly string[]; cwd?: string }[] = [];
  const spawned: { bin: string; args: readonly string[]; log?: string }[] = [];
  const up = { ...(o.up ?? {}) };
  const fetchFn = (async (url: string) => {
    const u = String(url);
    const id = u.includes(':11434') ? 'ollama' : u.includes(':1933') ? 'openviking' : u.includes(':4317') ? 'hooktop' : 'other';
    const status = up[id];
    if (status === undefined) throw new Error('ECONNREFUSED');
    return { ok: status < 300, status } as Response;
  }) as unknown as typeof fetch;
  const files = { ...(o.files ?? {}) };
  const tools = new Set(o.tools ?? []);
  const deps: StackDeps = {
    fetch: fetchFn,
    platform: o.platform ?? 'linux',
    inWsl: o.inWsl ?? false,
    home: HOME,
    env: { PATH: '/usr/bin' },
    exists: (f) => f in files || (f.startsWith(`${BIN}/`) && tools.has(path.posix.basename(f))),
    readFile: (f) => files[f],
    run: async (bin, args, opts): Promise<RunResult> => {
      runs.push({ bin, args, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
      return { code: 0, out: '' };
    },
    spawnDetached: (bin, args, opts) => void spawned.push({ bin, args, ...(opts?.log ? { log: opts.log } : {}) }),
  };
  return { deps, runs, spawned, up, tools };
}

describe('your stack: looking at it', () => {
  it('finds a tool on the PATH or in ~/.local/bin', () => {
    const { deps } = machine({ tools: ['gitnexus'] });
    expect(findTool('gitnexus', deps)).toBe(`${BIN}/gitnexus`);
    expect(findTool('graphify', deps)).toBeUndefined();
  });

  it('counts a service up when anything answers (hooktop’s 401, OpenViking’s 406), down when nothing does', async () => {
    const { deps } = machine({ up: { ollama: 200, openviking: 406, hooktop: 401 }, tools: ['rtk', 'gls'] });
    const checks = await lookAll(deps);
    expect(checks.map((c) => c.id)).toEqual([...STACK_CHECKS]);
    expect(Object.fromEntries(checks.map((c) => [c.id, c.state]))).toEqual({ ollama: 'up', openviking: 'up', hooktop: 'up', rtk: 'up', 'token-goat': 'missing', gitnexus: 'missing', graphify: 'missing', gls: 'up' });
    const down = machine({ up: { ollama: 500 } });
    expect((await lookAll(down.deps)).filter((c) => c.kind === 'service').every((c) => c.state === 'down')).toBe(true);
  });

  it('reads OpenViking’s address from its CLI config', () => {
    const { deps } = machine({ files: { [`${HOME}/.openviking/ovcli.conf`]: '{"url":"http://127.0.0.1:2000/"}' } });
    expect(openVikingUrl(deps)).toBe('http://127.0.0.1:2000');
    expect(openVikingUrl(machine().deps)).toBe('http://127.0.0.1:1933');
  });
});

describe('your stack: keeping it up', () => {
  const setup = (o: Parameters<typeof machine>[0] = {}) => {
    const m = machine(o);
    const store = new Store(initialState('room'));
    const notices: NoticeEvent[] = [];
    let now = 1_000;
    const monitor = new StackMonitor({ store, stack: m.deps, bootstrap: { ...m.deps, viking: async () => undefined }, notify: (e) => void notices.push(e), settleMs: 10_000, pollMs: 1_000, sleep: async (ms) => void (now += ms), now: () => now });
    return { ...m, store, notices, monitor };
  };

  it('starts the Windows Ollama from WSL once per outage, and the next look finds it up', async () => {
    const t = setup({ inWsl: true, up: { openviking: 200, hooktop: 401 }, tools: ['rtk', 'token-goat', 'gitnexus', 'graphify', 'gls'] });
    // It comes up while Beluga waits for it.
    const start = t.deps.spawnDetached;
    (t.deps as { spawnDetached: StackDeps['spawnDetached'] }).spawnDetached = (bin, args, opts) => {
      start(bin, args, opts);
      t.up.ollama = 200;
    };
    const view = await t.monitor.check();
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]!.bin).toMatch(/powershell\.exe$/);
    expect(t.spawned[0]!.args.join(' ')).toContain('ollama app.exe');
    expect(view.checks.find((c) => c.id === 'ollama')).toMatchObject({ state: 'up', started: true });
    expect(stackProblems(view)).toEqual([]);
    expect(t.notices).toEqual([]);
  });

  it('tries once, then tells you once: Needs You names what’s down and how to fix it, and clears when it’s back', async () => {
    const t = setup({ up: { ollama: 200, hooktop: 401 }, tools: ['rtk', 'token-goat', 'gitnexus', 'graphify', 'gls', 'openviking-server'] });
    await t.monitor.check();
    expect(t.spawned.map((s) => s.bin)).toEqual([`${BIN}/openviking-server`]);
    expect(t.spawned[0]!.log).toBe(`${HOME}/.openviking/server.log`);
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toMatchObject({ kind: 'problems', need: 'stack' });
    const needs = needsYou(t.store.getState()).filter((n) => n.kind === 'stack');
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ id: 'stack:openviking', actions: [{ method: 'stack.check', tone: 'main' }] });
    expect(needs[0]!.detail).toMatch(/OpenViking: .*openviking-server/);
    // Still down: not started again, not told again.
    await t.monitor.check();
    expect(t.spawned).toHaveLength(1);
    expect(t.notices).toHaveLength(1);
    // Back: Needs You is clear, and a later outage is tried and told again.
    t.up.openviking = 200;
    await t.monitor.check();
    expect(needsYou(t.store.getState()).filter((n) => n.kind === 'stack')).toEqual([]);
    delete t.up.openviking;
    await t.monitor.check();
    expect(t.spawned).toHaveLength(2);
    expect(t.notices).toHaveLength(2);
  });

  it('starts nothing when Start Services That Are Down is off', async () => {
    const t = setup({ tools: ['openviking-server'] });
    t.store.dispatch({ type: 'prefs', prefs: { stackRepair: false } });
    await t.monitor.check();
    expect(t.spawned).toEqual([]);
    expect(t.runs).toEqual([]);
  });

  it('starts hooktop through its systemd unit, and Ollama with `open` on a Mac', async () => {
    const linux = setup({ files: { [`${HOME}/.config/systemd/user/hooktop.service`]: '' }, up: { ollama: 200, openviking: 200 } });
    await linux.monitor.check();
    expect(linux.runs).toEqual([{ bin: 'systemctl', args: ['--user', 'start', 'hooktop'] }]);
    const mac = setup({ platform: 'darwin', up: { openviking: 200, hooktop: 401 } });
    await mac.monitor.check();
    expect(mac.runs).toEqual([{ bin: 'open', args: ['-a', 'Ollama'] }]);
  });

  it('sets a project up only while Set Up New Projects is on', async () => {
    const t = setup();
    const root = mkdtempSync(path.join(os.tmpdir(), 'beluga-stack-'));
    t.store.dispatch({ type: 'prefs', prefs: { stackBootstrap: false } });
    t.monitor.projectAdded(root);
    expect(existsSync(path.join(root, 'beluga.json'))).toBe(false);
  });
});

describe('your stack: setting a project up', () => {
  const project = (): string => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'beluga-stack-'));
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(path.join(root, 'package-lock.json'), '{}');
    writeFileSync(path.join(root, 'package.json'), '{}');
    writeFileSync(path.join(root, 'AGENTS.md'), '# rules');
    writeFileSync(path.join(root, 'README.md'), '# app');
    mkdirSync(path.join(root, 'docs'));
    return root;
  };

  it('installs then indexes in each new worktree, with only the tools that are here', () => {
    const root = project();
    expect(stackSetup(root, () => true, 'linux')).toBe('npm install && gitnexus analyze --index-only && gls graphify ensure');
    expect(stackSetup(root, (t) => t === 'gitnexus', 'linux')).toBe('npm install && gitnexus analyze --index-only');
  });

  it('writes beluga.json and CLAUDE.md only where there are none, keeps the indexes out of git, and runs each index', async () => {
    const root = project();
    const m = machine({ tools: ['gitnexus', 'gls'] });
    const viking = { bin: 'ov' };
    const report = await bootstrapProject(root, { ...m.deps, platform: 'linux', viking: async () => viking });
    expect(report.wrote).toEqual(['beluga.json', 'CLAUDE.md']);
    expect(JSON.parse(readFileSync(path.join(root, 'beluga.json'), 'utf8'))).toEqual({ scripts: { setup: 'npm install && gitnexus analyze --index-only && gls graphify ensure' } });
    expect(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    const exclude = readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8');
    for (const line of STACK_EXCLUDES) expect(exclude.split('\n')).toContain(line);
    expect(m.runs.slice(0, 2)).toEqual([
      { bin: `${BIN}/gitnexus`, args: ['analyze', '--index-only'], cwd: root },
      { bin: `${BIN}/gls`, args: ['graphify', 'ensure'], cwd: root },
    ]);
    // Only the documentation goes to OpenViking, under the project's own folder.
    const ov = m.runs.slice(2);
    expect(ov.map((r) => path.basename(String(r.args[1])))).toEqual(docPaths(root));
    expect(ov.every((r) => r.bin === 'ov' && r.args[0] === 'add-resource' && r.args[3] === vikingParent(root))).toBe(true);
    expect(report.ran).toEqual(['gitnexus', 'graphify', 'openviking']);
    expect(setUpWords('app', report)).toMatch(/GitNexus.*graphify.*OpenViking/);

    // Again: nothing written over, nothing added twice to the exclude.
    const again = await bootstrapProject(root, { ...m.deps, platform: 'linux', viking: async () => undefined });
    expect(again.wrote).toEqual([]);
    expect(readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8')).toBe(exclude);
  });

  it('writes no CLAUDE.md without an AGENTS.md, and says what failed', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'beluga-stack-'));
    const m = machine({ tools: ['gitnexus'] });
    (m.deps as { run: StackDeps['run'] }).run = async () => ({ code: 1, out: 'boom' });
    const report = await bootstrapProject(root, { ...m.deps, viking: async () => undefined });
    expect(existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
    expect(report.failed).toEqual([{ step: 'gitnexus', why: 'boom' }]);
  });
});

describe('your stack: Claude by kind of work', () => {
  it('adds the three Claude combos to yours and routes each kind and role to them', () => {
    const p = claudeByKind(undefined);
    expect(p.combos.map((c) => c.id)).toEqual([...DEFAULT_COMBOS, ...CLAUDE_KIND_COMBOS].map((c) => c.id));
    expect(p.categoryCombos).toEqual(CLAUDE_KIND_CATEGORIES);
    expect(p.roleCombos).toEqual(CLAUDE_KIND_ROLES);
    expect(CLAUDE_KIND_CATEGORIES).toMatchObject({ ultrabrain: { combo: 'claude-opus' }, deep: { combo: 'claude-sonnet' }, docs: { combo: 'claude-haiku' }, explore: { combo: 'claude-haiku' } });
    // Yours kept; one already there not added twice; never past the limit.
    const mine = [{ id: 'claude-opus', name: 'Mine', targets: [{ runtime: 'claude', model: 'opus' }] }];
    expect(claudeByKind(mine).combos.map((c) => c.name)).toEqual(['Mine', 'Claude: Sonnet first', 'Claude: Haiku first']);
    const full = Array.from({ length: MAX_COMBOS }, (_, i) => ({ id: `c${i}`, name: `C${i}`, targets: [{ runtime: 'claude' }] }));
    expect(claudeByKind(full).combos).toHaveLength(MAX_COMBOS);
  });

  it('is set once, only when you never chose combos for kinds of work or roles', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'beluga-stack-')), 'stack.json');
    const store = new Store(initialState('room'));
    const set: unknown[] = [];
    const session = { setPrefs: (p: unknown) => void set.push(p) };
    expect(claudeByKindOnce(session, store, file)).toBe(true);
    expect(set).toHaveLength(1);
    expect(claudeByKindOnce(session, store, file)).toBe(false);
    expect(set).toHaveLength(1);
    // Someone with kinds of their own: recorded, nothing changed.
    const theirs = new Store(initialState('room'));
    theirs.dispatch({ type: 'prefs', prefs: { categoryCombos: { docs: { combo: 'economy' } } } });
    const other = path.join(path.dirname(file), 'other.json');
    expect(claudeByKindOnce(session, theirs, other)).toBe(true);
    expect(set).toHaveLength(1);
  });
});
