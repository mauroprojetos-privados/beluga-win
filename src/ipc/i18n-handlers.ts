import type { Session } from '../core/session.js';
import type { Args, Method } from './api.js';

/** What each `settings.*` language method does (see i18n-api.ts). */

type I18nMethod = Extract<Method, `settings.${string}`>;
type I18nHandlers = { readonly [M in I18nMethod]: (s: Session, ...args: Args<M>) => unknown };

export const I18N_HANDLERS = {
  'settings.language': (s, choice) => s.setPrefs({ language: choice }),
  'settings.commitLanguage': (s, project, locale) => {
    const { [project]: _gone, ...rest } = s.store.getState().prefs.commitLanguages ?? {};
    // English is the default: kept as unset, so a project with none says nothing in settings.json.
    const next = locale && locale !== 'en' ? { ...rest, [project]: locale } : rest;
    s.setPrefs({ commitLanguages: Object.keys(next).length ? next : null });
  },
} satisfies I18nHandlers;
