/**
 * The plain-words explanations, shared with the Mac (src/companion/diagnose.ts). Import from here
 * in the app: here they're said in the phone's language (that file stays English and import-free,
 * so it runs in Bare; its words carry their keys).
 */
import { type DialAttempt, type LinkPath } from '../../../../src/companion/protocol';
import { type DiagnoseInput, type Diagnosis, diagnose as diagnoseEnglish, pathLabelKey } from '../../../../src/companion/diagnose';
import { formatNumber } from '../../../../src/shared/i18n/format';
import { type Key, isKey, t } from '../../../../src/shared/i18n/index';

export * from '../../../../src/companion/diagnose';

const said = (key: string | undefined, english: string): string => (key && isKey(key) ? t(key) : english);

/** One attempt for the "Why?" sheet, in the phone's language. */
export function attemptLine(a: DialAttempt): string {
  const extras = [a.ms !== undefined ? t('shared.diagnose.seconds', { n: formatNumber(a.ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : '', a.code ?? ''].filter(Boolean).join(' · ');
  const way = t(`shared.diagnose.way.${a.way}` as Key);
  const outcome = t(`shared.diagnose.outcome.${a.outcome}` as Key);
  return extras ? t('shared.diagnose.attemptExtras', { way, outcome, extras }) : t('shared.diagnose.attempt', { way, outcome });
}

/** How a link came, in a few words, in the phone's language. */
export const pathLabel = (path: LinkPath): string => t(pathLabelKey(path) as Key);

/** What went wrong with the link, said in the phone's language. */
export function diagnose(input: DiagnoseInput): Diagnosis {
  const d = diagnoseEnglish(input);
  const detail = [...(input.report?.tried ?? []).map(attemptLine)];
  if (input.report?.dht === 'unreachable') detail.push(t('shared.diagnose.dhtSilent'));
  if (input.report?.recordAge !== undefined) detail.push(t('shared.diagnose.recordAge', { n: Math.round(input.report.recordAge / 60_000) }));
  if (input.online !== undefined) detail.push(t(input.online ? 'shared.diagnose.online' : 'shared.diagnose.notOnline'));
  const w = d.words;
  return {
    ...d,
    detail,
    ...(w ? { title: said(w.title, d.title), body: said(w.body, d.body) } : {}),
    ...(w && d.tryThis !== undefined ? { tryThis: said(w.tryThis, d.tryThis) } : {}),
  };
}
