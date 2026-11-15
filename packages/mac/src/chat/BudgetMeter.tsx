import { useMemo } from 'react';
import { type BudgetView, budgetView } from '@beluga/core/budget/model.js';
import { budgetTokens } from '@beluga/shared/budget.js';
import { Tip, cx } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { useClock } from '../lib/window-active.js';
import { useT } from '../lib/i18n.js';
import s from './budget.module.css';

/**
 * A conversation's token budget beside its context meter (docs/budget.md): what it spent against the
 * tightest budget on it ("1.2M / 2M"), amber from 80%, red once reached, and every budget on it
 * (the conversation's, your day's, its project's and bot's) and your plan's 5-hour window on hover.
 * Nothing set and the plan's window far off: nothing shows.
 */
export function BudgetMeter({ channel }: { channel: string }) {
  const t = useT();
  const now = useClock(true, 30_000);
  const prefs = useApp((st) => st.prefs);
  const projects = useApp((st) => st.projects);
  const bots = useApp((st) => st.bots);
  const spend = useApp((st) => st.spend);
  const selfId = useApp((st) => st.selfId);
  const self = useApp((st) => st.self);
  const view = useMemo(() => budgetView({ prefs, projects, bots, spend, selfId, self }, channel, now), [prefs, projects, bots, spend, selfId, self, channel, now]);
  if (!view) return null;
  const top = [...view.lines].sort((a, b) => b.pct - a.pct)[0];
  const label = top ? `${budgetTokens(top.used)} / ${budgetTokens(top.limit)}` : t('budget.meter.plan', { pct: view.plan?.pct ?? 0 });
  const tone = top ? top.level : view.plan?.level === 'over' ? 'over' : 'near';
  return (
    <Tip label={budgetTip(view, t)}>
      <span className={cx(s.chip, tone === 'near' && s.near, tone === 'over' && s.over)} data-budget={tone} aria-label={t('budget.meter.aria', { label })}>
        {label}
      </span>
    </Tip>
  );
}

/** Every budget on the conversation, a line each, and what happens at one. */
function budgetTip(view: BudgetView, t: ReturnType<typeof useT>): string {
  const lines = view.lines.map((l) => t(`budget.meter.${l.scope}`, { used: budgetTokens(l.used), limit: budgetTokens(l.limit), pct: l.pct, name: l.name ?? '' }));
  if (view.plan) lines.push(t('budget.meter.planLine', { pct: view.plan.pct }));
  if (view.lines.length) lines.push(view.cheaper ? t('budget.meter.cheaperNow') : t(`budget.meter.near.${view.near}`));
  return lines.join('\n');
}
