import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readProjectFile } from '../workspaces/scripts.js';
import { parseBotFile } from './bots/schema.js';
import { type ResolvedSkills, type SkillList, resolveSkills } from '../shared/run-skills.js';

/**
 * The skills a run gets, from the places that can set them (shared/run-skills.ts): Settings, the
 * project's beluga.json at the run's folder, the bot's bot.json (its own folder, or the bot a task
 * was handed to). The daemon's side, which reads the files; a file that can't be read sets nothing.
 */

/** The project's own list (beluga.json at its folder, a worktree's own copy included). */
export function projectSkills(root: string | undefined): SkillList | undefined {
  if (!root) return undefined;
  try {
    return readProjectFile(root).file?.skills;
  } catch {
    return undefined;
  }
}

/** A bot's list (bot.json in its folder). */
export function botSkills(dir: string | undefined): SkillList | undefined {
  const file = dir ? path.join(dir, 'bot.json') : undefined;
  if (!file || !existsSync(file)) return undefined;
  try {
    return parseBotFile(readFileSync(file, 'utf8')).bot.skills;
  } catch {
    return undefined;
  }
}

/** The list that applies to a run at `cwd` (and `botDir`), Settings' list being `settings`. */
export function skillsAt(settings: SkillList | undefined, where: { readonly cwd?: string; readonly botDir?: string }): ResolvedSkills {
  const botDir = where.botDir ?? (where.cwd && existsSync(path.join(where.cwd, 'bot.json')) ? where.cwd : undefined);
  return resolveSkills({ settings, project: projectSkills(where.cwd), bot: botSkills(botDir) });
}
