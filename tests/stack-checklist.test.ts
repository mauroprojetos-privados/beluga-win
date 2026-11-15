import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsYou } from '../src/companion/needs-you.js';
import { parseAgent, readAgents, stackless, withModel, withTool } from '../src/core/stack/agents.js';
import { CHECKLIST_EXCLUDES, type ChecklistDeps, autoFix, excludesItem, machineChecklist, ollamaItem, parseIndexCheck, placeChecklist } from '../src/core/stack/checklist.js';
import { StackMonitor } from '../src/core/stack/monitor.js';
import type { RunResult } from '../src/core/stack/probe.js';
import { CHECKLIST_ITEMS, checklistProblems } from '../src/core/stack-store.js';
import { Store, initialState } from '../src/core/store.js';

const HOME = '/home/me';
const BIN = `${HOME}/.local/bin`;
const ERP = '/home/me/projetos/erp';

type Runner = (bin: string, args: readonly string[], cwd?: string) => RunResult | Promise<RunResult>;

/** A pretend computer: files in a map, `tools` installed, Ollama answering when `ollama` is set. */
function computer(o: { tools?: readonly string[]; files?: Record<string, string>; ollama?: { name: string; tools: boolean }[]; run?: Runner } = {}) {
  const files: Record<string, string> = { ...(o.files ?? {}) };
  const tools = new Set(o.tools ?? []);
  const runs: { bin: string; args: readonly string[]; cwd?: string }[] = [];
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (!u.includes(':11434') || !o.ollama) throw new Error('ECONNREFUSED');
    if (u.endsWith('/api/tags')) return { ok: true, status: 200, json: async () => ({ models: o.ollama!.map((m) => ({ name: m.name })) }) } as unknown as Response;
    const model = (JSON.parse(init?.body ?? '{}') as { model: string }).model;
    return { ok: true, status: 200, json: async () => ({ capabilities: o.ollama!.find((m) => m.name === model)?.tools ? ['completion', 'tools'] : ['completion'] }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const deps: ChecklistDeps = {
    fetch: fetchFn,
    platform: 'linux',
    inWsl: false,
    home: HOME,
    env: { PATH: '/usr/bin' },
    exists: (f) => f in files || Object.keys(files).some((k) => k.startsWith(`${f}/`)) || (f.startsWith(`${BIN}/`) && tools.has(path.posix.basename(f))),
    readFile: (f) => files[f],
    listDir: (dir) => Object.keys(files).filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1)),
    writeFile: (f, text) => void (files[f] = text),
    run: async (bin, args, opts) => {
      runs.push({ bin, args, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
      return (await o.run?.(bin, args, opts?.cwd)) ?? { code: 0, out: '' };
    },
    spawnDetached: () => undefined,
    viking: async () => undefined,
    now: () => Date.UTC(2026, 10, 15, 12, 0, 0),
  };
  return { deps, files, runs };
}

/** Your Claude Code set up for the stack, so the computer's own items are ✓. */
const READY: Record<string, string> = {
  [`${HOME}/.claude/settings.json`]: JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ command: 'rtk hook claude' }] },
        { matcher: 'Grep|Glob|Bash', hooks: [{ command: `node '${HOME}/.claude/hooks/gitnexus/gitnexus-hook.cjs'` }] },
      ],
      PostToolUse: [{ matcher: 'Bash', hooks: [{ command: `node '${HOME}/.claude/hooks/gitnexus/gitnexus-hook.cjs'` }] }],
    },
  }),
  [`${HOME}/.claude/hooks/gitnexus/gitnexus-hook.cjs`]: '',
  [`${HOME}/.claude.json`]: JSON.stringify({ mcpServers: { gitnexus: {} } }),
  [`${HOME}/.claude/CLAUDE.md`]: '## Stack (every project)\ntoken-goat\n',
  [`${ERP}/.git/info/exclude`]: `${CHECKLIST_EXCLUDES.join('\n')}\n`,
  [`${ERP}/.graphify-out/graph.json`]: '{}',
  [`${ERP}/beluga.json`]: JSON.stringify({ scripts: { setup: 'npm ci && gitnexus analyze --index-only && gls graphify ensure' } }),
};

const OLLAMA_OK = [{ name: 'qwen3:8b', tools: true }];
const place = { id: 'p1', projectId: 'p1', name: 'erp', dir: ERP };

