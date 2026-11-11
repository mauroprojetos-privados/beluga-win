import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Complete } from '../../agent/runtime/types.js';
import { claudeMcpSession } from '../../agent/runtime/claude/mcp-connect.js';
import { ownerMcpEntries } from '../../agent/runtime/claude/owner-mcp.js';
import { isSecretPath } from '../shares.js';
import type { Bots } from './bots.js';
import { BOT_JSON, BotFolder, KNOWLEDGE_DIR, KNOWLEDGE_JSON, MCP_JSON, MEMORY, PERSONA, fingerprint, isBotFile, mcpNames, mcpServersOf } from './folder.js';
import { type BotFile, MAC_BOT, SKILL_NAME, botFileText, parseBotFile, parseSkillHeader, secretsIn } from './schema.js';
import { readZip, safeName, writeZip } from './zip.js';

/**
 * Bot Studio's work (docs/bots.md, Phase 6c): what Settings › Bots › (a bot) shows and saves. Every
 * save writes the file, commits it in the bot's own git and refreshes the screens; a file changed
 * since the screen read it is refused (folder.ts BotConflict) instead of overwritten.
 */

/** One skill or sub-agent as Bot Studio lists it. */
export interface SkillView {
  readonly name: string;
  readonly description?: string;
  readonly problem?: string;
  readonly text: string;
}

/** A bot's files, as Bot Studio's tabs show them. */
export interface BotView {
  readonly id: string;
  readonly dir: string;
  readonly bot: BotFile;
  readonly persona: string;
  readonly mcp: string;
  readonly memory: string;
  readonly skills: readonly SkillView[];
  readonly agents: readonly SkillView[];
  /** The servers its .mcp.json declares. */
  readonly servers: readonly string[];
  /** The secrets .mcp.json names, and whether each is set (never its value). */
  readonly secrets: ReadonlyArray<{ readonly name: string; readonly set: boolean }>;
  readonly knowledge: { readonly sources: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly name: string; readonly origin?: string; readonly size: number; readonly addedAt: number }>; readonly indexed?: { readonly at: number; readonly backend: 'openviking' | 'local'; readonly chunks: number; readonly skipped?: readonly string[] }; readonly backend: 'openviking' | 'local' };
  readonly problems: readonly string[];
  /** Each file's fingerprint as read, sent back with a save. */
  readonly prints: Readonly<Record<string, string>>;
}

export async function botView(bots: Bots, id: string): Promise<BotView> {
  const folder = bots.folder(id);
  const docs = folder.docs();
  const have = bots.secretValues();
  const k = bots.knowledge(id);
  const kf = k.read();
  const info = bots.list().find((b) => b.id === id);
  return {
    id,
    dir: folder.dir,
    bot: docs.parsed.bot,
    persona: docs.persona,
    mcp: docs.mcp,
    memory: docs.memory,
    skills: docs.skills.map((s) => ({ name: s.name, ...(s.header ? { description: s.header.description } : {}), ...(s.problem ? { problem: s.problem } : {}), text: s.text })),
    agents: docs.agents.map((s) => ({ name: s.name, ...(s.header ? { description: s.header.description } : {}), ...(s.problem ? { problem: s.problem } : {}), text: s.text })),
    servers: mcpNames(docs.mcp),
    secrets: secretsIn(docs.mcp).map((name) => ({ name, set: Boolean(have[name]) })),
    knowledge: { sources: kf.sources.map((s) => ({ id: s.id, kind: s.kind, name: s.name, ...(s.origin ? { origin: s.origin } : {}), size: s.size, addedAt: s.addedAt })), ...(kf.indexed ? { indexed: kf.indexed } : {}), backend: await k.backend() },
    problems: info?.problems ?? [],
    prints: { ...docs.prints, [KNOWLEDGE_JSON]: fingerprint(folder.read(KNOWLEDGE_JSON)) },
  };
}

/** Save one of a bot's files as one commit ("Persona", "Tools"…) → its version id (none: nothing changed, or no git). */
export async function saveFile(bots: Bots, id: string, rel: string, text: string | undefined, expect: string | undefined, message: string): Promise<string | undefined> {
  const folder = bots.folder(id);
  folder.put(rel, text, expect);
  const version = await folder.commit(message);
  bots.refresh();
  return version;
}

