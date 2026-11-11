import { type Key, en } from './en.js';
import { DEFAULT_LOCALE, type Locale } from './locales.js';
import type { Catalog, Message, Params } from './message.js';
import { ptBR } from './pt-BR.js';

// Beluga's words in the chosen language (docs/i18n.md). One small, typed layer with no
// dependencies, so the daemon, the Mac app, the web build and the phone all use the same one.

export { type Key, en } from './en.js';
export { ptBR } from './pt-BR.js';
export * from './locales.js';
export type { Catalog, Message, Params, PluralMessage } from './message.js';

export const CATALOGS: Record<Locale, Catalog> = { en, 'pt-BR': ptBR };

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

/** The language screens speak now. */
export const getLocale = (): Locale => current;

/** Speak `locale` from now on (a screen calls it when Settings › Language changes). */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const fn of listeners) fn(locale);
}

/** Hear when the language changes (a screen redraws). Returns the way to stop. */
export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether `key` is one of ours (a key sent by a newer daemon may not be). */
export const isKey = (key: unknown): key is Key => typeof key === 'string' && Object.hasOwn(en, key);

const plurals = new Map<string, Intl.PluralRules>();
/** The plural category of `count` (where Intl.PluralRules is missing, as on some phones' engines: one or other). */
export function pluralOf(locale: Locale, count: number): Intl.LDMLPluralRule {
  if (typeof Intl.PluralRules !== 'function') return Math.abs(count) === 1 || (locale === 'pt-BR' && count === 0) ? 'one' : 'other';
  let rules = plurals.get(locale);
  if (!rules) plurals.set(locale, (rules = new Intl.PluralRules(locale)));
  return rules.select(count);
}

function pick(message: Message, locale: Locale, params?: Params): string {
  if (typeof message === 'string') return message;
  const count = Number(params?.count ?? 0);
  if (count === 0 && message.zero !== undefined) return message.zero;
  return message[pluralOf(locale, count)] ?? message.other;
}

/** `{name}` slots filled from `params`; one with no value stays as it is, so the gap shows. */
function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : all));
}

/** `key` in `locale`: its own sentence, else English, else the key itself (never blank). */
export function translate(locale: Locale, key: Key, params?: Params): string {
  const message = CATALOGS[locale][key] ?? en[key] ?? key;
  return fill(pick(message, CATALOGS[locale][key] !== undefined ? locale : DEFAULT_LOCALE, params), params);
}

/** `key` in the language screens speak now. */
export const t = (key: Key, params?: Params): string => translate(current, key, params);

/** A `t` bound to one language, for the daemon saying something in a chosen language. */
export const translator =
  (locale: Locale) =>
  (key: Key, params?: Params): string =>
    translate(locale, key, params);

/**
 * A Needs You item (src/companion/protocol.ts) said in this screen's language: its title, buttons
 * and send button by their keys where the Mac sent them and we know them; the rest as sent.
 */
export function sayNeed<N extends { readonly title: string; readonly key?: string; readonly params?: Params; readonly actions: readonly { readonly label: string; readonly key?: string }[]; readonly answer?: { readonly label?: string; readonly key?: string } }>(n: N): N {
  if (!n.key && !n.actions.some((a) => a.key) && !n.answer?.key) return n;
  return {
    ...n,
    title: sayKeyed({ text: n.title, ...(n.key ? { key: n.key } : {}), ...(n.params ? { params: n.params } : {}) }),
    actions: n.actions.map((a) => (a.key && isKey(a.key) ? { ...a, label: t(a.key) } : a)),
    ...(n.answer ? { answer: n.answer.key && isKey(n.answer.key) ? { ...n.answer, label: t(n.answer.key) } : n.answer } : {}),
  };
}

/**
 * What the daemon sent, said here (protocol.ts `key`/`params` beside `text`): its key in this
 * screen's language when we know the key, else the daemon's own `text`.
 */
export function sayKeyed(sent: { readonly text?: string; readonly key?: string; readonly params?: Params }, fallback = ''): string {
  if (sent.key && isKey(sent.key)) return t(sent.key, sent.params);
  return sent.text ?? fallback;
}