function monitorFor(c: ReturnType<typeof computer>) {
  const store = new Store(initialState('room'));
  const monitor = new StackMonitor({ store, stack: c.deps, bootstrap: { ...c.deps, viking: async () => undefined }, checklist: { deps: c.deps, places: () => [place] } });
  return { store, monitor };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the stack’s checklist: its items', () => {
  it('has 19 items, numbered in the plan’s order', () => {
    expect(CHECKLIST_ITEMS).toHaveLength(19);
    expect(CHECKLIST_ITEMS[2]).toBe('ollamaNeeded');
    expect(CHECKLIST_ITEMS[14]).toBe('agentTools');
  });

  it('reads `gls index --check`, a token-goat timeout being a stale map (rebuild), not a broken tool', () => {
    const out = [
      '=== ÍNDICES DE CÓDIGO ===',
      '[✓] gitnexus   Status: ✅ up-to-date',
      "[!] token-goat TimeoutExpired: Command '['token-goat', 'map', '--compact']' timed out after 60 seconds -- rode: token-goat index",
      '[!] graphify   2 novo(s), 2 alterado(s), 0 removido(s) -- rode: gls index (sem --check)',
    ].join('\n');
    const parsed = parseIndexCheck(out);
    expect(parsed.gitnexus?.verdict).toBe('ok');
    expect(parsed['token-goat']?.verdict).toBe('stale');
    expect(parsed.graphify?.verdict).toBe('stale');
  });

  it('wants graph-loop’s memory and Beluga’s worktrees out of git too, and adds them in a worktree’s shared .git', async () => {
    expect(CHECKLIST_EXCLUDES).toEqual(expect.arrayContaining(['.gitnexus/', '.graphify-out/', '.graph_loop_run', '.graph_loop_memory.db', '.claude/worktrees/']));
    const wt = `${ERP}/.claude/worktrees/fix`;
    const c = computer({ files: { [`${wt}/.git`]: `gitdir: ${ERP}/.git/worktrees/fix\n`, [`${ERP}/.git/worktrees/fix/commondir`]: '../..\n', [`${ERP}/.git/info/exclude`]: '.gitnexus/\n' } });
    const p = { id: 'w1', projectId: 'p1', name: 'erp › fix', dir: wt, worktree: true };
    expect(excludesItem(p, c.deps)).toMatchObject({ state: 'warn', why: 'notExcluded', fix: 'auto' });
    await autoFix('excludes', p, c.deps);
    expect(c.files[`${ERP}/.git/info/exclude`]!.split('\n')).toEqual(expect.arrayContaining(['.graph_loop_memory.db', '.claude/worktrees/']));
    expect(excludesItem(p, c.deps).state).toBe('ok');
  });
});

describe('the stack’s checklist: Ollama', () => {
  const local = [{ id: 'local-first', name: 'Local first', targets: [{ runtime: 'local', endpoint: 'ollama' }] }];

  it('without Ollama and with a local combo, says what stops working', async () => {
    const item = await ollamaItem({ checks: [], combos: local }, computer().deps);
    expect(item).toMatchObject({ id: 'ollamaNeeded', why: 'ollamaOff' });
    expect(['warn', 'fail']).toContain(item.state);
    expect(item.detail).toContain('Local first: no local targets');
  });

  it('is ✗ when OpenViking’s embeddings are Ollama’s, and doesn’t apply when nothing uses it', async () => {
    const ov = computer({ files: { [`${HOME}/.openviking/ov.conf`]: '{"embedding":{"dense":{"provider":"ollama","api_base":"http://localhost:11434/v1"}}}' } });
    expect(await ollamaItem({ checks: [], combos: [] }, ov.deps)).toMatchObject({ state: 'fail', detail: expect.stringContaining('OpenViking') });
    expect((await ollamaItem({ checks: [], combos: [] }, computer().deps)).state).toBe('skip');
  });

  it('asks Ollama over HTTP (no program needed) and notes the models that call tools', async () => {
    const c = computer({ ollama: [{ name: 'gemma3:4b', tools: false }, { name: 'qwen3:8b', tools: true }] });
    expect(await ollamaItem({ checks: [], combos: local }, c.deps)).toMatchObject({ state: 'ok', detail: 'tools: qwen3:8b' });
    const none = computer({ ollama: [{ name: 'gemma3:4b', tools: false }] });
    expect(await ollamaItem({ checks: [], combos: local }, none.deps)).toMatchObject({ state: 'warn', why: 'noToolsModel' });
  });
});

