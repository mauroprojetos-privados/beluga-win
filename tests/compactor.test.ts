import { describe, expect, it } from 'vitest';
import type { AgentBackend, AgentRunInput } from '../src/agent/types.js';
import { AgentHost } from '../src/core/agent-host.js';
import { Store, initialState } from '../src/core/store.js';
import type { BodyOf } from '../src/protocol.js';
import { type AutoCompactAt, COMPACT_INSTRUCTIONS } from '../src/shared/context-usage.js';
import { MockContext, mockSummary, seedMockContext } from '../src/agent/mock-context.js';
import { createMockBackend } from '../src/agent/mock.js';
import { isCompactItem } from '../packages/mac/src/chat/context-model.js';
import { waitFor } from './helpers.js';

const ME = 'me';
const pct = (p: number) => JSON.stringify({ used: p * 2_000, window: 200_000 });

/**
 * A pretend Claude: each prompt runs one script step — report this much context, then answer.
 * `hold` keeps a run going until released (to send things while Claude works).
 */
function backend(script: { fill?: number[]; compactTo?: number; failCompact?: boolean } = {}) {
  const prompts: string[] = [];
  const inputs: AgentRunInput[] = [];
  const fill = [...(script.fill ?? [])];
  let release: (() => void) | undefined;
  const holds: Array<Promise<void>> = [];
  const agent: AgentBackend = {
    async run(input) {
      prompts.push(input.prompt);
      inputs.push(input);
      if (input.prompt.startsWith('/compact')) {
        if (script.failCompact) throw new Error('compaction failed');
        input.onEvent('compact', JSON.stringify({ pre: 170_000, post: script.compactTo ?? 20_000, trigger: 'manual', summary: 'kept the plan' }));
        return '';
      }
      const hold = holds.shift();
      if (hold) await hold;
      const next = fill.shift();
      if (next !== undefined) input.onEvent('context', pct(next));
      return 'done';
    },
  };
  return {
    agent,
    prompts,
    inputs,
    /** The next normal run waits until `go()`. */
    holdNext: () => {
      holds.push(new Promise<void>((r) => (release = r)));
      return () => release?.();
    },
  };
}

/** Where a conversation's Claude runs, for the tests: a folder and nothing else. */
const placeFor = (channel: string) => ({ cwd: `/tmp/beluga-test/${channel.replace(/[^a-z0-9]/gi, '-')}`, additionalDirectories: [], autoEdit: true, onSession: () => undefined });

function host(agent: AgentBackend, prefs: { autoCompact?: boolean; autoCompactAt?: AutoCompactAt } = {}, opts: { places?: boolean } = {}) {
  const store = new Store(initialState('room', 'auto'));
  // Auto-compact is off by default; these tests are about it on unless they say otherwise.
  store.dispatch({ type: 'prefs', prefs: { autoCompact: true, ...prefs } });
  const toasts: string[] = [];
  // Events go to yourself, as the room would deliver them.
  const send = (body: { kind: string } & Record<string, unknown>): boolean => {
    if (body.kind !== 'agent_event') return true;
    const e = body as unknown as BodyOf<'agent_event'>;
    store.dispatch({ type: 'agent_event', owner: ME, requestId: e.requestId, requester: e.requester, event: e.event, text: e.text, ts: Date.now(), channel: e.channel });
    return true;
  };
  const h = new AgentHost({
    store,
    selfId: () => ME,
    send: send as never,
    agent: () => agent,
    shares: {} as never,
    sharing: { recipients: () => [], sharedFor: () => undefined, canPost: () => true } as never,
    people: {} as never,
    questions: { track: () => undefined, ask: async () => ({ kind: 'skip' }), cancelAll: () => undefined, cancelChannel: () => undefined } as never,
    toast: (text) => void toasts.push(text),
    system: () => undefined,
    approvalTimeoutMs: () => 60_000,
    refreshUsage: async () => undefined,
    // A conversation that isn't the room runs in a folder of its own (a worktree, Your Mac, a bot's).
    ...(opts.places ? { workspaces: { place: (channel: string) => placeFor(channel), btwPlace: () => undefined, agentIn: () => undefined, inChannel: () => undefined, refreshWorkspace: async () => undefined } as never } : {}),
  });
  let n = 0;
  const ask = (prompt: string, channel = 'room'): Promise<void> => h.onAgentRequest(ME, { kind: 'agent_request', requestId: `r${++n}`, prompt, viaAgent: false, channel, urgent: false, plan: false });
  return { h, store, ask, toasts };
}

