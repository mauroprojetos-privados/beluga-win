import { CATEGORY_INFO, shortCost, shortTokens } from '@beluga/core/routing/model.js';
import { type ComboReport, DEFAULT_BASELINE, comboReport, savingsWords, strongerOf, successWords } from '@beluga/core/routing/outcomes.js';
import { useApp } from '../../lib/beluga.js';
import { useT } from '../../lib/i18n.js';
import { Card } from './parts.js';
import c from './combos.module.css';

const same = (a: readonly ComboReport[], b: readonly ComboReport[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Usage › Combos (docs/routing.md): your runs through each combo, split by the agent and model each
 * went to, with the tokens and cost they spent and how many stopped on a usage limit. A bar per
 * target shows its share of the combo's tokens (of its runs, before any token was counted). Then,
 * Phase 5: how its tasks went (by kind too), what it saved against the baseline Settings picks, and
 * suggestions, read-only (never applied). Nothing run through a combo yet: no card.
 */
export function CombosCard() {
  const report = useApp((st) => comboReport(st.log, st.board.issues, st.selfId, { baseline: st.prefs.savingsBaseline ?? DEFAULT_BASELINE, ...strongerOf(st) }), same);
  const t = useT();
  if (!report.length) return null;
  const baseline = report[0]!.baseline;
  const saved = report.reduce((n, u) => n + u.saved, 0);
  const judged = report.reduce((n, u) => n + u.judged, 0);
  const good = report.reduce((n, u) => n + u.good, 0);
  const suggestions = report.flatMap((u) => u.suggestions);
  return (
    <Card title={t('routing.usage.title')} aside={t('routing.usage.aside')}>
      <div className={c.list}>
        <div className={c.summary}>
          <span>{savingsWords(saved, baseline)}</span>
          <span className={c.total}>{t('routing.usage.tasks', { words: successWords(judged, good) })}</span>
        </div>
        {report.map((u) => {
          const byTokens = u.tokens > 0;
          return (
            <section key={u.combo} className={c.combo} aria-label={u.name}>
              <header className={c.head}>
                <span className={c.name}>{u.name}</span>
                <span className={c.total}>{[t('routing.usage.runs', { count: u.runs }), u.tokens ? t('routing.usage.tokens', { tokens: shortTokens(u.tokens) }) : '', shortCost(u.cost), u.limited ? t('routing.usage.atLimit', { count: u.limited }) : '', u.tokens ? savingsWords(u.saved, u.baseline).replace(/ against .*| than .*/, '') : ''].filter(Boolean).join(' · ')}</span>
              </header>
              {u.targets.map((x) => {
                const share = byTokens ? x.tokens / u.tokens : x.runs / u.runs;
                return (
                  <div key={`${x.runtime}-${x.target}`} className={c.row}>
                    <span className={c.target}>{x.target}</span>
                    <span className={c.bar} aria-hidden>
                      <span className={c.fill} style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
                    </span>
                    <span className={c.figures}>{[`${x.runs}`, x.tokens ? shortTokens(x.tokens) : '', shortCost(x.cost), x.limited ? t('routing.usage.atLimit', { count: x.limited }) : ''].filter(Boolean).join(' · ')}</span>
                  </div>
                );
              })}
              {u.judged ? (
                <div className={c.outcomes}>
                  {successWords(u.judged, u.good)}
                  {u.categories.length ? `: ${u.categories.map((k) => `${CATEGORY_INFO[k.category].label} ${k.good}/${k.judged}`).join(', ')}` : ''}
                </div>
              ) : null}
            </section>
          );
        })}
        {suggestions.length ? (
          <section className={c.suggestions} aria-label={t('routing.usage.suggestions')}>
            <span className={c.name}>{t('routing.usage.suggestions')}</span>
            {suggestions.map((s) => (
              <p key={s} className={c.suggestion}>
                {s}
              </p>
            ))}
            <span className={c.total}>{t('routing.usage.onlySuggestions')}</span>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
