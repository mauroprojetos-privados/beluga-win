import { z } from 'zod';
import { tool } from './tool-kit.js';
import type { DelegateTools } from './types.js';

/**
 * Orchestrator mode, phase 3: `mcp__beluga_mac__delegate`. The lead hands a task to one of its
 * executors on another model (Codex, a local endpoint, OpenCode), waits for it, and reads back a
 * short summary in the same turn (core/routing/delegate.ts runs it). Only your own runs with such an
 * executor have it (core/agent-host.ts); never a friend's or an external agent's below full.
 */

const does = (can: string): string => (can === 'read' ? 'reads' : can === 'run' ? 'reads and runs checks' : 'reads, runs and edits');

export function delegateToolDef(d: DelegateTools) {
  const names = d.executors.map((e) => e.name);
  const list = d.executors.map((e) => `${e.name} (${e.label}: ${does(e.can)}${e.description ? `; ${e.description}` : ''})`).join('; ');
  return tool(
    'delegate',
    `Hand one bounded piece of legwork to an executor on another model and wait for its short summary: ${list}. ` +
      'It works in this folder and sees only your task, so write it in full: the goal, the files or areas, and the shape of the answer you want (file:line). ' +
      'It never edits unless it is an editing executor. One process per call, closed when it answers, with a time and token limit; if its first target can’t run, the next one in its combo answers and the reply says which.',
    {
      executor: z.string().min(1).max(32).describe(`Which executor: ${names.join(', ')}`),
      task: z.string().min(1).max(16_000).describe('The whole task, self-contained: it sees nothing else'),
      paths: z.array(z.string().min(1).max(400)).max(20).optional().describe('Files or folders to start from'),
    },
    async (a) => {
      try {
        const text = await d.delegate({ executor: a.executor, task: a.task, ...(a.paths?.length ? { paths: a.paths } : {}) });
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );
}
