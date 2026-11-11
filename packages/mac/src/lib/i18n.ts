import { useEffect, useSyncExternalStore } from 'react';
import { type Key, type Locale, type Params, en, getLocale, onLocaleChange, resolveLocale, setLocale, t } from '@beluga/shared/i18n/index.js';
import { useApp } from './beluga.js';

// The Mac app's language (docs/i18n.md): Settings › General › Language, kept by the daemon
// (`prefs.language`), `auto` resolved with this computer's own languages.

/** This computer's languages, best first (the web view's are the system's). */
export const systemLanguages = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

/** Speak the chosen language: App calls it once, and every `useT` screen redraws when it changes. */
export function useLanguage(): Locale {
  const choice = useApp((st) => st.prefs.language);
  const locale = resolveLocale(choice, systemLanguages());
  useEffect(() => {
    setLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);
  return locale;
}

/** The language screens speak now, redrawing when it changes. */
export const useLocale = (): Locale => useSyncExternalStore(onLocaleChange, getLocale, getLocale);

/** `t`, for a component that redraws when the language changes. */
export function useT(): (key: Key, params?: Params) => string {
  useLocale();
  return t;
}

/** One of the catalog's plain sentences, by its English words. */
export type Said = Extract<(typeof en)[Key], string>;

let keys: Map<string, Key> | undefined;
/** The key whose English is `english`, if the catalog has one (the first such key). */
export function keyOfEnglish(english: string): Key | undefined {
  keys ??= new Map(Object.entries(en).flatMap(([key, words]) => (typeof words === 'string' ? [[words, key as Key] as const] : [])).reverse());
  return keys.get(english);
}

/**
 * A sentence written in English in the source and said in the app's language: for Settings' row
 * labels and group titles, whose English must stay in the file because the Settings search indexes
 * it (dialogs/settings-index.ts, tests/mac-settings-search.test.ts). Typed against the catalog.
 */
export function say(english: Said): string {
  const key = keyOfEnglish(english);
  return key ? t(key) : english;
}
