import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MacTools } from '../src/agent/types.js';
import { acpHttpServers, acpStartedServers, codexPlaceConfig, placeServers } from '../src/agent/runtime/place-mcp.js';
import { Bots } from '../src/core/bots/bots.js';
import { BotFolder } from '../src/core/bots/folder.js';
import { Knowledge, MAX_REPO_FILE_BYTES, isGitAddress, repoFiles } from '../src/core/bots/knowledge.js';
import { MAC_BOT, botChannel, mcpReach, nextRunOf, parseBotFile } from '../src/core/bots/schema.js';
import { patchBot } from '../src/core/bots/studio.js';
import { triggerMessage } from '../src/core/bots/triggers.js';
import { homeView } from '../src/companion/views.js';
import { Store, initialState } from '../src/core/store.js';
import { ASSISTANT_CHANNEL } from '../src/shared/assistant.js';

/**
 * What bots do beyond their first version (docs/bots.md): triggers (Sentinels' own, a turn in the
 * bot's chat), several chats, their MCPs on other runtimes, a repository as knowledge, and
 * OpenViking (here a fake `ov`, tests/fixtures/fake-ov.mjs, with the local index as the fallback).
 */

const ME = 'me';
const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'beluga-bots-auto-'));
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const stopped: Bots[] = [];
afterEach(() => {
  for (const b of stopped.splice(0)) b.stop();
});

function setup(opts: { now?: () => number; chatLimit?: number } = {}) {
  const home = tmp();
  const macDir = path.join(home, 'assistant', 'work');
  mkdirSync(macDir, { recursive: true });
  const store = new Store(initialState('room', 'auto'));
  store.dispatch({ type: 'projects', projects: [{ id: 'p1', name: 'Triexis', root: path.join(home, 'triexis'), base: 'main', workspaces: [] }] });
  if (opts.chatLimit !== undefined) store.dispatch({ type: 'prefs', prefs: { chatLimit: opts.chatLimit } } as never);
  const said: Array<{ channel: string; text: string }> = [];
  const bots = new Bots({
    store,
    home,
    macDir,
    selfId: () => ME,
    secrets: { values: () => ({}), set: () => undefined },
    macTools: () => ({ listWork: () => 'Triexis' }) as unknown as MacTools,
    watch: false,
    knowledge: (dir, id) => new Knowledge(dir, id, async () => undefined),
    submit: (channel, text) => (said.push({ channel, text }), true),
    triggerTickMs: 0,
    tz: 'UTC',
    ...(opts.now ? { now: opts.now } : {}),
  });
  stopped.push(bots);
  return { bots, store, home, said };
}

const at = (iso: string): number => Date.parse(iso);

