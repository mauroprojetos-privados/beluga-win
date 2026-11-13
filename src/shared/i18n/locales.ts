// The languages Beluga speaks (docs/i18n.md). Browser-safe: the daemon, the Mac app, the web build
// and the phone all read it.

/** Every language with a catalog. `en` is the source: every other one falls back to it. */
export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

/** What Settings › General › Language offers: the system's language, or one of ours. */
export const LANGUAGE_CHOICES = ['auto', ...LOCALES] as const;
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language as it calls itself, for the pickers (never translated). */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', 'pt-BR': 'Português (Brasil)' };

/** Each language as an English sentence names it, for the agents' prompts ("Answer in …"). */
export const LANGUAGE_IN_ENGLISH: Record<Locale, string> = { en: 'English', 'pt-BR': 'Brazilian Portuguese' };

/** The BCP 47 tag `Intl` formats with: `en` is US English (dates as 11/11/2026). */
export const INTL_TAG: Record<Locale, string> = { en: 'en-US', 'pt-BR': 'pt-BR' };

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
export const isLanguageChoice = (v: unknown): v is LanguageChoice => typeof v === 'string' && (LANGUAGE_CHOICES as readonly string[]).includes(v);

/**
 * Ours for a language tag (`pt`, `pt-BR`, `pt_PT.UTF-8`, `en-GB`), or undefined for one we don't
 * have. Any Portuguese is Brazilian Portuguese for now: the only one we have.
 */
export function matchLocale(tag: string | undefined): Locale | undefined {
  if (!tag) return undefined;
  const clean = tag.split('.')[0]!.replace('_', '-').toLowerCase();
  if (clean === 'c' || clean === 'posix') return undefined;
  const lang = clean.split('-')[0];
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'en') return 'en';
  return undefined;
}

/**
 * The language to speak: the chosen one, or for `auto` (or nothing chosen) the first of the
 * system's languages we have, else English.
 */
export function resolveLocale(choice: LanguageChoice | string | undefined | null, system: readonly (string | undefined)[] = []): Locale {
  if (isLocale(choice)) return choice;
  for (const tag of system) {
    const found = matchLocale(tag);
    if (found) return found;
  }
  return DEFAULT_LOCALE;
}
