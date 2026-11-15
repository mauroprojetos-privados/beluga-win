import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { changesFiles, delegateTools, delegateVerdict } from '../src/agent/delegate-gate.js';
import { buildOrchestratorAppend, delegateRefusal, orchestratorAgents } from '../src/agent/orchestrator-agents.js';
import { decideTool } from '../src/agent/policy.js';
import { runToolSuites } from '../src/agent/run-tools.js';
import { CompletionError, type Complete, type CompletionRequest } from '../src/agent/runtime/types.js';
import type { AgentBackend, AgentRunInput, DelegateTools } from '../src/agent/types.js';
import { ViewShelf } from '../src/agent/view-tools.js';
import { AgentHost } from '../src/core/agent-host.js';
import { DELEGATE_MAX_TURNS, type DelegateDeps, cannotRun, delegate, outcomeText } from '../src/core/routing/delegate.js';
import type { Combo, RouteWorld } from '../src/core/routing/model.js';
import { resolveOrchestrator } from '../src/core/routing/orchestrator.js';
import { runOrchestrator } from '../src/core/routing/orchestrator-run.js';
import { Store, initialState } from '../src/core/store.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { waitFor } from './helpers.js';

/**
 * Orchestrator mode, phase 3 (roadmap/modo-orquestrador.md; docs/routing.md "Executors on other
 * models"): the lead hands a task to an executor on another runtime through
 * mcp__beluga_mac__delegate. Fake runtimes only: no Codex process starts here.
 */

const claude = { id: 'claude', label: 'Claude', available: true, state: 'ready', models: [] } as unknown as RuntimeChoice;
const codexReady = { id: 'codex', label: 'Codex', available: true, state: 'ready', models: [] } as unknown as RuntimeChoice;
const codexOut = { id: 'codex', label: 'Codex', available: true, state: 'signed_out', fix: 'Run codex login', models: [] } as unknown as RuntimeChoice;
const world = (...runtimes: RuntimeChoice[]): RouteWorld => ({ runtimes, limits: new Map() });

const COMBOS: Combo[] = [
  { id: 'codex-first', name: 'Codex first', targets: [{ runtime: 'codex' }, { runtime: 'claude', model: 'haiku' }] },
  { id: 'claude-haiku', name: 'Claude Haiku', targets: [{ runtime: 'claude', model: 'haiku' }] },
];

const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-delegate-'));
writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
const place = { cwd: dir, roots: [dir] };
const explore = { name: 'explore', can: 'read' as const, combo: 'codex-first' };

/** A runtime's one-shot call that answers `text`, keeping what it was asked. */
function fake(text: string | ((req: CompletionRequest) => Promise<string>), asked: CompletionRequest[] = []): Complete {
  return async (req) => {
    asked.push(req);
    return typeof text === 'string' ? (req.onTokens?.(1200), text) : text(req);
  };
}

const deps = (w: RouteWorld, completes: Record<string, Complete>, extra: Partial<DelegateDeps> = {}): DelegateDeps => ({ combos: () => COMBOS, world: () => w, complete: (r) => completes[r], ...extra });

