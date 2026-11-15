import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { AGENT_SCRATCH_MARK, buildAgentScratchNote, summarizeTool } from '../../prompt.js';
import { agentScratchName } from '../../../shared/scratch-dir.js';
import type { RunOrchestrator, SubAgentEvent } from '../../types.js';
import { modelName } from '../../../shared/agent-label.js';

/** Tools that launch a sub-agent in Claude Code. */
export const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

/**
 * A sub-agent launch with its own scratch folder in the prompt (`<scratch>/agents/<name>/`, made
 * here), so what it makes lands where its page shows it. Undefined: not a launch, no prompt, or
 * it already has one.
 */
export function withAgentScratch(toolName: string, input: Readonly<Record<string, unknown>>, toolUseId: string, scratch: string): Record<string, unknown> | undefined {
  const prompt = input.prompt;
  if (!SUBAGENT_TOOLS.has(toolName) || typeof prompt !== 'string' || !prompt.trim() || prompt.includes(AGENT_SCRATCH_MARK)) return undefined;
  const dir = path.join(scratch, 'agents', agentScratchName(toolUseId));
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // It can make the folder itself.
  }
  return { ...input, prompt: `${prompt}${buildAgentScratchNote(dir)}` };
}

interface Block {
  readonly type: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
}

/** A sub-agent's API response as the SDK streams it (Messages API names): its id, model and token counts. */
export interface SubAgentMessage {
  readonly id?: string;
  readonly model?: string;
  readonly usage?: { readonly input_tokens?: number | null; readonly output_tokens?: number | null; readonly cache_creation_input_tokens?: number | null } | null;
}

/** What the sub-agents spent since the last look: tokens (input, output, cache writes) and the model most of them ran on. */
export interface SubAgentSpend {
  readonly tokens: number;
  readonly model?: string;
}

/**
 * Follows sub-agents through the SDK message stream: a top-level Task/Agent tool
 * call starts one, messages tagged with its id are its steps, and the matching
 * tool_result ends it. One started in the background answers its call right away
 * ("launched"): it ends when Claude Code reports its task finished.
 */
export class SubAgentTracker {
  private readonly open = new Set<string>();
  private readonly tasks = new Set<string>();
  /** Sub-agents launched in the background (by their call), and their tasks → that call. */
  private readonly background = new Set<string>();
  private readonly taskCall = new Map<string, string>();

  /** Orchestrator mode's executors by name: their sub-agents start with the model they run on. */
  private readonly executors: ReadonlyMap<string, string | undefined>;

  /**
   * What the sub-agents spend (Usage's executor tokens): every call the lead started, and the ones
   * they started in turn, each → the lead's call it belongs to and the model it was started on.
   * Only these count: Claude Code's own side calls (titles, summaries) never come as sub-agent
   * messages, so they stay the lead's even on the executors' model.
   */
  private readonly spenders = new Map<string, { readonly root: string; readonly model?: string }>();
  /** Tokens counted so far per API message (it streams in pieces, each with its usage so far). */
  private readonly perMessage = new Map<string, number>();
  /** Lead's calls whose tokens came in their own messages: a background one's final report adds nothing then. */
  private readonly streamed = new Set<string>();
  /** Not taken yet, by model ('' unknown). */
  private pending = new Map<string, number>();

  constructor(
    private readonly cwd?: string,
    orchestrator?: RunOrchestrator,
  ) {
    this.executors = new Map((orchestrator?.executors ?? []).map((e) => [e.name, e.model]));
  }

  /** Returns true if the tool_use is a sub-agent launch (so callers can skip it as a normal step). */
  isLaunch(block: Block): boolean {
    return block.type === 'tool_use' && SUBAGENT_TOOLS.has(block.name ?? '');
  }

