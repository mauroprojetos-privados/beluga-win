import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { RunOrchestrator } from '../../agent/types.js';
import { readProjectFile } from '../../workspaces/scripts.js';
import { parseBotFile } from '../bots/schema.js';
import type { RouteWorld } from './model.js';
import { type OrchestratorBlock, type OrchestratorState, type ResolvedOrchestrator, claudeExecutors, resolveOrchestrator } from './orchestrator.js';

/**
 * Orchestrator mode for one run, from the places it can be set (Settings, the project's beluga.json,
 * the bot's bot.json, the conversation): the daemon's side of core/routing/orchestrator.ts, which reads files.
 */

/** The project's own block (beluga.json at its folder, a worktree's own copy included); unset when none. */
export function projectOrchestrator(root: string | undefined): OrchestratorBlock | undefined {
  if (!root) return undefined;
  try {
    return readProjectFile(root).file?.orchestrator;
  } catch {
    return undefined;
  }
}

/** A bot's block (bot.json in its folder); unset when the folder isn't a bot's or sets none. */
export function botOrchestrator(dir: string | undefined): OrchestratorBlock | undefined {
  const file = dir ? path.join(dir, 'bot.json') : undefined;
  if (!file || !existsSync(file)) return undefined;
  try {
    return parseBotFile(readFileSync(file, 'utf8')).bot.orchestrator;
  } catch {
    return undefined;
  }
}

/** The sub-agents a bot brings itself (.claude/agents/<name>.md next to its bot.json): they win over an executor of the same name. */
export function botAgentNames(dir: string | undefined): Set<string> {
  const names = new Set<string>();
  if (!dir || !existsSync(path.join(dir, 'bot.json'))) return names;
  const agents = path.join(dir, '.claude', 'agents');
  try {
    for (const file of readdirSync(agents)) {
      if (!file.endsWith('.md')) continue;
      names.add(file.slice(0, -3));
      // Claude Code names an agent by its frontmatter's `name:`, when it has one.
      const named = /^---[\s\S]*?^name:\s*["']?([\w-]+)["']?\s*$/m.exec(readFileSync(path.join(agents, file), 'utf8').slice(0, 4000));
      if (named?.[1]) names.add(named[1]);
    }
  } catch {
    // No agents of its own.
  }
  return names;
}

/** Where a run is, for its orchestrator: its folder, a bot's folder (its own, or the one a task was handed to) and the conversation's switch. */
export interface OrchestratorPlace {
  readonly cwd?: string;
  readonly botDir?: string;
  readonly conversation?: boolean;
}

/** The orchestrator that applies to a run there, resolved now. */
export function orchestratorAt(st: OrchestratorState, world: RouteWorld, where: OrchestratorPlace): ResolvedOrchestrator {
  const botDir = where.botDir ?? (where.cwd && existsSync(path.join(where.cwd, 'bot.json')) ? where.cwd : undefined);
  return resolveOrchestrator(st, world, {
    project: projectOrchestrator(where.cwd),
    bot: botOrchestrator(botDir),
    ...(where.conversation !== undefined ? { conversation: { on: where.conversation } } : {}),
  });
}

/** What a Claude run gets: its Claude executors that can run now, less the names the bot's own agents take. Undefined: off, or none left. */
export function runOrchestrator(o: ResolvedOrchestrator, taken: ReadonlySet<string> = new Set()): RunOrchestrator | undefined {
  if (!o.on) return undefined;
  const executors = claudeExecutors(o)
    .filter((e) => !taken.has(e.name))
    .map((e) => ({ name: e.name, can: e.can, ...(e.model ? { model: e.model } : {}), ...(e.description ? { description: e.description } : {}) }));
  return executors.length ? { executors, delegate: o.delegate } : undefined;
}
