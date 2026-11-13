import { type CSSProperties, useMemo } from 'react';
import type { View } from '@beluga/shared/view-spec.js';
import { type CalendarDay, planCalendar, scaleColor, scaleOf } from '@beluga/shared/render/grid-model.js';
import { useDocTheme } from '../markdown/use-doc-theme.js';
import type { ViewData } from './use-view-data.js';
import { formatCell, formatNumber, headingOf } from './format.js';
import { useHoverTip } from './HoverTip.js';
import { useT } from '../../lib/i18n.js';
import v from './views.module.css';

/**
 * A calendar of days (GitHub's contributions): a column per week, Monday on top, each day a small
 * rounded square colored by its value. Months above, Mon/Wed/Fri beside; hover a day for its value
 * (and its note). Underneath: how many days had something, the total, and Less → More.
 */

const dateF = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const DAYS = (t: ReturnType<typeof useT>): string[] => [t('components.views.calendar.mon'), '', t('components.views.calendar.wed'), '', t('components.views.calendar.fri'), '', ''];

/** A YYYY-MM-DD as a local date (not UTC midnight). */
const local = (d: string): Date => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, day ?? 1);
};

export function CalendarView({ view, data }: { view: View; data: ViewData }) {
  const t = useT();
  const dark = useDocTheme() === 'dark';
  const plan = useMemo(() => planCalendar(view, data.rows, data.columns), [view, data.rows, data.columns]);
  const { show, hide, tip } = useHoverTip();
  if (!plan) return <div className={v.empty}>{data.loading ? t('common.loading') : t('components.views.calendar.empty')}</div>;
  const scale = scaleOf(view, dark);
  const fmt = (n: number): string => (plan.valueColumn ? formatCell(n, plan.valueColumn) : formatNumber(n));
  const color = (d: CalendarDay): string => (d.inside ? scaleColor(d.value, plan.min, plan.max, scale) : 'transparent');
  const weeks = plan.weeks.length;
  const style = { gridTemplateColumns: `28px repeat(${weeks}, minmax(9px, 1fr))`, minWidth: 28 + weeks * 12, maxWidth: 28 + weeks * 17 } as CSSProperties;
  const tipFor = (d: CalendarDay) => (
    <>
      <div className={v.tipHead}>{dateF.format(local(d.date))}</div>
      <div className={v.tipRow}>
        <span className={v.legendMark} style={{ background: color(d) }} />
        <span className={v.tipName}>{plan.valueColumn ? headingOf(plan.valueColumn) : t('components.views.calendar.count')}</span>
        <span className={v.tipValue}>{fmt(d.value ?? 0)}</span>
      </div>
      {d.note ? <div className={v.calNote}>{d.note}</div> : null}
    </>
  );
  return (
    <div className={v.cal} onMouseLeave={hide}>
      <div className={v.heatScroll}>
        <div className={v.calGrid} style={style} role="grid" aria-label={view.title ?? t('components.views.calendar.label')}>
          <span style={{ gridRow: 1, gridColumn: 1 }} />
          {plan.months.map((m) => (
            <span key={`${m.week}-${m.label}`} className={v.calMonth} style={{ gridRow: 1, gridColumn: m.week + 2 }}>
              {m.label}
            </span>
          ))}
          {DAYS(t).map((d, i) => (
            <span key={`d${i}`} className={v.calDay} style={{ gridRow: i + 2, gridColumn: 1 }}>
              {d}
            </span>
          ))}
          {plan.weeks.map((week, w) =>
            week.map((d, i) => (
              <span
                key={d.date}
                role="gridcell"
                className={d.inside ? v.calCell : v.calOut}
                style={{ gridRow: i + 2, gridColumn: w + 2, background: color(d) }}
                aria-label={d.inside ? `${d.date}: ${fmt(d.value ?? 0)}` : undefined}
                {...(d.inside ? { onMouseEnter: (e: React.MouseEvent<HTMLSpanElement>) => show(e.currentTarget, tipFor(d)), onMouseLeave: hide } : {})}
              />
            )),
          )}
        </div>
      </div>
      <div className={v.calFoot}>
        <span>
          {t('components.views.calendar.foot', { count: plan.days, total: fmt(plan.total) })}
        </span>
        <span className={v.grow} />
        <span className={v.calScale}>
          {t('components.views.calendar.less')}
          {scale.map((c) => (
            <span key={c} className={v.calSwatch} style={{ background: c }} />
          ))}
          {t('components.views.calendar.more')}
        </span>
      </div>
      {tip}
    </div>
  );
}
