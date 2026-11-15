import { useFocusEffect } from 'expo-router';
import { Gauge, Lightbulb, Route, Users } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, Screen, useScrolled } from '../components/Screen';
import { Card, Row, T } from '../components/ui';
import { calls } from '../lib/link/calls';
import type { ComboReportView, LeadReportView } from '../lib/link/protocol';
import { store } from '../lib/store';
import { CATEGORY_INFO, shortCost, shortTokens } from '../../../src/core/routing/model';
import { type SavingsBaseline, savingsWords, successWords } from '../../../src/core/routing/outcomes';
import { useT } from '../lib/language';
import { useSupports } from '../lib/hooks';
import { executorShare, savedUsd } from '../../../src/core/routing/measure';

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const kindLabel = (k: string): string => (k in CATEGORY_INFO ? CATEGORY_INFO[k as keyof typeof CATEGORY_INFO].label : k);

/**
 * Settings › Routing (docs/routing.md, Phase 5): your runs through each combo, read-only. What they
 * saved against the baseline your Mac's Settings picks, how the tasks went (by kind too), each target's
 * share, and the suggestions your record supports. Then (1.58, "Lead and executors") the lead against
 * the sub-agents it started, by conversation and by day, what they saved, and the context a run starts
 * with per project. Nothing is changed from here: combos are edited on the Mac.
 */
export default function Routing() {
  const { scrolled, onScroll } = useScrolled();
  const insets = useSafeAreaInsets();
  const say = useT();
  const [report, setReport] = useState<readonly ComboReportView[]>();
  const [lead, setLead] = useState<LeadReportView>();
  const leadOn = useSupports('leadUsage');

  useFocusEffect(
    useCallback(() => {
      void store.call<readonly ComboReportView[]>(calls.routingUsage(), { queue: false }).then(
        (r) => setReport(r ?? []),
        () => setReport([]),
      );
      if (leadOn)
        void store.call<LeadReportView>(calls.leadUsage(), { queue: false }).then(
          (r) => setLead(r ?? undefined),
          () => setLead(undefined),
        );
    }, [leadOn]),
  );
  const split = (s: { readonly lead: number; readonly executors: number }): string => say('phoneApp.lead.split', { lead: shortTokens(s.lead), executors: shortTokens(s.executors), share: executorShare(s) });
  const money = (s: { readonly executors: number; readonly saved: number }): string =>
    !s.executors ? say('phoneApp.lead.none') : Math.abs(s.saved) < 0.005 ? say('phoneApp.lead.same') : s.saved > 0 ? say('phoneApp.lead.saved', { usd: savedUsd(s.saved) }) : say('phoneApp.lead.costMore', { usd: savedUsd(s.saved) });
  const leadShown = lead && (lead.lead > 0 || lead.executors > 0 || lead.openings.length > 0);

  const list = report ?? [];
  const saved = list.reduce((n, u) => n + (u.saved ?? 0), 0);
  const judged = list.reduce((n, u) => n + (u.judged ?? 0), 0);
  const good = list.reduce((n, u) => n + (u.good ?? 0), 0);
  const baseline = (list[0]?.baseline ?? 'opus') as SavingsBaseline;
  const suggestions = list.flatMap((u) => u.suggestions ?? []);

  return (
    <Screen>
      <Header scrolled={scrolled} back title={say('phoneApp.settings.routing')} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 40, gap: 12 }}>
        {report && !list.length && !leadShown ? <T v="caption">{say('phoneApp.routing.none')}</T> : null}
        {list.length ? (
          <Card>
            <Row first Icon={Route} tone="mint" label={savingsWords(saved, baseline)} sub={say('phoneApp.routing.tasks', { words: successWords(judged, good) })} chevron={false} />
          </Card>
        ) : null}
        {list.map((u) => (
          <Card key={u.combo} style={{ padding: 16, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T v="heading" style={{ flex: 1 }}>
                {u.name}
              </T>
              <T v="caption" style={{ fontVariant: ['tabular-nums'] }}>
                {[say('phoneApp.routing.runs', { count: u.runs }), u.tokens ? shortTokens(u.tokens) : '', shortCost(u.cost ?? 0)].filter(Boolean).join(' · ')}
              </T>
            </View>
            {u.targets.map((t) => (
              <T key={`${t.runtime}-${t.target}`} v="callout">
                {t.target}: {t.runs}
                {t.tokens ? ` · ${shortTokens(t.tokens)}` : ''}
                {u.runs ? ` (${pct(t.runs / u.runs)})` : ''}
                {t.limited ? ` · ${say('phoneApp.routing.atLimit', { count: t.limited })}` : ''}
              </T>
            ))}
            {u.judged ? (
              <T v="caption">
                {successWords(u.judged, u.good ?? 0)}
                {u.categories?.length ? `: ${u.categories.map((k) => `${kindLabel(k.category)} ${k.good}/${k.judged}`).join(', ')}` : ''}
              </T>
            ) : null}
            {u.saved !== undefined && u.tokens ? <T v="caption">{savingsWords(u.saved, baseline)}</T> : null}
          </Card>
        ))}
        {suggestions.length ? (
          <Card>
            {suggestions.map((s, i) => (
              <Row key={s} first={i === 0} Icon={Lightbulb} tone="butter" label={s} chevron={false} />
            ))}
          </Card>
        ) : null}
        {suggestions.length ? <T v="caption">{say('phoneApp.routing.onlySuggestions')}</T> : null}
        {lead && leadShown ? (
          <>
            <Card>
              <Row first Icon={Users} tone="lavender" label={money(lead)} sub={split(lead)} chevron={false} />
            </Card>
            {lead.conversations.length ? (
              <Card style={{ padding: 16, gap: 8 }}>
                <T v="heading">{say('phoneApp.lead.byConversation')}</T>
                {lead.conversations.map((c) => (
                  <T key={c.channel} v="callout">
                    {c.name}: {split(c)}
                  </T>
                ))}
              </Card>
            ) : null}
            {lead.days.length ? (
              <Card style={{ padding: 16, gap: 8 }}>
                <T v="heading">{say('phoneApp.lead.byDay')}</T>
                {lead.days.map((d) => (
                  <T key={d.day} v="callout" style={{ fontVariant: ['tabular-nums'] }}>
                    {d.day}: {split(d)}
                  </T>
                ))}
              </Card>
            ) : null}
            {lead.openings.length ? (
              <Card>
                {lead.openings.map((o, i) => (
                  <Row
                    key={o.project}
                    first={i === 0}
                    Icon={Gauge}
                    tone="sky"
                    label={`${o.name}: ${say('phoneApp.lead.openingRow', { used: shortTokens(o.used), runs: o.runs, last: shortTokens(o.last) })}`}
                    sub={o.system !== undefined ? say('phoneApp.lead.openingParts', { system: shortTokens(o.system), tools: shortTokens(o.tools ?? 0), conversation: shortTokens(o.conversation ?? 0) }) : say('phoneApp.lead.opening')}
                    chevron={false}
                  />
                ))}
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