describe('delegate (core/routing/delegate.ts)', () => {
  it('hands the task to the Codex target: one call, read-only tools, and the answer names who answered', async () => {
    const asked: CompletionRequest[] = [];
    const targets: string[] = [];
    let tokens = 0;
    const o = await delegate(deps(world(claude, codexReady), { codex: fake('Found it in a.ts:1', asked) }, { onTarget: (t) => targets.push(t.label), onTokens: (n) => (tokens += n) }), { executor: explore, task: 'Where is a defined?', paths: ['a.ts'], place });
    expect(o).toMatchObject({ ok: true, target: 'Codex', runtime: 'codex', answer: 'Found it in a.ts:1', tokens: 1200 });
    expect(targets).toEqual(['Codex']);
    expect(tokens).toBe(1200);
    expect(asked).toHaveLength(1);
    const req = asked[0]!;
    expect(req.cwd).toBe(dir);
    expect(req.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(req.maxTurns).toBe(DELEGATE_MAX_TURNS);
    expect(req.prompt).toMatch(/Where is a defined\?[\s\S]*Start from: `a.ts`/);
    expect(req.system).toMatch(/Read only: never change a file/);
    expect(outcomeText('explore', o)).toMatch(/^explore answered on Codex\.\n\nFound it/);
  });

  it('falls back along the combo when Codex isn’t signed in, and says so', async () => {
    const haiku: CompletionRequest[] = [];
    const o = await delegate(deps(world(claude, codexOut), { codex: fake('never'), claude: fake('Claude found it', haiku) }), { executor: explore, task: 'look', place });
    expect(o).toMatchObject({ ok: true, target: 'Claude · Haiku', runtime: 'claude', model: 'haiku' });
    expect(o.passed).toEqual([{ label: 'Codex', why: 'Run codex login' }]);
    expect(haiku[0]!.model).toBe('haiku');
    expect(outcomeText('explore', o)).toMatch(/answered on Claude · Haiku \(Codex: Run codex login\)/);
  });

  it('falls back too when the call itself says it isn’t signed in (the state hadn’t caught up)', async () => {
    const signedOut: Complete = async () => {
      throw new CompletionError('failed', 'Not logged in · Please run /login');
    };
    const o = await delegate(deps(world(claude, codexReady), { codex: signedOut, claude: fake('ok') }), { executor: explore, task: 'look', place });
    expect(o).toMatchObject({ ok: true, target: 'Claude · Haiku' });
    expect(o.passed[0]).toEqual({ label: 'Codex', why: "Isn't signed in" });
  });

  it('ends at a target that ran and failed: the next one would pay for the same work again', async () => {
    const ranThenFailed: Complete = async (req) => {
      req.onTokens?.(5000);
      throw new CompletionError('max_turns');
    };
    const claudeCalls: CompletionRequest[] = [];
    const o = await delegate(deps(world(claude, codexReady), { codex: ranThenFailed, claude: fake('x', claudeCalls) }), { executor: explore, task: 'look', place });
    expect(o).toMatchObject({ ok: false, target: 'Codex', tokens: 5000 });
    expect(o.ok ? '' : o.why).toMatch(/ran out of its 30 turns/);
    expect(claudeCalls).toHaveLength(0);
    expect(cannotRun(new CompletionError('failed'), 0)).toBe("Couldn't start");
    expect(cannotRun(new CompletionError('failed'), 10)).toBeUndefined();
  });

  it('stops at its time limit, without trying another target', async () => {
    let aborted = false;
    const slow: Complete = (req) =>
      new Promise((_, reject) =>
        req.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        }),
      );
    const claudeCalls: CompletionRequest[] = [];
    const o = await delegate(deps(world(claude, codexReady), { codex: slow, claude: fake('x', claudeCalls) }), { executor: explore, task: 'look', place, timeoutMs: 20 });
    expect(aborted).toBe(true);
    expect(o).toMatchObject({ ok: false, stopped: 'timeout', target: 'Codex' });
    expect(claudeCalls).toHaveLength(0);
  });

  it('stops past its token cap', async () => {
    const hungry: Complete = (req) =>
      new Promise((_, reject) => {
        req.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        req.onTokens?.(900);
      });
    const o = await delegate(deps(world(claude, codexReady), { codex: hungry }), { executor: explore, task: 'look', place, maxTokens: 500 });
    expect(o).toMatchObject({ ok: false, stopped: 'tokens', tokens: 900 });
  });

  it('stops with the lead’s run', async () => {
    const ctl = new AbortController();
    const slow: Complete = (req) => new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const p = delegate(deps(world(claude, codexReady), { codex: slow }), { executor: explore, task: 'look', place, signal: ctl.signal });
    ctl.abort();
    expect(await p).toMatchObject({ ok: false, stopped: 'aborted' });
  });

  it('says why when nothing in the combo can run', async () => {
    const o = await delegate(deps(world(codexOut), {}), { executor: { ...explore, combo: 'codex-first' }, task: 'look', place });
    expect(o.ok).toBe(false);
    expect(o.ok ? '' : o.why).toMatch(/Nothing in Codex first can run now: Codex: Run codex login; Claude · Haiku/);
  });
});

