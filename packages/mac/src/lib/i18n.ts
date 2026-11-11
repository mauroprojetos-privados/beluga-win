import { useEffect, useSyncExternalStore } from 'react';
import { type Key, type Locale, type Params, getLocale, onLocaleChange, resolveLocale, setLocale, t } from '../../../../src/shared/i18n/index.js';
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

// Settings' rows say their English in the app's language (src/shared/i18n/english.ts).
export { type Said, keyOfEnglish, say } from '../../../../src/shared/i18n/english.js';
