import path from 'node:path';
import type { Combo } from '../routing/model.js';
import { LOCAL_RUNTIME, OLLAMA_ID } from '../../shared/local-endpoints.js';
import {
  type ChecklistItem,
  type ChecklistItemId,
  type ChecklistPlace,
  type ChecklistWhy,
  type StackCheck,
} from '../stack-store.js';
import { type AgentDeps, type AgentFile, STACK_TOOL_FIX, cliOnly, mentionsStack, readAgents, readsOnly, stackless, withModel, withTool } from './agents.js';
import { STACK_EXCLUDES, vikingParent } from './bootstrap.js';
import { OLLAMA_URL, type StackDeps, findTool, openVikingUrl } from './probe.js';

/**
 * The stack's checklist (docs/stack.md › Checklist): whether the stack works, not only whether it's
 * installed — on this computer (1–7), in each project and worktree (8–14) and for sub-agents
 * (15–19). Each item is a function over the deps, so tests pretend the computer. What's the
 * project's own and changes nothing of yours fixes itself (indexes, excludes, docs, GitNexus's
 * registry: `autoFix`); what changes a file of yours is fixed only on your yes (`askFix`), after a
 * backup next to it (`<file>.bak-YYYYMMDD-HHMMSS`).
 */

export interface ChecklistDeps extends StackDeps, AgentDeps {
  readonly writeFile: (file: string, text: string) => void;
  /** OpenViking's `ov`, when it runs here. */
  readonly viking: () => Promise<{ readonly bin: string; readonly pre?: readonly string[] } | undefined>;
  readonly now: () => number;
}

/** What the checklist reads besides the computer: Beluga's own state. */
export interface ChecklistContext {
  /** The last look at the tools and services (items 1–2). */
  readonly checks: readonly StackCheck[];
  readonly combos?: readonly Combo[];
  /** Each bot's folder (its `.claude/agents`). */
  readonly botDirs?: readonly string[];
  /** When Beluga last sent a project's docs to OpenViking (ms). */
  readonly docsSentAt?: (dir: string) => number | undefined;
  /** An index being rebuilt right now, or the last rebuild's failure. */
  readonly rebuild?: (dir: string, id: ChecklistItemId) => { readonly running?: boolean; readonly failed?: string } | undefined;
}

/** A place to check: a project's main checkout or one of its worktrees. */
export type PlaceInput = Omit<ChecklistPlace, 'items'> & { readonly worktree?: boolean };

/** What the excludes must have: the indexes' folders, graph-loop's memory and Beluga's worktrees. */
export const CHECKLIST_EXCLUDES = [...new Set([...STACK_EXCLUDES, '.graph_loop_memory.db', '.claude/worktrees/'])];

/** Items a sub-agent can't see working any other way (advice in Settings › Stack only). */
const ADVISORY: ReadonlySet<ChecklistItemId> = new Set(['subagentHooks', 'subagentRules', 'otherRuntimes']);

/** Fixes that change a file of yours: only on your yes. */
export const ASK_FIX: ReadonlySet<ChecklistItemId> = new Set(['rtkHook', 'gitnexusHooks', 'mcps', 'claudeMd', 'belugaJson', 'agentTools', 'agentModels']);
/** Fixes that are the project's own: they run by themselves. */
export const AUTO_FIX: ReadonlySet<ChecklistItemId> = new Set(['gitnexusIndex', 'graphifyIndex', 'tokenGoatMap', 'excludes', 'docs', 'gitnexusRegistry']);

const P = (deps: Pick<StackDeps, 'platform'>): typeof path.posix => (deps.platform === 'win32' ? path.win32 : path.posix);

const ok = (id: ChecklistItemId, detail?: string): ChecklistItem => ({ id, state: 'ok', ...(detail ? { detail } : {}) });
const skip = (id: ChecklistItemId, detail?: string): ChecklistItem => ({ id, state: 'skip', ...(detail ? { detail } : {}) });
function bad(id: ChecklistItemId, state: 'warn' | 'fail', why: ChecklistWhy, detail?: string, extra: Partial<ChecklistItem> = {}): ChecklistItem {
  const fix = ASK_FIX.has(id) ? 'ask' : AUTO_FIX.has(id) ? 'auto' : undefined;
  return { id, state, why, ...(detail ? { detail: detail.slice(0, 2000) } : {}), ...(fix ? { fix } : {}), ...(ADVISORY.has(id) ? { advisory: true } : {}), ...extra };
}

const has = (deps: StackDeps, tool: string): boolean => Boolean(findTool(tool, deps));

