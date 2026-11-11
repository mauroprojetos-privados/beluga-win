import { type ComboUsage, comboUsage, shortCost, shortTokens } from '@beluga/core/routing/model.js';
import { useApp } from '../../lib/beluga.js';
import { Card } from './parts.js';
import c from './combos.module.css';

const same = (a: readonly ComboUsage[], b: readonly ComboUsage[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Usage › Combos (docs/routing.md): your runs through each combo, split by the agent and model each
 * went to, with the tokens and cost they spent and how many stopped on a usage limit. A bar per
 * target shows its share of the combo's tokens (of its runs, before any token was counted).
 * Nothing run through a combo yet: no card.
 */
export function CombosCard() {
  const usage = useApp((st) => comboUsage(st.log, st.selfId), same);
  if (!usage.length) return null;
  return (
    <Card title="Combos" aside="Runs, tokens and cost by the agent each went to">
      <div className={c.list}>
        {usage.map((u) => {
          const byTokens = u.tokens > 0;
          return (
            <section key={u.combo} className={c.combo} aria-label={u.name}>
              <header className={c.head}>
                <span className={c.name}>{u.name}</span>
                <span className={c.total}>{[`${u.runs} run${u.runs === 1 ? '' : 's'}`, u.tokens ? `${shortTokens(u.tokens)} tokens` : '', shortCost(u.cost), u.limited ? `${u.limited} at a limit` : ''].filter(Boolean).join(' · ')}</span>
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
            </section>
          );
        })}
      </div>
    </Card>
  );
}
