import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Combo, RouteWorld } from '../src/core/routing/model.js';
import { mergeOrchestrator, orchestratorUsage, orchestratorWords, resolveOrchestrator, type OrchestratorState } from '../src/core/routing/orchestrator.js';
import { botAgentNames, orchestratorAt, runOrchestrator } from '../src/core/routing/orchestrator-run.js';
import { buildOrchestratorAppend, delegateRefusal, executorTools, orchestratorAgents, orchestratorEnv } from '../src/agent/orchestrator-agents.js';
import { parseBotFile } from '../src/core/bots/schema.js';
import { ProjectFile } from '../src/workspaces/scripts.js';
import { SubAgentTracker } from '../src/agent/runtime/claude/subagents.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';

const claude = { id: 'claude', label: 'Claude', available: true, state: 'ready', models: [] } as unknown as RuntimeChoice;
const world: RouteWorld = { runtimes: [claude], limits: new Map() };
/** The user's own combos (roadmap §1: explore, quick and docs on claude-haiku, ultrabrain on claude-opus). */
const COMBOS: Combo[] = [
  { id: 'claude-haiku', name: 'Claude Haiku', targets: [{ runtime: 'claude', model: 'haiku' }] },
  { id: 'claude-opus', name: 'Claude Opus', targets: [{ runtime: 'claude', model: 'opus' }] },
  { id: 'codex-only', name: 'Codex', targets: [{ runtime: 'codex' }] },
];
const state = (orchestrator?: OrchestratorState['prefs']['orchestrator']): OrchestratorState => ({
  runtimes: [claude],
  prefs: { combos: COMBOS, categoryCombos: { explore: { combo: 'claude-haiku' }, docs: { combo: 'claude-haiku' } }, ...(orchestrator ? { orchestrator } : {}) },
});

describe('resolveOrchestrator (core/routing/orchestrator.ts)', () => {
  it('is off, with no executors, until a place turns it on', () => {
    const o = resolveOrchestrator(state(), world);
    expect(o.on).toBe(false);
    expect(o.executors).toEqual([]);
  });

  it('gives explore, test and docs on Haiku by default: an executor without a combo takes its kind of work’s, else Claude · Haiku', () => {
    const o = resolveOrchestrator(state({ on: true, lead: 'claude-opus' }), world);
    expect(o.on).toBe(true);
    expect(o.executors.map((e) => [e.name, e.can, e.runtime, e.model, e.combo])).toEqual([
      ['explore', 'read', 'claude', 'haiku', 'claude-haiku'],
      ['test', 'run', 'claude', 'haiku', undefined],
      ['docs', 'read', 'claude', 'haiku', 'claude-haiku'],
    ]);
    expect(o.lead).toMatchObject({ combo: 'claude-opus', model: 'opus', label: 'Claude · Opus' });
    expect(orchestratorWords(o)).toBe('Claude · Opus leads · 3 executors');
  });

  it('says why an executor whose combo can’t run is left out, never running it on the lead', () => {
    const o = resolveOrchestrator(state({ on: true, executors: { explore: { combo: 'codex-only' } } }), world);
    expect(o.executors).toHaveLength(1);
    expect(o.executors[0]!.why).toMatch(/Codex/);
    expect(runOrchestrator(o)).toBeUndefined();
  });

  it('lets the most specific place win, field by field: Settings → project → bot → conversation', () => {
    const settings = { on: true, delegate: 'suggest' as const, executors: { explore: { can: 'read' as const }, test: { can: 'run' as const } } };
    expect(resolveOrchestrator(state(settings), world, { project: { on: false } }).on).toBe(false);
    expect(resolveOrchestrator(state(settings), world, { project: { on: false }, conversation: { on: true } }).on).toBe(true);
    const merged = mergeOrchestrator({ settings, project: { delegate: 'always' }, bot: { executors: { test: null, docs: { can: 'read' } } } });
    expect(merged.delegate).toBe('always');
    expect(Object.keys(merged.executors ?? {})).toEqual(['explore', 'test', 'docs']);
    expect(merged.executors?.test).toBeNull();
    const o = resolveOrchestrator(state(settings), world, { bot: { executors: { test: null, docs: { can: 'read' } } } });
    expect(o.executors.map((e) => e.name)).toEqual(['explore', 'docs']);
  });
});

