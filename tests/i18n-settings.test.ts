import { describe, expect, it } from 'vitest';
import { appLocale, commitLocale, systemLanguages } from '../src/core/language.js';
import { Settings } from '../src/shared/settings-schema.js';
import { PrefsPatch } from '../src/ipc/api.js';
import { I18N_API } from '../src/ipc/i18n-api.js';
import { SYNCED_SETTINGS } from '../src/machines/sync.js';

describe('the language setting', () => {
  it('is Automatic until chosen, and a value it doesn’t know reads as Automatic', () => {
    expect(Settings.parse({}).language).toBe('auto');
    expect(Settings.parse({ language: 'pt-BR' }).language).toBe('pt-BR');
    expect(Settings.parse({ language: 'klingon' }).language).toBe('auto');
  });

  it('keeps each project’s language for commits, dropping a malformed list', () => {
    expect(Settings.parse({ commitLanguages: { triexis: 'pt-BR' } }).commitLanguages).toEqual({ triexis: 'pt-BR' });
    expect(Settings.parse({ commitLanguages: { triexis: 'fr' } }).commitLanguages).toBeUndefined();
  });

  it('travels to the daemon and follows you to your other computers', () => {
    expect(PrefsPatch.safeParse({ language: 'en' }).success).toBe(true);
    expect(I18N_API['settings.language'].args.safeParse(['pt-BR']).success).toBe(true);
    expect(I18N_API['settings.language'].args.safeParse(['fr']).success).toBe(false);
    expect(I18N_API['settings.commitLanguage'].args.safeParse(['triexis', null]).success).toBe(true);
    expect(SYNCED_SETTINGS).toEqual(expect.arrayContaining(['language', 'commitLanguages']));
  });
});

describe('the daemon’s languages', () => {
  it('resolves Automatic with this computer’s languages', () => {
    expect(systemLanguages({ LANG: 'pt_BR.UTF-8' })[0]).toBe('pt_BR.UTF-8');
    expect(appLocale({ language: 'auto' })).toBe('en'); // tests pin BELUGA_LANGUAGE=en
    expect(appLocale({ language: 'pt-BR' })).toBe('pt-BR');
  });

  it('writes commits in the project’s language, English by default, never the app’s', () => {
    const prefs = { language: 'pt-BR', commitLanguages: { triexis: 'pt-BR' as const } };
    expect(commitLocale(prefs, 'triexis')).toBe('pt-BR');
    expect(commitLocale(prefs, 'beluga')).toBe('en');
    expect(commitLocale(prefs)).toBe('en');
  });
});
