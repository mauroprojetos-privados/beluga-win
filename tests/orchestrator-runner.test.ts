import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunInput, RoomBridge, RunOrchestrator } from '../src/agent/types.js';

/** The options a Claude run hands the SDK (roadmap/modo-orquestrador.md, phase 2). */
const seen: { options?: Options } = {};

vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Options }) =>
    Object.assign(
      (async function* () {
        seen.options = options;
        yield { type: 'system', subtype: 'init', session_id: 's1' };
        for await (const _ of prompt) {
          yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', modelUsage: {}, total_cost_usd: 0 };
          break;
        }
      })(),
      { interrupt: async () => undefined, setModel: async () => undefined },
    ),
}));

const { createClaudeBackend } = await import('../src/agent/runner.js');

const bridge = { selfName: () => 'kay', reportUsage: () => undefined } as unknown as RoomBridge;

const input = (over: Partial<AgentRunInput> = {}): AgentRunInput => ({
  prompt: 'find where the thing is used',
  requesterName: 'kay',
  viaAgent: false,
  context: [],
  scope: 'full',
  model: 'opus',
  signal: new AbortController().signal,
  onEvent: () => undefined,
  onFileTouched: () => undefined,
  canUseTool: async () => true,
  ...over,
});

async function optionsFor(over: Partial<AgentRunInput> = {}): Promise<Options> {
  seen.options = undefined;
  await createClaudeBackend({ cwd: '/tmp', autoEdit: false, additionalDirectories: [], bridge }).run(input(over));
  return seen.options!;
}

/** The options as data: functions and live objects (the abort controller, Beluga's in-process MCP servers) named, not compared by identity. */
function plain(o: Options): Record<string, unknown> {
  const named = (k: string, v: unknown): unknown => {
    if (typeof v === 'function') return `[fn ${k}]`;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) return '[object]';
    // Where Claude Code is installed is this computer's, not the run's.
    if (k === 'pathToClaudeCodeExecutable') return undefined;
    return v;
  };
  return JSON.parse(JSON.stringify(o, named)) as Record<string, unknown>;
}

const ORCHESTRATOR: RunOrchestrator = {
  delegate: 'suggest',
  executors: [
    { name: 'explore', can: 'read', model: 'haiku' },
    { name: 'test', can: 'run', model: 'haiku' },
    { name: 'docs', can: 'read', model: 'haiku' },
  ],
};

describe('a Claude run in orchestrator mode', () => {
  it('passes agents.explore on Haiku and CLAUDE_CODE_SUBAGENT_MODEL', async () => {
    const o = await optionsFor({ orchestrator: ORCHESTRATOR });
    expect(o.agents?.explore?.model).toBe('haiku');
    expect(o.agents?.test?.tools).toContain('Bash');
    expect(o.agents?.explore?.tools).not.toContain('Edit');
    expect(o.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku');
    // The lead keeps its own model.
    expect(o.model).toBe('opus');
    expect((o.systemPrompt as { append: string }).append).toMatch(/You are the orchestrator of this conversation/);
  });

  it('changes nothing in the SDK options when the mode is off', async () => {
    const off = plain(await optionsFor());
    expect(off).not.toHaveProperty('agents');
    expect(off).not.toHaveProperty('env');
    expect((off.systemPrompt as { append: string }).append).not.toMatch(/orchestrator/);
    // The brief itself is other code's (and checked below): the snapshot keeps the options around it.
    expect({ ...off, systemPrompt: { ...(off.systemPrompt as object), append: '[the run’s instructions]' } }).toMatchSnapshot();
    // On, only agents, env and the brief's paragraph differ.
    const { agents: _a, env: _e, systemPrompt: onPrompt, ...on } = plain(await optionsFor({ orchestrator: ORCHESTRATOR }));
    const { systemPrompt: offPrompt, ...rest } = off;
    expect(on).toEqual(rest);
    expect((onPrompt as { append: string }).append.startsWith((offPrompt as { append: string }).append)).toBe(true);
  });

  it('with delegate "always", the lead’s broad Grep is refused and a sub-agent’s is not', async () => {
    const o = await optionsFor({ orchestrator: { ...ORCHESTRATOR, delegate: 'always' } });
    const hook = o.hooks!.PreToolUse![0]!.hooks[0]! as HookCallback;
    const call = (agentId?: string) => hook({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'useThing' }, tool_use_id: 'tu1', session_id: 's1', transcript_path: '', cwd: '/tmp', ...(agentId ? { agent_id: agentId } : {}) } as never, 'tu1', { signal: new AbortController().signal });
    const lead = (await call()) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(lead.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(lead.hookSpecificOutput?.permissionDecisionReason).toMatch(/`explore`/);
    const sub = (await call('agent-1')) as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(sub.hookSpecificOutput?.permissionDecision).not.toBe('deny');
  });
});