describe('the stack’s checklist: indexes fix themselves', () => {
  it('asked, rebuilds a stale GitNexus index in the background, with nothing in Needs You', async () => {
    let indexed = 'aaaa1111';
    let release: () => void = () => undefined;
    const done = new Promise<void>((r) => (release = r));
    const files = { ...READY, [`${HOME}/.gitnexus/registry.json`]: '' };
    const registry = (): string => JSON.stringify([{ name: 'erp', path: ERP, lastCommit: indexed }]);
    files[`${HOME}/.gitnexus/registry.json`] = registry();
    const c = computer({
      tools: ['gitnexus', 'rtk'],
      files,
      ollama: OLLAMA_OK,
      run: async (bin, args) => {
        if (bin === 'git' && args[0] === 'rev-parse') return { code: 0, out: 'bbbb2222\n' };
        if (bin.endsWith('gitnexus') && args[0] === 'analyze') {
          await done;
          indexed = 'bbbb2222';
          c.files[`${HOME}/.gitnexus/registry.json`] = registry();
        }
        return { code: 0, out: '' };
      },
    });
    const { store, monitor } = monitorFor(c);
    const first = await monitor.runChecklist(['p1'], { manual: true });
    const item = first!.places[0]!.items.find((i) => i.id === 'gitnexusIndex');
    expect(item).toMatchObject({ state: 'warn', why: 'rebuilding', fixing: true });
    expect(c.runs.find((r) => r.args[0] === 'analyze')).toMatchObject({ args: ['analyze', '--index-only'], cwd: ERP });
    expect(checklistProblems(store.getState().stack.checklist)).toEqual([]);
    expect(needsYou(store.getState()).filter((n) => n.kind === 'stack')).toEqual([]);
    release();
    await settle();
    const after = await monitor.runChecklist(['p1'], { manual: true });
    expect(after!.places[0]!.items.find((i) => i.id === 'gitnexusIndex')?.state).toBe('ok');
    expect(needsYou(store.getState()).filter((n) => n.kind === 'stack')).toEqual([]);
    monitor.stop();
  });

  it('a rebuild that fails waits for you in Needs You, grouped by project', async () => {
    const files = { ...READY, [`${HOME}/.gitnexus/registry.json`]: JSON.stringify([{ name: 'erp', path: ERP, lastCommit: 'aaaa' }]) };
    const c = computer({
      tools: ['gitnexus'],
      files,
      ollama: OLLAMA_OK,
      run: (bin, args) => (bin === 'git' ? { code: 0, out: 'bbbb\n' } : args[0] === 'analyze' ? { code: 1, out: 'out of memory' } : { code: 0, out: '' }),
    });
    const { store, monitor } = monitorFor(c);
    await monitor.runChecklist(['p1'], { manual: true });
    await settle();
    await monitor.runChecklist(['p1'], { manual: true });
    const card = needsYou(store.getState()).find((n) => n.id.startsWith('stack:list:'));
    expect(card?.detail).toContain('erp');
    expect(card?.detail).toContain('out of memory');
    expect(card?.actions[0]).toMatchObject({ method: 'stack.checklist' });
    monitor.stop();
  });

  it('by itself stays light: no index rebuilt, no Claude Code started, no place looked at, and a rebuild never leads to another', async () => {
    const files = { ...READY, [`${HOME}/.gitnexus/registry.json`]: JSON.stringify([{ name: 'erp', path: ERP, lastCommit: 'aaaa' }]) };
    const c = computer({ tools: ['gitnexus', 'rtk', 'claude'], files, ollama: OLLAMA_OK, run: (bin) => (bin === 'git' ? { code: 0, out: 'bbbb\n' } : { code: 0, out: '' }) });
    const { monitor } = monitorFor(c);
    const daily = await monitor.runChecklist();
    expect(daily!.places).toEqual([]);
    expect(c.runs.some((r) => r.args[0] === 'mcp')).toBe(false);
    expect(c.runs.some((r) => r.args[0] === 'analyze')).toBe(false);
    const light = await monitor.runChecklist(['p1']);
    expect(light!.places[0]!.items.find((i) => i.id === 'gitnexusIndex')).toMatchObject({ state: 'warn', fix: 'auto' });
    expect(light!.places[0]!.items.find((i) => i.id === 'gitnexusIndex')?.fixing).toBeUndefined();
    expect(c.runs.some((r) => r.args[0] === 'analyze' || r.args[0] === 'mcp')).toBe(false);
    await monitor.runChecklist(undefined, { manual: true });
    expect(c.runs.some((r) => r.args[0] === 'mcp' && r.args[1] === 'list')).toBe(true);
    monitor.stop();
  });
});