function readJson(deps: Pick<StackDeps, 'readFile'>, file: string): unknown {
  const raw = deps.readFile(file);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

const claudeDir = (deps: StackDeps): string => P(deps).join(deps.home, '.claude');
const settingsFile = (deps: StackDeps): string => P(deps).join(claudeDir(deps), 'settings.json');

// ---- 1–2: what the stack already looks at --------------------------------------------------------

export function toolsItem(ctx: ChecklistContext): ChecklistItem {
  const missing = ctx.checks.filter((c) => c.kind === 'tool' && c.state !== 'up').map((c) => c.id);
  return missing.length ? bad('tools', 'fail', 'missing', missing.join(', ')) : ok('tools');
}

export function servicesItem(ctx: ChecklistContext): ChecklistItem {
  const down = ctx.checks.filter((c) => c.kind === 'service' && c.state !== 'up' && c.id !== 'ollama').map((c) => c.id);
  return down.length ? bad('services', 'fail', 'down', down.join(', ')) : ok('services');
}

// ---- 3: Ollama, when something needs it ---------------------------------------------------------

/** What uses Ollama here: each combo with an Ollama target, and OpenViking's embeddings when they're local. */
export function ollamaUsers(ctx: ChecklistContext, deps: StackDeps): { readonly combos: readonly string[]; readonly openviking: boolean } {
  const combos = (ctx.combos ?? []).filter((c) => c.targets.some((t) => t.runtime === LOCAL_RUNTIME && (t.endpoint ?? OLLAMA_ID) === OLLAMA_ID)).map((c) => c.name);
  const conf = deps.readFile(P(deps).join(deps.home, '.openviking', 'ov.conf')) ?? '';
  return { combos, openviking: /11434|"provider"\s*:\s*"ollama"|ollama\//i.test(conf) };
}

/** Ollama's models, and those that can call tools (what a local agent needs). Undefined: it doesn't answer. */
export async function ollamaModels(deps: Pick<StackDeps, 'fetch'>): Promise<{ readonly all: readonly string[]; readonly tools: readonly string[] } | undefined> {
  let names: string[];
  try {
    const res = await deps.fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { models?: { name?: unknown }[] };
    names = (body.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string');
  } catch {
    return undefined;
  }
  const tools: string[] = [];
  for (const name of names.slice(0, 30)) {
    try {
      const res = await deps.fetch(`${OLLAMA_URL}/api/show`, { method: 'POST', body: JSON.stringify({ model: name }), headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2500) });
      const caps = res.ok ? ((await res.json()) as { capabilities?: unknown }).capabilities : undefined;
      if (Array.isArray(caps) && caps.includes('tools')) tools.push(name);
    } catch {
      // That one model unread: not counted.
    }
  }
  return { all: names, tools };
}

/** Item 3: Ollama is checked over HTTP (`/api/tags`), never by its program: WSL reaches the Windows one with none here. */
export async function ollamaItem(ctx: ChecklistContext, deps: StackDeps): Promise<ChecklistItem> {
  const users = ollamaUsers(ctx, deps);
  const needed = users.combos.length > 0 || users.openviking;
  const models = await ollamaModels(deps);
  const loses = [...users.combos.map((c) => `${c}: no local targets`), ...(users.openviking ? ['OpenViking: search without embeddings'] : [])].join('; ');
  // A combo still runs on its next target (⚠); OpenViking's search has nothing else (✗).
  if (!models) return needed ? bad('ollamaNeeded', users.openviking ? 'fail' : 'warn', 'ollamaOff', loses) : skip('ollamaNeeded');
  if (users.combos.length && !models.tools.length) return bad('ollamaNeeded', 'warn', 'noToolsModel', models.all.join(', ') || '—');
  return ok('ollamaNeeded', models.tools.length ? `tools: ${models.tools.join(', ')}` : undefined);
}

// ---- 4–7: your Claude Code settings -------------------------------------------------------------

interface HookEntry {
  readonly matcher?: string;
  readonly hooks?: readonly { readonly command?: string }[];
}

/** The commands your ~/.claude/settings.json runs on `event` for `tool`. */
export function hookCommands(settings: unknown, event: 'PreToolUse' | 'PostToolUse', tool: string): string[] {
  const entries = ((settings as { hooks?: Record<string, unknown> } | undefined)?.hooks?.[event] ?? []) as HookEntry[];
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => {
      const m = e.matcher ?? '';
      if (!m || m === '*') return true;
      try {
        return new RegExp(`^(?:${m})$`).test(tool);
      } catch {
        return m.split('|').includes(tool);
      }
    })
    .flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? '').filter(Boolean));
}

