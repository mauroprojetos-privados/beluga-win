import type { CombinedEarnings } from '@beluga/core/earnings-combined.js';
import type { MoneyTotal } from '@beluga/core/earnings-store.js';
import { useEffect, useRef, useState } from 'react';
import { formatMoney, missingNote, newestPaid, openEarnings, ratesWhen, sourcesOf, updatedAgo, useConverted, useMoney, usePaymentArrivals, useProjectEarnings, useRevenueRises } from '../lib/earnings.js';
import { brandText } from '../lib/brand.js';
import { Icon } from './Icon.js';
import { PixelBurst } from './PixelBurst.js';
import { Tip, cx } from './ui.js';
import s from './earnings.module.css';
import { useT } from '../lib/i18n.js';

/**
 * What a project's tooltip says: its total in the currency earnings are shown in, what it earned in
 * each currency when that's another (or several), how fresh, what went wrong.
 */
export function EarningsTipBody({ earnings }: { earnings: CombinedEarnings }) {
  const t = useT();
  const { fx } = useMoney();
  const totals = earnings.totals ?? [];
  const money = useConverted(totals);
  const breakdown = money.converted || money.missing.length > 0;
  const note = missingNote(money.missing);
  const head = earnings.refreshing && !earnings.totals ? t('components.earnings.counting', { sources: sourcesOf([earnings]) }) : earnings.refreshing ? t('components.earnings.updating') : t('components.earnings.updated', { ago: updatedAgo(earnings.updatedAt) });
  const newest = newestPaid(earnings);
  // With both sources, what each one counted (the total above is the two added).
  const stripeMoney = useConverted(earnings.stripe?.totals);
  const rcMoney = useConverted(earnings.revenuecat?.totals);
  const both = Boolean(earnings.stripe && earnings.revenuecat);
  const part = (name: string, source: { totals?: readonly MoneyTotal[]; refreshing?: boolean } | undefined, m: ReturnType<typeof useConverted>) =>
    source ? (
      <span key={name} className={s.tipLine}>
        <span>{name}</span>
        <span className={s.num}>{source.totals ? `${m.converted ? '≈ ' : ''}${formatMoney(m.amount, m.currency)}` : t('components.earnings.countingShort')}</span>
      </span>
    ) : null;
  const errors = [
    ['Stripe', earnings.stripe?.error],
    ['RevenueCat', earnings.revenuecat?.error],
  ] as const;
  return (
    <span className={s.tipBody}>
      <span>{head}</span>
      {breakdown ? <span className={s.tipTotal}>≈ {formatMoney(money.amount, money.currency)}</span> : totals.length ? <span className={s.tipTotal}>{formatMoney(money.amount, money.currency)}</span> : null}
      {breakdown
        ? totals.map((tot) => (
            <span key={tot.currency} className={s.tipLine}>
              <span>{tot.currency.toUpperCase()}</span>
              <span className={s.num}>{formatMoney(tot.amount, tot.currency)}</span>
            </span>
          ))
        : null}
      {both ? [part('Stripe', earnings.stripe, stripeMoney), part('RevenueCat', earnings.revenuecat, rcMoney)] : null}
      {note ? <span className={s.tipDim}>{note}</span> : null}
      {newest ? (
        <span className={s.tipDim}>
          {t('components.earnings.lastPayment', { ago: updatedAgo(newest.at), amount: formatMoney(newest.amount, newest.currency) })}
        </span>
      ) : null}
      {money.converted && fx ? <span className={s.tipDim}>{t('components.earnings.converted', { when: ratesWhen(fx.at) })}</span> : null}
      {earnings.mode === 'test' && !earnings.revenuecat ? <span className={s.tipDim}>{t('components.earnings.testMode')}</span> : null}
      {errors.map(([name, error]) => (error ? <span key={name} className={s.tipError}>{both ? `${name}: ` : ''}{brandText(error.message)}</span> : null))}
    </span>
  );
}

/** True for a moment after each new payment (`arrivals` counting up), not on first show. */
function usePulse(arrivals: number): boolean {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!arrivals) return;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(timer);
  }, [arrivals]);
  return pulse;
}

/**
 * A project's all-time earnings (Stripe and RevenueCat added) beside its name in the sidebar: one amount, compact ("$12.4K"),
 * in the currency you show earnings in (other currencies converted at today's rates; each shows
 * on hover). Just the figure, in a quiet money green; it shimmers while earnings are being read, and
 * when a new payment arrives it hops and tints for a moment (`celebrate`, the sidebar's: with a
 * burst of pixel confetti).
 * Clicking it opens the project's Earnings sheet. Nothing when neither Stripe nor RevenueCat is connected.
 */
export function EarningsPill({ root, projectId, celebrate }: { root: string | undefined; projectId: string; celebrate?: boolean }) {
  const t = useT();
  const earnings = useProjectEarnings(root);
  const ref = useRef<HTMLButtonElement>(null);
  const arrivals = usePaymentArrivals(earnings);
  const rises = useRevenueRises(root);
  // A rise in RevenueCat's total pulses the pill too, but only Stripe's payments throw confetti.
  const pulse = usePulse(arrivals + rises);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (arrivals && celebrate) setBurst(arrivals);
  }, [arrivals, celebrate]);
  const totals = earnings?.totals ?? [];
  const money = useConverted(totals);
  // Nothing has a rate yet: its biggest total, as it is.
  const nothingConverts = totals.length > 0 && money.missing.length === totals.length;
  const shown = totals.length ? (nothingConverts ? totals[0] : { amount: money.amount, currency: money.currency }) : undefined;
  const label = shown ? formatMoney(shown.amount, shown.currency, true) : earnings?.totals ? formatMoney(0, money.currency, true) : '';
  if (!earnings) return null;
  const failed = Boolean(earnings.error) && !shown;
  return (
    <Tip label={<EarningsTipBody earnings={earnings} />}>
      <button
        ref={ref}
        type="button"
        className={cx(s.pill, earnings.refreshing && s.shimmer, earnings.mode === 'test' && !earnings.revenuecat && s.test, failed && s.failed, earnings.error && shown && s.stale, !shown && !failed && !earnings.totals && s.pending, pulse && s.pulse)}
        aria-label={shown ? (money.converted ? t('components.earnings.allTimeAbout', { amount: formatMoney(shown.amount, shown.currency) }) : t('components.earnings.allTime', { amount: formatMoney(shown.amount, shown.currency) })) : failed ? t('components.earnings.problem') : t('components.earnings.countingAria')}
        data-earnings-pill={projectId}
        onClick={(e) => {
          e.stopPropagation();
          openEarnings(projectId);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {failed ? <Icon name="alert" size={10} /> : null}
        {label ? <span className={s.num}>{label}</span> : null}
        {burst ? <PixelBurst key={burst} anchor={ref.current} onDone={() => setBurst(0)} /> : null}
      </button>
    </Tip>
  );
}
