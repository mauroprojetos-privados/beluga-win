import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { Button, IconButton, Tip, cx } from '../components/ui.js';
import { EarningsTipBody } from '../components/EarningsPill.js';
import { dismissEarningsHint, formatMoney, missingNote, openEarnings, refreshEarnings, sourcesOf, updatedAgo, useConvertedEarnings, useEarningsHintDismissed } from '../lib/earnings.js';
import { useApi, useApp } from '../lib/beluga.js';
import s from './earnings-card.module.css';
import { useT } from '../lib/i18n.js';

/**
 * The Overview's Earnings: every project with Stripe or RevenueCat connected and what it earned, all-time.
 * Before any is connected, a one-time hint says it exists (dismissed for good with ✕).
 */
export function EarningsCard() {
  const t = useT();
  const api = useApi();
  const summary = useConvertedEarnings();
  const dismissed = useEarningsHintDismissed();
  const repos = useApp((st) => st.projects.filter((p) => p.root).length);
  if (!summary.projects.length) {
    if (dismissed || !repos) return null;
    return (
      <section className={s.hint} aria-label={t('views.earnings.trackLabel')}>
        <span className={s.hintIcon} aria-hidden="true">
          <Icon name="coin" size={16} />
        </span>
        <span className={s.hintText}>
          <span className={s.hintTitle}>{t('views.earnings.trackTitle')}</span>
          <span className={s.hintDetail}>{t('views.earnings.trackDetail')}</span>
        </span>
        <Button size="small" variant="primary" onClick={() => openEarnings()}>
          {t('views.earnings.connect')}
        </Button>
        <IconButton icon="x" label={t('views.earnings.dontShow')} className={s.dismiss} onClick={dismissEarningsHint} />
      </section>
    );
  }
  const { currency, total, rows } = summary.converted;
  const several = summary.projects.length > 1;
  const counted = summary.projects.some((c) => c.earnings.totals);
  return (
    <section className={s.card} aria-label={t('views.earnings.earnings')}>
      <div className={s.head}>
        <h2 className={s.title}>{t('views.earnings.earnings')}</h2>
        <span className={s.sub}>{t('views.earnings.allTimeFrom', { sources: sourcesOf(summary.projects.map((c) => c.earnings)) })}{summary.updatedAt && !summary.refreshing ? t('views.earnings.updated', { ago: updatedAgo(summary.updatedAt) }) : summary.refreshing ? t('views.earnings.counting') : ''}</span>
        <span className={s.actions}>
          <Button size="small" variant="quiet" icon="plus" onClick={() => openEarnings()}>
            {t('views.earnings.connectAnother')}
          </Button>
          <Tip label={t('views.earnings.countAgain')}>
            <Button size="small" variant="quiet" icon="refresh" aria-label={t('views.earnings.refreshAll')} disabled={summary.refreshing} onClick={() => refreshEarnings(api)} />
          </Tip>
        </span>
      </div>
      <div className={s.tiles}>
        {several && counted ? (
          <div className={cx(s.tile, s.all)}>
            <span className={s.tileName}>{t('views.earnings.allProjects')}</span>
            <span className={s.amount}>{formatMoney(total.amount, currency)}</span>
            <span className={s.others}>{missingNote(total.missing) ?? (total.converted ? t('views.earnings.ecbRates') : ' ')}</span>
          </div>
        ) : null}
        {rows.map(({ item: { project, earnings }, money, share }) => (
          <Tip key={project.id} label={<EarningsTipBody earnings={earnings} />}>
            <button type="button" className={cx(s.tile, earnings.refreshing && s.counting)} onClick={() => openEarnings(project.id)}>
              <span className={s.tileName}>
                <ProjectIcon id={project.id} name={project.name} size={14} />
                {project.name}
                {earnings.mode === 'test' && !earnings.revenuecat ? <span className={s.test}>{t('views.earnings.test')}</span> : null}
                {earnings.error ? <Icon name="alert" size={11} className={s.warn} /> : null}
              </span>
              <span className={s.amount}>{earnings.totals ? formatMoney(money.amount, currency) : t('views.earnings.countingTile')}</span>
              <span className={s.others}>{missingNote(money.missing) ?? (several && earnings.totals ? t('views.earnings.share', { percent: Math.round(share * 100) }) : ' ')}</span>
            </button>
          </Tip>
        ))}
      </div>
    </section>
  );
}