describe('the delegated executor’s gate (agent/delegate-gate.ts)', () => {
  const verdict = (can: 'read' | 'run' | 'edit', tool: string, input: Record<string, unknown>, readOnly = false) => delegateVerdict(can, { ...place, ...(readOnly ? { readOnly: true } : {}) }, tool, input).allow;

  it('read: Read, Grep and Glob inside the folder, never a secret, never a command or an edit', () => {
    expect(delegateTools('read')).toEqual(['Read', 'Grep', 'Glob']);
    expect(verdict('read', 'Read', { file_path: path.join(dir, 'a.ts') })).toBe(true);
    expect(verdict('read', 'Grep', { pattern: 'a', path: dir })).toBe(true);
    expect(verdict('read', 'Read', { file_path: path.join(dir, '.env') })).toBe(false);
    expect(verdict('read', 'Read', { file_path: path.join(os.homedir(), '.ssh', 'id_rsa') })).toBe(false);
    expect(verdict('read', 'Bash', { command: 'ls' })).toBe(false);
    expect(verdict('read', 'Write', { file_path: path.join(dir, 'b.ts'), content: 'x' })).toBe(false);
    expect(verdict('read', 'Edit', { file_path: path.join(dir, 'a.ts'), old_string: '1', new_string: '2' })).toBe(false);
  });

  it('run: also checks with Bash, never a command that changes files, never Edit or Write', () => {
    expect(delegateTools('run')).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
    for (const ok of ['npx vitest run tests/a.test.ts', 'npm run typecheck 2>&1 | tail -40', 'git status', 'git diff --stat', 'tsc --noEmit > /dev/null']) expect(verdict('run', 'Bash', { command: ok }), ok).toBe(true);
    for (const no of ['rm -rf src', 'echo x > a.ts', 'git commit -am x', 'git push', 'npm install left-pad', "sed -i 's/1/2/' a.ts", 'cat .env', 'mv a.ts b.ts']) expect(verdict('run', 'Bash', { command: no }), no).toBe(false);
    expect(verdict('run', 'Write', { file_path: path.join(dir, 'b.ts'), content: 'x' })).toBe(false);
    expect(changesFiles('git log --oneline -5')).toBe(false);
  });

  it('edit: only when the block says so, inside the folder; never above the lead’s place (a main folder only reads)', () => {
    expect(delegateTools('edit')).toContain('Write');
    expect(verdict('edit', 'Write', { file_path: path.join(dir, 'b.ts'), content: 'x' })).toBe(true);
    expect(verdict('edit', 'Write', { file_path: path.join(dir, '.env'), content: 'x' })).toBe(false);
    expect(verdict('edit', 'Write', { file_path: path.join(dir, 'b.ts'), content: 'x' }, true)).toBe(false);
    expect(verdict('run', 'Bash', { command: 'npx vitest run' }, true)).toBe(false);
  });

  it('read-only enforced end to end: the call gets the read gate whatever the executor tries', async () => {
    const tried: Array<[string, boolean]> = [];
    const sneaky: Complete = async (req) => {
      for (const [tool, input] of [
        ['Write', { file_path: path.join(dir, 'x.ts'), content: 'x' }],
        ['Bash', { command: 'touch x' }],
        ['Read', { file_path: path.join(dir, 'a.ts') }],
      ] as const)
        tried.push([tool, req.vetTool!(tool, input as Record<string, unknown>).allow]);
      return 'done';
    };
    await delegate(deps(world(claude, codexReady), { codex: sneaky }), { executor: explore, task: 'look', place });
    expect(tried).toEqual([
      ['Write', false],
      ['Bash', false],
      ['Read', true],
    ]);
  });
});

