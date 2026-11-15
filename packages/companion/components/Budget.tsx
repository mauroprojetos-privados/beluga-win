import { Wallet } from 'lucide-react-native';
import { View } from 'react-native';
import type { BudgetBand, BudgetLineView } from '../lib/link/protocol';
import { t as tx } from '../lib/language';
import { color, ink } from '../lib/theme';
import { Card, IconBadge, T } from './ui';

/**
 * Token budgets (docs/budget.md, 1.57): each one against what it counted, a soft bar each (mint,
 * butter from 80%, rose once reached), and what happens at one. Home shows the day's
 * (`HomeView.budget`), a conversation its own (`ConvView.budget`). Read-only: budgets are set on the
 * Mac; a budget that asks reaches the phone as a Needs You card with its buttons.
 */
const toneOf = (level: BudgetLineView['level']): 'mint' | 'butter' | 'rose' => (level === 'over' ? 'rose' : level === 'near' ? 'butter' : 'mint');

/** "1.2M", "84k", "512" tokens. */
const shortTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

function Line({ line }: { readonly line: BudgetLineView }) {
  const tone = toneOf(line.level);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <T v="callout" c={color.text} style={{ fontWeight: '500', flex: 1 }} numberOfLines={1}>
          {line.name ?? tx(`budget.usage.${line.scope}`)}
        </T>
        <T v="caption" style={{ fontVariant: ['tabular-nums'] }}>
          {tx('budget.phone.of', { used: shortTokens(line.used), limit: shortTokens(line.limit) })}
        </T>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: color.sunken, overflow: 'hidden' }}>
        <View style={{ height: 8, borderRadius: 4, width: `${Math.min(100, Math.max(line.pct > 0 ? 2 : 0, line.pct))}%`, backgroundColor: ink[tone], opacity: 0.5 }} />
      </View>
    </View>
  );
}

/** A conversation's budget in one row, under its header: the budget nearest its end, and what happens at it. */
export function BudgetRow({ budget }: { readonly budget: BudgetBand }) {
  const top = [...budget.lines].sort((a, b) => b.pct - a.pct)[0];
  const tone = top ? toneOf(top.level) : budget.plan && budget.plan.pct >= 95 ? 'rose' : 'butter';
  const what = top ? `${top.name ?? tx(`budget.usage.${top.scope}`)} · ${tx('budget.phone.of', { used: shortTokens(top.used), limit: shortTokens(top.limit) })}` : tx('budget.usage.plan', { pct: Math.round(budget.plan?.pct ?? 0) });
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
      <IconBadge Icon={Wallet} tone={tone} size={28} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="callout" c={color.text} numberOfLines={1}>
          {what}
        </T>
        {top && budget.near ? (
          <T v="caption" numberOfLines={1}>
            {budget.cheaper ? tx('budget.meter.cheaperNow') : tx(`budget.meter.near.${budget.near}`)}
          </T>
        ) : null}
      </View>
    </Card>
  );
}

/** The budgets as a card: every line, your plan's 5-hour window when it's near, and what happens at one. */
export function BudgetCard({ budget, style }: { readonly budget: BudgetBand; readonly style?: object }) {
  return (
    <Card style={[{ padding: 16, gap: 14 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBadge Icon={Wallet} tone={toneOf(budget.level)} size={30} />
        <T v="heading" style={{ flex: 1 }}>
          {tx('budget.phone.title')}
        </T>
      </View>
      {budget.lines.map((l) => (
        <Line key={`${l.scope}:${l.name ?? ''}`} line={l} />
      ))}
      {budget.plan ? <T v="caption">{tx('budget.usage.plan', { pct: Math.round(budget.plan.pct) })}</T> : null}
      {budget.lines.length && budget.near ? <T v="caption">{budget.cheaper ? tx('budget.meter.cheaperNow') : tx(`budget.meter.near.${budget.near}`)}</T> : null}
      {!budget.lines.length && budget.spent !== undefined ? <T v="caption">{tx('budget.usage.none', { used: shortTokens(budget.spent) })}</T> : null}
    </Card>
  );
}