describe('a bot’s triggers in bot.json', () => {
  it('reads Sentinels’ trigger shapes with a message, and drops a bad one alone', () => {
    const p = parseBotFile(
      JSON.stringify({
        version: 1,
        triggers: [
          { id: 'nightly', trigger: { kind: 'schedule', every: 'day', at: '07:00' }, message: 'check staging and deploy if green' },
          { id: 'hook', trigger: { kind: 'webhook' }, message: 'no webhooks for bots' },
          { id: 'nightly', trigger: { kind: 'manual' }, message: 'a second with the same id' },
          { id: 'down', trigger: { kind: 'uptime', url: 'https://staging.example.com', minutes: 5 }, message: 'look at it' },
        ],
      }),
    );
    expect(p.bot.triggers?.map((t) => t.id)).toEqual(['nightly', 'down']);
    // Sentinels' defaults are filled in.
    expect(p.bot.triggers?.[0]?.trigger).toMatchObject({ kind: 'schedule', missed: 'catch-up' });
    expect(p.problems.join('\n')).toMatch(/hook.*not after a sentinel or a webhook/);
    expect(p.problems.join('\n')).toMatch(/another has its id/);
  });

  it('tells the bot who started it and its autonomy, then the message', () => {
    const text = triggerMessage({ id: 'n', trigger: { kind: 'manual' }, message: 'Deploy if green' }, 'ask', 'you, with Run Now');
    expect(text).toMatch(/Started by your trigger “Only when you press Run”: you, with Run Now/);
    expect(text).toMatch(/Ask First/);
    expect(text.trim().endsWith('Deploy if green')).toBe(true);
  });

  it('a schedule runs once per slot in the bot’s open chat; a missed one catches up once; off never runs', async () => {
    let now = at('2026-11-10T06:00:00Z');
    const { bots, said, store } = setup({ now: () => now });
    const id = await bots.create({ name: 'Deployer' });
    await patchBot(bots, id, { triggers: [{ id: 'nightly', trigger: { kind: 'schedule', every: 'day', at: '07:00', missed: 'catch-up' }, message: 'check staging and deploy if green' }] }, undefined);
    const info = bots.list().find((b) => b.id === id)!;
    expect(info.nextRun).toBe(at('2026-11-10T07:00:00Z'));
    expect(nextRunOf(info.triggers ?? [])).toBe(info.nextRun);
    bots.tickTriggers();
    expect(said).toEqual([]);
    now = at('2026-11-10T07:00:30Z');
    bots.tickTriggers();
    bots.tickTriggers();
    expect(said).toHaveLength(1);
    expect(said[0]!.channel).toBe(botChannel(id));
    expect(said[0]!.text).toMatch(/check staging and deploy if green/);
    expect(bots.list().find((b) => b.id === id)?.triggers?.[0]).toMatchObject({ last: now, next: at('2026-11-11T07:00:00Z') });
    // Three days asleep: one run, said to be caught up.
    now = at('2026-11-14T09:00:00Z');
    bots.tickTriggers();
    expect(said).toHaveLength(2);
    expect(said[1]!.text).toMatch(/caught up/);
    // A new chat is the one open: the next run goes there.
    const chat = bots.newChat(id);
    await patchBot(bots, id, { triggers: [{ id: 'nightly', trigger: { kind: 'schedule', every: 'day', at: '07:00', missed: 'catch-up' }, message: 'check staging', off: true }] }, undefined);
    now = at('2026-11-15T07:01:00Z');
    bots.tickTriggers();
    expect(said).toHaveLength(2);
    expect(bots.list().find((b) => b.id === id)?.nextRun).toBeUndefined();
    // Run Now works on one that's off too (you asked), in the chat open now.
    expect(bots.runTrigger(id, 'nightly')).toBe(true);
    expect(said[2]!.channel).toBe(botChannel(id, chat));
    expect(said[2]!.text).toMatch(/you, with Run Now/);
    expect(() => bots.runTrigger(id, 'gone')).toThrow(/deleted/);
    // The phone's row says when it runs next (none now: it's off).
    void store;
  });

  it('Your Mac’s trigger goes to its first chat; the phone sees the next run', async () => {
    const now = at('2026-11-10T06:00:00Z');
    const { bots, said, store } = setup({ now: () => now });
    new BotFolder(bots.dirOf(MAC_BOT)).writeBot({ version: 1, triggers: [{ id: 'morning', trigger: { kind: 'schedule', every: 'day', at: '08:00', missed: 'skip' }, message: 'What’s on today?' }] });
    bots.refresh();
    expect(bots.runTrigger(MAC_BOT, 'morning')).toBe(true);
    expect(said[0]!.channel).toBe(ASSISTANT_CHANNEL);
    const mac = store.getState().bots.bots.find((b) => b.id === MAC_BOT)!;
    expect(mac.nextRun).toBe(at('2026-11-10T08:00:00Z'));
    const home = homeView(store.getState(), { mac: { name: 'Mac', version: '1' } } as never);
    expect(home.bots?.find((b) => b.mac)).toMatchObject({ nextRun: at('2026-11-10T08:00:00Z'), nextRunName: 'Every day at 8:00' });
  });

  it('an event trigger is watched by Sentinels’ own watchers, under the bot’s project', async () => {
    const home = tmp();
    const macDir = path.join(home, 'assistant', 'work');
    mkdirSync(macDir, { recursive: true });
    const store = new Store(initialState('room', 'auto'));
    const bots = new Bots({
      store,
      home,
      macDir,
      selfId: () => ME,
      secrets: { values: () => ({}), set: () => undefined },
      watch: false,
      knowledge: (dir, id) => new Knowledge(dir, id, async () => undefined),
      submit: () => true,
      triggerTickMs: 0,
      // Uptime polls: a fetch that never answers in the test's time.
      triggerEvents: { fetch: () => new Promise(() => undefined) },
    });
    stopped.push(bots);
    const id = await bots.create({ name: 'Watcher' });
    await patchBot(bots, id, { triggers: [{ id: 'site', trigger: { kind: 'uptime', url: 'https://staging.example.com', minutes: 5 }, message: 'Staging is down: find out why' }] }, undefined);
    expect(bots.watchingTriggers()).toEqual([`bot~${id}~site`]);
    await patchBot(bots, id, { triggers: null }, undefined);
    expect(bots.watchingTriggers()).toEqual([]);
  });
});

