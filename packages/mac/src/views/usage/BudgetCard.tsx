import type { AppState } from '@beluga/core/store.js';
import { dayBudgets } from '@beluga/core/budget/model.js';
import { budgetTokens } from '@beluga/shared/budget.js';
import { Card, Meter } from './parts.js';
import { resetsAt } from './usage-model.js';
import s from './usage.module.css';
import { useT } from '../../lib/i18n.js';

/**
 * Usage › Right now › Budget (docs/budget.md): today's spend against your daily budget, each
 * project's and bot's that has one, and your plan's 5-hour window against the 80% Beluga warns at.
 * With no budget set it says what today spent and where to set one.
 */
export function BudgetCard({ state, now }: { state: AppState; now: number }) {
  const t = useT();
  const day = dayBudgets(state, now);
  return (
    <Card label={t('budget.usage.title')} title={t('budget.usage.title')}>
      {day.lines.length ? (
        <div className={s.windows}>
          {day.lines.map((l) => (
            <div key={l.key} className={s.window} data-budget={l.level}>
              <div className={s.windowHead}>
                <span className={s.windowTitle}>{l.name ?? t(`budget.usage.${l.scope}`)}</span>
                <span className={s.windowPct}>
                  {l.pct}
                  <small>%</small>
                </span>
              </div>
              <Meter pct={l.pct} label={t('budget.usage.meter', { pct: l.pct })} />
              <div className={s.windowFoot}>{t('budget.usage.of', { used: budgetTokens(l.used), limit: budgetTokens(l.limit) })}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className={s.quiet}>{t('budget.usage.none', { used: budgetTokens(day.spent) })}</p>
      )}
      {day.plan ? <p className={s.quiet}>{day.plan.resetsAt && day.plan.resetsAt > now ? t('budget.usage.planResets', { pct: day.plan.pct, when: resetsAt(day.plan.resetsAt, now) }) : t('budget.usage.plan', { pct: day.plan.pct })}</p> : null}
    </Card>
  );
}
