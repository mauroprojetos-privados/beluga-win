import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMacToolDefs } from '../src/agent/mac-tools.js';
import type { MacTools } from '../src/agent/types.js';
import { Bots } from '../src/core/bots/bots.js';
import { botAgent, routeTask } from '../src/core/bots/dispatch.js';
import { BotConflict, BotFolder, fingerprint, isBotFile, mcpServersOf } from '../src/core/bots/folder.js';
import { Knowledge, chunksOf, htmlText, searchIndex, termsOf, vikingPassages } from '../src/core/bots/knowledge.js';
import { BOT_FILE_VERSION, MAC_BOT, botChannel, botFileText, botOfChannel, botStatusLine, botTestChannel, orchestrates, parseBotFile, parseSkillHeader, plainSecretsIn, secretsIn } from '../src/core/bots/schema.js';
import { applyDraft, draftFiles, exportBot, importBot, patchBot, saveFile, saveSkill } from '../src/core/bots/studio.js';
import { readZip, safeName, writeZip } from '../src/core/bots/zip.js';
import { Store, initialState } from '../src/core/store.js';
import { ASSISTANT_CHANNEL } from '../src/shared/assistant.js';
import type { Project } from '../src/workspaces/types.js';

/**
 * Bots (docs/bots.md, routing Phases 6, 6b and 6c): Your Mac is the first bot and changes nothing
 * until its folder sets something; a bot is a folder whose files are the source of truth; Bot Studio
 * saves each change as a commit and refuses one made against a file that changed since.
 */

const ME = 'me';
const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'beluga-bots-'));
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

function setup(opts: { secrets?: Record<string, string>; createPlan?: ConstructorParameters<typeof Bots>[0]['createPlan'] } = {}) {
  const home = tmp();
  const macDir = path.join(home, 'assistant', 'work');
  mkdirSync(macDir, { recursive: true });
  const store = new Store(initialState('room', 'auto'));
  const project: Project = { id: 'p1', name: 'Triexis', root: path.join(home, 'triexis'), base: 'main', workspaces: [] };
  store.dispatch({ type: 'projects', projects: [project] });
  const secrets: Record<string, string> = { ...(opts.secrets ?? {}) };
  const bots = new Bots({
    store,
    home,
    macDir,
    selfId: () => ME,
    secrets: { values: () => secrets, set: (n, v) => (v === undefined ? delete secrets[n] : (secrets[n] = v)) },
    macTools: () => ({ listWork: () => 'Triexis' }) as unknown as MacTools,
    ...(opts.createPlan ? { createPlan: opts.createPlan } : {}),
    watch: false,
    knowledge: (dir, id) => new Knowledge(dir, id, async () => undefined),
  });
  stopped.push(bots);
  return { bots, store, home, macDir, secrets };
}

describe('bot.json', () => {
  it('reads an empty or missing file as a bot with nothing set', () => {
    expect(parseBotFile(undefined)).toEqual({ bot: { version: BOT_FILE_VERSION }, problems: [] });
    expect(parseBotFile('  ')).toEqual({ bot: { version: BOT_FILE_VERSION }, problems: [] });
  });

  it('drops a bad field alone and says why; a bad category alone too', () => {
    const p = parseBotFile(JSON.stringify({ version: 1, name: 'Supa', color: 'red', categories: { deep: 'combo:strong', bad: 'nowhere' }, autonomy: 'autopilot' }));
    expect(p.bot).toEqual({ version: 1, name: 'Supa', categories: { deep: 'combo:strong' }, autonomy: 'autopilot' });
    expect(p.problems.join('\n')).toMatch(/color/);
    expect(p.problems.join('\n')).toMatch(/bad/);
  });

  it('reads a newer Beluga’s file for what it knows, and says so', () => {
    const p = parseBotFile(JSON.stringify({ version: 9, name: 'Kami', future: true }));
    expect(p.bot).toEqual({ version: 1, name: 'Kami' });
    expect(p.problems[0]).toMatch(/newer Beluga/);
  });

  it('is not JSON: an empty bot with the reason', () => {
    expect(parseBotFile('{nope').problems[0]).toMatch(/isn’t valid JSON/);
  });

  it('writes stable text that reads back the same', () => {
    const bot = { version: 1, name: 'Supa', categories: { supabase: 'bot:supa' }, projects: [] };
    expect(parseBotFile(botFileText(bot)).bot).toEqual({ version: 1, name: 'Supa', categories: { supabase: 'bot:supa' } });
  });

  it('orchestrates only once something of Phase 6 is set', () => {
    expect(orchestrates({ version: 1 }, '')).toBe(false);
    expect(orchestrates({ version: 1, name: 'x' }, '  ')).toBe(false);
    expect(orchestrates({ version: 1 }, 'You are the tech lead')).toBe(true);
    expect(orchestrates({ version: 1, combo: 'strong' }, '')).toBe(true);
    expect(orchestrates({ version: 1, autonomy: 'ask' }, '')).toBe(true);
  });
});