describe('the orchestrator block in beluga.json and bot.json', () => {
  it('reads it in a project file, and a block that doesn’t fit is left out alone', () => {
    expect(ProjectFile.parse({ orchestrator: { on: true, delegate: 'always' } }).orchestrator).toEqual({ on: true, delegate: 'always' });
    const bad = ProjectFile.parse({ scripts: { setup: 'npm i' }, orchestrator: { on: 'yes' } });
    expect(bad.orchestrator).toBeUndefined();
    expect(bad.scripts.setup).toBe('npm i');
  });

  it('reads it in a bot file', () => {
    const { bot, problems } = parseBotFile(JSON.stringify({ version: 1, orchestrator: { on: true, executors: { explore: { combo: 'claude-haiku', can: 'read' } } } }));
    expect(problems).toEqual([]);
    expect(bot.orchestrator?.executors?.explore).toEqual({ combo: 'claude-haiku', can: 'read' });
  });

  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('a bot’s own .claude/agents/<name>.md wins over an executor of that name', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'orch-bot-'));
    writeFileSync(path.join(dir, 'bot.json'), JSON.stringify({ version: 1, orchestrator: { on: true } }));
    mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
    writeFileSync(path.join(dir, '.claude', 'agents', 'explore.md'), '---\nname: explore\nmodel: sonnet\n---\nMine.');
    const taken = botAgentNames(dir);
    expect([...taken]).toEqual(['explore']);
    const o = orchestratorAt(state(), world, { cwd: dir });
    expect(o.on).toBe(true);
    expect(runOrchestrator(o, taken)?.executors.map((e) => e.name)).toEqual(['test', 'docs']);
  });
});

