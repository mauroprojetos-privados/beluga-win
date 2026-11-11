import { type Locale, resolveLocale } from '../shared/i18n/locales.js';

// The daemon's languages (docs/i18n.md): what it says, and what agents answer and commit in.

/**
 * This computer's languages, best first: BELUGA_LANGUAGE (the tests pin it), then the usual
 * environment variables, then what Intl was started with (the system's on macOS and Windows).
 */
export function systemLanguages(env: NodeJS.ProcessEnv = process.env): string[] {
  let intl: string | undefined;
  try {
    intl = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    intl = undefined;
  }
  return [env.BELUGA_LANGUAGE, env.LC_ALL, env.LC_MESSAGES, env.LANG, intl].filter((v): v is string => Boolean(v));
}

/** The app's language: Settings › General › Language, `auto` (or unset) the system's. */
export const appLocale = (prefs: { readonly language?: string }): Locale => resolveLocale(prefs.language, systemLanguages());

/** What `project`'s commits and pull requests are written in: its own choice, else English (never the app's). */
export const commitLocale = (prefs: { readonly commitLanguages?: Readonly<Record<string, Locale>> }, project?: string): Locale => (project ? prefs.commitLanguages?.[project] : undefined) ?? 'en';