describe('the stack’s checklist: sub-agents', () => {
  const AGENT = `${HOME}/.claude/agents/x.md`;
  const text = '---\nname: x\ndescription: finds things\ntools: Read\n---\n\nYou find things.\n';

  it('an agent with `tools: Read` is “no stack”, and Fix adds GitNexus’s MCP only on your yes (with a backup)', async () => {
    const c = computer({ tools: ['gitnexus'], files: { ...READY, [AGENT]: text }, ollama: OLLAMA_OK });
    const { store, monitor } = monitorFor(c);
    const list = await monitor.runChecklist([]);
    expect(list!.machine.find((i) => i.id === 'agentTools')).toMatchObject({ state: 'warn', why: 'noStack', fix: 'ask', detail: 'x (user)' });
    // The run itself changes nothing of yours.
    expect(c.files[AGENT]).toBe(text);
    expect(needsYou(store.getState()).find((n) => n.id.startsWith('stack:list:'))?.detail).toContain('x (user)');
    const r = await monitor.fix('agentTools');
    expect(r).toMatchObject({ ok: true, changed: [AGENT] });
    expect(c.files[AGENT]).toContain('tools: Read, mcp__gitnexus__*');
    expect(Object.keys(c.files).find((f) => f.startsWith(`${AGENT}.bak-`))).toBeDefined();
    expect(c.files[Object.keys(c.files).find((f) => f.startsWith(`${AGENT}.bak-`))!]).toBe(text);
    await settle();
    const again = await monitor.runChecklist([]);
    expect(again!.machine.find((i) => i.id === 'agentTools')?.state).toBe('ok');
    monitor.stop();
  });

  it('reads `tools:` inline or as a list, and edits each without touching the rest', () => {
    const list = '---\nname: y\ntools:\n  - Read\n  - Grep\n---\nbody\n';
    expect(parseAgent('y.md', list, 'project').tools).toEqual(['Read', 'Grep']);
    expect(withTool(list, 'mcp__gitnexus__*')).toBe('---\nname: y\ntools:\n  - Read\n  - Grep\n  - mcp__gitnexus__*\n---\nbody\n');
    expect(stackless(parseAgent('y.md', list, 'project'))).toBe(true);
    expect(stackless(parseAgent('z.md', '---\ntools: Bash, Read\n---\n', 'user'))).toBe(false);
    expect(stackless(parseAgent('w.md', '---\nname: w\n---\n', 'user'))).toBe(false);
    expect(withModel('---\nname: y\ntools: Read\n---\nbody\n', 'haiku')).toBe('---\nname: y\nmodel: haiku\ntools: Read\n---\nbody\n');
  });

  it('a reading agent without `model:` runs on the main model, unless CLAUDE_CODE_SUBAGENT_MODEL is set', async () => {
    const agent = '---\nname: explorador\ntools: Bash, Grep, Read\n---\n';
    const c = computer({ files: { [`${HOME}/.claude/agents/explorador.md`]: agent }, ollama: OLLAMA_OK });
    const items = await machineChecklist({ checks: [] }, c.deps);
    expect(items.find((i) => i.id === 'agentModels')).toMatchObject({ state: 'warn', why: 'inheritsLead', fix: 'ask' });
    c.files[`${HOME}/.claude/settings.json`] = JSON.stringify({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } });
    expect((await machineChecklist({ checks: [] }, c.deps)).find((i) => i.id === 'agentModels')?.state).toBe('ok');
  });

  it('reads a project’s and a bot’s agents too', async () => {
    const c = computer({ files: { [`${ERP}/.claude/agents/a.md`]: '---\ntools: Read\n---\n', '/bots/clara/.claude/agents/b.md': '---\ntools: Glob\n---\n' }, ollama: OLLAMA_OK });
    expect(readAgents('/bots/clara/.claude/agents', 'bot', c.deps).map((a) => a.name)).toEqual(['b']);
    const items = await placeChecklist(place, { checks: [] }, c.deps);
    expect(items.find((i) => i.id === 'agentTools')).toMatchObject({ why: 'noStack', detail: 'a (project)' });
    const machine = await machineChecklist({ checks: [], botDirs: ['/bots/clara'] }, c.deps);
    expect(machine.find((i) => i.id === 'agentTools')).toMatchObject({ detail: 'b (bot)' });
  });
});
