import { router } from 'expo-router';
import { BookOpen, ChartLine, ChevronRight, FileText, Table2, Terminal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSupports } from '../lib/hooks';
import { calls } from '../lib/link/calls';
import type { DataListView } from '../lib/link/protocol';
import { t } from '../lib/language';
import { store } from '../lib/store';
import { formatNumber } from '../../../src/shared/i18n/format';
import { color, type } from '../lib/theme';
import { openDocument } from './TypedCell';
import { Card, Hairline, haptic, Press, T } from './ui';

const KIND_WORDS: Readonly<Record<string, () => string>> = { number: () => t('phoneParts.kept.aNumber'), rows: () => t('phoneParts.kept.aTable'), series: () => t('phoneParts.kept.aSeries'), output: () => t('phoneParts.kept.anOutput') };
const FIRST_RUNS = 5;
const ago = (at: number): string => {
  const m = Math.round((Date.now() - at) / 60_000);
  return m < 1 ? t('phoneParts.kept.justNow') : m < 60 ? t('phoneParts.kept.minAgo', { count: m }) : m < 48 * 60 ? t('phoneParts.kept.hAgo', { count: Math.round(m / 60) }) : t('phoneParts.kept.daysAgo', { count: Math.round(m / 1440) });
};

/**
 * Kept data on a sentinel's page (BLG-392), as the Mac's card has it: each metric it keeps opens its
 * whole history (CSV, made on the Mac when you open it, streamed into the reader), and each run's
 * files (its report, each step's output, its documents) stream into the viewer. Nothing is kept on
 * the phone. `at`: when its last run ended (read again then).
 */
export function KeptData({ sentinelId, at }: { readonly sentinelId: string; readonly at?: number }) {
  const can = useSupports('keptData');
  const [data, setData] = useState<DataListView>();
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!can) return;
    let alive = true;
    void store.call<DataListView>(calls.dataList(sentinelId), { queue: false }).then(
      (d) => alive && setData(d),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [can, sentinelId, at]);
  if (!data || (!data.metrics.length && !data.runs.length)) return null;
  const runs = all ? data.runs : data.runs.slice(0, FIRST_RUNS);
  return (
    <View style={{ gap: 8 }}>
      <T v="eyebrow" style={{ paddingHorizontal: 20 }}>
        {t('phoneParts.kept.title')}
      </T>
      {data.metrics.length ? (
        <Card style={{ marginHorizontal: 16 }}>
          {data.metrics.map((m, i) => {
            const Icon = m.kind === 'rows' ? Table2 : m.kind === 'output' ? FileText : ChartLine;
            const much = m.kind === 'rows' ? t('phoneParts.kept.rowsOver', { rows: formatNumber(m.rows ?? 0), runs: formatNumber(m.lines) }) : t('phoneParts.kept.runs', { count: m.lines, n: formatNumber(m.lines) });
            return (
              <View key={m.name}>
                {i ? <Hairline style={{ marginLeft: 46 }} /> : null}
                <Press onPress={() => (haptic.tap(), router.push({ pathname: '/reader', params: { ref: m.ref, name: `${m.label}.csv` } }))} accessibilityLabel={t('phoneParts.kept.history', { name: m.label })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 }}>
                  <Icon size={18} color={color.text3} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="body" style={{ fontWeight: '500' }} numberOfLines={1}>
                      {m.label}
                    </T>
                    <T v="caption" numberOfLines={1}>
                      {[KIND_WORDS[m.kind]?.() ?? m.kind, much, m.first ? t('phoneParts.kept.since', { when: ago(m.first) }) : undefined].filter(Boolean).join('  ·  ')}
                    </T>
                  </View>
                  <ChevronRight size={18} color={color.text3} />
                </Press>
              </View>
            );
          })}
        </Card>
      ) : null}
      {data.runs.length ? (
        <Card style={{ marginHorizontal: 16 }}>
          {runs.map((r, i) => (
            <View key={r.runId}>
              {i ? <Hairline style={{ marginLeft: 14 }} /> : null}
              <View style={{ paddingVertical: 10, paddingHorizontal: 14, gap: 8 }}>
                <T v="caption" numberOfLines={1}>
                  {[ago(r.at), r.headline].filter(Boolean).join('  ·  ')}
                </T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {r.files.map((f) => {
                    const Icon = f.kind === 'report' ? BookOpen : f.kind === 'step' ? Terminal : FileText;
                    return (
                      <Press key={f.name} onPress={() => openDocument({ ref: f.ref, name: f.kind === 'step' ? `${f.label}.txt` : f.kind === 'report' ? 'Report.md' : f.label, mime: f.mime }, { run: r.runId, name: f.name })} accessibilityLabel={t('phoneParts.dash.openName', { name: f.label })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: color.sunken }}>
                        <Icon size={12} color={color.text2} />
                        <Text numberOfLines={1} style={{ ...type.caption, color: color.text, fontWeight: '600', maxWidth: 180 }}>
                          {f.label}
                        </Text>
                      </Press>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          ))}
          {data.runs.length > FIRST_RUNS ? (
            <Press haptics={false} onPress={() => (haptic.tap(), setAll((x) => !x))} accessibilityLabel={all ? t('phoneParts.kept.fewerRuns') : t('phoneParts.kept.allRuns')} style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
              <T v="callout" c={color.info} style={{ fontWeight: '600' }}>
                {all ? t('phoneParts.dash.fewer') : t('phoneParts.kept.allRunsFiles', { count: data.runs.length })}
              </T>
            </Press>
          ) : null}
        </Card>
      ) : null}
      <T v="caption" style={{ paddingHorizontal: 20 }}>
        {t('phoneParts.kept.keptDays', { count: data.keepsDays })}
      </T>
    </View>
  );
}
