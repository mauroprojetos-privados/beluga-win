import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_FILES, detectSetup } from '../../workspaces/scripts.js';
import { findTool, type StackDeps } from './probe.js';

/**
 * Setting a project up for your stack (docs/stack.md), when it's added or made, or by hand: GitNexus
 * and graphify index it, OpenViking gets its documentation, and what's missing is written once — a
 * beluga.json whose setup installs and indexes each new worktree, a CLAUDE.md that points at
 * AGENTS.md. Never committed, never over anything you wrote: idempotent, so running it again only
 * refreshes the indexes. The stack's rules themselves live in your global ~/.claude/CLAUDE.md.
 */

/** What indexes write in a project, kept out of git through .git/info/exclude (never .gitignore). */
export const STACK_EXCLUDES = ['.gitnexus/', '.graphify-out/', '.graph_loop_run'] as const;

/** The project's documentation OpenViking gets (the code is GitNexus's and graphify's). */
const DOCS = ['AGENTS.md', 'CLAUDE.md', 'docs', 'roadmap'] as const;

export type BootstrapStep = 'gitnexus' | 'graphify' | 'openviking';
export type BootstrapFile = 'beluga.json' | 'CLAUDE.md';

export interface BootstrapReport {
  /** Files it wrote (new, not committed). */
  readonly wrote: readonly BootstrapFile[];
  /** Indexes that ran. */
  readonly ran: readonly BootstrapStep[];
  /** Steps that failed, with what they said. */
  readonly failed: readonly { readonly step: BootstrapStep; readonly why: string }[];
}

export interface BootstrapDeps extends Pick<StackDeps, 'run' | 'env' | 'home' | 'platform' | 'exists' | 'executable'> {
  /** OpenViking's `ov`, when it runs here (bots/knowledge.ts findViking). */
  readonly viking: () => Promise<{ readonly bin: string; readonly pre?: readonly string[] } | undefined>;
}

/** Indexes can take a while on a big repository. */
const INDEX_MS = 15 * 60_000;

/** OpenViking's folder for a project: its name, kept to what a URI takes. */
export const vikingParent = (root: string): string => `viking://resources/${path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'}`;

/** The setup a new worktree runs: the project's install, then each index whose tool is here. */
export function stackSetup(root: string, has: (tool: 'gitnexus' | 'gls') => boolean, platform: NodeJS.Platform = process.platform): string | undefined {
  const parts = [detectSetup(root, platform), has('gitnexus') ? 'gitnexus analyze --index-only' : undefined, has('gls') ? 'gls graphify ensure' : undefined].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' && ') : undefined;
}

/** .git/info/exclude with the indexes' folders added (a worktree's or a plain folder's: nothing). */
export function excludeIndexes(root: string): void {
  const git = path.join(root, '.git');
  try {
    if (!statSync(git).isDirectory()) return;
  } catch {
    return;
  }
  const file = path.join(git, 'info', 'exclude');
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // None yet: made below.
  }
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const add = STACK_EXCLUDES.filter((line) => !have.has(line));
  if (!add.length) return;
  try {
    appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
  } catch {
    // No info/ folder (an odd .git): the indexes show as untracked, nothing worse.
  }
}

/** A beluga.json and a CLAUDE.md, each only where the project has none. */
export function writeMissing(root: string, has: (tool: 'gitnexus' | 'gls') => boolean, platform: NodeJS.Platform = process.platform): BootstrapFile[] {
  const wrote: BootstrapFile[] = [];
  const ownFile = [...PROJECT_FILES, 'conductor.json'].some((name) => existsSync(path.join(root, name)));
  const setup = ownFile ? undefined : stackSetup(root, has, platform);
  if (setup) {
    writeFileSync(path.join(root, 'beluga.json'), `${JSON.stringify({ scripts: { setup } }, null, 2)}\n`);
    wrote.push('beluga.json');
  }
  // Claude Code reads CLAUDE.md: point it at AGENTS.md, where the project's own rules are.
  if (!existsSync(path.join(root, 'CLAUDE.md')) && existsSync(path.join(root, 'AGENTS.md'))) {
    writeFileSync(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
    wrote.push('CLAUDE.md');
  }
  return wrote;
}

/** The documentation paths OpenViking gets: README*, AGENTS.md, CLAUDE.md, docs/, roadmap/. */
export function docPaths(root: string): string[] {
  let readmes: string[] = [];
  try {
    readmes = readdirSync(root).filter((f) => /^readme(\.|$)/i.test(f));
  } catch {
    return [];
  }
  return [...readmes, ...DOCS.filter((d) => existsSync(path.join(root, d)))];
}

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'it failed';

/** Set the project at `root` up for the stack (see the top of this file). */
export async function bootstrapProject(root: string, deps: BootstrapDeps): Promise<BootstrapReport> {
  const has = (tool: 'gitnexus' | 'gls'): boolean => Boolean(findTool(tool, deps));
  excludeIndexes(root);
  const wrote = writeMissing(root, has, deps.platform);
  const ran: BootstrapStep[] = [];
  const failed: { step: BootstrapStep; why: string }[] = [];
  const step = async (name: BootstrapStep, bin: string, args: readonly string[], timeoutMs = INDEX_MS): Promise<void> => {
    const r = await deps.run(bin, args, { cwd: root, timeoutMs });
    if (r.code === 0) ran.push(name);
    else failed.push({ step: name, why: tail(r.out) });
  };
  const gitnexus = findTool('gitnexus', deps);
  if (gitnexus) await step('gitnexus', gitnexus, ['analyze', '--index-only']);
  const gls = findTool('gls', deps);
  if (gls) await step('graphify', gls, ['graphify', 'ensure']);
  const viking = await deps.viking();
  const docs = viking ? docPaths(root) : [];
  if (viking && docs.length) {
    // Queued, not waited for (its model summarizes each file): OpenViking works through them on its own.
    const parent = vikingParent(root);
    const before = failed.length;
    for (const doc of docs) {
      const r = await deps.run(viking.bin, [...(viking.pre ?? []), 'add-resource', path.join(root, doc), '-p', parent], { cwd: root, timeoutMs: 120_000 });
      if (r.code !== 0) failed.push({ step: 'openviking', why: tail(r.out) });
    }
    if (failed.length === before) ran.push('openviking');
  }
  return { wrote, ran, failed };
}