  assistant(parentToolUseId: string | null, blocks: readonly Block[]): SubAgentEvent[] {
    const events: SubAgentEvent[] = [];
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      if (parentToolUseId === null && this.isLaunch(block) && block.id) {
        this.open.add(block.id);
        if (input.run_in_background === true) this.background.add(block.id);
        const type = typeof input.subagent_type === 'string' ? input.subagent_type : undefined;
        // One of the run's executors: "explore · Haiku · <what it was asked>".
        const model = type && this.executors.has(type) ? this.executors.get(type) : undefined;
        const title = [type, model ? modelName(model) : undefined, input.description].filter((v): v is string => typeof v === 'string' && v.length > 0).join(' · ');
        events.push({ id: block.id, phase: 'start', title: title || 'sub-agent', ...(model ? { runtime: 'claude', model } : {}) });
        const asked = model ?? (typeof input.model === 'string' ? input.model : undefined);
        this.spenders.set(block.id, { root: block.id, ...(asked ? { model: asked } : {}) });
      } else if (parentToolUseId && this.open.has(parentToolUseId)) {
        events.push({ id: parentToolUseId, phase: 'step', step: summarizeTool(block.name ?? 'tool', input, this.cwd) });
      }
      // A sub-agent starting one of its own: what that one spends is the executors' too.
      const parent = parentToolUseId ? this.spenders.get(parentToolUseId) : undefined;
      if (parent && block.id && this.isLaunch(block)) this.spenders.set(block.id, parent);
    }
    return events;
  }

  /**
   * Background work Claude Code reports as tasks (background shells, background agents).
   * Tasks that belong to a sub-agent we already show are skipped.
   */
  task(msg: { subtype?: string; task_id?: string; tool_use_id?: string; description?: string; patch?: { status?: string; description?: string }; status?: string; summary?: string; usage?: { total_tokens?: number } }): SubAgentEvent[] {
    const id = msg.task_id;
    if (!id) return [];
    // A background sub-agent's task: it ends that sub-agent's row.
    const call = msg.tool_use_id && this.background.has(msg.tool_use_id) ? msg.tool_use_id : this.taskCall.get(id);
    if (call) {
      this.taskCall.set(id, call);
      // Its messages never came (Claude Code ran it out of the stream): its own total stands in for them.
      const total = msg.subtype === 'task_notification' ? (msg.usage?.total_tokens ?? 0) : 0;
      if (total > 0 && !this.streamed.has(call)) {
        this.streamed.add(call);
        this.add(this.spenders.get(call)?.model, total);
      }
      const status = msg.subtype === 'task_updated' ? msg.patch?.status : msg.subtype === 'task_notification' ? msg.status : undefined;
      if (!status || !['completed', 'failed', 'killed', 'stopped'].includes(status)) return [];
      this.taskCall.delete(id);
      this.background.delete(call);
      this.open.delete(call);
      return [{ id: call, phase: 'done', failed: status !== 'completed' }];
    }
    if (msg.tool_use_id && this.open.has(msg.tool_use_id)) return [];
    if (msg.subtype === 'task_started') {
      this.tasks.add(id);
      return [{ id, phase: 'start', title: msg.description || 'background task', kind: 'background' }];
    }
    if (!this.tasks.has(id)) return [];
    if (msg.subtype === 'task_progress' && msg.description) return [{ id, phase: 'step', step: msg.description }];
    const status = msg.subtype === 'task_updated' ? msg.patch?.status : msg.subtype === 'task_notification' ? msg.status : undefined;
    if (status && ['completed', 'failed', 'killed', 'stopped'].includes(status)) {
      this.tasks.delete(id);
      return [{ id, phase: 'done', failed: status !== 'completed', ...(msg.summary ? { step: msg.summary } : {}) }];
    }
    return [];
  }

  /**
   * A sub-agent's response (an assistant message with `parentToolUseId`): its tokens count as the
   * executors'. Pieces of one response carry its usage so far, so only the growth is added.
   */
  spent(parentToolUseId: string | null, message: SubAgentMessage): void {
    const who = parentToolUseId ? this.spenders.get(parentToolUseId) : undefined;
    const u = message.usage;
    if (!who || !u) return;
    const n = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const before = message.id ? (this.perMessage.get(message.id) ?? 0) : 0;
    if (!(n > before)) return;
    if (message.id) this.perMessage.set(message.id, n);
    this.streamed.add(who.root);
    this.add(message.model ?? who.model, n - before);
  }

  /** What the sub-agents spent since the last call (a turn's result reports it), and the model most of it ran on. */
  takeSpend(): SubAgentSpend {
    let tokens = 0;
    let top: [string, number] | undefined;
    for (const [model, n] of this.pending) {
      tokens += n;
      if (model && (!top || n > top[1])) top = [model, n];
    }
    this.pending = new Map();
    return { tokens, ...(top ? { model: top[0] } : {}) };
  }

  private add(model: string | undefined, n: number): void {
    const key = model ?? '';
    this.pending.set(key, (this.pending.get(key) ?? 0) + n);
  }

  user(blocks: readonly Block[] | string): SubAgentEvent[] {
    if (typeof blocks === 'string') return [];
    const events: SubAgentEvent[] = [];
    for (const block of blocks) {
      // Launched in the background: its call answers at once, but it works on.
      if (block.type === 'tool_result' && block.tool_use_id && !this.background.has(block.tool_use_id) && this.open.delete(block.tool_use_id)) {
        events.push({ id: block.tool_use_id, phase: 'done' });
      }
    }
    return events;
  }
}
