import { type Key, t } from './index.js';

// The words of the core's own tables, said on a screen in the app's language (docs/i18n.md).
// STATUS_INFO, CATEGORY_INFO, TRUST_INFO and GRANT_INFO stay English in the core: the agents'
// prompts and the CLI read them. A screen says them through these.

/** A task's status on the board: "In Review", "Em revisão". */
export const statusLabel = (status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'in_plan' | 'done' | 'canceled'): string => t(`helpers.status.${status}`);

/** A kind of work's name: "Visual", "Rápido". */
export const categoryLabel = (category: 'quick' | 'deep' | 'ultrabrain' | 'visual' | 'review' | 'docs' | 'explore'): string => t(`helpers.category.${category}`);

/** What a kind of work is for. */
export const categoryHint = (category: 'quick' | 'deep' | 'ultrabrain' | 'visual' | 'review' | 'docs' | 'explore'): string => t(`helpers.category.${category}.hint`);

type Trust = 'blocked' | 'ask' | 'trusted' | 'full';

/** A trust level's name, short word and what it means. */
export const trustWords = (level: Trust): { readonly label: string; readonly short: string; readonly detail: string } => ({
  label: t(`helpers.trust.${level}.label`),
  short: t(`helpers.trust.${level}.short`),
  detail: t(`helpers.trust.${level}.detail`),
});

/** The same level seen from the other side: what a friend's trust lets you do there. */
export const grantWords = (level: Trust): { readonly short: string; readonly detail: string } => ({
  short: t(`helpers.grant.${level}.short`),
  detail: t(`helpers.grant.${level}.detail`),
});

/**
 * A table whose words are read when they're said, not when the module loads: each field is a key
 * (said in the language of the moment) or, for an empty field, ''. For the screens' own tables
 * (MODE_INFO, CATEGORY_TITLES…), so their callers stay as they are.
 */
export function wordTable<R extends Readonly<Record<string, Readonly<Record<string, Key | ''>>>>>(keys: R): { readonly [I in keyof R]: { readonly [F in keyof R[I]]: string } } {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, fields] of Object.entries(keys)) {
    const row: Record<string, string> = {};
    for (const [field, key] of Object.entries(fields)) Object.defineProperty(row, field, { get: () => (key ? t(key) : ''), enumerable: true });
    out[id] = row;
  }
  return out as { readonly [I in keyof R]: { readonly [F in keyof R[I]]: string } };
}

/** A record of words read when they're said: `{ active: 'helpers.chats.active' }` → `table.active` in the app's language. */
export function wordRecord<R extends Readonly<Record<string, Key>>>(keys: R): { readonly [I in keyof R]: string } {
  const out: Record<string, string> = {};
  for (const [id, key] of Object.entries(keys)) Object.defineProperty(out, id, { get: () => t(key), enumerable: true });
  return out as { readonly [I in keyof R]: string };
}
