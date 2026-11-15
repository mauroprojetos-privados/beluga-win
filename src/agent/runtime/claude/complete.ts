import { query } from '@anthropic-ai/claude-agent-sdk';
import { CompletionError, type CompletionRequest } from '../types.js';
import { PromptQueue } from './live-run.js';
import { sdkServers } from './sdk-mount.js';
import { claudeExecutable } from '../../claude-code.js';

/**
 * A side call on Claude Code (agent/side-calls.ts): one model turn or a few, no saved session, no
 * settings files (a friend with :rw access could plant hooks there), only the tools it's given.
 */
export async function claudeComplete(req: CompletionRequest, claudePath?: string): Promise<string> {
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  if (req.signal?.aborted) stop();
  req.signal?.addEventListener('abort', stop, { once: true });
  // Pictures go in as content blocks, which needs the prompt streamed in (so do in-process tools).
  let prompt: string | PromptQueue = req.prompt;
  if (req.images) {
    prompt = new PromptQueue();
    prompt.push(req.images.length ? [...req.images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mime as 'image/png', data: img.data } })), { type: 'text' as const, text: req.prompt }] : req.prompt);
    prompt.close();
  }
  const vet = req.vetTool;
  try {
    const q = query({
      prompt,
      options: {
        cwd: req.cwd,
        ...(req.model ? { model: req.model } : {}),
        tools: [...(req.tools ?? [])],
        ...(req.suites ? { mcpServers: sdkServers(req.suites), strictMcpConfig: true } : {}),
        ...(req.allowedTools ? { allowedTools: [...req.allowedTools] } : {}),
        maxTurns: req.maxTurns ?? 1,
        settingSources: [],
        persistSession: false,
        abortController,
        systemPrompt: req.system,
        ...(vet
          ? {
              hooks: {
                PreToolUse: [
                  {
                    hooks: [
                      async (h) => {
                        if (h.hook_event_name !== 'PreToolUse') return {};
                        const { allow, reason } = vet(h.tool_name, (h.tool_input ?? {}) as Record<string, unknown>);
                        return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: allow ? ('allow' as const) : ('deny' as const), permissionDecisionReason: reason } };
                      },
                    ],
                  },
                ],
              },
            }
          : {}),
        ...claudeExecutable(claudePath),
        // A local endpoint's variables (agent/runtime/local.ts): this call goes there, never to Anthropic.
        ...(req.env ? { env: { ...process.env, ...req.env } } : {}),
      },
    });
    // The tokens spent so far, once per model message (its content blocks come as several messages).
    const spent = new Map<string, number>();
    for await (const msg of q) {
      if (req.onTokens && msg.type === 'assistant') {
        const u = msg.message.usage as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null } | undefined;
        const id = msg.message.id ?? msg.uuid;
        if (u) {
          spent.set(id, (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
          req.onTokens([...spent.values()].reduce((a, b) => a + b, 0));
        }
      }
      if (msg.type !== 'result') continue;
      if (req.onTokens) {
        const all = Object.values(msg.modelUsage ?? {}).reduce((a, m) => a + m.inputTokens + m.outputTokens + m.cacheCreationInputTokens, 0);
        if (all) req.onTokens(all);
      }
      if (msg.subtype === 'success') return msg.result;
      throw new CompletionError(msg.subtype === 'error_max_turns' ? 'max_turns' : 'failed', 'errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('\n').slice(0, 2000) : undefined);
    }
    throw new CompletionError('no_answer');
  } finally {
    req.signal?.removeEventListener('abort', stop);
  }
}
