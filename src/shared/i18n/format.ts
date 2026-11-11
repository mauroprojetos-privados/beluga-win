import { type Key, getLocale, translate } from './index.js';
import { INTL_TAG, type Locale } from './locales.js';

// Dates, times, numbers and money in the chosen language, in one place (docs/i18n.md): never
// `toLocaleString()` with the system's language. Each takes a `locale` to say it in another one.

type When = Date | number;

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat | Intl.ListFormat>();
function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat | Intl.ListFormat>(kind: string, locale: Locale, options: object, make: (tag: string) => T): T {
  const id = `${kind}|${locale}|${JSON.stringify(options)}`;
  let f = cache.get(id) as T | undefined;
  if (!f) cache.set(id, (f = make(INTL_TAG[locale])));
  return f;
}

const dateFormat = (locale: Locale, options: Intl.DateTimeFormatOptions) => cached('d', locale, options, (tag) => new Intl.DateTimeFormat(tag, options));
const numberFormat = (locale: Locale, options: Intl.NumberFormatOptions) => cached('n', locale, options, (tag) => new Intl.NumberFormat(tag, options));

/** "11/11/2026" (en: "11/11/2026", pt-BR: "11/11/2026"), or `style` long: "November 11, 2026" / "11 de novembro de 2026". */
export function formatDate(when: When, style: 'short' | 'medium' | 'long' = 'short', locale: Locale = getLocale()): string {
  const options: Intl.DateTimeFormatOptions = style === 'short' ? { year: 'numeric', month: '2-digit', day: '2-digit' } : { dateStyle: style };
  return dateFormat(locale, options).format(when);
}

/** "2:30 PM" / "14:30". */
export function formatTime(when: When, locale: Locale = getLocale()): string {
  return dateFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(when);
}

/** "11/11/2026, 2:30 PM" / "11/11/2026, 14:30". */
export function formatDateTime(when: When, locale: Locale = getLocale()): string {
  return dateFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }).format(when);
}

/** Any other date shape, with `Intl`'s own options ("Wed", "Nov 11"…). */
export function formatDateWith(when: When, options: Intl.DateTimeFormatOptions, locale: Locale = getLocale()): string {
  return dateFormat(locale, options).format(when);
}

/** "1,234.5" / "1.234,5". */
export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}, locale: Locale = getLocale()): string {
  return numberFormat(locale, options).format(n);
}

/** `ratio` 0–1 as "42%" / "42%". */
export function formatPercent(ratio: number, digits = 0, locale: Locale = getLocale()): string {
  return numberFormat(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(ratio);
}

/** "$1,234.56" / "R$ 1.234,56" (`currency` an ISO code, any case; amount in whole units, not cents). */
export function formatMoney(amount: number, currency: string, locale: Locale = getLocale(), options: Intl.NumberFormatOptions = {}): string {
  return numberFormat(locale, { style: 'currency', currency: currency.toUpperCase(), ...options }).format(amount);
}

/** "5 minutes ago" / "há 5 minutos", "in 2 days" / "em 2 dias", from `when` to `now`. */
export function formatRelative(when: When, now: When = Date.now(), locale: Locale = getLocale()): string {
  const secs = Math.round((Number(when) - Number(now)) / 1000);
  const abs = Math.abs(secs);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60 ? [0, 'second'] : abs < 3600 ? [Math.round(secs / 60), 'minute'] : abs < 86_400 ? [Math.round(secs / 3600), 'hour'] : abs < 30 * 86_400 ? [Math.round(secs / 86_400), 'day'] : abs < 365 * 86_400 ? [Math.round(secs / (30 * 86_400)), 'month'] : [Math.round(secs / (365 * 86_400)), 'year'];
  // Some phones' engines have no RelativeTimeFormat: the number and its unit, said plainly.
  if (typeof Intl.RelativeTimeFormat !== 'function') return value === 0 ? translate(locale, 'time.now') : translate(locale, value < 0 ? 'time.ago' : 'time.in', { n: formatNumber(Math.abs(value), {}, locale), unit: translate(locale, `time.${unit}` as Key, { count: Math.abs(value) }) });
  const rtf = cached('r', locale, { numeric: 'auto' }, (tag) => new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }));
  return rtf.format(value, unit);
}

/** "a, b and c" / "a, b e c". */
export function formatList(items: readonly string[], locale: Locale = getLocale()): string {
  if (typeof Intl.ListFormat !== 'function') return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${translate(locale, 'common.and')} ${items.at(-1)}`;
  return cached('l', locale, { type: 'conjunction' }, (tag) => new Intl.ListFormat(tag, { style: 'long', type: 'conjunction' })).format(items);
}
