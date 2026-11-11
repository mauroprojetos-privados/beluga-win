import { describe, expect, it } from 'vitest';
import { RefTable } from '../src/companion/files.js';
import { needsYou } from '../src/companion/needs-you.js';
import { COMPANION_PROTO, ConvView, HomeView, NeedsYou, SINCE } from '../src/companion/protocol.js';
import { PHONE } from '../src/companion/coverage.js';
import { type ViewContext, homeView, viewOf } from '../src/companion/views.js';
import type { BotInfo } from '../src/core/bots/schema.js';
import { type Action, Store, initialState } from '../src/core/store.js';
import { ASSISTANT_CHANNEL } from '../src/shared/assistant.js';

/**
 * Bots on the phone (1.52, docs/bots.md): the list with what each does, chatting with one, and the
 * bot's name on a Needs You its work raised. Editing them stays on the Mac.
 */

const ME = 'me';
const T0 = 1_760_000_000_000;

const bot = (over: Partial<BotInfo> & Pick<BotInfo, 'id' | 'name'>): BotInfo => ({
  icon: 'bot',
  channel: `bot:${over.id}`,
  dir: `~/.beluga/bots/${over.id}`,
  mac: false,
  orchestrates: true,
  autonomy: 'ask',
  problems: [],
  knowledge: 'local',
  rev: 1,
  behind: [],
  ...over,
});

function state() {
  const store = new Store(initialState('room'));
  const run = (a: Action): void => store.dispatch(a);
  run({ type: 'identity', selfId: ME, isHost: true, home: '/Users/k' });
  run({ type: 'projects', projects: [{ id: 'p1', name: 'triexis', root: '/p', base: 'main', workspaces: [{ id: 'w1', projectRoot: '/p', projectId: 'p1', name: 'csv', path: '/p/.w/w1', kind: 'worktree', createdAt: T0, external: false }] }] as never });
  run({
    type: 'bots',
    bots: [
      bot({ id: 'mac', name: 'Your Mac', icon: 'laptop', channel: ASSISTANT_CHANNEL, mac: true, status: { planId: 'pl1', planTitle: 'CSV', done: 2, total: 6, waiting: 'Contrast check' }, behind: ['ws:w1'] }),
      bot({ id: 'supa', name: 'Supa', description: 'Supabase', problems: ['Missing secret T'] }),
    ],
  });
  run({ type: 'approval_add', approval: { id: 'a1', kind: 'command', title: 'npm i papaparse', detail: 'npm i papaparse', askedAt: T0, timeoutMs: 60_000, channel: 'ws:w1' } as never });
  return store;
}

const ctx = (): ViewContext => ({ refs: new RefTable(() => 'ref00001'), mac: { name: 'Mac', version: '1' }, outputs: () => [] });

describe('bots on the phone', () => {
  it('is 1.52, and only reading them is the phone’s', () => {
    expect(SINCE.bots).toBe(52);
    expect(COMPANION_PROTO.minor).toBeGreaterThanOrEqual(SINCE.bots);
    expect(PHONE['bots.list']).toBe('phone');
    expect(PHONE['bots.status']).toBe('phone');
    for (const m of ['bots.edit.persona', 'bots.edit.mcp', 'bots.edit.secret', 'bots.export', 'bots.import', 'bots.create', 'bots.delete', 'bots.knowledge.addUrl'] as const) expect(PHONE[m]).toBe('mac');
  });

  it('Home lists them, Your Mac first, with what each is doing and its plan', () => {
    const home = homeView(state().getState(), ctx());
    expect(HomeView.safeParse(home).success).toBe(true);
    expect(home.bots?.map((b) => [b.id, b.topic, b.line ?? null, b.plan ?? null, b.problems ?? 0])).toEqual([
      ['mac', 'conv:mac:assistant', '2 of 6 done · waiting on Contrast check', 'plan:pl1', 0],
      ['supa', 'conv:bot:supa', null, null, 1],
    ]);
  });

  it('a bot’s conversation opens and takes your messages', () => {
    const view = viewOf(state().getState(), ctx(), 'conv:bot:supa') as ConvView;
    expect(ConvView.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({ title: 'Supa', canSend: true });
  });

  it('a Needs You raised by a bot’s work names the bot', () => {
    const items = needsYou(state().getState());
    const item = items.find((n) => n.id.includes('a1'));
    expect(item?.bot).toBe('Your Mac');
    expect(NeedsYou.safeParse(item).success).toBe(true);
  });

  it('with no bots of yours and Your Mac idle, Home has no Bots list (nothing changes)', () => {
    const store = state();
    store.dispatch({ type: 'bots', bots: [bot({ id: 'mac', name: 'Your Mac', channel: ASSISTANT_CHANNEL, mac: true, orchestrates: false })] });
    expect(homeView(store.getState(), ctx()).bots).toBeUndefined();
  });
});
