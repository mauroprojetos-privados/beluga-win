import { type Key, en, t } from './index.js';

// A sentence written in English in a screen's source, said in the app's language (docs/i18n.md):
// for Settings' rows, whose English the search reads. Pure, browser-safe.

/** One of the catalog's plain sentences, by its English words. */
export type Said = Extract<(typeof en)[Key], string>;

let keys: Map<string, Key> | undefined;
/** The key whose English is `english`, if the catalog has one (the first such key). */
export function keyOfEnglish(english: string): Key | undefined {
  keys ??= new Map(Object.entries(en).flatMap(([key, words]) => (typeof words === 'string' ? [[words, key as Key] as const] : [])).reverse());
  return keys.get(english);
}

/** `english` in the app's language: its catalog sentence, or the English itself. Typed against the catalog. */
export function say(english: Said): string {
  const key = keyOfEnglish(english);
  return key ? t(key) : english;
}
