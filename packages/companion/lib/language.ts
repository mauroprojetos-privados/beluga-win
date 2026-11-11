import { useSyncExternalStore } from 'react';
import { type Key, type Locale, type Params, getLocale, isLocale, onLocaleChange, resolveLocale, setLocale, t } from '../../../src/shared/i18n/index';
import { kv } from './kv';
import type { HomeView } from './link/protocol';
import { store } from './store';

/**
 * The phone's language (docs/i18n.md): the Mac's by default (Home's `mac.language`, since 1.52),
 * or its own from Settings › Advanced › Language. Before a Mac has said, the phone's own.
 */
export type PhoneLanguage = 'mac' | Locale;
let choice: PhoneLanguage = ((c) => (c === 'mac' || isLocale(c) ? c : 'mac'))(kv.get<string>('language'));

function phoneLanguages(): string[] {
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

/** What your Mac speaks, once it said (an older Mac doesn't). */
export function macLanguage(): Locale | undefined {
  const said = store.view<HomeView>('home')?.data.mac.language;
  return isLocale(said) ? said : undefined;
}

function apply(): void {
  setLocale(choice === 'mac' ? (macLanguage() ?? resolveLocale('auto', phoneLanguages())) : choice);
}
apply();
store.subscribe('view:home', apply);

export const language = {
  get: (): PhoneLanguage => choice,
  set(c: PhoneLanguage): void {
    choice = c;
    kv.set('language', c);
    apply();
  },
};

/** The language in use; the root remounts on change, so every screen says it afresh. */
export const useLocale = (): Locale => useSyncExternalStore(onLocaleChange, getLocale, getLocale);

/** `t`, for a screen that redraws when the language changes. */
export function useT(): (key: Key, params?: Params) => string {
  useLocale();
  return t;
}

export { sayNeed, t } from '../../../src/shared/i18n/index';