export function rtkHookItem(deps: StackDeps): ChecklistItem {
  if (!has(deps, 'rtk')) return skip('rtkHook');
  const settings = readJson(deps, settingsFile(deps));
  return hookCommands(settings, 'PreToolUse', 'Bash').some((c) => /\brtk\b/.test(c)) ? ok('rtkHook') : bad('rtkHook', 'fail', 'noHook', 'PreToolUse Bash → rtk hook claude');
}

const expandHome = (file: string, deps: StackDeps): string => file.replace(/^~(?=[\\/])/, deps.home).replace(/\$HOME|\$\{HOME\}/g, deps.home);

export function gitnexusHooksItem(deps: StackDeps): ChecklistItem {
  if (!has(deps, 'gitnexus')) return skip('gitnexusHooks');
  const settings = readJson(deps, settingsFile(deps));
  const want: [event: 'PreToolUse' | 'PostToolUse', tool: string][] = [
    ['PreToolUse', 'Grep'],
    ['PreToolUse', 'Glob'],
    ['PreToolUse', 'Bash'],
    ['PostToolUse', 'Bash'],
  ];
  const missing: string[] = [];
  const gone = new Set<string>();
  for (const [event, tool] of want) {
    const cmds = hookCommands(settings, event, tool).filter((c) => c.includes('gitnexus-hook'));
    if (!cmds.length) missing.push(`${event} ${tool}`);
    for (const c of cmds) {
      const file = /['"]?([^'"\s]*gitnexus-hook\.c?js)['"]?/.exec(c)?.[1];
      if (file && !deps.exists(expandHome(file, deps))) gone.add(file);
    }
  }
  if (gone.size) return bad('gitnexusHooks', 'fail', 'hookFileGone', [...gone].join(', '));
  return missing.length ? bad('gitnexusHooks', 'fail', 'noHook', missing.join(', ')) : ok('gitnexusHooks');
}

