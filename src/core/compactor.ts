import { randomUUID } from 'node:crypto';
import type { AgentBackend, AgentPlace } from '../agent/types.js';
import { type AutoCompactAt, COMPACT_INSTRUCTIONS, autoCompactDue, compactLimit, contextWindowFor, formatTokenCount } from '../shared/context-usage.js';
import { t } from '../shared/i18n/index.js';
import { blackbox } from './blackbox/recorder.js';
import type { Store } from './store.js';

/** What the compactor needs from the agent host. */
export interface CompactorDeps {
  readonly store: Store;
  readonly agent: () => AgentBackend | undefined;
  /** Where the conversation's Claude runs (a workspace's folder and session), if it's a workspace. */
  readonly place: (channel: string) => AgentPlace | undefined;
  /** Send one of your Claude's events for the conversation (to you and whoever follows it). */
  readonly emit: (requestId: string, kind: 'context' | 'compact' | 'usage', text: string, channel: string) => void;
  readonly requesterName: () => string;
  readonly modelFor: (place?: AgentPlace) => { model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
}

type Trigger = 'manual' | 'auto';

/** What one run said about the context: whether it sent the meter's number, and its token counts. */
interface RunSeen {
  context: boolean;
  /** input + cache read + cache write of the run's `usage` (its last turn's when the runtime says it). */
  usage?: number;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Compacting conversations: Claude summarizes its working memory and continues from the summary,
 * while the chat stays on screen with a divider where it happened. Runs only between Claude's
 * turns (the agent host runs it in the conversation's queue), never in the middle of a tool call.
 * Auto-compact follows Settings › Claude: past the threshold (a percent of the window or tokens,
 * whichever comes first: docs/compaction.md) when a run ends, or before the next message goes, the
 * conversation is compacted first. Every conversation's runs come through here: projects and
 * worktrees, Your Mac, bots (`bot:<id>`), sentinels, plans and threads all run in the agent host's lanes.
 */
export class Compactor {
  /** Context per conversation, as your Claude's runs reported it (ahead of the store's copy). */
  private readonly seen = new Map<string, { used: number; window: number }>();
  /** Auto-compacted with no run since: don't try again until Claude has run (a big summary would loop). */
  private readonly tried = new Set<string>();
  /** The run going on in each conversation: did it send a context number, and its usage. */
  private readonly runs = new Map<string, RunSeen>();
  /** Compacted and still past the threshold: what it came to. It isn't compacted again until it grows a quarter of the threshold past that. */
  private readonly stuck = new Map<string, number>();

  constructor(private readonly deps: CompactorDeps) {}

  /** A run's event: keep the latest numbers for the conversation. */
  observe(channel: string, kind: string, text: string): void {
    if (kind !== 'context' && kind !== 'compact' && kind !== 'usage') return;
    let data: { used?: unknown; window?: unknown; post?: unknown; pre?: unknown; input?: unknown; cacheRead?: unknown; cacheWrite?: unknown; last?: unknown };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    if (kind === 'usage') {
      // A runtime may give its last turn's counts (`last`); else the run's totals (an upper bound).
      const u = (data.last && typeof data.last === 'object' ? data.last : data) as { input?: unknown; cacheRead?: unknown; cacheWrite?: unknown };
      const tokens = count(u.input) + count(u.cacheRead) + count(u.cacheWrite);
      if (tokens > 0) this.runs.set(channel, { context: this.runs.get(channel)?.context ?? false, usage: tokens });
      return;
    }
    const prev = this.seen.get(channel);
    const window = typeof data.window === 'number' && data.window > 0 ? data.window : (prev?.window ?? this.deps.store.getState().context[channel]?.window ?? 200_000);
    const used = kind === 'compact' ? (typeof data.pre === 'number' ? (typeof data.post === 'number' ? data.post : 0) : undefined) : typeof data.used === 'number' ? data.used : undefined;
    if (used === undefined) return;
    this.seen.set(channel, { used, window });
    if (kind === 'context' && used > 0) this.runs.set(channel, { ...this.runs.get(channel), context: true });
  }

  /**
   * A normal run finished here: auto-compact may try again. A run that never said how full the
   * context is (no `context` event) would never compact: its usage stands in for it, and the gap is
   * written to the black box.
   */
  ran(channel: string): void {
    this.tried.delete(channel);
    const run = this.runs.get(channel);
    this.runs.delete(channel);
    if (!run || run.context || !run.usage) return;
    const known = this.info(channel);
    const window = known?.window ?? contextWindowFor(this.deps.modelFor(channel === 'room' ? undefined : this.deps.place(channel)).model);
    this.seen.set(channel, { used: run.usage, window });
    blackbox.record('log', `compactor: no context event from the run in ${channel.slice(0, 80)}; estimated ${formatTokenCount(run.usage)} tokens from its usage`, { used: run.usage, window });
  }

  /** Forget a conversation's numbers (its chat was cleared, or it starts fresh). */
  forget(channel: string): void {
    this.seen.delete(channel);
    this.tried.delete(channel);
    this.runs.delete(channel);
    this.stuck.delete(channel);
  }

  /** How full the conversation is, as last seen. */
  private info(channel: string): { readonly used: number; readonly window: number; readonly compacting?: boolean } | undefined {
    return this.seen.get(channel) ?? this.deps.store.getState().context[channel];
  }

  /** Is this conversation full enough that it should be compacted before anything else runs? */
  due(channel: string): boolean {
    const prefs = this.deps.store.getState().prefs;
    const info = this.info(channel);
    if (!autoCompactDue({ on: prefs.autoCompact, at: prefs.autoCompactAt, ...(info ? { info } : {}), triedSinceRun: this.tried.has(channel) })) return false;
    // Its summary was still past the threshold: compacting each turn again wouldn't help (Needs You offers a fresh start).
    const stuck = this.stuck.get(channel);
    return stuck === undefined || !info || info.used >= stuck + compactLimit(prefs.autoCompactAt, info.window) / 4;
  }

  /**
   * For a run: the threshold Claude Code's own auto-compact should use (nothing when it's off), and
   * the window Beluga last saw for the conversation, so a threshold in tokens is worked out on it.
   */
  threshold(channel?: string): { autoCompactAt?: AutoCompactAt; contextWindow?: number } {
    const prefs = this.deps.store.getState().prefs;
    if (!prefs.autoCompact) return {};
    const window = channel ? this.info(channel)?.window : undefined;
    return { autoCompactAt: prefs.autoCompactAt, ...(window && window > 0 ? { contextWindow: window } : {}) };
  }

  /**
   * Compact one conversation now. The chat shows "Compacting…" until it's done, then the divider
   * (with the summary Claude kept). Resolves when Claude is done, whatever happened. A summary still
   * past the threshold is said in the chat (Needs You offers to start fresh from it), not retried.
   */
  async run(channel: string, trigger: Trigger, signal: AbortSignal, instructions = ''): Promise<void> {
    const agent = this.deps.agent();
    if (!agent) return;
    if (trigger === 'auto') this.tried.add(channel);
    const requestId = `compact-${randomUUID()}`;
    const place = channel === 'room' ? undefined : this.deps.place(channel);
    if (channel !== 'room' && !place) return;
    const info = this.info(channel);
    const emit = (kind: 'context' | 'compact' | 'usage', text: string): void => this.deps.emit(requestId, kind, text, channel);
    emit('context', JSON.stringify({ compacting: true, trigger, ...(info ? { used: info.used, window: info.window } : {}) }));
    let landed = false;
    this.runs.delete(channel);
    try {
      await agent.run({
        prompt: `/compact ${instructions.trim() || COMPACT_INSTRUCTIONS}`,
        requesterName: this.deps.requesterName(),
        viaAgent: false,
        context: [],
        scope: 'full',
        signal,
        ...(place ? { place } : {}),
        // Compacting only rewrites Claude's memory: the chat (text, steps) shows nothing of it but the divider.
        onEvent: (kind, text) => {
          if (kind !== 'context' && kind !== 'compact' && kind !== 'usage') return;
          if (kind === 'compact') landed = true;
          const out = kind === 'compact' ? withTrigger(text, trigger, info?.used) : text;
          this.observe(channel, kind, out);
          emit(kind, out);
        },
        onFileTouched: () => undefined,
        canUseTool: async () => false,
        ...this.deps.modelFor(place),
      });
    } catch {
      // Stopped or failed: the divider says it didn't finish (below).
    } finally {
      // The compaction's own usage isn't the conversation's: it never stands in for a context number.
      this.runs.delete(channel);
      if (!landed) emit('context', JSON.stringify({ compacting: false, ...(info ? { used: info.used, window: info.window } : {}) }));
    }
    if (landed) this.stillBig(channel);
  }

  /** After a compaction: a summary still past the threshold is said in the chat (Needs You offers a fresh start from it). */
  private stillBig(channel: string): void {
    this.stuck.delete(channel);
    const after = this.seen.get(channel);
    if (!after || !(after.used > 0)) return;
    const limit = compactLimit(this.deps.store.getState().prefs.autoCompactAt, after.window);
    if (after.used < limit) return;
    this.stuck.set(channel, after.used);
    this.deps.store.dispatch({ type: 'system', channel, level: 'warn', text: t('chat.compact.stillBig', { used: formatTokenCount(after.used), limit: formatTokenCount(limit) }) });
  }
}

/**
 * Claude Code always calls /compact "manual"; say auto when Beluga started it. A runtime that
 * can't tell how full it was before (OpenCode: each run is a new process, its first number comes
 * after the compaction) says 0: then it's what Beluga last saw (`before`).
 */
function withTrigger(text: string, trigger: Trigger, before?: number): string {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const pre = data.pre === 0 && before ? { pre: before } : {};
    return typeof data.pre === 'number' ? JSON.stringify({ ...data, ...pre, trigger }) : text;
  } catch {
    return text;
  }
}