describe('channels, status and checks', () => {
  it('names Your Mac’s conversation as the assistant’s, another bot’s as bot:<id>', () => {
    expect(botChannel(MAC_BOT)).toBe(ASSISTANT_CHANNEL);
    expect(botChannel('supa')).toBe('bot:supa');
    expect(botOfChannel('bot:supa')).toEqual({ id: 'supa', test: false, chat: 'main' });
    expect(botOfChannel(botTestChannel('supa'))).toEqual({ id: 'supa', test: true, chat: 'test' });
    // Another of its chats (its tabs); never a name that isn't a chat's, nor `main` spelled out.
    expect(botOfChannel('bot:supa:ab12c')).toEqual({ id: 'supa', test: false, chat: 'ab12c' });
    expect(botOfChannel('bot:supa:other-chat')).toBeUndefined();
    expect(botOfChannel('bot:supa:main')).toBeUndefined();
    expect(botOfChannel('bot:supa:a:b')).toBeUndefined();
    expect(botOfChannel('ws:1')).toBeUndefined();
  });

  it('says what a bot is doing in a line', () => {
    expect(botStatusLine({ planId: 'p', planTitle: 'CSV', done: 2, total: 6, waiting: 'Contrast check' })).toBe('2 of 6 done · waiting on Contrast check');
    expect(botStatusLine({ planId: 'p', planTitle: 'CSV', done: 0, total: 0, draft: true })).toMatch(/waiting for your Approve/);
    expect(botStatusLine(undefined)).toBeUndefined();
  });

  it('finds the secrets a .mcp.json names, and a secret written in it', () => {
    const ok = JSON.stringify({ mcpServers: { supabase: { command: 'npx', env: { SUPABASE_TOKEN: '${env:SUPABASE_TOKEN}' } } } });
    expect(secretsIn(ok)).toEqual(['SUPABASE_TOKEN']);
    expect(plainSecretsIn(ok)).toEqual([]);
    expect(plainSecretsIn(JSON.stringify({ mcpServers: { s: { env: { API_KEY: 'abc123' } } } }))).toEqual(['API_KEY']);
    expect(plainSecretsIn(JSON.stringify({ mcpServers: { s: { args: ['ghp_abcdef'] } } }))).toEqual(['args']);
  });

  it('fills a .mcp.json’s secrets from yours, never keeping them in the file', () => {
    const text = JSON.stringify({ mcpServers: { supabase: { command: 'npx', args: ['--token', '${env:T}'] }, 'bad name!': {} } });
    expect(mcpServersOf(text, { T: 's3cret' })).toEqual({ supabase: { command: 'npx', args: ['--token', 's3cret'] } });
    expect(mcpServersOf('nope', {})).toEqual({});
  });

  it('checks a skill’s header the way Claude Code needs it', () => {
    expect(parseSkillHeader('---\nname: rls\ndescription: RLS patterns\n---\nbody')).toEqual({ ok: true, header: { name: 'rls', description: 'RLS patterns' } });
    expect(parseSkillHeader('no header')).toMatchObject({ ok: false });
    expect(parseSkillHeader('---\nname: RLS\ndescription: x\n---\n')).toMatchObject({ ok: false, why: expect.stringMatching(/lowercase/) });
    expect(parseSkillHeader('---\nname: rls\n---\n')).toMatchObject({ ok: false, why: expect.stringMatching(/description/) });
  });

  it('only a bot’s own files can be written', () => {
    expect(isBotFile('CLAUDE.md')).toBe(true);
    expect(isBotFile('.claude/skills/rls/SKILL.md')).toBe(true);
    expect(isBotFile('.claude/agents/auditor.md')).toBe(true);
    expect(isBotFile('.claude/settings.json')).toBe(false);
    expect(isBotFile('.claude/skills/../../x')).toBe(false);
    expect(isBotFile('src/index.ts')).toBe(false);
  });
});