/** bot.json changed by a patch (the Identity and Model tabs): what's set replaces, null clears. */
export async function patchBot(bots: Bots, id: string, patch: Readonly<Record<string, unknown>>, expect: string | undefined): Promise<string | undefined> {
  const folder = bots.folder(id);
  const now = folder.bot().bot as Record<string, unknown>;
  const next: Record<string, unknown> = { ...now };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  const parsed = parseBotFile(JSON.stringify(next));
  if (parsed.problems.length) throw new Error(parsed.problems[0]);
  const keys = Object.keys(patch);
  return saveFile(bots, id, BOT_JSON, botFileText(parsed.bot), expect, keys.some((k) => ['name', 'icon', 'color', 'description', 'projects'].includes(k)) ? 'Identity' : 'Model');
}

/** A skill (or sub-agent) written: its header must read, its name must be a folder's. */
export async function saveSkill(bots: Bots, id: string, kind: 'skill' | 'agent', name: string, text: string | null, expect: string | undefined): Promise<string | undefined> {
  if (!SKILL_NAME.test(name)) throw new Error('A name is lowercase letters, digits and dashes');
  const rel = kind === 'skill' ? `.claude/skills/${name}/SKILL.md` : `.claude/agents/${name}.md`;
  if (text !== null) {
    const h = parseSkillHeader(text);
    if (!h.ok) throw new Error(`${kind === 'skill' ? 'The skill' : 'The sub-agent'} can’t be read: ${h.why}`);
  }
  return saveFile(bots, id, rel, text ?? undefined, expect, `${kind === 'skill' ? 'Skill' : 'Sub-agent'} ${name}${text === null ? ' removed' : ''}`);
}

