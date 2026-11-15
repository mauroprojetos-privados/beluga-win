import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isSecretPath } from '../core/shares.js';

/**
 * A project's own instructions on a Claude run: its CLAUDE.md (and CLAUDE.local.md), with their
 * `@file` imports filled in, the way Claude Code itself would read them. Claude Code loads these
 * only when a run loads the project's settings, and Beluga never does (a friend with :rw could plant
 * hooks or permission rules there, see ownerSettings in runtime/claude/runner.ts). So without this,
 * a project's rules (its module boundaries, its commands, how to delegate) never reached the agent.
 * Text only: nothing here runs, and an import stays inside the folder and off secret files.
 * A project with only an AGENTS.md gets that (what Codex reads on its own).
 */

/** The most a project's instructions add to the prompt, imports included. */
export const PROJECT_INSTRUCTIONS_MAX = 40_000;
const FILE_MAX = 256 * 1024;
const IMPORT_DEPTH = 4;
const IMPORT = /^\s*@(\S+)\s*$/;

function readInside(file: string, root: string): string | undefined {
  try {
    const real = realpathSync(file);
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
    if (isSecretPath(file) || isSecretPath(real)) return undefined;
    const st = statSync(real);
    if (!st.isFile() || st.size > FILE_MAX) return undefined;
    return readFileSync(real, 'utf8');
  } catch {
    return undefined;
  }
}

/** `file`'s text with each `@path` line replaced by that file's own text (once each, nested a few deep). */
function expand(file: string, root: string, seen: Set<string>, depth: number): string | undefined {
  const text = readInside(file, root);
  if (text === undefined) return undefined;
  seen.add(path.resolve(file));
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const m = fenced ? null : IMPORT.exec(line);
      if (!m?.[1] || depth >= IMPORT_DEPTH) return line;
      const target = path.resolve(path.dirname(file), m[1]);
      if (seen.has(target)) return '';
      const inner = expand(target, root, seen, depth + 1);
      return inner === undefined ? line : inner.trimEnd();
    })
    .join('\n');
}

/** The instructions in `cwd`, or '' when it has none. */
export function projectInstructions(cwd: string): string {
  let root: string;
  try {
    root = realpathSync(cwd);
  } catch {
    return '';
  }
  const seen = new Set<string>();
  const parts = ['CLAUDE.md', 'CLAUDE.local.md'].flatMap((name) => {
    const text = expand(path.join(cwd, name), root, seen, 0);
    return text?.trim() ? [text.trim()] : [];
  });
  if (!parts.length) {
    const agents = expand(path.join(cwd, 'AGENTS.md'), root, seen, 0);
    if (agents?.trim()) parts.push(agents.trim());
  }
  const all = parts.join('\n\n');
  return all.length > PROJECT_INSTRUCTIONS_MAX ? `${all.slice(0, PROJECT_INSTRUCTIONS_MAX)}\n[…cut: the rest is in the file]` : all;
}

/** The project's instructions as a part of the run's own instructions, or '' when it has none. */
export function buildProjectInstructionsAppend(cwd: string): string {
  const text = projectInstructions(cwd);
  if (!text) return '';
  return (
    "\n\nThis project's own instructions (its CLAUDE.md, imports filled in), written by the people who work on it. " +
    'Follow them for work in this folder, under the rules above:\n<project-instructions>\n' +
    text +
    '\n</project-instructions>'
  );
}
