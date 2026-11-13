import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, promises as fs, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { type BotFile, type ParsedBot, SKILL_NAME, type SkillHeader, botFileText, parseBotFile, parseSkillHeader, plainSecretsIn, secretsIn } from './schema.js';

/**
 * One bot's folder (docs/bots.md): the files are the source of truth, and this reads and writes
 * them. Every save is a commit in the folder's own git (Undo and Versions read it), and a save
 * made against a file that changed since it was read (by you in an editor, by an agent) is refused
 * with the reason instead of overwriting it.
 *
 *   bot.json            identity and routing (schema.ts)
 *   CLAUDE.md           persona and rules
 *   .mcp.json           its tools; secrets as ${env:NAME}, the values in ~/.beluga/env.json
 *   .claude/skills/<name>/SKILL.md, .claude/agents/<name>.md
 *   knowledge.json, knowledge/   its documentation (knowledge.ts)
 *   memory.md           what it learned
 */

const run = promisify(execFile);

export const BOT_JSON = 'bot.json';
export const PERSONA = 'CLAUDE.md';
export const MCP_JSON = '.mcp.json';
export const MEMORY = 'memory.md';
export const KNOWLEDGE_JSON = 'knowledge.json';
export const KNOWLEDGE_DIR = 'knowledge';
export const SKILLS_DIR = path.join('.claude', 'skills');
export const AGENTS_DIR = path.join('.claude', 'agents');

/** The files a bot's git keeps: nothing else in the folder (Your Mac's work/ holds its scratch and what it makes). */
const GITIGNORE = ['# Beluga keeps only the bot’s own files here (docs/bots.md).', '/*', `!/${BOT_JSON}`, `!/${PERSONA}`, `!/${MCP_JSON}`, `!/${MEMORY}`, `!/${KNOWLEDGE_JSON}`, `!/${KNOWLEDGE_DIR}/`, '!/.claude/', '/.claude/*', '!/.claude/skills/', '!/.claude/agents/', '!/.gitignore', ''].join('\n');

/** The file names a save may write (relative, forward slashes): nothing outside the bot's own files. */
export function isBotFile(rel: string): boolean {
  const r = rel.replace(/\\/g, '/');
  if ([BOT_JSON, PERSONA, MCP_JSON, MEMORY, KNOWLEDGE_JSON].includes(r)) return true;
  const skill = /^\.claude\/skills\/([^/]+)\/(.+)$/.exec(r);
  if (skill) return SKILL_NAME.test(skill[1]!) && !skill[2]!.split('/').some((s) => s === '..' || s === '' || s.startsWith('.'));
  const agent = /^\.claude\/agents\/([^/]+)\.md$/.exec(r);
  return Boolean(agent && SKILL_NAME.test(agent[1]!));
}

/** A file's fingerprint: what a screen read, so a save knows whether it changed since. */
export const fingerprint = (text: string | undefined): string => (text === undefined ? 'none' : createHash('sha256').update(text).digest('hex').slice(0, 16));

/** A save refused because the file changed since it was read. */
export class BotConflict extends Error {
  constructor(readonly file: string) {
    super(`${file} changed outside Beluga since you opened it (in an editor, or by an agent). Its new version is shown now: make your change again, or copy yours first.`);
    this.name = 'BotConflict';
  }
}

export interface SkillEntry {
  readonly name: string;
  readonly header?: SkillHeader;
  /** Why its header can't be read (Claude Code would skip it). */
  readonly problem?: string;
  readonly text: string;
}

/** Everything a bot's folder says, as Bot Studio shows it. */
export interface BotDocs {
  readonly parsed: ParsedBot;
  readonly persona: string;
  readonly mcp: string;
  readonly memory: string;
  readonly skills: readonly SkillEntry[];
  readonly agents: readonly SkillEntry[];
  /** Each file's fingerprint (by relative name), for conflict checks. */
  readonly prints: Readonly<Record<string, string>>;
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

const listDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && SKILL_NAME.test(d.name)).map((d) => d.name).sort();
  } catch {
    return [];
  }
};

