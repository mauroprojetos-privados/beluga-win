import { describe, expect, it, vi } from 'vitest';
import type { AgentRunInput, RoomBridge, RunOrchestrator } from '../src/agent/types.js';

/**
 * Usage's executor tokens (roadmap/modo-orquestrador.md, phase 5): only what the sub-agents the lead
 * started spent, never Claude Code's own side calls (a title on Haiku) that modelUsage lists by model.
 */
const script: { messages: unknown[] } = { messages: [] };

vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  query: ({ prompt }: { prompt: AsyncIterable<unknown> }) =>
    Object.assign(
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's1' };
        for await (const _ of prompt) {
          yield* script.messages;
          break;
        }
      })(),
      { interrupt: async () => undefined, setModel: async () => undefined },
    ),
}));

const { createClaudeBackend } = await import('../src/agent/runner.js');

const bridge = { selfName: () => 'kay', reportUsage: () => undefined } as unknown as RoomBridge;
const ORCHESTRATOR: RunOrchestrator = { delegate: 'suggest', executors: [{ name: 'explore', can: 'read', model: 'haiku' }] };

const model = (input: number, output: number, write = 0) => ({ inputTokens: input, outputTokens: output, cacheReadInputTokens: 30_000, cacheCreationInputTokens: write, contextWindow: 200_000 });
const result = (modelUsage: Record<string, unknown>) => ({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', modelUsage, total_cost_usd: 0.01 });

/** The usage events a run sent. */
async function usageOf(messages: unknown[]): Promise<Array<Record<string, unknown>>> {
  script.messages = messages;
  const events: Array<Record<string, unknown>> = [];
  await createClaudeBackend({ cwd: '/tmp', autoEdit: false, additionalDirectories: [], bridge }).run({
    prompt: 'oi, responda só: ok',
    requesterName: 'kay',
    viaAgent: false,
    context: [],
    scope: 'full',
    model: 'sonnet',
    orchestrator: ORCHESTRATOR,
    signal: new AbortController().signal,
    onEvent: (kind: string, text: string) => {
      if (kind === 'usage') events.push(JSON.parse(text) as Record<string, unknown>);
    },
    onFileTouched: () => undefined,
    canUseTool: async () => true,
  } as AgentRunInput);
  return events;
}

describe('executor tokens', () => {
  it('are none when no sub-agent ran, even with Claude Code’s side call on Haiku in modelUsage', async () => {
    // Measured live: {"tokens":1261,…,"executorTokens":1255} for a plain "ok".
    const [usage] = await usageOf([
      { type: 'assistant', parent_tool_use_id: null, message: { id: 'lead1', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 30_000 } } },
      result({ 'claude-sonnet-4-5': model(4, 2), 'claude-haiku-4-5-20251001': model(1200, 55) }),
    ]);
    expect(usage).toMatchObject({ input: 1204, output: 57 });
    expect(usage!.executorTokens).toBeUndefined();
  });

  it('are what an explore sub-agent spent, on its model', async () => {
    const [usage] = await usageOf([
      { type: 'assistant', parent_tool_use_id: null, message: { id: 'lead1', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: 'call1', name: 'Agent', input: { subagent_type: 'Explore', description: 'find the thing', prompt: 'where is useThing used' } }], usage: { input_tokens: 10, output_tokens: 20 } } },
      { type: 'assistant', parent_tool_use_id: 'call1', message: { id: 'sub1', model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'useThing' } }], usage: { input_tokens: 900, output_tokens: 40, cache_creation_input_tokens: 60, cache_read_input_tokens: 5000 } } },
      { type: 'assistant', parent_tool_use_id: 'call1', message: { id: 'sub2', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'src/a.ts:3' }], usage: { input_tokens: 300, output_tokens: 100 } } },
      { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: 'src/a.ts:3' }] } },
      { type: 'assistant', parent_tool_use_id: null, message: { id: 'lead2', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'It is in src/a.ts.' }], usage: { input_tokens: 5, output_tokens: 8 } } },
      // A side call on Haiku as well: modelUsage's Haiku row is bigger than the sub-agent's share.
      result({ 'claude-sonnet-4-5': model(15, 28), 'claude-haiku-4-5-20251001': model(2400, 195, 60) }),
    ]);
    expect(usage).toMatchObject({ executorTokens: 1400, executorModel: 'claude-haiku-4-5-20251001' });
  });
});