describe('orchestrator mode with executors on other models', () => {
  const st = (orchestrator: object) => ({ runtimes: [claude, codexReady], prefs: { combos: COMBOS, orchestrator } }) as never;

  it('makes an executor whose combo runs on Codex a delegate (not an SDK sub-agent), and tells the lead how to use it', () => {
    const o = resolveOrchestrator(st({ on: true, executors: { explore: { combo: 'claude-haiku', can: 'read' }, codex: { combo: 'codex-first', can: 'run' } } }), world(claude, codexReady));
    const run = runOrchestrator(o)!;
    expect(run.executors.map((e) => e.name)).toEqual(['explore']);
    expect(run.delegates).toEqual([{ name: 'codex', can: 'run', combo: 'codex-first', runtime: 'codex', label: 'Codex' }]);
    expect(Object.keys(orchestratorAgents(run) ?? {})).toEqual(['explore']);
    const append = buildOrchestratorAppend(run);
    expect(append).toMatch(/`codex` \(Codex, reads and runs checks\)/);
    expect(append).toMatch(/mcp__beluga_mac__delegate/);
  });

  it('with only a delegate, delegating always names it and the delegate tool', () => {
    const o = resolveOrchestrator(st({ on: true, delegate: 'always', executors: { codex: { combo: 'codex-first', can: 'run' } } }), world(claude, codexReady));
    const run = runOrchestrator(o)!;
    expect(run.executors).toEqual([]);
    expect(delegateRefusal(run, 'Bash', { command: 'npm test' })).toMatch(/`codex` with mcp__beluga_mac__delegate/);
  });

  it('mounts the delegate tool on beluga_mac, and policy lets it run', async () => {
    const tools: DelegateTools = { executors: [{ name: 'codex', can: 'read', combo: 'codex-first', runtime: 'codex', label: 'Codex' }], delegate: async (a) => `asked ${a.executor}: ${a.task}` };
    const suites = runToolSuites({ delegateTools: tools } as unknown as AgentRunInput, {} as never, new ViewShelf(), dir);
    const suite = suites.beluga_mac!;
    expect(suite.tools.map((t) => t.name)).toEqual(['delegate']);
    const out = await suite.tools[0]!.handler({ executor: 'codex', task: 'look' }, undefined);
    expect(out.content).toEqual([{ type: 'text', text: 'asked codex: look' }]);
    expect(runToolSuites({} as unknown as AgentRunInput, {} as never, new ViewShelf(), dir).beluga_mac).toBeUndefined();
    expect(decideTool('mcp__beluga_mac__delegate', {}, { cwd: dir, roots: [dir], autoEdit: false })).toBe('allow');
  });
});

describe('the sub-agent row (core/store.ts)', () => {
  it('a delegation’s row ends with the title of the target that answered', () => {
    const store = new Store(initialState('room', 'auto'));
    const ev = (event: string, text: string) => store.dispatch({ type: 'agent_event', owner: 'me', requestId: 'r1', requester: 'me', event, text, ts: 1, channel: 'ws:w1' } as never);
    ev('progress', 'working');
    ev('sub', JSON.stringify({ id: 'd1', phase: 'start', kind: 'agent', title: 'delegate · Codex · explore', runtime: 'codex' }));
    ev('sub', JSON.stringify({ id: 'd1', phase: 'done', title: 'delegate · Claude · Haiku · explore', step: 'Claude · Haiku answered' }));
    const card = store.getState().log.find((l) => l.type === 'agent' && l.requestId === 'r1') as { subagents: Array<{ title: string; status: string; steps: string[] }> } | undefined;
    expect(card?.subagents[0]).toMatchObject({ title: 'delegate · Claude · Haiku · explore', status: 'done', steps: ['Claude · Haiku answered'] });
  });
});