/** Your own skills (~/.claude/skills), to copy one into a bot. */
export function yourSkills(home = os.homedir()): Array<{ readonly name: string; readonly description?: string }> {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills');
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && SKILL_NAME.test(d.name))
      .flatMap((d) => {
        try {
          const h = parseSkillHeader(readFileSync(path.join(dir, d.name, 'SKILL.md'), 'utf8'));
          return [{ name: d.name, ...(h.ok ? { description: h.header.description } : {}) }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Copy one of your skills (or another bot's) into a bot: its whole folder, text files only. */
export async function copySkill(bots: Bots, id: string, from: { readonly bot?: string; readonly name: string }, home = os.homedir()): Promise<string | undefined> {
  if (!SKILL_NAME.test(from.name)) throw new Error('That isn’t a skill');
  const src = from.bot ? path.join(bots.folder(from.bot).dir, '.claude', 'skills', from.name) : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills', from.name);
  if (!existsSync(path.join(src, 'SKILL.md'))) throw new Error(`There’s no skill ${from.name} there`);
  const folder = bots.folder(id);
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile() && !isSecretPath(abs) && statSync(abs).size <= 1024 * 1024) folder.put(`.claude/skills/${from.name}${r}`, readFileSync(abs, 'utf8'));
    }
  };
  walk(src, '');
  const version = await folder.commit(`Skill ${from.name} copied`);
  bots.refresh();
  return version;
}

// ------------------------------------------------------------------ tools (MCP)

/** A secret's name for a value found in a server you add: the variable's own, else SERVER_KEY. */
const secretName = (server: string, key: string): string => `${server}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1').slice(0, 64);

/**
 * One of your MCP servers (Settings › Agent › MCP) added to a bot's .mcp.json: its settings copied,
 * every env value and header moved out into a secret (`${env:NAME}`), the values saved with your
 * secrets in ~/.beluga/env.json.
 */
export async function addInstalledMcp(bots: Bots, id: string, name: string, expect: string | undefined): Promise<string | undefined> {
  const entry = ownerMcpEntries([os.homedir()]).find((e) => e.name === name);
  if (!entry) throw new Error(`There’s no MCP server of yours called ${name}`);
  const folder = bots.folder(id);
  const text = folder.read(MCP_JSON);
  let raw: { mcpServers?: Record<string, unknown> } = {};
  try {
    raw = text?.trim() ? (JSON.parse(text) as typeof raw) : {};
  } catch {
    throw new Error('.mcp.json isn’t valid JSON: fix it in the Tools tab first');
  }
  const short = name.replace(/^plugin:[^:]+:/, '').replace(/[^\w.-]/g, '-').slice(0, 64);
  const config = JSON.parse(JSON.stringify(entry.config)) as Record<string, unknown>;
  const have = bots.secretValues();
  const move = (obj: unknown, kind: string): void => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v !== 'string' || /^\$\{env:/.test(v)) continue;
      // An env value that's yours already under its own name stays that name.
      const n = kind === 'env' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) && (!have[k] || have[k] === v) ? k : secretName(short, k);
      if (have[n] !== v) bots.setSecret(n, v);
      (obj as Record<string, unknown>)[k] = `\${env:${n}}`;
    }
  };
  move(config.env, 'env');
  move(config.headers, 'headers');
  const next = { ...raw, mcpServers: { ...(raw.mcpServers ?? {}), [short]: config } };
  return saveFile(bots, id, MCP_JSON, `${JSON.stringify(next, null, 2)}\n`, expect, `Tool ${short} added`);
}

/** Your MCP servers a bot can take (names only). */
export function installedMcps(): Array<{ readonly name: string; readonly from: string }> {
  return ownerMcpEntries([os.homedir()]).map((e) => ({ name: e.name, from: e.from }));
}

/** Whether each of a bot's servers connects, as Claude Code says, with the reason when it doesn't. */
export async function checkTools(bots: Bots, id: string, settleMs = 12_000): Promise<Array<{ readonly name: string; readonly status: string; readonly error?: string; readonly tools?: number }>> {
  const folder = bots.folder(id);
  const text = folder.read(MCP_JSON);
  const names = mcpNames(text);
  if (!names.length) return [];
  const missing = folder.missingSecrets(bots.secretValues());
  const servers = mcpServersOf(text, bots.secretValues()) as unknown as Parameters<ReturnType<typeof claudeMcpSession>>[1];
  const session = claudeMcpSession()(folder.dir, servers);
  try {
    const until = Date.now() + settleMs;
    let statuses = await session.mcpServerStatus();
    while (statuses.some((s) => s.status === 'pending') && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      statuses = await session.mcpServerStatus();
    }
    return names.map((n) => {
      const s = statuses.find((x) => x.name === n) as { status: string; error?: string; tools?: unknown[] } | undefined;
      const needs = secretsIn(JSON.stringify((JSON.parse(text ?? '{}') as { mcpServers?: Record<string, unknown> }).mcpServers?.[n] ?? {})).filter((x) => missing.includes(x));
      const error = needs.length ? `missing secret ${needs.join(', ')}` : s?.error;
      return { name: n, status: needs.length ? 'failed' : (s?.status ?? 'failed'), ...(error ? { error } : !s ? { error: 'Claude Code didn’t start it' } : {}), ...(Array.isArray(s?.tools) ? { tools: s.tools.length } : {}) };
    });
  } finally {
    session.close();
  }
}

// ------------------------------------------------------------------ export and import

/** The files a bot's export carries: its own files, never a secret (they're `${env:}` in .mcp.json, the values stay here). */
function exportFiles(folder: BotFolder): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  const add = (rel: string): void => {
    const abs = path.join(folder.dir, rel);
    if (isSecretPath(abs)) return;
    try {
      if (statSync(abs).isFile()) out.push({ name: rel.replace(/\\/g, '/'), data: readFileSync(abs) });
    } catch {
      // Not there.
    }
  };
  for (const f of [BOT_JSON, PERSONA, MCP_JSON, MEMORY, KNOWLEDGE_JSON]) add(f);
  const walk = (rel: string): void => {
    let list: import('node:fs').Dirent[] = [];
    try {
      list = readdirSync(path.join(folder.dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else add(r);
    }
  };
  walk(KNOWLEDGE_DIR);
  walk('.claude/skills');
  walk('.claude/agents');
  return out;
}

/** A bot as a .zip, without secrets → its file name and bytes (base64 for the screens). */
export function exportBot(bots: Bots, id: string): { readonly name: string; readonly base64: string; readonly secrets: readonly string[] } {
  const folder = bots.folder(id);
  const files = exportFiles(folder);
  const name = `${(folder.bot().bot.name ?? id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || id}.zip`;
  return { name, base64: writeZip(files.map((f) => ({ name: `${id === MAC_BOT ? 'your-mac' : id}/${f.name}`, data: f.data }))).toString('base64'), secrets: secretsIn(folder.read(MCP_JSON) ?? '') };
}

/** A bot from a .zip (an export): a new bot of its own, and the secrets it needs that aren't set here. */
export async function importBot(bots: Bots, base64: string): Promise<{ readonly id: string; readonly missing: readonly string[] }> {
  const entries = readZip(Buffer.from(base64, 'base64'));
  // An export puts everything in one folder: that folder is the bot.
  const firsts = new Set(entries.map((e) => e.name.replace(/\\/g, '/').split('/')[0]));
  const prefix = firsts.size === 1 && !entries.some((e) => e.name === BOT_JSON) ? `${[...firsts][0]}/` : '';
  const files = entries.flatMap((e) => {
    const n = safeName(e.name);
    if (!n || !n.startsWith(prefix)) return [];
    const rel = n.slice(prefix.length);
    const knowledge = rel.startsWith(`${KNOWLEDGE_DIR}/`) && !rel.slice(KNOWLEDGE_DIR.length + 1).split('/').some((s) => s.startsWith('.'));
    return (isBotFile(rel) || knowledge) && !isSecretPath(rel) ? [{ rel, data: e.data }] : [];
  });
  const botJson = files.find((f) => f.rel === BOT_JSON);
  if (!botJson) throw new Error('That .zip has no bot.json: it isn’t a bot’s export');
  const parsed = parseBotFile(botJson.data.toString('utf8'));
  const id = await bots.create({ name: parsed.bot.name ?? 'Imported bot', ...(parsed.bot.icon ? { icon: parsed.bot.icon } : {}) });
  const folder = bots.folder(id);
  for (const f of files) {
    if (f.rel === BOT_JSON) continue;
    const abs = path.join(folder.dir, f.rel);
    mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    writeFileSync(abs, f.data, { mode: 0o600 });
  }
  // Its routing names combos and bots of the computer it came from: kept, and checked here.
  folder.writeBot({ ...parsed.bot, name: folder.bot().bot.name ?? parsed.bot.name ?? 'Imported bot' });
  await folder.commit('Imported');
  await bots.knowledge(id).reindex().catch(() => undefined);
  bots.adopt(id);
  return { id, missing: folder.missingSecrets(bots.secretValues()) };
}

// ------------------------------------------------------------------ Create with Claude

/** What Create with Claude proposes: whole files, each shown as a diff against what's there before it's accepted. */
export interface BotDraft {
  readonly files: Readonly<Record<string, string>>;
  readonly notes?: string;
}

const DRAFT_SYSTEM = [
  'You draft a specialist bot for Beluga, an app that runs coding agents. A bot is a folder of files that Claude Code reads.',
  'Answer with one JSON object only, no prose around it:',
  '{"name": "Supa", "icon": "table", "description": "one line", "persona": "the CLAUDE.md text: who it is, what it does and never does, how it works, in markdown",',
  ' "categories": {"quick": "combo:economy"} (optional), "skills": [{"name": "kebab-name", "description": "when to use it", "body": "markdown steps"}],',
  ' "mcp": {"server-name": {"command": "npx", "args": ["-y", "pkg"], "env": {"TOKEN": "${env:SERVER_TOKEN}"}}} (only well-known servers; secrets always as ${env:NAME}, never a value),',
  ' "knowledge": ["https://docs… pages worth indexing"], "notes": "what the owner should check"}',
  'Keep the persona under 60 lines and at most 4 skills. Icons: bot, table, phone, server, branch, globe, lock, flask, terminal, book, review, wrench, bolt.',
].join('\n');

/** Ask Claude for a first version of a bot's files from a description. */
export async function draftBot(complete: Complete, description: string, existing?: { readonly bot: BotFile; readonly persona: string }): Promise<BotDraft> {
  const prompt = [`The owner describes the bot they want:\n<description>\n${description.slice(0, 4000)}\n</description>`, existing ? `\nIt exists already; improve it. Its persona now:\n<persona>\n${existing.persona.slice(0, 6000)}\n</persona>` : ''].join('\n');
  const raw = await complete({ prompt, system: DRAFT_SYSTEM, cwd: os.tmpdir(), model: 'sonnet' });
  return draftFiles(raw, existing?.bot);
}

/** Claude's JSON → the bot's files (what doesn't fit is left out). */
export function draftFiles(raw: string, base?: BotFile): BotDraft {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  let d: Record<string, unknown> = {};
  try {
    if (!json) throw new Error('no JSON');
    d = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('Claude’s draft didn’t read as a bot. Try again, or describe it differently.');
  }
  const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const files: Record<string, string> = {};
  const bot = parseBotFile(JSON.stringify({ ...(base ?? { version: 1 }), version: 1, ...(str(d.name, 40) ? { name: str(d.name, 40) } : {}), ...(str(d.icon, 32) ? { icon: str(d.icon, 32) } : {}), ...(str(d.description, 300) ? { description: str(d.description, 300) } : {}), ...(d.categories && typeof d.categories === 'object' ? { categories: d.categories } : {}) })).bot;
  files[BOT_JSON] = botFileText(bot);
  const persona = str(d.persona, 20_000);
  if (persona) files[PERSONA] = `${persona}\n`;
  if (Array.isArray(d.skills)) {
    for (const s of d.skills.slice(0, 6)) {
      if (!s || typeof s !== 'object') continue;
      const o = s as Record<string, unknown>;
      const name = str(o.name, 64)?.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const desc = str(o.description, 400)?.replace(/\n/g, ' ');
      if (!name || !SKILL_NAME.test(name) || !desc) continue;
      files[`.claude/skills/${name}/SKILL.md`] = `---\nname: ${name}\ndescription: ${desc}\n---\n\n${str(o.body, 20_000) ?? ''}\n`;
    }
  }
  if (d.mcp && typeof d.mcp === 'object' && !Array.isArray(d.mcp) && Object.keys(d.mcp).length) {
    const text = `${JSON.stringify({ mcpServers: d.mcp }, null, 2)}\n`;
    if (!/"(sk-|ghp_|xox)/.test(text)) files[MCP_JSON] = text;
  }
  const urls = Array.isArray(d.knowledge) ? d.knowledge.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10) : [];
  const notes = [str(d.notes, 2000), urls.length ? `Documentation worth adding under Knowledge:\n${urls.map((u) => `- ${u}`).join('\n')}` : undefined].filter(Boolean).join('\n\n');
  return { files, ...(notes ? { notes } : {}) };
}

/** Accept a draft: each of its files written (a new bot when `id` is unset) as one commit → the bot's id. */
export async function applyDraft(bots: Bots, id: string | undefined, files: Readonly<Record<string, string>>): Promise<string> {
  for (const rel of Object.keys(files)) if (!isBotFile(rel)) throw new Error(`${rel} isn’t one of a bot’s files`);
  const parsed = parseBotFile(files[BOT_JSON]);
  const target = id ?? (await bots.create({ name: parsed.bot.name ?? 'New bot', ...(parsed.bot.icon ? { icon: parsed.bot.icon } : {}) }));
  const folder = bots.folder(target);
  for (const [rel, text] of Object.entries(files)) {
    if (rel === BOT_JSON) folder.writeBot({ ...parsed.bot, ...(id ? {} : { name: folder.bot().bot.name ?? parsed.bot.name }) });
    else if (rel.endsWith('SKILL.md') || rel.startsWith('.claude/agents/')) {
      if (parseSkillHeader(text).ok) folder.put(rel, text);
    } else folder.put(rel, text);
  }
  await folder.commit(id ? 'Created with Claude: changes' : 'Created with Claude');
  bots.refresh();
  return target;
}