describe('several chats per bot', () => {
  it('starts, opens and deletes chats like Your Mac’s tabs, within your Open chats limit', async () => {
    const { bots } = setup({ chatLimit: 2 });
    const id = await bots.create({ name: 'Supa' });
    const first = bots.list().find((b) => b.id === id)!;
    expect(first.chats?.map((c) => c.id)).toEqual(['main']);
    expect(first.channel).toBe(botChannel(id));
    const chat = bots.newChat(id);
    expect(bots.list().find((b) => b.id === id)?.channel).toBe(botChannel(id, chat));
    // The limit counts a bot's chats as Your Mac's.
    expect(() => bots.newChat(id)).toThrow();
    bots.openChat(id, 'main');
    expect(bots.list().find((b) => b.id === id)?.channel).toBe(botChannel(id));
    expect(bots.forRun(botChannel(id, chat), ME)).toBeDefined();
    expect(bots.forRun(botChannel(id, 'zzz9'), ME)).toBeUndefined();
    await bots.deleteChat(id, 'main');
    expect(bots.list().find((b) => b.id === id)?.chats?.map((c) => c.id)).toEqual([chat]);
    // The last one leaves a fresh first chat.
    await bots.deleteChat(id, chat);
    expect(bots.list().find((b) => b.id === id)?.chats?.map((c) => c.id)).toEqual(['main']);
    expect(() => bots.newChat(MAC_BOT)).toThrow(/its own tabs/);
    expect(bots.channelsOf(id)).toEqual([botChannel(id), `bot:${id}:test`]);
  });

  it('the phone lists them on the bot and can open each', async () => {
    const { bots, store } = setup();
    const id = await bots.create({ name: 'Supa' });
    const chat = bots.newChat(id);
    const home = homeView(store.getState(), { mac: { name: 'Mac', version: '1' } } as never);
    const row = home.bots?.find((b) => b.id === id);
    expect(row?.topic).toBe(`conv:${botChannel(id, chat)}`);
    expect(row?.chats?.map((c) => c.topic)).toEqual([`conv:${botChannel(id)}`, `conv:${botChannel(id, chat)}`]);
  });
});

