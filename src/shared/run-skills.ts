import { z } from 'zod';

/**
 * Which skills a run of yours gets (docs/routing.md "Skills per project"). Every skill Claude Code
 * finds is listed in every turn's context, so a project that uses three of them pays for thirty.
 * The list can sit in three places, the most specific winning whole: Settings (`skills`), the
 * project's beluga.json (`skills`), a bot's bot.json (`skills`). Unset everywhere: every skill, as
 * before. The SDK takes exact names only (`pdf`, or `plugin:skill`); a wildcard there fails the run,
 * so it's refused here, where the list is read.
 *
 * Browser-safe (zod only): the daemon resolves with it, and Settings shows the same list.
 */

/** A skill's exact name: its directory name, or `plugin:skill`. No wildcards, spaces, slashes or parentheses. */
export const SKILL_NAME = /^[A-Za-z0-9][\w.-]{0,63}(?::[A-Za-z0-9][\w.-]{0,63})?$/;
export const MAX_SKILLS = 100;

export const SkillName = z.string().regex(SKILL_NAME, 'A skill’s exact name (its folder’s name, or plugin:skill), without * or spaces');

/** `"all"`, or the names a run gets (`[]`: none). */
export const SkillList = z.union([z.literal('all'), z.array(SkillName).max(MAX_SKILLS)]);
export type SkillList = z.infer<typeof SkillList>;

/** As read from a file you may have edited by hand: a list that doesn't fit reads as unset (every skill). */
export const SavedSkills = SkillList.optional().catch(undefined);

/** Where the list came from, least specific first. */
export const SKILL_SOURCES = ['settings', 'project', 'bot'] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

export interface ResolvedSkills {
  readonly skills: SkillList;
  /** Which place set it (unset: none did; every skill). */
  readonly from?: SkillSource;
}

/** The list for a run: the most specific place's, whole (never merged), deduplicated. */
export function resolveSkills(layers: Partial<Record<SkillSource, SkillList | undefined>>): ResolvedSkills {
  for (const source of [...SKILL_SOURCES].reverse()) {
    const list = layers[source];
    if (list === undefined) continue;
    return { skills: list === 'all' ? 'all' : [...new Set(list)], from: source };
  }
  return { skills: 'all' };
}

/**
 * Skills typed in Settings ("pdf, docx project:deploy"): the names, and the ones that aren't a
 * skill's exact name (a wildcard, a slash). Commas, spaces and new lines separate.
 */
export function parseSkillNames(text: string): { readonly names: string[]; readonly bad: string[] } {
  const words = text
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const names: string[] = [];
  const bad: string[] = [];
  for (const w of words) (SKILL_NAME.test(w) ? names : bad).push(w);
  return { names: [...new Set(names)].slice(0, MAX_SKILLS), bad };
}

/**
 * The names as the SDK gets them for a run that also loads Beluga's own plugin of the project's (or
 * the bot's) skills (agent/runtime/claude/skill-plugins.ts): a bare `deploy` also means that
 * plugin's `project:deploy`, since the SDK matches exact names only.
 */
export function skillsForRun(list: SkillList, plugins: readonly string[] = []): SkillList {
  if (list === 'all') return 'all';
  const out = new Set(list);
  for (const name of list) if (!name.includes(':')) for (const p of plugins) out.add(`${p}:${name}`);
  return [...out];
}