const dividers = (store: Store) => store.getState().log.filter(isCompactItem);
const cards = (store: Store) => store.getState().log.filter((l) => l.type === 'agent');

describe('auto-compact', () => {
  it('compacts in the background when a run ends past the threshold, between turns', async () => {
    const b = backend({ fill: [88] });
    const { h, store, ask } = host(b.agent);
    await ask('build the thing');
    await waitFor(() => dividers(store)[0]?.compact.state === 'done');
    expect(b.prompts).toEqual(['build the thing', `/compact ${COMPACT_INSTRUCTIONS}`]);
    expect(dividers(store)[0]!.compact).toMatchObject({ state: 'done', trigger: 'auto', pre: 170_000, post: 20_000, summary: 'kept the plan' });
    expect(store.getState().context.room).toMatchObject({ used: 20_000 });
    // Compacting isn't a message: no card for it, only the divider.
    expect(cards(store)).toHaveLength(1);
    await h.idle('room');
  });

  it('leaves a conversation under the threshold alone, and does nothing when turned off', async () => {
    const under = backend({ fill: [84] });
    const a = host(under.agent);
    await a.ask('hello');
    await waitFor(() => cards(a.store)[0]?.type === 'agent' && cards(a.store)[0]!.status === 'done');
    await a.h.idle('room');
    expect(under.prompts).toEqual(['hello']);

    const off = backend({ fill: [99] });
    const b = host(off.agent, { autoCompact: false });
    await b.ask('hello');
    await b.h.idle('room');
    await waitFor(() => cards(b.store)[0]?.type === 'agent' && cards(b.store)[0]!.status === 'done');
    expect(off.prompts).toEqual(['hello']);
    expect(dividers(b.store)).toHaveLength(0);
  });

  it('follows the threshold you set', async () => {
    const b = backend({ fill: [72] });
    const { h, store, ask } = host(b.agent, { autoCompactAt: 70 });
    await ask('hello');
    await waitFor(() => dividers(store)[0]?.compact.state === 'done');
    await h.idle('room');
    expect(b.prompts[1]).toMatch(/^\/compact /);
  });

  it('compacts before the next message goes when the conversation is already past it', async () => {
    const b = backend({ fill: [40] });
    const { h, store, ask } = host(b.agent);
    store.dispatch({ type: 'agent_event', owner: ME, requestId: 'seed', requester: ME, event: 'context', text: pct(91), ts: 1, channel: 'room' });
    await ask('next task');
    await waitFor(() => b.prompts.length === 2);
    await h.idle('room');
    expect(b.prompts[0]).toMatch(/^\/compact /);
    expect(b.prompts[1]).toBe('next task');
  });

  it('doesn’t loop when the summary is still big: says so in the chat, and tries again only once it has grown well past it', async () => {
    const b = backend({ fill: [95, 96, 99], compactTo: 180_000 });
    const { h, store, ask } = host(b.agent);
    await ask('one');
    await waitFor(() => dividers(store).length === 1 && dividers(store)[0]!.compact.state === 'done');
    await h.idle('room');
    expect(b.prompts.filter((p) => p.startsWith('/compact'))).toHaveLength(1);
    // The summary (180k) is past the threshold (170k): said in the chat, not silently retried.
    expect(store.getState().log.some((l) => l.type === 'system' && l.level === 'warn' && /summary is still big/.test(l.text))).toBe(true);
    // 192k, then 198k: not a quarter of the threshold (42.5k) past the 180k summary, so no compaction each turn.
    await ask('two');
    await h.idle('room');
    await ask('three');
    await h.idle('room');
    expect(b.prompts.map((p) => (p.startsWith('/compact') ? 'compact' : p))).toEqual(['one', 'compact', 'two', 'three']);
  });

  it('tells Claude Code the same threshold for its own compaction, and nothing when off', async () => {
    const on = backend();
    const a = host(on.agent, { autoCompactAt: 78 });
    await a.ask('hi');
    await a.h.idle('room');
    expect(on.inputs[0]!.autoCompactAt).toBe(78);
    const off = backend();
    const b = host(off.agent, { autoCompact: false });
    await b.ask('hi');
    await b.h.idle('room');
    expect(off.inputs[0]!.autoCompactAt).toBeUndefined();
  });
});

