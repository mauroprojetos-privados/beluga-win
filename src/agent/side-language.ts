import { LANGUAGE_IN_ENGLISH, type Locale } from '../shared/i18n/locales.js';

// What the side calls (agent/side-calls.ts) answer in: the app's language (docs/i18n.md). The
// session sets where it comes from once; until then, and in tests, English.

let current: () => Locale = () => 'en';

/** Where the language comes from (the session: Settings › General › Language). */
export function setSideLanguage(from: () => Locale): void {
  current = from;
}

export const sideLanguage = (): Locale => current();

/** A side call's system prompt, told to write `what` in the app's language; as it is for English. */
export function inLanguage(system: string, what: string, locale: Locale = sideLanguage()): string {
  return locale === 'en' ? system : `${system} Write ${what} in ${LANGUAGE_IN_ENGLISH[locale]}.`;
}