const listFiles = (dir: string, ext: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(ext) && SKILL_NAME.test(d.name.slice(0, -ext.length))).map((d) => d.name.slice(0, -ext.length)).sort();
  } catch {
    return [];
  }
};

/** A skill or agent file, read and checked. */
function entryOf(name: string, text: string | undefined): SkillEntry {
  const t = text ?? '';
  const h = parseSkillHeader(t);
  return h.ok ? { name, header: h.header, text: t } : { name, problem: h.why, text: t };
}

export class BotFolder {
  constructor(readonly dir: string) {}

  private at(rel: string): string {
    return path.join(this.dir, rel);
  }

  read(rel: string): string | undefined {
    return readText(this.at(rel));
  }

  /** The folder, made if it isn't there yet (empty files are "not set"). */
  ensure(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  exists(): boolean {
    return existsSync(this.at(BOT_JSON));
  }

  bot(): ParsedBot {
    return parseBotFile(this.read(BOT_JSON));
  }

  persona(): string {
    return this.read(PERSONA) ?? '';
  }

  skills(): SkillEntry[] {
    return listDirs(this.at(SKILLS_DIR)).map((n) => entryOf(n, this.read(path.join(SKILLS_DIR, n, 'SKILL.md'))));
  }

  agents(): SkillEntry[] {
    return listFiles(this.at(AGENTS_DIR), '.md').map((n) => entryOf(n, this.read(path.join(AGENTS_DIR, `${n}.md`))));
  }

  docs(): BotDocs {
    const persona = this.read(PERSONA);
    const mcp = this.read(MCP_JSON);
    const memory = this.read(MEMORY);
    const botText = this.read(BOT_JSON);
    const skills = this.skills();
    const agents = this.agents();
    const prints: Record<string, string> = { [BOT_JSON]: fingerprint(botText), [PERSONA]: fingerprint(persona), [MCP_JSON]: fingerprint(mcp), [MEMORY]: fingerprint(memory) };
    for (const s of skills) prints[`.claude/skills/${s.name}/SKILL.md`] = fingerprint(s.text);
    for (const a of agents) prints[`.claude/agents/${a.name}.md`] = fingerprint(a.text);
    return { parsed: parseBotFile(botText), persona: persona ?? '', mcp: mcp ?? '', memory: memory ?? '', skills, agents, prints };
  }

  /**
   * Write one of the bot's files (`text` undefined: delete it), refusing when it changed since
   * `expect` (its fingerprint when read; unset: no check). Doesn't commit: `save` does.
   */
  put(rel: string, text: string | undefined, expect?: string): void {
    if (!isBotFile(rel)) throw new Error(`${rel} isn’t one of a bot’s files`);
    if (expect !== undefined && fingerprint(this.read(rel)) !== expect) throw new BotConflict(rel);
    if (rel === MCP_JSON && text !== undefined) {
      const plain = plainSecretsIn(text);
      if (plain.length) throw new Error(`.mcp.json has a secret written in it (${plain.join(', ')}): put \${env:NAME} there instead, and the value under Secrets (it’s kept in ~/.beluga/env.json, never in the bot’s folder)`);
      try {
        JSON.parse(text);
      } catch (err) {
        throw new Error(`.mcp.json isn’t valid JSON (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    const file = this.at(rel);
    if (text === undefined) {
      rmSync(file, { force: true });
      // A skill's folder goes with its SKILL.md.
      if (/^\.claude[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/.test(rel)) rmSync(path.dirname(file), { recursive: true, force: true });
      return;
    }
    writeAtomic(file, text);
  }

  writeBot(bot: BotFile, expect?: string): void {
    this.put(BOT_JSON, botFileText(bot), expect);
  }

  // ------------------------------------------------------------------ git

  private async git(args: readonly string[]): Promise<string> {
    const { stdout } = await run('git', ['-C', this.dir, '-c', 'user.name=Beluga', '-c', 'user.email=beluga@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout;
  }

  /** Its own git, with the .gitignore that keeps only its files. False: git isn't here (saves still work, without history). */
  async ensureRepo(): Promise<boolean> {
    this.ensure();
    if (readText(this.at('.gitignore')) !== GITIGNORE) writeAtomic(this.at('.gitignore'), GITIGNORE);
    if (existsSync(this.at('.git'))) return true;
    try {
      await this.git(['init', '-q']);
      return true;
    } catch {
      return false;
    }
  }

  /** Commit what changed, as one save ("Persona", "Tools"…); nothing changed: no commit. → its id. */
  async commit(message: string): Promise<string | undefined> {
    if (!(await this.ensureRepo())) return undefined;
    try {
      await this.git(['add', '-A']);
      const staged = await this.git(['status', '--porcelain']);
      if (!staged.trim()) return undefined;
      await this.git(['commit', '-q', '-m', message.slice(0, 200)]);
      return (await this.git(['rev-parse', '--short', 'HEAD'])).trim();
    } catch {
      return undefined;
    }
  }

  /** Its saves, newest first. */
  async versions(limit = 50): Promise<Array<{ readonly id: string; readonly at: number; readonly message: string }>> {
    if (!existsSync(this.at('.git'))) return [];
    try {
      const out = await this.git(['log', `-${Math.max(1, Math.min(limit, 500))}`, '--format=%h%x09%ct%x09%s']);
      return out
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [id, at, ...msg] = l.split('\t');
          return { id: id!, at: Number(at) * 1000, message: msg.join('\t') };
        });
    } catch {
      return [];
    }
  }

  /** The bot's files back as they were at a save (a new save on top: nothing is lost). */
  async restore(version: string, message = `Back to ${version}`): Promise<string | undefined> {
    if (!/^[0-9a-f]{4,40}$/.test(version)) throw new Error('That isn’t a version of this bot');
    if (!existsSync(this.at('.git'))) throw new Error('This bot has no history yet (git isn’t installed, or nothing was saved)');
    // Files made after it go; the rest come back as they were.
    const added = (await this.git(['diff', '--name-only', '--diff-filter=A', version, 'HEAD'])).split('\n').filter(Boolean);
    for (const rel of added) await fs.rm(this.at(rel), { force: true });
    await this.git(['checkout', version, '--', '.']);
    return this.commit(message);
  }

  /** Undo the last save: the files as they were before it. */
  async undo(): Promise<string | undefined> {
    const list = await this.versions(2);
    if (list.length < 2) throw new Error('There’s nothing to undo');
    return this.restore(list[1]!.id, `Undo: ${list[0]!.message}`.slice(0, 200));
  }

  // ------------------------------------------------------------------ checks

  /** The secrets its .mcp.json names that aren't set (in `have`). */
  missingSecrets(have: Readonly<Record<string, string>>): string[] {
    return secretsIn(this.read(MCP_JSON) ?? '').filter((n) => !have[n]);
  }
}

/**
 * .mcp.json's servers with `${env:NAME}` filled from `env` (a missing one left empty: the check
 * says so first). Unreadable: none.
 */
export function mcpServersOf(text: string | undefined, env: Readonly<Record<string, string>>): Record<string, Record<string, unknown>> {
  if (!text?.trim()) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  const servers = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { mcpServers?: unknown }).mcpServers : undefined;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
  const fill = (v: unknown): unknown => (typeof v === 'string' ? v.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]{0,63})\}/g, (_, n: string) => env[n] ?? '') : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
    if (!/^[\w.-]{1,64}$/.test(name) || !config || typeof config !== 'object' || Array.isArray(config)) continue;
    out[name] = fill(config) as Record<string, unknown>;
  }
  return out;
}

/** The server names a .mcp.json declares (without reading their settings). */
export function mcpNames(text: string | undefined): string[] {
  return Object.keys(mcpServersOf(text, {}));
}

/** The servers a .mcp.json declares, each with whether it’s reached over HTTP (`url`) or started (`command`). */
export function mcpKindsOf(text: string | undefined): Array<{ readonly name: string; readonly http: boolean }> {
  return Object.entries(mcpServersOf(text, {})).map(([name, c]) => ({ name, http: typeof c.url === 'string' && typeof c.command !== 'string' }));
}