/** A pretend Claude on a 1M-window model: each normal run reports `used` tokens of context, or only its usage. */
function longBackend(used: number[], opts: { usageOnly?: boolean } = {}) {
  const prompts: Array<{ prompt: string; channel?: string }> = [];
  const inputs: AgentRunInput[] = [];
  const fill = [...used];
  const agent: AgentBackend = {
    async run(input) {
      prompts.push({ prompt: input.prompt, ...(input.channel ? { channel: input.channel } : {}) });
      inputs.push(input);
      if (input.prompt.startsWith('/compact')) {
        input.onEvent('compact', JSON.stringify({ pre: 170_000, post: 30_000, trigger: 'manual', window: 1_000_000, summary: 'kept the plan' }));
        return '';
      }
      const next = fill.shift();
      if (next !== undefined && opts.usageOnly) input.onEvent('usage', JSON.stringify({ input: 2_000, output: 900, cacheRead: next - 12_000, cacheWrite: 10_000, cost: 0.1, session: 's' }));
      else if (next !== undefined) input.onEvent('context', JSON.stringify({ used: next, window: 1_000_000 }));
      return 'done';
    },
  };
  return { agent, prompts, inputs };
}

describe('auto-compact in tokens (docs/compaction.md)', () => {
  // A project's worktree, a bot's chat, a sentinel run (in Your Mac's chats), a plan's home and a child thread
  // (worktrees too): every one of them runs in the agent host's lanes, through the same Compactor.
  const conversations = [
    ['a project', 'ws:proj1'],
    ['a bot', 'bot:clara'],
    ['a sentinel', 'mac:assistant:sentinel1'],
  ] as const;

  for (const [what, channel] of conversations) {
    it(`compacts ${what} on a 1M window at 170k before its next turn (160k, not 85% of 1M)`, async () => {
      const b = longBackend([170_000, 40_000]);
      const { h, store, ask } = host(b.agent, {}, { places: true });
      await ask('build the thing', channel);
      await ask('next', channel);
      await waitFor(() => b.prompts.length === 3);
      await h.idle(channel);
      expect(b.prompts.map((p) => (p.prompt.startsWith('/compact') ? 'compact' : p.prompt))).toEqual(['build the thing', 'compact', 'next']);
      expect(dividers(store)[0]!.compact).toMatchObject({ state: 'done', trigger: 'auto', pre: 170_000, post: 30_000 });
      // The run that follows tells Claude Code the same threshold, on the window Beluga saw.
      expect(b.inputs[2]).toMatchObject({ autoCompactAt: 85, contextWindow: 1_000_000 });
    });
  }

  it('compacts a thread’s or a plan’s run (runFor) the same way', async () => {
    const b = longBackend([170_000, 40_000]);
    const { h } = host(b.agent, {}, { places: true });
    h.runFor(ME, 'ws:child1', 'child work');
    await waitFor(() => b.prompts.length >= 1);
    await h.idle('ws:child1');
    h.runFor(ME, 'ws:child1', 'more');
    await waitFor(() => b.prompts.length === 3);
    await h.idle('ws:child1');
    expect(b.prompts.map((p) => (p.prompt.startsWith('/compact') ? 'compact' : p.prompt))).toEqual(['child work', 'compact', 'more']);
  });

  it('leaves a 1M conversation under 160k alone, and a 200k one keeps the percent', async () => {
    const b = longBackend([150_000]);
    const a = host(b.agent, {}, { places: true });
    await a.ask('hi', 'ws:proj1');
    await a.h.idle('ws:proj1');
    expect(b.prompts).toHaveLength(1);
    // 200k window: 165k is under 85% (170k), so it stays.
    const s = backend({ fill: [82.5] });
    const c = host(s.agent);
    await c.ask('hi');
    await c.h.idle('room');
    expect(s.prompts).toEqual(['hi']);
  });

  it('follows tokens you set, whichever comes first', async () => {
    const b = longBackend([110_000]);
    const { h, ask } = host(b.agent, { autoCompactAt: { tokens: 100_000 } }, { places: true });
    await ask('hi', 'bot:clara');
    await waitFor(() => b.prompts.length === 2);
    await h.idle('bot:clara');
    expect(b.prompts[1]!.prompt).toMatch(/^\/compact /);
  });

  it('estimates the context from the run’s usage when it sends no number, and notes the gap in the black box', async () => {
    const { blackbox } = await import('../src/core/blackbox/recorder.js');
    const before = blackbox.version;
    const b = longBackend([170_000], { usageOnly: true });
    const { h, ask } = host(b.agent, {}, { places: true });
    await ask('hi', 'ws:proj1');
    await waitFor(() => b.prompts.length === 2);
    await h.idle('ws:proj1');
    expect(b.prompts[1]!.prompt).toMatch(/^\/compact /);
    expect(blackbox.since(before).some((e) => /no context event/.test(e.text) && e.data?.used === 170_000)).toBe(true);
  });
});

