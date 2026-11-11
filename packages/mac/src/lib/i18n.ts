import { useEffect, useSyncExternalStore } from 'react';
import { type Key, type Locale, type Params, getLocale, onLocaleChange, resolveLocale, setLocale, t } from '../../../../src/shared/i18n/index.js';
import { useApp } from './beluga.js';

// The Mac app's language (docs/i18n.md): Settings › General › Language, kept by the daemon
// (`prefs.language`), `auto` resolved with this computer's own languages.

/** This computer's languages, best first (the web view's are the system's). */
export const systemLanguages = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

/** The main window's language, for its other windows (the call card, the sharer's overlay), which never hear the daemon's prefs. */
const LOCALE_KEY = 'beluga.locale';

/** A window without the daemon: speak the language the main window last spoke, and follow it when it changes. */
export function followMainLanguage(): void {
  const take = (value: string | null): void => {
    if (!value) return;
    const locale = resolveLocale(value, systemLanguages());
    setLocale(locale);
    document.documentElement.lang = locale;
  };
  try {
    take(localStorage.getItem(LOCALE_KEY));
  } catch {
    // No storage: English.
  }
  window.addEventListener('storage', (e) => {
    if (e.key === LOCALE_KEY) take(e.newValue);
  });
}

/** Speak the chosen language: App calls it once, and every `useT` screen redraws when it changes. */
export function useLanguage(): Locale {
  const choice = useApp((st) => st.prefs.language);
  const locale = resolveLocale(choice, systemLanguages());
  useEffect(() => {
    setLocale(locale);
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // No storage: the other windows stay in English.
    }
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
