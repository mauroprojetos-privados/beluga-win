import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatList, formatMoney, formatNumber, formatPercent, formatRelative, formatTime } from '../src/shared/i18n/format.js';
import { CATALOGS, LOCALES, type Message, en, getLocale, isKey, matchLocale, onLocaleChange, ptBR, resolveLocale, sayKeyed, sayNeed, setLocale, t, translate, translator } from '../src/shared/i18n/index.js';

const slots = (m: Message): string[] =>
  [...new Set((typeof m === 'string' ? [m] : Object.values(m)).flatMap((s) => [...(s as string).matchAll(/\{(\w+)\}/g)].map((x) => x[1]!)))].sort();

afterEach(() => setLocale('en'));

describe('catalogs', () => {
  it('has every key in every language (pt-BR says nothing in English by accident)', () => {
    for (const locale of LOCALES) {
      const missing = Object.keys(en).filter((k) => CATALOGS[locale][k] === undefined);
      expect(missing, `missing in ${locale}`).toEqual([]);
    }
  });

  it('has no key in a translation that English lacks', () => {
    expect(Object.keys(ptBR).filter((k) => !isKey(k))).toEqual([]);
  });

  it('keeps the same {slots} and plural shape in each translation', () => {
    for (const [key, message] of Object.entries(ptBR)) {
      const source = en[key as keyof typeof en];
      expect(slots(message!), key).toEqual(slots(source));
      expect(typeof message, key).toBe(typeof source);
    }
  });

  it('never has an empty sentence', () => {
    for (const locale of LOCALES)
      for (const [key, m] of Object.entries(CATALOGS[locale])) for (const s of typeof m === 'string' ? [m] : Object.values(m!)) expect((s as string).trim(), `${locale} ${key}`).not.toBe('');
  });
});

describe('t', () => {
  it('says a key in the chosen language, with its slots filled', () => {
    expect(t('common.cancel')).toBe('Cancel');
    setLocale('pt-BR');
    expect(t('common.cancel')).toBe('Cancelar');
    expect(t('language.auto', { language: 'English' })).toBe('Automático (English)');
  });

  it('picks the plural form by count', () => {
    expect(t('needsYou.count', { count: 1 })).toBe('1 thing needs you');
    expect(t('needsYou.count', { count: 3 })).toBe('3 things need you');
    expect(translate('pt-BR', 'needsYou.count', { count: 1 })).toBe('1 coisa precisa de você');
    expect(translate('pt-BR', 'needsYou.count', { count: 2 })).toBe('2 coisas precisam de você');
  });

  it('falls back to English for a key a language lacks, never blank', () => {
    const saved = ptBR['common.cancel'];
    delete (ptBR as Record<string, unknown>)['common.cancel'];
    try {
      expect(translate('pt-BR', 'common.cancel')).toBe('Cancel');
    } finally {
      (ptBR as Record<string, unknown>)['common.cancel'] = saved;
    }
  });

  it('leaves a slot with no value as it is', () => {
    expect(t('language.auto')).toBe('Automatic ({language})');
  });

  it('tells screens when the language changes', () => {
    const heard: string[] = [];
    const stop = onLocaleChange((l) => heard.push(l));
    setLocale('pt-BR');
    setLocale('pt-BR');
    stop();
    setLocale('en');
    expect(heard).toEqual(['pt-BR']);
    expect(getLocale()).toBe('en');
  });

  it('binds a translator to one language', () => {
    expect(translator('pt-BR')('common.send')).toBe('Enviar');
  });

  it("says what the daemon sent by its key, or its text for a key it doesn't know", () => {
    setLocale('pt-BR');
    expect(sayKeyed({ text: 'Send', key: 'common.send' })).toBe('Enviar');
    expect(sayKeyed({ text: 'From a newer Mac', key: 'nope.unknown' })).toBe('From a newer Mac');
    expect(sayKeyed({ text: 'Plain' })).toBe('Plain');
  });
});

describe('locales', () => {
  it('matches system tags to ours', () => {
    expect(matchLocale('pt-BR')).toBe('pt-BR');
    expect(matchLocale('pt_PT.UTF-8')).toBe('pt-BR');
    expect(matchLocale('en-GB')).toBe('en');
    expect(matchLocale('fr-FR')).toBeUndefined();
    expect(matchLocale('C')).toBeUndefined();
  });

  it('resolves Automatic to the first system language we have, else English', () => {
    expect(resolveLocale('auto', ['fr-FR', 'pt-BR'])).toBe('pt-BR');
    expect(resolveLocale('auto', ['fr-FR'])).toBe('en');
    expect(resolveLocale(undefined, [])).toBe('en');
    expect(resolveLocale('en', ['pt-BR'])).toBe('en');
    expect(resolveLocale('xx', ['pt-BR'])).toBe('pt-BR');
  });
});

describe('format', () => {
  const when = new Date(2026, 10, 11, 14, 30);

  it('says dates and times in the language', () => {
    expect(formatDate(when)).toBe('11/11/2026');
    expect(formatDate(when, 'long', 'pt-BR')).toBe('11 de novembro de 2026');
    expect(formatDate(when, 'long')).toBe('November 11, 2026');
    expect(formatTime(when, 'pt-BR')).toBe('14:30');
    expect(formatTime(when)).toMatch(/^2:30\sPM$/);
    expect(formatDateTime(when, 'pt-BR')).toBe('11/11/2026, 14:30');
  });

  it('says numbers, percents and money in the language', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatNumber(1234.5, {}, 'pt-BR')).toBe('1.234,5');
    expect(formatPercent(0.42)).toBe('42%');
    expect(formatMoney(1234.56, 'brl', 'pt-BR')).toMatch(/^R\$\s1\.234,56$/);
    expect(formatMoney(1234.56, 'usd')).toBe('$1,234.56');
  });

  it('says how long ago, and lists', () => {
    const now = when.getTime();
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(formatRelative(now - 5 * 60_000, now, 'pt-BR')).toBe('há 5 minutos');
    expect(formatRelative(now + 2 * 86_400_000, now, 'pt-BR')).toBe('depois de amanhã');
    expect(formatList(['a', 'b', 'c'], 'pt-BR')).toBe('a, b e c');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
  });

  it('follows the chosen language when none is given', () => {
    setLocale('pt-BR');
    expect(formatNumber(1234.5)).toBe('1.234,5');
  });
});

describe('what the daemon sends by key (protocol 1.54)', () => {
  it('says a Needs You item in this screen’s language, and leaves one without keys as it is', () => {
    const sent = { title: 'Approve the plan “Ship”?', key: 'needs.approvePlan', params: { title: 'Ship' }, actions: [{ label: 'Approve', key: 'needs.approve' }, { label: 'Option A' }], answer: { label: 'Send', key: 'needs.send' } };
    setLocale('pt-BR');
    const said = sayNeed(sent);
    expect(said.title).toBe('Aprovar o plano “Ship”?');
    expect(said.actions.map((a) => a.label)).toEqual(['Aprovar', 'Option A']);
    expect(said.answer?.label).toBe('Enviar');
    const plain = { title: 'Something', actions: [{ label: 'OK' }] };
    expect(sayNeed(plain)).toBe(plain);
  });
});
