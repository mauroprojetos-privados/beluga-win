import { useMemo, useState } from 'react';
import { type StatsSnapshot, dailySeries, dayStart, streaks } from '@beluga/shared/stats.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { cx } from '../../components/ui.js';
import { type GroupBy, type GroupRow, duration, favouriteHour } from './stats-model.js';
import s from './stats.module.css';
import { useT } from '../../lib/i18n.js';

const DAYS = Array.from({ length: 7 }, (_, d) => new Date(2026, 0, 4 + d).toLocaleDateString([], { weekday: 'short' }));

/** Prompts by weekday and hour: when you work. */
export function Hours({ hours }: { hours: readonly number[] }) {
  const t = useT();
  const max = Math.max(1, ...hours);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const label = (i: number): string => `${DAYS[Math.floor(i / 24)]} ${new Date(2026, 0, 4, i % 24).toLocaleTimeString([], { hour: 'numeric' })}`;
  const none = !hours.some((n) => n > 0);
  return (
    <div className={cx(s.hours, none && s.hoursNone)} onMouseLeave={() => setHover(undefined)}>
      {none ? <p className={s.hoursEmpty}>{t('usage.hours.empty')}</p> : null}
      <div className={s.hoursGrid} role="grid" aria-label={t('usage.hours.grid')}>
        {DAYS.map((d, day) => (
          <div key={d} className={s.hoursRow} role="row">
            <span className={s.hoursDay}>{d}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const i = day * 24 + h;
              const n = hours[i] ?? 0;
              return (
                <span
                  key={h}
                  role="gridcell"
                  aria-label={t('usage.hours.cell', { when: label(i), n })}
                  className={cx(s.hour, hover === i && s.dayOn)}
                  style={{ opacity: n ? 0.18 + 0.82 * (n / max) : undefined, background: n ? undefined : 'var(--track)' }}
                  onMouseEnter={() => setHover(i)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className={s.calendarFoot}>
        {hover !== undefined ? (
          <span className={s.calendarHover}>
            <strong>{label(hover)}</strong> · {t('usage.hours.prompts', { n: (hours[hover] ?? 0).toLocaleString() })}
          </span>
        ) : (
          <span className={s.hoursAxis}>
            {[0, 6, 12, 18, 23].map((h) => (
              <span key={h}>{new Date(2026, 0, 4, h).toLocaleTimeString([], { hour: 'numeric' })}</span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** A few things worth knowing, as badges: a big figure and what it is. */
export function Highlights({ stats, now, rows, by }: { stats: StatsSnapshot; now: number; rows: readonly GroupRow[]; by: GroupBy }) {
  const t = useT();
  const { current, longest } = useMemo(() => streaks(stats, now), [stats, now]);
  const busiest = useMemo(() => dailySeries(stats, 'agentMs', now, 365).reduce<{ key: string; value: number } | undefined>((b, d) => (d.value > (b?.value ?? 0) ? d : b), undefined), [stats, now]);
  const hour = favouriteHour(stats.hours);
  const top = rows[0];
  const items: Array<{ icon: IconName; value: string; label: string; hot?: boolean }> = [
    { icon: 'flame', value: current ? t('usage.hours.daysCount', { count: current }) : t('usage.hours.noneYet'), label: current ? t('usage.hours.streakGoing') : t('usage.hours.startStreak'), hot: current > 0 },
    ...(longest > 1 ? [{ icon: 'star' as const, value: t('usage.hours.daysCount', { count: longest }), label: t('usage.hours.longestStreak') }] : []),
    ...(busiest ? [{ icon: 'calendar' as const, value: new Date(dayStart(busiest.key)).toLocaleDateString([], { month: 'short', day: 'numeric' }), label: t('usage.hours.busiestDay', { time: duration(busiest.value) }) }] : []),
    ...(hour ? [{ icon: 'clock' as const, value: hour.time, label: t('usage.hours.busiestHour', { day: hour.day }) }] : []),
    ...(top && rows.length > 1 ? [{ icon: 'heart' as const, value: top.name, label: by === 'agent' ? t('usage.hours.topAgent') : t('usage.hours.topProject') }] : []),
  ];
  return (
    <ul className={s.badges} aria-label={t('usage.hours.highlights')}>
      {items.map((it) => (
        <li key={it.label} className={cx(s.badge, it.hot && s.badgeHot)}>
          <Icon name={it.icon} size={15} />
          <span className={s.badgeText}>
            <strong>{it.value}</strong>
            <span>{it.label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
