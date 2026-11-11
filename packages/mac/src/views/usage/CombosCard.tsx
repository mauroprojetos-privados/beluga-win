import { CATEGORY_INFO, shortCost, shortTokens } from '@beluga/core/routing/model.js';
import { type ComboReport, DEFAULT_BASELINE, comboReport, savingsWords, strongerOf, successWords } from '@beluga/core/routing/outcomes.js';
import { useApp } from '../../lib/beluga.js';
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
  if (!report.length) return null;
  const baseline = report[0]!.baseline;
  const saved = report.reduce((n, u) => n + u.saved, 0);
  const judged = report.reduce((n, u) => n + u.judged, 0);
  const good = report.reduce((n, u) => n + u.good, 0);
  const suggestions = report.flatMap((u) => u.suggestions);
  return (
    <Card title="Combos" aside="Runs, tokens and cost by the agent each went to">
      <div className={c.list}>
        <div className={c.summary}>
          <span>{savingsWords(saved, baseline)}</span>
          <span className={c.total}>Tasks: {successWords(judged, good)}</span>
        </div>
        {report.map((u) => {
          const byTokens = u.tokens > 0;
          return (
            <section key={u.combo} className={c.combo} aria-label={u.name}>
              <header className={c.head}>
                <span className={c.name}>{u.name}</span>
                <span className={c.total}>{[`${u.runs} run${u.runs === 1 ? '' : 's'}`, u.tokens ? `${shortTokens(u.tokens)} tokens` : '', shortCost(u.cost), u.limited ? `${u.limited} at a limit` : '', u.tokens ? savingsWords(u.saved, u.baseline).replace(/ against .*| than .*/, '') : ''].filter(Boolean).join(' · ')}</span>
              </header>
              {u.targets.map((t) => {
                const share = byTokens ? t.tokens / u.tokens : t.runs / u.runs;
                return (
                  <div key={`${t.runtime}-${t.target}`} className={c.row}>
                    <span className={c.target}>{t.target}</span>
                    <span className={c.bar} aria-hidden>
                      <span className={c.fill} style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
                    </span>
                    <span className={c.figures}>{[`${t.runs}`, t.tokens ? shortTokens(t.tokens) : '', shortCost(t.cost), t.limited ? `${t.limited} at a limit` : ''].filter(Boolean).join(' · ')}</span>
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
          <section className={c.suggestions} aria-label="Suggestions">
            <span className={c.name}>Suggestions</span>
            {suggestions.map((s) => (
              <p key={s} className={c.suggestion}>
                {s}
              </p>
            ))}
            <span className={c.total}>Only suggestions: change a combo in Settings › Agent › Combos if you agree.</span>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