describe('Compact now', () => {
  it('waits for Claude’s current turn to end (never in the middle of a tool call), once even if asked twice', async () => {
    const b = backend({ fill: [30] });
    const { h, store, ask, toasts } = host(b.agent);
    const go = b.holdNext();
    void ask('long task');
    await waitFor(() => b.prompts.length === 1);
    h.compact('room', 'keep the API decisions');
    h.compact('room');
    expect(toasts.at(-1)).toMatch(/when it finishes/);
    await new Promise((r) => setTimeout(r, 30));
    expect(b.prompts).toEqual(['long task']);
    go();
    await waitFor(() => dividers(store)[0]?.compact.state === 'done');
    await h.idle('room');
    expect(b.prompts).toEqual(['long task', '/compact keep the API decisions']);
    expect(dividers(store)[0]!.compact.trigger).toBe('manual');
  });

  it('says the compaction didn’t finish when it fails, and the conversation goes on', async () => {
    const b = backend({ failCompact: true });
    const { h, store } = host(b.agent);
    store.dispatch({ type: 'agent_event', owner: ME, requestId: 'seed', requester: ME, event: 'context', text: pct(50), ts: 1, channel: 'room' });
    h.compact('room');
    await waitFor(() => dividers(store)[0]?.compact.state === 'failed');
    await h.idle('room');
    expect(store.getState().context.room).toEqual({ used: 100_000, window: 200_000 });
  });

  it('stops quietly with the conversation: no "taken out of the queue" card for a waiting compaction', async () => {
    const b = backend();
    const { h, store, ask } = host(b.agent);
    const go = b.holdNext();
    void ask('long task');
    await waitFor(() => b.prompts.length === 1);
    h.compact('room');
    expect(h.stopRun('room')).toMatchObject({ stopped: true, returned: [] });
    go();
    await h.idle('room');
    expect(store.getState().log.filter((l) => l.type === 'agent' && /Taken out/.test(l.text))).toHaveLength(0);
  });
});

describe('the demo’s Claude', () => {
  const input = (prompt: string, cwd: string, events: Array<[string, string]>): AgentRunInput => ({
    prompt,
    requesterName: 'kay',
    viaAgent: false,
    context: [],
    scope: 'full',
    signal: new AbortController().signal,
    place: { cwd, additionalDirectories: [], autoEdit: true, onSession: () => undefined },
    onEvent: (kind, text) => void events.push([kind, text]),
    onFileTouched: () => undefined,
    canUseTool: async () => true,
  });

  it('fills the window as it works and compacts it with a summary, per conversation', async () => {
    const events: Array<[string, string]> = [];
    seedMockContext('/demo/full', 166_000);
    const agent = createMockBackend({} as never, 0.01);
    await agent.run(input('look around', '/demo/full', events));
    const used = events.filter(([k]) => k === 'context').map(([, t]) => (JSON.parse(t) as { used: number }).used);
    expect(used.length).toBeGreaterThan(1); // live, while it works
    expect(used).toEqual([...used].sort((a, b) => a - b));
    expect(used.at(-1)).toBeGreaterThan(166_000);
    await agent.run(input('/compact keep the deploy steps', '/demo/full', events));
    const compact = JSON.parse(events.find(([k]) => k === 'compact')![1]) as { pre: number; post: number; summary: string };
    expect(compact.pre).toBe(used.at(-1));
    expect(compact.post).toBeLessThan(compact.pre / 4);
    expect(compact.summary).toMatch(/Open tasks/);
    expect(compact.summary).toMatch(/keep the deploy steps/);
    // Another conversation keeps its own numbers.
    const other = new MockContext();
    const e2: Array<[string, string]> = [];
    expect(other.grow(input('x', '/demo/other', e2))).toBe(25_500);
    expect(mockSummary(COMPACT_INSTRUCTIONS)).not.toMatch(/Kept in focus/);
  });
});
