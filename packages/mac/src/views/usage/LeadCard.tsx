import { shortTokens } from '@beluga/core/routing/model.js';
import { type LeadReport, type LeadSplit, executorShare, leadReport, placesIn, savedUsd } from '@beluga/core/routing/measure.js';
import { DEFAULT_BASELINE } from '@beluga/core/routing/outcomes.js';
import { useApp } from '../../lib/beluga.js';
import { useT } from '../../lib/i18n.js';
import { Card } from './parts.js';
import c from './combos.module.css';

const same = (a: LeadReport, b: LeadReport): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Usage › Combos, lead and executors (docs/routing.md, orchestrator mode phase 5): what the lead
 * spent against what its sub-agents took off it, by conversation and by day, what that saved at the
 * price table's rates, and the context a run starts with per project (its fixed part is what
 * trimming skills and MCP servers lowers). All from the runs' cards. No run counted yet: no card.
 */
export function LeadCard() {
  const report = useApp((st) => leadReport(st.log, st.selfId, { baseline: st.prefs.savingsBaseline ?? DEFAULT_BASELINE, place: placesIn(st) }), same);
  const t = useT();
  if (!report.lead && !report.executors && !report.openings.length) return null;
  const split = (s: LeadSplit): string => t('routing.lead.split', { lead: shortTokens(s.lead), executors: shortTokens(s.executors), share: executorShare(s) });
  const money = !report.executors ? t('routing.lead.none') : Math.abs(report.saved) < 0.005 ? t('routing.lead.same') : report.saved > 0 ? t('routing.lead.saved', { usd: savedUsd(report.saved) }) : t('routing.lead.costMore', { usd: savedUsd(report.saved) });
  const bar = (s: LeadSplit) => (
    <span className={c.bar} aria-hidden>
      <span className={c.fill} style={{ width: `${s.executors ? Math.max(2, executorShare(s)) : 0}%` }} />
    </span>
  );
  return (
    <Card title={t('routing.lead.title')} aside={t('routing.lead.aside')}>
      <div className={c.list}>
        <div className={c.summary}>
          <span>{money}</span>
          <span className={c.total}>{split(report)}</span>
        </div>
        {report.conversations.length ? (
          <section className={c.combo} aria-label={t('routing.lead.byConversation')}>
            <span className={c.name}>{t('routing.lead.byConversation')}</span>
            {report.conversations.map((x) => (
              <div key={x.channel} className={c.row}>
                <span className={c.target}>{x.name}</span>
                {bar(x)}
                <span className={c.figures}>{split(x)}</span>
              </div>
            ))}
          </section>
        ) : null}
        {report.days.length ? (
          <section className={c.combo} aria-label={t('routing.lead.byDay')}>
            <span className={c.name}>{t('routing.lead.byDay')}</span>
            {report.days.map((d) => (
              <div key={d.day} className={c.row}>
                <span className={c.target}>{d.day}</span>
                {bar(d)}
                <span className={c.figures}>{split(d)}</span>
              </div>
            ))}
          </section>
        ) : null}
        {report.openings.length ? (
          <section className={c.combo} aria-label={t('routing.lead.opening')}>
            <span className={c.name}>{t('routing.lead.opening')}</span>
            {report.openings.map((o) => (
              <div key={o.project} className={c.outcomes}>
                <span className={c.target}>{o.name}</span>: {t('routing.lead.openingRow', { used: shortTokens(o.used), runs: o.runs, last: shortTokens(o.last) })}
                {o.system !== undefined ? ` · ${t('routing.lead.openingParts', { system: shortTokens(o.system), tools: shortTokens(o.tools ?? 0), conversation: shortTokens(o.conversation ?? 0) })}` : ''}
              </div>
            ))}
            <span className={c.total}>{t('routing.lead.openingHint')}</span>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