describe('a bot’s MCPs on other runtimes', () => {
  const mcp = { servers: { supabase: { command: 'npx', args: ['-y', 'supabase-mcp'], env: { TOKEN: 't' } }, linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer x' } }, odd: { type: 'ws' } }, strict: true as const };

  it('splits .mcp.json into started and HTTP servers', () => {
    const s = placeServers(mcp);
    expect(Object.keys(s.started)).toEqual(['supabase']);
    expect(Object.keys(s.http)).toEqual(['linear']);
    expect(s.skipped).toEqual(['odd']);
  });

  it('gives Codex both, with your own servers turned off for the run', () => {
    expect(codexPlaceConfig(mcp, ['github', 'supabase'])).toEqual({
      'mcp_servers.github.enabled': false,
      'mcp_servers.supabase': { command: 'npx', args: ['-y', 'supabase-mcp'], env: { TOKEN: 't' } },
      'mcp_servers.linear': { url: 'https://mcp.linear.app/mcp', http_headers: { Authorization: 'Bearer x' } },
    });
    expect(codexPlaceConfig(undefined, ['github'])).toEqual({});
  });

  it('gives OpenCode stdio and HTTP servers, Copilot HTTP ones (ACP)', () => {
    expect(acpStartedServers(mcp)).toEqual([{ name: 'supabase', command: 'npx', args: ['-y', 'supabase-mcp'], env: [{ name: 'TOKEN', value: 't' }] }]);
    expect(acpHttpServers(mcp)).toEqual([{ type: 'http', name: 'linear', url: 'https://mcp.linear.app/mcp', headers: [{ name: 'Authorization', value: 'Bearer x' }] }]);
  });

  it('says which targets of its combo get them, and warns of the rest', async () => {
    const servers = [
      { name: 'supabase', http: false },
      { name: 'linear', http: true },
    ];
    expect(mcpReach('codex', servers)).toEqual({ runtime: 'codex', gets: 'all', missing: [] });
    expect(mcpReach('copilot', servers)).toEqual({ runtime: 'copilot', gets: 'some', missing: ['supabase'] });
    expect(mcpReach('local', servers).gets).toBe('none');
    const { bots, store } = setup();
    store.dispatch({ type: 'prefs', prefs: { combos: [{ id: 'mixed', name: 'Mixed', targets: [{ runtime: 'claude', model: 'opus' }, { runtime: 'copilot' }, { runtime: 'local' }] }] } } as never);
    const id = await bots.create({ name: 'Supa' });
    const folder = bots.folder(id);
    folder.put('.mcp.json', JSON.stringify({ mcpServers: { supabase: { command: 'npx', args: [] }, linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } }));
    folder.writeBot({ version: 1, name: 'Supa', combo: 'mixed' });
    bots.refresh();
    expect(bots.reachOf(id).map((r) => [r.label, r.gets])).toEqual([
      ['Claude opus', 'all'],
      ['Copilot', 'some'],
      ['Local model', 'none'],
    ]);
    const problems = bots.list().find((b) => b.id === id)!.problems.join('\n');
    expect(problems).toMatch(/Copilot, which loads only its HTTP servers: supabase/);
    expect(problems).toMatch(/Local model, which doesn’t load the bot’s MCPs/);
  });
});

describe('a repository as knowledge', () => {
  function repo(): string {
    const root = path.join(tmp(), 'my-app');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(path.join(root, 'README.md'), '# My app\n\nDeploys go through the staging pipeline first.\n');
    writeFileSync(path.join(root, 'src', 'auth.ts'), 'export function rowLevelSecurity() { return "policies on every table"; }\n');
    writeFileSync(path.join(root, '.env'), 'SUPABASE_KEY=sk-secret\n');
    writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(path.join(root, 'src', 'huge.json'), 'x'.repeat(MAX_REPO_FILE_BYTES + 1));
    writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = "not knowledge"');
    return root;
  }

  it('indexes only text files, never secrets, built folders or what is too big', () => {
    const listed = repoFiles(repo());
    expect(listed.files.map((f) => f.rel).sort()).toEqual(['README.md', 'src/auth.ts']);
    expect(listed.skipped).toBeGreaterThanOrEqual(3);
  });

  it.skipIf(!hasGit)('in a git repository, follows its .gitignore', () => {
    const root = repo();
    writeFileSync(path.join(root, '.gitignore'), 'src/auth.ts\nnode_modules\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    expect(repoFiles(root).files.map((f) => f.rel).sort()).toEqual(['README.md']);
  });

  it('adds a folder, indexes it on demand and searches it; the status says how many', async () => {
    const dir = tmp();
    const k = new Knowledge(dir, 'supa', async () => undefined);
    const root = repo();
    const source = await k.addRepo(root);
    expect(source).toMatchObject({ kind: 'repo', name: 'my-app', origin: root });
    const indexed = await k.reindex();
    expect(indexed.repos?.[source.id]).toMatchObject({ files: 2 });
    const found = await k.search('row level security policies');
    expect(found.backend).toBe('local');
    expect(found.passages[0]?.source).toBe('my-app/src/auth.ts');
    expect((await k.search('SUPABASE_KEY sk-secret')).passages).toEqual([]);
    // Index Again reads it as it is now.
    writeFileSync(path.join(root, 'DEPLOY.md'), 'Rollback with the blue-green switch.\n');
    expect((await k.reindex()).repos?.[source.id]?.files).toBe(3);
    expect((await k.search('blue-green rollback')).passages[0]?.source).toBe('my-app/DEPLOY.md');
    // Removing it never touches your folder.
    k.remove(source.id);
    expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toMatch(/My app/);
    await expect(k.addRepo(path.join(root, 'nope'))).rejects.toThrow(/no folder/);
    await expect(k.addRepo(dir)).rejects.toThrow(/bot’s own folder/);
    expect(isGitAddress('https://github.com/org/repo')).toBe(true);
    expect(isGitAddress('git@github.com:org/repo.git')).toBe(true);
    expect(isGitAddress('~/code/app')).toBe(false);
  });
});

describe('OpenViking (a fake ov: it isn’t set up on this computer)', () => {
  const FAKE = path.join(__dirname, 'fixtures', 'fake-ov.mjs');

  it('indexes into it and searches it end to end; falls back to the local index when it stops answering', async () => {
    const store = tmp();
    const dir = tmp();
    const viking = { bin: process.execPath, pre: [FAKE, store] };
    const k = new Knowledge(dir, 'supa', async () => viking);
    k.addText('RLS guide', 'Row level security: enable it on every table, then write a policy per role.');
    const root = path.join(tmp(), 'infra');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'deploy.md'), 'Deploy with the blue-green switch; staging first.');
    writeFileSync(path.join(root, '.env'), 'TOKEN=secret');
    await k.addRepo(root);
    const indexed = await k.reindex();
    expect(indexed.backend).toBe('openviking');
    const calls = readFileSync(path.join(store, 'calls.log'), 'utf8');
    expect(calls).toMatch(/^rm viking:\/\/resources\/beluga-bots\/supa -r$/m);
    expect(calls).toMatch(/add-resource .*rls-guide\.md -p viking:\/\/resources\/beluga-bots\/supa --wait/);
    // The repository goes in as its staged text files only: never its .env.
    expect(readFileSync(path.join(store, 'index.json'), 'utf8')).not.toMatch(/TOKEN=secret/);
    const found = await k.search('row level security policy');
    expect(found.backend).toBe('openviking');
    expect(found.passages[0]?.file).toBe('viking://resources/beluga-bots/supa/rls-guide.md');
    expect((await k.search('blue-green deploy')).passages[0]?.file).toBe('viking://resources/beluga-bots/supa/repo-infra/deploy.md');
    // It stops answering: the local index answers instead.
    writeFileSync(path.join(store, 'down'), '');
    const fallback = await k.search('row level security policy');
    expect(fallback.backend).toBe('local');
    expect(fallback.passages[0]?.source).toBe('RLS guide');
    rmSync(path.join(store, 'down'));
  });
});
