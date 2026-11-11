import { EarningsTipBody } from '../../components/EarningsPill.js';
import { Icon } from '../../components/Icon.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { Button, IconButton, Tip, cx } from '../../components/ui.js';
import { type ConnectedProject, formatGlance, formatMoney, missingNote, openEarnings, ratesWhen, updatedAgo, useConvertedEarnings } from '../../lib/earnings.js';
import type { ConvertedRow } from '../../lib/money.js';
import { Card } from './parts.js';
import s from './usage.module.css';
import { useT } from '../../lib/i18n.js';

/** One connected project: its name, what it earned in the shown currency, and a thin bar for its part of the total. */
function EarningsRow({ row, currency }: { row: ConvertedRow<ConnectedProject>; currency: string }) {
  const t = useT();
  const { project, earnings } = row.item;
  const counted = Boolean(earnings.totals);
  const nothingConverts = counted && row.money.missing.length > 0 && row.money.missing.length === earnings.totals!.length;
  const amount = !counted ? t('usage.earnings.counting') : nothingConverts ? '—' : formatGlance(row.money.amount, currency);
  const pct = Math.round(row.share * 100);
  return (
    <li>
      <Tip label={<EarningsTipBody earnings={earnings} />}>
        <button type="button" className={cx(s.earnRow, earnings.refreshing && s.earnCounting)} onClick={() => openEarnings(project.id)} aria-label={counted && pct ? t('usage.earnings.rowShare', { name: project.name, amount: formatMoney(row.money.amount, currency), pct }) : t('usage.earnings.row', { name: project.name, amount: counted ? formatMoney(row.money.amount, currency) : t('usage.earnings.countingLower') })}>
          <span className={s.earnName}>
            <ProjectIcon id={project.id} name={project.name} size={14} />
            <span className={s.earnLabel}>{project.name}</span>
            {earnings.mode === 'test' && !earnings.revenuecat ? <span className={s.earnTest}>{t('usage.earnings.test')}</span> : null}
            {earnings.error ? <Icon name="alert" size={11} className={s.alertWarn} /> : null}
          </span>
          <span className={s.earnAmount}>{amount}</span>
          <span className={s.earnShare} aria-hidden="true">
            <span style={{ width: `${row.share > 0 ? Math.max(1.5, row.share * 100) : 0}%` }} />
          </span>
        </button>
      </Tip>
    </li>
  );
}

/**
 * The Usage view's third card: what every project with Stripe or RevenueCat connected earned, all-time, as one
 * amount in the currency you show earnings in (Settings › General, or a project's Earnings sheet),
 * then each project with its part of it. Other currencies are converted at the ECB's daily rates;
 * a project's own currencies show on hover. With none connected, a quiet way to connect one.
 */
export function EarningsSummaryCard() {
  const t = useT();
  const summary = useConvertedEarnings();
  if (!summary.projects.length) {
    return (
      <Card label={t('usage.earnings.title')} title={t('usage.earnings.title')} className={s.earnCard}>
        <p className={s.quiet}>{t('usage.earnings.connectIntro')}</p>
        <div className={s.earnConnect}>
          <Button size="small" icon="coin" onClick={() => openEarnings()}>
            {t('usage.earnings.connect')}
          </Button>
        </div>
      </Card>
    );
  }
  const { converted, fx } = summary;
  const { currency, total } = converted;
  const counted = summary.projects.some((c) => c.earnings.totals);
  const status = summary.refreshing ? t('usage.earnings.counting') : summary.updatedAt ? t('usage.earnings.updated', { when: updatedAgo(summary.updatedAt) }) : undefined;
  const count = summary.projects.length;
  const caption = [t('usage.earnings.allTime'), t('usage.earnings.projects', { count }), ...(total.converted && fx ? [t('usage.earnings.ecbRates', { when: ratesWhen(fx.at) })] : [])].join(' · ');
  const note = missingNote(total.missing);
  return (
    <Card
      label={t('usage.earnings.title')}
      title={t('usage.earnings.title')}
      className={s.earnCard}
      aside={
        <>
          {status ? <span className={s.updated}>{status}</span> : null}
          <IconButton icon="plus" label={t('usage.earnings.connectAnother')} className={s.earnAdd} onClick={() => openEarnings()} />
        </>
      }
    >
      <div className={s.earnBody}>
        <div className={s.earnSummary}>
          <Tip label={total.converted ? t('usage.earnings.approximate', { amount: formatMoney(total.amount, currency) }) : formatMoney(total.amount, currency)}>
            <span className={s.earnTotal} data-earnings-total={currency} aria-label={t(total.converted ? 'usage.earnings.allTimeAbout' : 'usage.earnings.allTimeAmount', { amount: formatMoney(total.amount, currency) })}>
              {counted ? formatGlance(total.amount, currency) : '—'}
            </span>
          </Tip>
          <div className={s.earnCaption}>{caption}</div>
          {note ? <div className={s.earnNote}>{note}</div> : null}
        </div>
        <ul className={s.earnList} aria-label={t('usage.earnings.byProject')}>
          {converted.rows.map((row) => (
            <EarningsRow key={row.item.project.id} row={row} currency={currency} />
          ))}
        </ul>
      </div>
    </Card>
  );
}