describe('the executors as the SDK’s agents (agent/orchestrator-agents.ts)', () => {
  const run = { delegate: 'suggest' as const, executors: [{ name: 'explore', can: 'read' as const, model: 'haiku' }, { name: 'test', can: 'run' as const, model: 'haiku' }] };

  it('gives each executor its model, a short prompt and the tools its `can` allows', () => {
    const agents = orchestratorAgents(run)!;
    expect(agents.explore!.model).toBe('haiku');
    expect(agents.explore!.tools).toEqual(expect.arrayContaining(['Glob', 'Grep', 'Read']));
    expect(agents.explore!.tools).not.toContain('Bash');
    expect(agents.test!.tools).toContain('Bash');
    for (const a of Object.values(agents)) {
      expect(a.tools).not.toContain('Edit');
      expect(a.tools).not.toContain('Write');
      expect(a.prompt.length).toBeLessThan(800);
      expect(a.maxTurns).toBeGreaterThan(0);
    }
    expect(executorTools('edit')).toEqual(expect.arrayContaining(['Edit', 'Write']));
  });

  it('sets CLAUDE_CODE_SUBAGENT_MODEL to the explore executor’s model, and nothing when off', () => {
    expect(orchestratorEnv(run)).toEqual({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' });
    expect(orchestratorEnv(undefined)).toEqual({});
    expect(orchestratorAgents(undefined)).toBeUndefined();
  });

  it('tells the lead it orchestrates, naming its executors', () => {
    const text = buildOrchestratorAppend(run);
    expect(text).toMatch(/orchestrator/);
    expect(text).toContain('`explore`');
    expect(text).toMatch(/every edit/);
    expect(text).toMatch(/does not see this conversation/);
    expect(text).toMatch(/critical lines/);
    expect(text).toMatch(/parallel/);
    expect(buildOrchestratorAppend(undefined)).toBe('');
  });

  it('with delegate "always", refuses the lead a broad search or a test run and names the executor', () => {
    const always = { ...run, delegate: 'always' as const };
    expect(delegateRefusal(always, 'Grep', { pattern: 'useThing' })).toMatch(/`explore`/);
    expect(delegateRefusal(always, 'Glob', { pattern: '**/*.ts' })).toMatch(/`explore`/);
    expect(delegateRefusal(always, 'Bash', { command: 'npx vitest run tests/foo.test.ts' })).toMatch(/`test`/);
    expect(delegateRefusal(always, 'Bash', { command: 'npm run typecheck' })).toMatch(/`test`/);
    // Narrow: one folder, one file, a plain command.
    expect(delegateRefusal(always, 'Grep', { pattern: 'x', path: 'src/core' })).toBeUndefined();
    expect(delegateRefusal(always, 'Glob', { pattern: 'src/*.ts' })).toBeUndefined();
    expect(delegateRefusal(always, 'Bash', { command: 'git status' })).toBeUndefined();
    // Suggest: nothing is refused.
    expect(delegateRefusal(run, 'Grep', { pattern: 'useThing' })).toBeUndefined();
  });
});

describe('Usage, lead and executors apart', () => {
  const usage = (input: number, output = 0, write = 0) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: 9999 });
  const launch = (id: string, input: Record<string, unknown> = {}) => [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'explore', prompt: 'find it', ...input } }];

  it('counts what the sub-agents the lead started spent, once per response, and nothing else', () => {
    const t = new SubAgentTracker('/tmp', { delegate: 'suggest', executors: [{ name: 'explore', can: 'read', model: 'haiku' }] });
    // Not a sub-agent's (no launch): Claude Code's own side call, or a stray id.
    t.spent('nobody', { id: 'm0', model: 'claude-haiku-4-5', usage: usage(500) });
    expect(t.takeSpend()).toEqual({ tokens: 0 });
    t.assistant(null, launch('call1'));
    // One response streamed in two pieces, each with its usage so far (cache reads never count).
    t.spent('call1', { id: 'm1', model: 'claude-haiku-4-5', usage: usage(100, 5) });
    t.spent('call1', { id: 'm1', model: 'claude-haiku-4-5', usage: usage(100, 20, 30) });
    t.spent('call1', { id: 'm2', model: 'claude-haiku-4-5', usage: usage(40) });
    expect(t.takeSpend()).toEqual({ tokens: 190, model: 'claude-haiku-4-5' });
    // Taken: the next turn starts from nothing.
    expect(t.takeSpend()).toEqual({ tokens: 0 });
  });

  it('counts a sub-agent’s own sub-agents, and a background one by its final report when its messages never came', () => {
    const t = new SubAgentTracker('/tmp');
    t.assistant(null, launch('call1'));
    t.assistant('call1', [{ type: 'tool_use', id: 'nested', name: 'Task', input: { prompt: 'deeper' } }]);
    t.spent('nested', { id: 'n1', model: 'claude-haiku-4-5', usage: usage(70) });
    expect(t.takeSpend().tokens).toBe(70);
    t.assistant(null, launch('bg', { run_in_background: true, model: 'haiku' }));
    t.task({ subtype: 'task_started', task_id: 'task1', tool_use_id: 'bg' });
    t.task({ subtype: 'task_notification', task_id: 'task1', tool_use_id: 'bg', status: 'completed', usage: { total_tokens: 800 } });
    expect(t.takeSpend()).toEqual({ tokens: 800, model: 'haiku' });
  });

  it('splits your runs’ tokens between the lead and its executors', () => {
    const log = [
      { type: 'agent', owner: 'me', ts: 1, usage: { tokens: 1000, executorTokens: 300 } },
      { type: 'agent', owner: 'me', ts: 2, usage: { tokens: 500 } },
      { type: 'agent', owner: 'friend', ts: 3, usage: { tokens: 999, executorTokens: 999 } },
    ];
    expect(orchestratorUsage(log, 'me')).toEqual({ lead: 1200, executors: 300 });
  });
});
