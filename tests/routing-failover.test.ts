import { describe, expect, it, vi } from 'vitest';
import { ComboFailover } from '../src/core/routing/failover.js';
import { exhaustedCombos } from '../src/core/routing/model.js';
import { Store, initialState } from '../src/core/store.js';
import type { NoticeEvent } from '../src/core/notify.js';
import { needsYou } from '../src/companion/needs-you.js';
import { NeedsYou } from '../src/companion/protocol.js';
import { encodeFailure } from '../src/shared/run-failure.js';
import type { AgentRef } from '../src/protocol.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { PHONE } from '../src/companion/coverage.js';

const ECONOMY: AgentRef = { runtime: 'claude', label: 'Economy', combo: 'economy', comboName: 'Economy' };
const ws = (id: string, agent?: AgentRef): Workspace => ({ id, projectId: 'p', name: id, path: `/tmp/${id}`, kind: 'worktree', projectRoot: '/tmp/p', branch: `beluga/${id}`, createdAt: 0, external: false, ...(agent ? { agent } : {}) }) as unknown as Workspace;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function setup(runtimes = [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }]) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [{ id: 'p', name: 'app', root: '/tmp/p', base: 'main', workspaces: [ws('w1', ECONOMY), ws('w2')] } as unknown as Project] });
  store.dispatch({ type: 'runtimes', runtimes } as never);
  const asked: string[] = [];
  const carried: Array<[string, string]> = [];
  const notices: NoticeEvent[] = [];
  const failover = new ComboFailover({ store, ask: (_p, ch) => (asked.push(ch), `req-${asked.length}`), carry: (ch, from) => carried.push([ch, from]), notify: (e) => notices.push(e) });
  const me = store.getState().selfId;
  const stop = (channel: string, agent: AgentRef, requestId = 'r1') =>
    store.dispatch({ type: 'agent_event', owner: me, requestId, requester: me, event: 'error', text: encodeFailure({ kind: 'usage_limit', resetsAt: Date.now() + 3_600_000, detail: 'limit' }), ts: Date.now(), channel, agent });
  return { store, failover, asked, carried, notices, stop };
}

describe('a combo’s run that stops on its limit (Phase 2)', () => {
  it('goes on with the next target, carrying the conversation to another runtime, once', async () => {
    const t = setup();
    t.stop('ws:w1', { runtime: 'claude', label: 'Claude', model: 'sonnet', combo: 'economy', comboName: 'Economy' });
    await tick();
    expect(t.asked).toEqual(['ws:w1']);
    expect(t.carried).toEqual([['ws:w1', 'Claude']]);
    expect(t.store.getState().log.at(-1)).toMatchObject({ type: 'system', text: 'Claude is at its usage limit: Economy · Codex goes on (Economy).' });
    t.failover.tick();
    expect(t.asked).toHaveLength(1);
    t.failover.stop();
  });

  it('leaves a run on no combo, one whose conversation left the combo, and stays off with Continue after the limit off', async () => {
    const t = setup();
    t.stop('ws:w2', { runtime: 'claude', label: 'Claude', combo: 'economy', comboName: 'Economy' });
    await tick();
    expect(t.asked).toEqual([]);
    t.store.dispatch({ type: 'prefs', prefs: { autoContinue: false } });
    t.stop('ws:w1', { runtime: 'claude', label: 'Claude', combo: 'economy', comboName: 'Economy' }, 'r2');
    await tick();
    expect(t.asked).toEqual([]);
    t.failover.stop();
  });

  it('nothing left: tells you once, waits in Needs You with Try Again, which the phone may press', async () => {
    const t = setup([{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: false }]);
    t.store.dispatch({ type: 'prefs', prefs: { combos: [{ id: 'economy', name: 'Economy', targets: [{ runtime: 'claude', model: 'sonnet' }, { runtime: 'codex' }] }] } });
    t.stop('ws:w1', { runtime: 'claude', label: 'Claude', model: 'sonnet', combo: 'economy', comboName: 'Economy' });
    await tick();
    expect(t.asked).toEqual([]);
    expect(t.notices).toEqual([expect.objectContaining({ kind: 'needsYou', title: 'Nothing in Economy can run now', channel: 'ws:w1', need: 'combo:ws:w1' })]);
    expect(exhaustedCombos(t.store.getState(), Date.now())).toHaveLength(1);
    const item = needsYou(t.store.getState()).find((n) => n.kind === 'combo')!;
    expect(NeedsYou.parse(item)).toMatchObject({ id: 'combo:ws:w1', topic: 'conv:ws:w1', actions: [{ label: 'Try Again', method: 'routing.retry', args: ['ws:w1'] }] });
    expect(item.detail).toMatch(/Claude · Sonnet: At its usage limit until \d\d:\d\d; Codex/);
    expect(PHONE['routing.retry']).toBe('phone');
    // Codex is set up again: nothing waits any more.
    t.store.dispatch({ type: 'runtimes', runtimes: [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: true }] } as never);
    expect(needsYou(t.store.getState()).some((n) => n.kind === 'combo')).toBe(false);
    t.failover.stop();
  });

  it('a stop from before it started is the reset’s (auto-continue), not handed on', async () => {
    const t = setup();
    t.failover.stop();
    t.stop('ws:w1', { runtime: 'claude', label: 'Claude', combo: 'economy', comboName: 'Economy' });
    const ask = vi.fn(() => 'x');
    const again = new ComboFailover({ store: t.store, ask });
    again.tick();
    expect(ask).not.toHaveBeenCalled();
    again.stop();
  });
});