/** Item 6: GitNexus's and OpenViking's MCPs in your user scope (~/.claude.json), and answering (`claude mcp list`). */
export async function mcpsItem(ctx: ChecklistContext, deps: StackDeps): Promise<ChecklistItem> {
  const want = [
    ...(has(deps, 'gitnexus') ? ['gitnexus'] : []),
    ...(ctx.checks.some((c) => c.id === 'openviking' && c.state === 'up') || deps.exists(P(deps).join(deps.home, '.openviking', 'ovcli.conf')) ? ['openviking'] : []),
  ];
  if (!want.length) return skip('mcps');
  const servers = (readJson(deps, P(deps).join(deps.home, '.claude.json')) as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers ?? {};
  const missing = want.filter((id) => !(id in servers));
  if (missing.length) return bad('mcps', 'fail', 'notRegistered', missing.join(', '));
  const claude = findTool('claude', deps);
  if (!claude) return ok('mcps');
  const r = await deps.run(claude, ['mcp', 'list'], { timeoutMs: 90_000 });
  if (r.code !== 0) return ok('mcps');
  const failing = want.flatMap((id) => {
    const line = r.out.split(/\r?\n/).find((l) => l.startsWith(`${id}:`));
    return line && /✗|failed|error/i.test(line) ? [line.trim()] : [];
  });
  return failing.length ? bad('mcps', 'fail', 'notAnswering', failing.join('\n')) : ok('mcps');
}

/** The stack's block for your global CLAUDE.md (appended once on your yes; never rewrites yours). */
export const STACK_RULES_BLOCK = `
## Stack (every project)

Read less, find more:
1. **GitNexus** (\`mcp__gitnexus__*\` or \`gitnexus\`): who calls what, impact before an edit, \`detect_changes\` before a commit.
2. **token-goat** / \`gls symbol <file> <name>\`: just one symbol and its callers, never the whole file.
3. **OpenViking** (\`mcp__openviking__*\`): the project's docs and decisions, searched by meaning.
4. **RTK** shrinks shell output by itself (its hook); run commands normally.
`;

export function claudeMdItem(deps: StackDeps): ChecklistItem {
  const dir = claudeDir(deps);
  const text = deps.readFile(P(deps).join(dir, 'CLAUDE.md')) ?? '';
  const broken = [...text.matchAll(/^@(\S+)\s*$/gm)].map((m) => m[1]!).filter((f) => !deps.exists(P(deps).isAbsolute(f) ? f : P(deps).join(dir, expandHome(f, deps))));
  if (broken.length) {
    // Nothing here writes the file it imports: no fix.
    const { fix: _none, ...item } = bad('claudeMd', 'fail', 'brokenImport', broken.map((b) => `@${b}`).join(', '));
    return item;
  }
  const missing = [...(/^## Stack\b/m.test(text) ? [] : ['## Stack']), ...(has(deps, 'token-goat') && !text.includes('token-goat') ? ['token-goat'] : [])];
  return missing.length ? bad('claudeMd', 'warn', 'noBlock', missing.join(', ')) : ok('claudeMd');
}

// ---- 8–10: a place's indexes ---------------------------------------------------------------------

export type IndexVerdict = 'ok' | 'stale' | 'notBuilt';

/** `gls index --check`'s lines (`[✓] gitnexus …`, `[!] token-goat TimeoutExpired … -- rode: token-goat index`) by tool. */
export function parseIndexCheck(out: string): Partial<Record<'gitnexus' | 'token-goat' | 'graphify', { readonly verdict: IndexVerdict; readonly line: string }>> {
  const found: Partial<Record<'gitnexus' | 'token-goat' | 'graphify', { verdict: IndexVerdict; line: string }>> = {};
  for (const raw of out.split(/\r?\n/)) {
    const m = /^\s*\[(.)\]\s+(gitnexus|token-goat|graphify)\b\s*(.*)$/.exec(raw);
    if (!m) continue;
    const mark = m[1]!;
    const rest = m[3]!;
    // A timeout is a stale map (token-goat redoes it), not a broken tool.
    const verdict: IndexVerdict = mark === '✓' || mark === 'v' ? 'ok' : mark === '!' || /TimeoutExpired|timed out|rode:|run:/i.test(rest) ? 'stale' : 'notBuilt';
    found[m[2] as 'gitnexus' | 'token-goat' | 'graphify'] = { verdict, line: raw.trim() };
  }
  return found;
}

interface RegistryEntry {
  readonly name?: string;
  readonly path?: string;
  readonly lastCommit?: string;
}

/** GitNexus's registry (~/.gitnexus/registry.json). */
export function gitnexusRegistry(deps: StackDeps): readonly RegistryEntry[] {
  const list = readJson(deps, P(deps).join(deps.home, '.gitnexus', 'registry.json'));
  return Array.isArray(list) ? (list as RegistryEntry[]) : [];
}

const samePath = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');

/** What a place's indexes look like: GitNexus by its registry against HEAD; graphify and token-goat by `gls index --check`. */
export async function indexState(dir: string, deps: StackDeps): Promise<{ readonly gitnexus?: IndexVerdict; readonly graphify?: IndexVerdict; readonly tokenGoat?: IndexVerdict; readonly lines: Readonly<Record<string, string>> }> {
  const lines: Record<string, string> = {};
  let gitnexus: IndexVerdict | undefined;
  if (has(deps, 'gitnexus')) {
    const entry = gitnexusRegistry(deps).find((e) => e.path && samePath(e.path, dir));
    if (!entry) gitnexus = 'notBuilt';
    else {
      const head = await deps.run('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 15_000 });
      gitnexus = head.code === 0 && entry.lastCommit && head.out.trim() !== entry.lastCommit ? 'stale' : 'ok';
      if (gitnexus === 'stale') lines.gitnexus = `${entry.lastCommit?.slice(0, 8)} → ${head.out.trim().slice(0, 8)}`;
    }
  }
  let graphify: IndexVerdict | undefined;
  let tokenGoat: IndexVerdict | undefined;
  const gls = findTool('gls', deps);
  if (gls) {
    // Slow (token-goat's map alone may wait 60 s): this runs off the agents' queue.
    const r = await deps.run(gls, ['index', '--check'], { cwd: dir, timeoutMs: 300_000 });
    const parsed = parseIndexCheck(r.out);
    if (parsed.graphify) graphify = parsed.graphify.verdict;
    if (parsed['token-goat']) tokenGoat = parsed['token-goat'].verdict;
    if (!deps.exists(P(deps).join(dir, '.graphify-out'))) graphify = 'notBuilt';
    for (const [k, v] of Object.entries(parsed)) if (v.verdict !== 'ok') lines[k] = v.line;
    if (gitnexus === undefined && parsed.gitnexus) gitnexus = parsed.gitnexus.verdict;
  }
  return { ...(gitnexus ? { gitnexus } : {}), ...(graphify ? { graphify } : {}), ...(tokenGoat ? { tokenGoat } : {}), lines };
}

function indexItem(id: 'gitnexusIndex' | 'graphifyIndex' | 'tokenGoatMap', verdict: IndexVerdict | undefined, line: string | undefined, place: PlaceInput, ctx: ChecklistContext): ChecklistItem {
  const rebuild = ctx.rebuild?.(place.dir, id);
  if (rebuild?.running) return bad(id, 'warn', 'rebuilding', line, { fixing: true });
  if (verdict === undefined) return skip(id);
  if (verdict === 'ok') return ok(id);
  if (rebuild?.failed) return bad(id, 'fail', 'rebuildFailed', rebuild.failed);
  return bad(id, 'warn', verdict === 'stale' ? 'stale' : 'notBuilt', line);
}

/** The command that rebuilds an index (in the place's folder, in the background). */
export function rebuildCommand(id: 'gitnexusIndex' | 'graphifyIndex' | 'tokenGoatMap', why: ChecklistWhy | undefined): { readonly bin: string; readonly args: readonly string[] } {
  switch (id) {
    case 'gitnexusIndex':
      return { bin: 'gitnexus', args: ['analyze', '--index-only'] };
    case 'graphifyIndex':
      return why === 'notBuilt' ? { bin: 'gls', args: ['graphify', 'build'] } : { bin: 'gls', args: ['graphify', 'ensure'] };
    case 'tokenGoatMap':
      return { bin: 'token-goat', args: ['index'] };
  }
}

// ---- 11–14: the rest of a place ------------------------------------------------------------------

/** A checkout's shared git folder (a worktree's `.git` file points into the main one's). */
export function gitCommonDir(dir: string, deps: StackDeps): string | undefined {
  const p = P(deps);
  const dotGit = p.join(dir, '.git');
  if (!deps.exists(dotGit)) return undefined;
  const pointer = deps.readFile(dotGit);
  if (pointer === undefined) return dotGit; // a folder
  const gitdir = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
  if (!gitdir) return undefined;
  const own = p.isAbsolute(gitdir) ? gitdir : p.join(dir, gitdir);
  const common = deps.readFile(p.join(own, 'commondir'))?.trim();
  return common ? (p.isAbsolute(common) ? common : p.join(own, common)) : own;
}

export function excludesItem(place: PlaceInput, deps: StackDeps): ChecklistItem {
  const git = gitCommonDir(place.dir, deps);
  if (!git) return skip('excludes');
  const have = new Set((deps.readFile(P(deps).join(git, 'info', 'exclude')) ?? '').split(/\r?\n/).map((l) => l.trim()));
  const missing = CHECKLIST_EXCLUDES.filter((l) => !have.has(l));
  return missing.length ? bad('excludes', 'warn', 'notExcluded', missing.join(', ')) : ok('excludes');
}

/** The commands a project's setup needs so each new worktree indexes itself. */
export function setupNeeds(deps: StackDeps): string[] {
  return [...(has(deps, 'gitnexus') ? ['gitnexus analyze --index-only'] : []), ...(has(deps, 'gls') ? ['gls graphify ensure'] : [])];
}

export function belugaJsonItem(place: PlaceInput, deps: StackDeps): ChecklistItem {
  if (place.worktree) return skip('belugaJson');
  const needs = setupNeeds(deps);
  if (!needs.length) return skip('belugaJson');
  const p = P(deps);
  const file = p.join(place.dir, 'beluga.json');
  const raw = deps.readFile(file);
  if (raw === undefined) return deps.exists(p.join(place.dir, 'klaud.json')) ? skip('belugaJson') : bad('belugaJson', 'warn', 'noFile', needs.join(' && '));
  let setup = '';
  try {
    const s = (JSON.parse(raw) as { scripts?: { setup?: unknown } }).scripts?.setup;
    setup = typeof s === 'string' ? s : '';
  } catch {
    return skip('belugaJson', 'beluga.json');
  }
  const missing = needs.filter((n) => !setup.includes(n.split(' ').slice(0, 2).join(' ')));
  return missing.length ? bad('belugaJson', 'warn', 'noIndexSetup', missing.join(' && ')) : ok('belugaJson');
}

/** The documentation OpenViking gets (bootstrap.ts docPaths), through the deps. */
export function docPathsOf(dir: string, deps: StackDeps & AgentDeps): string[] {
  const readmes = deps.listDir(dir).filter((f) => /^readme(\.|$)/i.test(f));
  return [...readmes, ...['AGENTS.md', 'CLAUDE.md', 'docs', 'roadmap'].filter((d) => deps.exists(P(deps).join(dir, d)))];
}

export async function docsItem(place: PlaceInput, ctx: ChecklistContext, deps: ChecklistDeps): Promise<ChecklistItem> {
  if (place.worktree) return skip('docs');
  if (!ctx.checks.some((c) => c.id === 'openviking' && c.state === 'up')) return skip('docs');
  const docs = docPathsOf(place.dir, deps);
  if (!docs.length) return skip('docs');
  const sent = ctx.docsSentAt?.(place.dir);
  if (sent === undefined) return bad('docs', 'warn', 'notSent', vikingParent(place.dir));
  const r = await deps.run('git', ['log', '-1', '--format=%ct', '--', ...docs], { cwd: place.dir, timeoutMs: 15_000 });
  const changed = Number(r.out.trim()) * 1000;
  return r.code === 0 && changed > sent ? bad('docs', 'warn', 'old', vikingParent(place.dir)) : ok('docs');
}

/** GitNexus's registered folders that are gone and belong to this project (its folder, its worktrees, its name). */
export function registryLeftovers(place: PlaceInput, deps: StackDeps): string[] {
  const base = P(deps).basename(place.dir);
  return gitnexusRegistry(deps)
    .filter((e) => e.path && !deps.exists(e.path) && (e.path.startsWith(place.dir) || e.name === base || (e.name ?? '').startsWith(`${base}-`)))
    .map((e) => e.path!);
}

export function registryItem(place: PlaceInput, deps: StackDeps): ChecklistItem {
  if (place.worktree || !has(deps, 'gitnexus')) return skip('gitnexusRegistry');
  const gone = registryLeftovers(place, deps);
  return gone.length ? bad('gitnexusRegistry', 'warn', 'leftovers', gone.join('\n')) : ok('gitnexusRegistry');
}

// ---- 15–19: sub-agents ---------------------------------------------------------------------------

/** Your own agents and each bot's (the computer's list); a project's are read with its place. */
export function machineAgents(ctx: ChecklistContext, deps: ChecklistDeps): AgentFile[] {
  const p = P(deps);
  return [...readAgents(p.join(claudeDir(deps), 'agents'), 'user', deps), ...(ctx.botDirs ?? []).flatMap((d) => readAgents(p.join(d, '.claude', 'agents'), 'bot', deps))];
}

export const projectAgents = (place: PlaceInput, deps: ChecklistDeps): AgentFile[] => (place.worktree ? [] : readAgents(P(deps).join(place.dir, '.claude', 'agents'), 'project', deps));

const who = (a: AgentFile): string => `${a.name} (${a.owner})`;

export function agentToolsItem(agents: readonly AgentFile[]): ChecklistItem {
  if (!agents.length) return skip('agentTools');
  const none = agents.filter(stackless);
  if (none.length) return bad('agentTools', 'warn', 'noStack', none.map(who).join(', '));
  const cli = agents.filter(cliOnly);
  return ok('agentTools', cli.length ? `CLI only: ${cli.map((a) => a.name).join(', ')}` : undefined);
}

/** The model every sub-agent without `model:` gets (CLAUDE_CODE_SUBAGENT_MODEL, here or in ~/.claude/settings.json). */
export function subagentModel(deps: StackDeps): string | undefined {
  const env = (readJson(deps, settingsFile(deps)) as { env?: Record<string, unknown> } | undefined)?.env;
  const v = deps.env.CLAUDE_CODE_SUBAGENT_MODEL ?? env?.CLAUDE_CODE_SUBAGENT_MODEL;
  return typeof v === 'string' && v ? v : undefined;
}

export function agentModelsItem(agents: readonly AgentFile[], deps: StackDeps): ChecklistItem {
  if (!agents.length) return skip('agentModels');
  const all = subagentModel(deps);
  if (all) return ok('agentModels', `CLAUDE_CODE_SUBAGENT_MODEL=${all}`);
  const heavy = agents.filter((a) => readsOnly(a) && !a.model);
  return heavy.length ? bad('agentModels', 'warn', 'inheritsLead', heavy.map(who).join(', ')) : ok('agentModels');
}

/** Item 17: Claude Code runs your hooks for a sub-agent's tool calls too, so they reach it when 4 and 5 are ✓. */
export function subagentHooksItem(rtk: ChecklistItem, gitnexus: ChecklistItem): ChecklistItem {
  const off = [rtk, gitnexus].filter((i) => i.state === 'fail' || i.state === 'warn').map((i) => (i.id === 'rtkHook' ? 'RTK' : 'GitNexus'));
  if (rtk.state === 'skip' && gitnexus.state === 'skip') return skip('subagentHooks');
  return off.length ? bad('subagentHooks', 'warn', 'noHook', off.join(', ')) : ok('subagentHooks');
}

/** Item 18: an agent with its own `tools:` and nothing about the stack in its prompt. */
export function subagentRulesItem(agents: readonly AgentFile[]): ChecklistItem {
  const quiet = agents.filter((a) => a.tools && !stackless(a) && !mentionsStack(a));
  if (!agents.length) return skip('subagentRules');
  return quiet.length ? bad('subagentRules', 'warn', 'noRules', quiet.map(who).join(', ')) : ok('subagentRules');
}

/** Item 19: Codex and OpenCode don't get Claude's hooks nor its CLAUDE.md: their own config needs the stack's MCPs. */
export function otherRuntimesItem(deps: StackDeps): ChecklistItem {
  const p = P(deps);
  const lacking: string[] = [];
  let any = false;
  if (has(deps, 'codex')) {
    any = true;
    const toml = deps.readFile(p.join(deps.home, '.codex', 'config.toml')) ?? '';
    if (!/\[mcp_servers\.["']?gitnexus/.test(toml)) lacking.push('Codex: ~/.codex/config.toml [mcp_servers.gitnexus]');
  }
  if (has(deps, 'opencode')) {
    any = true;
    const conf = deps.readFile(p.join(deps.home, '.config', 'opencode', 'opencode.json')) ?? '';
    if (!conf.includes('gitnexus')) lacking.push('OpenCode: ~/.config/opencode/opencode.json mcp.gitnexus');
  }
  if (!any) return skip('otherRuntimes');
  return lacking.length ? bad('otherRuntimes', 'warn', 'missingConfig', lacking.join('\n')) : ok('otherRuntimes');
}

// ---- the lists -----------------------------------------------------------------------------------

/** This computer's items: 1–7, and 15–19 for your agents and your bots'. */
export async function machineChecklist(ctx: ChecklistContext, deps: ChecklistDeps): Promise<ChecklistItem[]> {
  const agents = machineAgents(ctx, deps);
  const rtk = rtkHookItem(deps);
  const gitnexus = gitnexusHooksItem(deps);
  const [ollama, mcps] = await Promise.all([ollamaItem(ctx, deps), mcpsItem(ctx, deps)]);
  return [
    toolsItem(ctx),
    servicesItem(ctx),
    ollama,
    rtk,
    gitnexus,
    mcps,
    claudeMdItem(deps),
    agentToolsItem(agents),
    agentModelsItem(agents, deps),
    subagentHooksItem(rtk, gitnexus),
    subagentRulesItem(agents),
    otherRuntimesItem(deps),
  ];
}

/** A place's items: 8–14, and 15–16 for the project's own agents. */
export async function placeChecklist(place: PlaceInput, ctx: ChecklistContext, deps: ChecklistDeps): Promise<ChecklistItem[]> {
  const idx = await indexState(place.dir, deps);
  const agents = projectAgents(place, deps);
  const items = [
    indexItem('gitnexusIndex', idx.gitnexus, idx.lines.gitnexus, place, ctx),
    indexItem('graphifyIndex', idx.graphify, idx.lines.graphify, place, ctx),
    indexItem('tokenGoatMap', idx.tokenGoat, idx.lines['token-goat'], place, ctx),
    excludesItem(place, deps),
    belugaJsonItem(place, deps),
    await docsItem(place, ctx, deps),
    registryItem(place, deps),
  ];
  if (agents.length) items.push(agentToolsItem(agents), agentModelsItem(agents, deps));
  return items;
}

// ---- fixing --------------------------------------------------------------------------------------

/** `20261115-124334`: a backup's suffix, as you name yours. */
export function stamp(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** A copy of `file` next to it, before it's changed (nothing when it isn't there). → the copy's path. */
export function backup(file: string, deps: ChecklistDeps): string | undefined {
  const text = deps.readFile(file);
  if (text === undefined) return undefined;
  const copy = `${file}.bak-${stamp(deps.now())}`;
  deps.writeFile(copy, text);
  return copy;
}

export interface FixResult {
  readonly ok: boolean;
  /** Files changed (each backed up first). */
  readonly changed: readonly string[];
  /** What failed, as the tool said it. */
  readonly why?: string;
}

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'it failed';

/**
 * Fix one item that changes a file of yours: called only from your Fix (the yes). Backs each file up
 * first. A place's items (12, 15–16 of a project) need its `place`.
 */
export async function askFix(id: ChecklistItemId, ctx: ChecklistContext, deps: ChecklistDeps, place?: PlaceInput): Promise<FixResult> {
  const p = P(deps);
  const runFix = async (files: string[], bin: string, args: string[]): Promise<FixResult> => {
    for (const f of files) backup(f, deps);
    const r = await deps.run(findTool(bin, deps) ?? bin, args, { timeoutMs: 120_000 });
    return r.code === 0 ? { ok: true, changed: files } : { ok: false, changed: files, why: tail(r.out) };
  };
  switch (id) {
    case 'rtkHook':
      return runFix([settingsFile(deps)], 'rtk', ['init', '-g']);
    case 'gitnexusHooks':
      return runFix([settingsFile(deps)], 'gitnexus', ['setup', '--coding-agent', 'claude']);
    case 'mcps': {
      const servers = (readJson(deps, p.join(deps.home, '.claude.json')) as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers ?? {};
      if ('gitnexus' in servers || !has(deps, 'gitnexus')) return { ok: false, changed: [], why: 'openviking: `claude mcp add -s user --transport http openviking <its url>/mcp`' };
      return runFix([p.join(deps.home, '.claude.json')], 'claude', ['mcp', 'add', '-s', 'user', 'gitnexus', '--', 'gitnexus', 'mcp']);
    }
    case 'claudeMd': {
      const file = p.join(claudeDir(deps), 'CLAUDE.md');
      const text = deps.readFile(file) ?? '';
      if (/^## Stack\b/m.test(text)) return { ok: false, changed: [], why: 'token-goat: its own setup writes its block' };
      backup(file, deps);
      deps.writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${STACK_RULES_BLOCK}`);
      return { ok: true, changed: [file] };
    }
    case 'belugaJson': {
      if (!place || place.worktree) return { ok: false, changed: [] };
      const file = p.join(place.dir, 'beluga.json');
      const raw = deps.readFile(file);
      const needs = setupNeeds(deps);
      if (raw === undefined) {
        deps.writeFile(file, `${JSON.stringify({ scripts: { setup: needs.join(' && ') } }, null, 2)}\n`);
        return { ok: true, changed: [file] };
      }
      let json: { scripts?: Record<string, unknown> } & Record<string, unknown>;
      try {
        json = JSON.parse(raw) as typeof json;
      } catch {
        return { ok: false, changed: [], why: 'beluga.json is not JSON' };
      }
      const setup = typeof json.scripts?.setup === 'string' ? json.scripts.setup : '';
      const add = needs.filter((n) => !setup.includes(n.split(' ').slice(0, 2).join(' ')));
      if (!add.length) return { ok: true, changed: [] };
      backup(file, deps);
      json.scripts = { ...(json.scripts ?? {}), setup: [setup, ...add].filter(Boolean).join(' && ') };
      deps.writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
      return { ok: true, changed: [file] };
    }
    case 'agentTools':
    case 'agentModels': {
      const agents = place ? projectAgents(place, deps) : machineAgents(ctx, deps);
      const all = subagentModel(deps);
      const pick = id === 'agentTools' ? agents.filter(stackless) : all ? [] : agents.filter((a) => readsOnly(a) && !a.model);
      const changed: string[] = [];
      for (const a of pick) {
        const next = id === 'agentTools' ? withTool(a.text, STACK_TOOL_FIX) : withModel(a.text, 'haiku');
        if (next === a.text) continue;
        backup(a.file, deps);
        deps.writeFile(a.file, next);
        changed.push(a.file);
      }
      return { ok: true, changed };
    }
    default:
      return { ok: false, changed: [], why: `${id} has no fix here` };
  }
}

/**
 * Fix one of a place's own items, by itself (nothing of yours changes): excludes, docs in OpenViking,
 * GitNexus's leftovers. Indexes (8–10) are rebuilt by the monitor in the background instead.
 */
export async function autoFix(id: ChecklistItemId, place: PlaceInput, deps: ChecklistDeps): Promise<FixResult> {
  const p = P(deps);
  switch (id) {
    case 'excludes': {
      const git = gitCommonDir(place.dir, deps);
      if (!git) return { ok: false, changed: [] };
      const file = p.join(git, 'info', 'exclude');
      const text = deps.readFile(file) ?? '';
      const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
      const add = CHECKLIST_EXCLUDES.filter((l) => !have.has(l));
      if (!add.length) return { ok: true, changed: [] };
      deps.writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
      return { ok: true, changed: [file] };
    }
    case 'docs': {
      const viking = await deps.viking();
      if (!viking) return { ok: false, changed: [], why: 'OpenViking isn’t here' };
      const parent = vikingParent(place.dir);
      for (const doc of docPathsOf(place.dir, deps)) {
        const r = await deps.run(viking.bin, [...(viking.pre ?? []), 'add-resource', p.join(place.dir, doc), '-p', parent], { cwd: place.dir, timeoutMs: 120_000 });
        if (r.code !== 0) return { ok: false, changed: [], why: tail(r.out) };
      }
      return { ok: true, changed: [] };
    }
    case 'gitnexusRegistry': {
      for (const gone of registryLeftovers(place, deps)) {
        const r = await deps.run(findTool('gitnexus', deps) ?? 'gitnexus', ['remove', '--force', gone], { timeoutMs: 60_000 });
        if (r.code !== 0) return { ok: false, changed: [], why: tail(r.out) };
      }
      return { ok: true, changed: [] };
    }
    default:
      return { ok: false, changed: [] };
  }
}