describe('a delegation in a run (core/agent-host.ts)', () => {
  const ME = 'me';
  function setup(completes: Record<string, Complete>) {
    const store = new Store(initialState('room', 'auto'));
    store.dispatch({ type: 'runtimes', runtimes: [claude, codexReady] } as never);
    store.dispatch({ type: 'prefs', prefs: { combos: COMBOS, orchestrator: { on: true, executors: { codex: { combo: 'codex-first', can: 'read' } } } } } as never);
    const runs: AgentRunInput[] = [];
    const sent: Array<{ kind: string; event?: string; text?: string }> = [];
    const agent: AgentBackend = {
      async run(input: AgentRunInput) {
        runs.push(input);
        return 'answered';
      },
    };
    const place = () => ({ cwd: dir, additionalDirectories: [], autoEdit: true, onSession: () => undefined });
    const host = new AgentHost({
      store,
      selfId: () => ME,
      send: (body) => (sent.push(body as never), true),
      agent: () => agent,
      shares: {} as never,
      sharing: { recipients: () => [], sharedFor: () => undefined, canPost: () => true } as never,
      people: {} as never,
      questions: { track: () => undefined, ask: async () => ({ kind: 'skip' }), cancelAll: () => undefined, cancelChannel: () => undefined } as never,
      toast: () => undefined,
      system: () => undefined,
      approvalTimeoutMs: () => 60_000,
      refreshUsage: async () => undefined,
      workspaces: { place, refreshWorkspace: async () => undefined, manager: { list: [] } } as never,
      completeFor: (r) => completes[r],
    });
    return { host, runs, store, sent };
  }

  it('your own run gets the tool; a call shows as "delegate · Codex · codex", answers, and counts as the executors’ tokens', async () => {
    const asked: CompletionRequest[] = [];
    const t = setup({ codex: fake('a.ts:1', asked) });
    await t.host.onAgentRequest(ME, { kind: 'agent_request', requestId: 'r1', prompt: 'find a', viaAgent: false, channel: 'ws:w1', urgent: false, plan: false });
    await waitFor(() => t.runs.length === 1);
    const tools = t.runs[0]!.delegateTools!;
    expect(tools.executors.map((e) => e.name)).toEqual(['codex']);
    expect(t.runs[0]!.orchestrator?.delegates?.[0]?.label).toBe('Codex');
    const text = await tools.delegate({ executor: 'codex', task: 'Where is a?' });
    expect(text).toMatch(/codex answered on Codex\.\n\na\.ts:1/);
    expect(asked[0]!.tools).toEqual(['Read', 'Grep', 'Glob']);
    const events = (kind: string) => t.sent.filter((b) => b.kind === 'agent_event' && b.event === kind).map((b) => JSON.parse(b.text!) as Record<string, unknown>);
    expect(events('sub')[0]).toMatchObject({ phase: 'start', kind: 'agent', title: 'delegate · Codex · codex', runtime: 'codex' });
    expect(events('sub').at(-1)).toMatchObject({ phase: 'done', title: 'delegate · Codex · codex', step: 'Codex answered' });
    // Its tokens: one report, added as it is, all of it the executors'.
    expect(events('usage')).toEqual([{ input: 1200, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, delegated: true, executorTokens: 1200 }]);
    expect(await tools.delegate({ executor: 'nobody', task: 'x' })).toMatch(/No executor named nobody/);
  });

  it('a friend’s run never gets it', async () => {
    const t = setup({ codex: fake('x') });
    await t.host.onAgentRequest('pal', { kind: 'agent_request', requestId: 'f1', prompt: 'look', viaAgent: false, channel: 'room', urgent: false, plan: false });
    await waitFor(() => t.runs.length === 1).catch(() => undefined);
    for (const r of t.runs) {
      expect(r.delegateTools).toBeUndefined();
      expect(r.orchestrator).toBeUndefined();
    }
  });
});