describe('routing a dispatched task', () => {
  const st = { runtimes: [{ id: 'claude', label: 'Claude', available: true, models: [] }] as never, prefs: { combos: [{ id: 'strong', name: 'Strong', targets: [{ runtime: 'claude', model: 'opus' }] }, { id: 'economy', name: 'Economy', targets: [{ runtime: 'claude', model: 'haiku' }] }], difficultyCombos: { hard: 'strong' } } };

  it('goes by category to a combo, or to another bot on its combo', () => {
    const bot = { version: 1, categories: { deep: 'combo:strong', supabase: 'bot:supa' } };
    const supa = { name: 'Supa', file: { version: 1, combo: 'economy' } };
    expect(routeTask(st, bot, { category: 'deep' }, () => undefined)).toMatchObject({ agent: { combo: 'strong' }, why: 'deep → Strong' });
    expect(routeTask(st, bot, { category: 'supabase' }, (id) => (id === 'supa' ? supa : undefined))).toMatchObject({ agent: { combo: 'economy' }, bot: 'supa', why: 'supabase → Supa' });
  });

  it('falls back to the bot’s difficulty map, then Settings’, then nothing', () => {
    expect(routeTask(st, { version: 1, difficulty: { simple: 'economy' } }, { difficulty: 'simple' }, () => undefined)).toMatchObject({ agent: { combo: 'economy' } });
    expect(routeTask(st, { version: 1 }, { difficulty: 'hard' }, () => undefined)).toMatchObject({ agent: { combo: 'strong' } });
    expect(routeTask(st, { version: 1 }, { category: 'visual' }, () => undefined)).toEqual({});
  });

  it('the bot itself runs on its combo (none: your agent)', () => {
    expect(botAgent(st, { version: 1, combo: 'strong' })).toMatchObject({ combo: 'strong' });
    expect(botAgent(st, { version: 1, combo: 'gone' })).toBeUndefined();
  });
});

describe('a bot’s folder', () => {
  it('refuses a save over a file that changed since it was read', () => {
    const folder = new BotFolder(tmp());
    folder.put('CLAUDE.md', 'first');
    const seen = fingerprint(folder.read('CLAUDE.md'));
    writeFileSync(path.join(folder.dir, 'CLAUDE.md'), 'edited outside');
    expect(() => folder.put('CLAUDE.md', 'mine', seen)).toThrow(BotConflict);
    expect(folder.read('CLAUDE.md')).toBe('edited outside');
    folder.put('CLAUDE.md', 'mine', fingerprint('edited outside'));
    expect(folder.read('CLAUDE.md')).toBe('mine');
  });

  it('refuses a secret written into .mcp.json, and JSON that doesn’t read', () => {
    const folder = new BotFolder(tmp());
    expect(() => folder.put('.mcp.json', JSON.stringify({ mcpServers: { s: { env: { TOKEN: 'abc' } } } }))).toThrow(/secret/);
    expect(() => folder.put('.mcp.json', '{')).toThrow(/valid JSON/);
  });

  it.skipIf(!hasGit)('commits each save, lists versions, undoes and restores', async () => {
    const folder = new BotFolder(tmp());
    folder.put('CLAUDE.md', 'v1');
    await folder.commit('Persona');
    folder.put('CLAUDE.md', 'v2');
    folder.put('memory.md', 'learned');
    await folder.commit('Persona again');
    expect(await folder.commit('nothing')).toBeUndefined();
    const versions = await folder.versions();
    expect(versions.map((v) => v.message)).toEqual(['Persona again', 'Persona']);
    await folder.undo();
    expect(folder.read('CLAUDE.md')).toBe('v1');
    expect(folder.read('memory.md')).toBeUndefined();
    expect((await folder.versions())[0]!.message).toBe('Undo: Persona again');
    await folder.restore(versions[0]!.id);
    expect(folder.read('CLAUDE.md')).toBe('v2');
    // Only the bot's own files are tracked (Your Mac's work/ holds its scratch too).
    writeFileSync(path.join(folder.dir, 'report.csv'), 'a,b');
    expect(await folder.commit('scratch only')).toBeUndefined();
  });
});

describe('knowledge', () => {
  it('cuts text into overlapping passages and folds words', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about row level security and policies.`).join('\n\n');
    const chunks = chunksOf(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 950)).toBe(true);
    expect(termsOf('Ação RLS-policy')).toEqual(['acao', 'rls', 'policy']);
  });

  it('finds the passage that matches, best first', () => {
    const index = { chunks: [{ file: 'a', source: 'A', text: 'deploy to staging with docker', terms: { deploy: 1, staging: 1, docker: 1 } as Record<string, number>, len: 5 }, { file: 'b', source: 'B', text: 'row level security', terms: { row: 1, level: 1, security: 1 } as Record<string, number>, len: 3 }], df: { deploy: 1, staging: 1, docker: 1, row: 1, level: 1, security: 1 }, avg: 4 };
    expect(searchIndex(index, 'security policies', 5).map((p) => p.source)).toEqual(['B']);
    expect(searchIndex(index, 'nothing here', 5)).toEqual([]);
  });

  it('adds sources, never a secret, and searches only its own (local index, said so)', async () => {
    const a = new Knowledge(tmp(), 'a', async () => undefined);
    const b = new Knowledge(tmp(), 'b', async () => undefined);
    a.addText('RLS guide', 'Enable row level security on every table; write a policy per organization.');
    b.addText('Deploy runbook', 'Deploy with docker compose to staging, then production.');
    const env = path.join(tmp(), '.env');
    writeFileSync(env, 'TOKEN=1');
    expect(() => a.addFile(env)).toThrow(/secret/);
    await a.reindex();
    const found = await a.search('row level security policy');
    expect(found.backend).toBe('local');
    expect(found.passages[0]?.source).toBe('RLS guide');
    expect((await a.search('docker staging')).passages).toEqual([]);
    expect(a.read().sources.map((s) => s.name)).toEqual(['RLS guide']);
  });

  it('reads web pages as text, and OpenViking’s answers loosely', () => {
    expect(htmlText('<html><script>x()</script><p>Hello&nbsp;<b>world</b></p></html>')).toBe('Hello world');
    expect(vikingPassages(JSON.stringify({ results: [{ uri: 'viking://resources/beluga-bots/supa/rls.md', abstract: 'RLS', score: 0.9 }] }), 5)).toEqual([{ source: 'rls.md', file: 'viking://resources/beluga-bots/supa/rls.md', text: 'RLS', score: 0.9 }]);
    expect(vikingPassages('not json', 5)).toEqual([]);
  });
});

describe('zip', () => {
  it('writes and reads back, and refuses names that climb out', () => {
    const buf = writeZip([{ name: 'supa/bot.json', data: Buffer.from('{"version":1}') }, { name: 'supa/knowledge/a.md', data: Buffer.from('x'.repeat(5000)) }]);
    const back = readZip(buf);
    expect(back.map((e) => e.name)).toEqual(['supa/bot.json', 'supa/knowledge/a.md']);
    expect(back[1]!.data.toString()).toBe('x'.repeat(5000));
    expect(safeName('../etc/passwd')).toBeUndefined();
    expect(safeName('/abs')).toBeUndefined();
    expect(safeName('C:/x')).toBeUndefined();
    expect(() => readZip(Buffer.from('nope'))).toThrow(/zip/);
  });
});

describe('Your Mac, the first bot', () => {
  it('changes nothing until its folder sets something', () => {
    const { bots } = setup();
    expect(bots.macExtras()).toBeUndefined();
    const mac = bots.list()[0]!;
    expect(mac).toMatchObject({ id: MAC_BOT, mac: true, orchestrates: false, channel: ASSISTANT_CHANNEL, problems: [] });
  });

  it('with a persona and a combo: its brief, its agent and plan_dispatch', async () => {
    const { bots, macDir } = setup();
    writeFileSync(path.join(macDir, 'CLAUDE.md'), 'You are the tech lead of Triexis.');
    writeFileSync(path.join(macDir, 'bot.json'), JSON.stringify({ version: 1, combo: 'strong', categories: { quick: 'combo:economy' } }));
    const extras = bots.macExtras()!;
    expect(extras.brief).toMatch(/tech lead of Triexis/);
    expect(extras.brief).toMatch(/quick → Economy/);
    expect(extras.agent).toMatchObject({ combo: 'strong' });
    expect(extras.tools.dispatchPlan).toBeTypeOf('function');
    const defs = createMacToolDefs({ ...extras.tools } as unknown as MacTools).map((d) => d.name);
    expect(defs).toContain('plan_dispatch');
    expect(defs).not.toContain('knowledge_search');
  });

  it('dispatches a plan: each task’s category recorded, routed, and the bot’s status follows it', async () => {
    const made: Array<{ autonomy: string; approve: boolean; body: { milestones: unknown[] } }> = [];
    const { bots, macDir, store } = setup({
      createPlan: async (input) => {
        made.push(input as never);
        return { id: 'plan1' };
      },
    });
    writeFileSync(path.join(macDir, 'bot.json'), JSON.stringify({ version: 1, categories: { deep: 'combo:strong' }, autonomy: 'ask' }));
    const said = await bots.dispatchPlan(MAC_BOT, { project: 'triexis', title: 'Fix recognise', goal: 'g', milestones: [{ title: 'M1', tasks: [{ id: 'hook', title: 'Fix the hook', category: 'deep' }, { id: 'test', title: 'Test it', difficulty: 'simple', blockedBy: ['hook'] }, { id: 'odd', title: 'Odd', category: 'visual' }] }] });
    expect(made[0]).toMatchObject({ autonomy: 'gated', approve: false });
    expect(said).toMatch(/plan:plan1/);
    expect(said).toMatch(/Not in your map.*visual/);
    expect(bots.router('plan1')?.('hook')?.why).toMatch(/deep → /);
    expect(bots.router('other')).toBeUndefined();
    expect(bots.botOfPlan('plan1')).toBe(MAC_BOT);
    expect(existsSync(path.join(bots['deps' as never]['home' as never] as string, 'bot-chats', 'dispatch.json'))).toBe(true);
    expect(store.getState().bots.bots[0]!.id).toBe(MAC_BOT);
    await expect(bots.dispatchPlan(MAC_BOT, { project: 'nowhere', title: 't', goal: 'g', milestones: [{ title: 'm', tasks: [{ id: 'a', title: 'a' }] }] })).rejects.toThrow(/no project called nowhere/);
  });
});

describe('other bots', () => {
  it('New Bot makes a folder; its chat runs there with only its own MCPs, its Test chat touches no project', async () => {
    const { bots, store } = setup({ secrets: { SUPABASE_TOKEN: 't0k' } });
    const id = await bots.create({ name: 'Supa' });
    expect(id).toBe('supa');
    expect(bots.ids()).toEqual([MAC_BOT, 'supa']);
    const folder = bots.folder(id);
    folder.put('.mcp.json', JSON.stringify({ mcpServers: { supabase: { command: 'npx', env: { SUPABASE_TOKEN: '${env:SUPABASE_TOKEN}' } } } }));
    folder.put('bot.json', JSON.stringify({ version: 1, name: 'Supa', projects: ['p1'] }));
    const run = bots.forRun('bot:supa', ME)!;
    expect(run.place.cwd).toBe(folder.dir);
    expect(run.place.additionalDirectories).toEqual([store.getState().projects[0]!.root]);
    expect(run.place.mcp).toEqual({ servers: { supabase: { command: 'npx', env: { SUPABASE_TOKEN: 't0k' } } }, strict: true });
    expect(run.brief).toMatch(/You are "Supa"/);
    expect(bots.forRun('bot:supa', 'friend')).toBeUndefined();
    const test = bots.forRun(botTestChannel('supa'), ME)!;
    expect(test.place.additionalDirectories).toEqual([]);
    await expect(test.tools.startWorktree({ project: 'x', message: 'y' })).rejects.toThrow(/Test chat/);
    expect(bots.botOfConversation('bot:supa')).toEqual({ id: 'supa', name: 'Supa' });
  });

  it('says what’s wrong with its files: a missing secret, a bad skill header, a category pointing nowhere', async () => {
    const { bots } = setup();
    const id = await bots.create({ name: 'Juno' });
    const folder = bots.folder(id);
    folder.put('.mcp.json', JSON.stringify({ mcpServers: { vps: { command: 'ssh', env: { VPS_KEY: '${env:VPS_KEY}' } } } }));
    folder.put('.claude/skills/deploy/SKILL.md', 'no header here');
    folder.put('bot.json', JSON.stringify({ version: 1, name: 'Juno', categories: { db: 'bot:gone' } }));
    bots.refresh();
    const problems = bots.list().find((b) => b.id === id)!.problems.join('\n');
    expect(problems).toMatch(/Missing secret VPS_KEY/);
    expect(problems).toMatch(/Skill “deploy”: it has no header/);
    expect(problems).toMatch(/points to a bot that was deleted/);
  });

  it('can’t delete Your Mac; deletes another for good', async () => {
    const { bots } = setup();
    await expect(bots.remove(MAC_BOT)).rejects.toThrow(/can’t be deleted/);
    const id = await bots.create({ name: 'Tmp' });
    await bots.remove(id);
    expect(bots.ids()).toEqual([MAC_BOT]);
  });
});

describe('Bot Studio', () => {
  it.skipIf(!hasGit)('saves through the tabs as commits, and refuses a stale save', async () => {
    const { bots } = setup();
    const id = await bots.create({ name: 'Supa' });
    await patchBot(bots, id, { combo: 'strong', autonomy: 'autopilot' }, undefined);
    expect(bots.file(id)).toMatchObject({ name: 'Supa', combo: 'strong', autonomy: 'autopilot' });
    await patchBot(bots, id, { combo: null }, undefined);
    expect(bots.file(id).combo).toBeUndefined();
    await saveFile(bots, id, 'CLAUDE.md', 'Persona', undefined, 'Persona');
    await expect(saveFile(bots, id, 'CLAUDE.md', 'Again', fingerprint('something else'), 'Persona')).rejects.toThrow(BotConflict);
    await expect(saveSkill(bots, id, 'skill', 'rls', 'no header', undefined)).rejects.toThrow(/can’t be read/);
    await saveSkill(bots, id, 'skill', 'rls', '---\nname: rls\ndescription: RLS\n---\n', undefined);
    const versions = await bots.folder(id).versions();
    expect(versions.map((v) => v.message)).toEqual(['Skill rls', 'Persona', 'Model', 'Model', 'New bot: Supa']);
  });

  it.skipIf(!hasGit)('exports without secrets and imports as a new bot that asks for them', async () => {
    const { bots, secrets } = setup({ secrets: { SUPABASE_TOKEN: 'real-value' } });
    const id = await bots.create({ name: 'Supa' });
    const folder = bots.folder(id);
    folder.put('.mcp.json', JSON.stringify({ mcpServers: { supabase: { command: 'npx', env: { SUPABASE_TOKEN: '${env:SUPABASE_TOKEN}' } } } }));
    folder.put('CLAUDE.md', 'Only Supabase.');
    bots.knowledge(id).addText('RLS', 'row level security');
    writeFileSync(path.join(folder.dir, 'knowledge', '.env'), 'X=1');
    const out = exportBot(bots, id);
    const zip = readZip(Buffer.from(out.base64, 'base64'));
    expect(zip.map((e) => e.name).sort()).toEqual(['supa/.mcp.json', 'supa/CLAUDE.md', 'supa/bot.json', 'supa/knowledge.json', 'supa/knowledge/rls.md', 'supa/memory.md']);
    expect(zip.some((e) => e.data.toString().includes('real-value'))).toBe(false);
    expect(out.secrets).toEqual(['SUPABASE_TOKEN']);
    delete secrets.SUPABASE_TOKEN;
    const back = await importBot(bots, out.base64);
    expect(back.id).toBe('supa-2');
    expect(back.missing).toEqual(['SUPABASE_TOKEN']);
    expect(readFileSync(path.join(bots.folder('supa-2').dir, 'CLAUDE.md'), 'utf8')).toBe('Only Supabase.');
  });

  it('Create with Claude: Claude’s JSON becomes the bot’s files, without secrets', async () => {
    const draft = draftFiles(JSON.stringify({ name: 'Supa', icon: 'table', description: 'Supabase', persona: 'You only do Supabase.', skills: [{ name: 'Migrations', description: 'how', body: 'steps' }, { name: 'x', description: '' }], mcp: { supabase: { command: 'npx', env: { T: '${env:T}' } } }, knowledge: ['https://supabase.com/docs'] }));
    expect(Object.keys(draft.files).sort()).toEqual(['.claude/skills/migrations/SKILL.md', '.mcp.json', 'CLAUDE.md', 'bot.json']);
    expect(draft.notes).toMatch(/supabase.com\/docs/);
    expect(() => draftFiles('{broken')).toThrow(/didn’t read/);
    const { bots } = setup();
    const id = await applyDraft(bots, undefined, draft.files);
    expect(bots.file(id)).toMatchObject({ name: 'Supa', icon: 'table' });
    expect(bots.folder(id).skills().map((s) => s.name)).toEqual(['migrations']);
    await expect(applyDraft(bots, id, { '../evil': 'x' })).rejects.toThrow(/isn’t one of a bot’s files/);
  });
});
