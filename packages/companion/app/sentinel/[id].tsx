import { router, useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronRight, CirclePause, FileText, Monitor, Play, Power, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NeedsStack } from '../../components/Needs';
import { GraphCard } from '../../components/render/Graph';
import { parseGraph } from '../../lib/render';
import { Options } from '../../components/Options';
import { Header, Screen, useScrolled } from '../../components/Screen';
import { nextText, runStateOf, sentinelIcon, stepIcon } from '../../components/Sentinels';
import { Button, Card, Hairline, haptic, IconBadge, More, Pill, Press, T, toneBg, toneInk } from '../../components/ui';
import { ago, useSupports, useView, useVisibleNeeds } from '../../lib/hooks';
import { calls } from '../../lib/link/calls';
import type { SentinelPageView, SentinelRunView, Topic } from '../../lib/link/protocol';
import { openOnMac } from '../../lib/mac';
import { store } from '../../lib/store';
import { color } from '../../lib/theme';
import { KeptData } from '../../components/KeptData';
import { t, useT } from '../../lib/language';

/** "2 min 12 s", "48 s". */
const took = (r: SentinelRunView): string | undefined => {
  if (r.endedAt === undefined) return undefined;
  const s = Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000));
  return s < 60 ? t('phoneApp.sentinel.secs', { s }) : s % 60 ? t('phoneApp.sentinel.minsSecs', { m: Math.floor(s / 60), s: s % 60 }) : t('phoneApp.sentinel.mins', { m: Math.floor(s / 60) });
};

/** A report shown here as text (no ref to open in the reader): code blocks folded, as Claude's answers are. */
const words = (md: string): string => md.replace(/```[\s\S]*?(```|$)/g, t('phoneApp.sentinel.code')).trim();

/**
 * One sentinel (BLG-237): when it runs, what it does (its steps by name), its run waiting for your
 * Merge, and its last 30 runs, live. Run Now is the one button; Pause / Turn On are under •••. A
 * run's report opens in the reader, or (a Mac that keeps it in memory only) unfolds here as text.
 */
export default function SentinelPage() {
  const { scrolled, onScroll } = useScrolled();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sid = decodeURIComponent(id ?? '');
  const topic = `sentinel:${sid}` as Topic;
  const on = useSupports('sentinel');
  const view = useView<SentinelPageView>(on ? topic : undefined);
  const s = view?.data;
  const insets = useSafeAreaInsets();
  const t = useT();
  const needs = useVisibleNeeds(s?.needsYou);
  const [menu, setMenu] = useState(false);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | undefined>();
  const [reports, setReports] = useState<Record<string, string | null>>({});
  const Icon = s ? sentinelIcon(s.icon) : undefined;
  const last = s?.last ? runStateOf(s.last.state) : undefined;
  // Its workflow (a Mac before 1.25 sends none: the steps show as pills).
  const graph = useMemo(() => {
    const parsed = s?.graph ? parseGraph(s.graph) : undefined;
    return parsed?.ok ? parsed.graph : undefined;
  }, [s?.graph]);

  const runNow = async () => {
    if (!s || running) return;
    haptic.commit();
    setRunning(true);
    await store.call(calls.sentinelRun(s.id, s.name), { queue: false }).then(
      () => store.toast({ text: t('phoneApp.sentinel.isRunning', { name: s.name }), tone: 'ok' }),
      (e: Error) => store.toast({ text: e.message, tone: 'error' }),
    );
    setRunning(false);
  };
  const pause = (paused: boolean) => {
    if (!s) return;
    void store.call(calls.sentinelPause(s.id, paused, s.name)).then(
      () => store.toast({ text: paused ? t('phoneApp.sentinel.isPaused', { name: s.name }) : t('phoneApp.sentinel.isOn', { name: s.name }), tone: 'ok' }),
      (e: Error) => store.toast({ text: e.message, tone: 'error' }),
    );
  };
  const openRun = (r: SentinelRunView) => {
    // Going now: its Claude's conversation, to watch it work (BLG-330).
    if (r.chat && /^(queued|running)$/.test(r.state)) {
      router.push(`/conv/${encodeURIComponent(r.chat)}`);
      return;
    }
    if (r.report) {
      router.push({ pathname: '/reader', params: { ref: r.report.ref, name: r.report.name } });
      return;
    }
    if (open === r.id) return setOpen(undefined);
    setOpen(r.id);
    if (reports[r.id] !== undefined) return;
    void store.call<{ report?: string }>(calls.sentinelRunGet(r.id), { queue: false }).then(
      (d) => setReports((m) => ({ ...m, [r.id]: d?.report ? words(d.report) : null })),
      (e: Error) => (setReports((m) => ({ ...m, [r.id]: null })), store.toast({ text: e.message, tone: 'error' })),
    );
  };

  return (
    <Screen>
      <Header
        scrolled={scrolled}
        back
        eyebrow={s ? (s.project ?? t('phone.home.yourMac')) : t('phoneApp.sentinel.sentinel')}
        title={s?.name ?? t('phoneApp.sentinel.sentinel')}
        subtitle={s?.sentence}
        at={view?.at}
        lead={Icon ? <IconBadge Icon={s?.paused ? CirclePause : Icon} tone={s?.paused ? 'plain' : 'sky'} size={32} /> : undefined}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {s?.paused ? <Pill label={t('phoneApp.sentinel.paused')} /> : null}
            <More onPress={() => setMenu(true)} label={t('phoneApp.sentinel.options')} />
          </View>
        }
      />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 40, gap: 14 }}>
        {!s ? (
          <T v="callout" style={{ textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
            {on ? t('phoneApp.sentinel.opening') : t('phoneApp.sentinel.update')}
          </T>
        ) : (
          <Animated.View entering={FadeIn.duration(220)} style={{ gap: 14 }}>
            {s.pausedWhy ? (
              <Card tone="rose" style={{ marginHorizontal: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <CirclePause color={toneInk('rose')} size={18} />
                <T v="callout" c={toneInk('rose')} style={{ flex: 1 }}>
                  {t('phoneApp.sentinel.pausedWhy', { why: s.pausedWhy })}
                </T>
              </Card>
            ) : s.trouble ? (
              <Card tone="rose" style={{ marginHorizontal: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TriangleAlert color={toneInk('rose')} size={18} />
                <T v="callout" c={toneInk('rose')} style={{ flex: 1 }}>
                  {s.trouble}
                </T>
              </Card>
            ) : null}

            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              <Button label={running ? t('phoneApp.task.starting') : t('phoneApp.sentinel.runNow')} Icon={Play} disabled={running || s.live} onPress={() => void runNow()} />
              <T v="caption" style={{ textAlign: 'center' }}>
                {s.live ? t('phoneApp.sentinel.live') : s.paused ? t('phoneApp.sentinel.pausedHint') : s.nextAt ? t('phoneApp.sentinel.nextAt', { when: nextText(s.nextAt) ?? '' }) : last && s.last ? t('phoneApp.sentinel.lastRan', { when: ago(s.last.at) }) : t('phoneApp.sentinel.notYet')}
              </T>
            </View>

            {needs.length ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 20 }}>
                  {t('phoneApp.sentinel.waiting')}
                </T>
                <NeedsStack items={needs} />
              </View>
            ) : null}

            {s.steps.length ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 20 }}>
                  {t('phoneApp.sentinel.whatItDoes')}
                </T>
                {graph ? (
                  // 1.25 (BLG-352): its workflow, as the Mac's Steps › Graph draws it.
                  <View style={{ paddingHorizontal: 16 }}>
                    <GraphCard graph={graph} />
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                    {s.steps.map((st, i) => (
                      <Pill key={i} label={st.name} Icon={stepIcon(st.kind)} tone={st.kind === 'claude' ? 'peach' : 'plain'} />
                    ))}
                  </View>
                )}
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              <T v="eyebrow" style={{ paddingHorizontal: 20 }}>
                {t('phoneApp.sentinel.runs')}
              </T>
              <Card style={{ marginHorizontal: 16 }}>
                {!s.runs.length ? (
                  <T v="callout" style={{ padding: 16 }}>
                    {t('phoneApp.sentinel.noRuns')}
                  </T>
                ) : null}
                {s.runs.map((r, i) => {
                  const st = runStateOf(r.state);
                  const shown = open === r.id;
                  const text = reports[r.id];
                  const canOpen = !r.state.match(/^(queued|running)$/) || Boolean(r.chat);
                  return (
                    <Animated.View key={r.id} entering={FadeIn.duration(200)} layout={LinearTransition.duration(180)}>
                      {i ? <Hairline style={{ marginLeft: 58 }} /> : null}
                      <Press scaleTo={0.985} disabled={!canOpen} onPress={() => openRun(r)} accessibilityLabel={t('phoneApp.sentinel.runA11y', { state: st.label, what: r.headline || t('phoneApp.sentinel.aRun') })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: toneBg(st.tone) }}>
                          <st.Icon color={toneInk(st.tone)} size={16} strokeWidth={1.9} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <T v="body" numberOfLines={2} style={{ fontWeight: '500' }}>
                            {r.headline || (r.step ? r.step : st.label)}
                          </T>
                          <T v="caption" numberOfLines={2}>
                            {[r.step && r.headline ? r.step : undefined, t('phoneApp.sentinel.by', { who: r.by }), ago(r.endedAt ?? r.startedAt), took(r), r.pr ? t('phoneApp.sentinel.pr', { number: r.pr.number }) : undefined, r.why].filter(Boolean).join('  ·  ')}
                          </T>
                        </View>
                        {r.report ? <FileText color={color.text3} size={17} /> : canOpen ? shown ? <ChevronDown color={color.text3} size={18} /> : <ChevronRight color={color.text3} size={18} /> : null}
                      </Press>
                      {shown ? (
                        <View style={{ paddingHorizontal: 14, paddingBottom: 14, paddingLeft: 58 }}>
                          {text === undefined ? (
                            <ActivityIndicator color={color.text3} style={{ alignSelf: 'flex-start' }} />
                          ) : (
                            <T v="callout" c={text ? color.text : color.text2} selectable>
                              {text || t('phoneApp.sentinel.noReport')}
                            </T>
                          )}
                          {r.chat ? (
                            <Press onPress={() => router.push(`/conv/${encodeURIComponent(r.chat!)}`)} accessibilityLabel={t('phoneApp.sentinel.session')} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                              <T v="callout" c={color.info} style={{ fontWeight: '600' }}>
                                {t('phoneApp.sentinel.session')}
                              </T>
                            </Press>
                          ) : null}
                        </View>
                      ) : null}
                    </Animated.View>
                  );
                })}
              </Card>
            </View>

            <KeptData sentinelId={s.id} at={s.runs[0]?.endedAt} />
          </Animated.View>
        )}
      </ScrollView>
      <Options
        visible={menu}
        onClose={() => setMenu(false)}
        title={s?.name}
        options={[
          { Icon: Power, label: t('phoneApp.sentinel.turnOn'), sub: s?.sentence, tone: 'mint', hidden: !s?.paused, onPress: () => pause(false) },
          { Icon: CirclePause, label: t('phoneApp.sentinel.pause'), sub: t('phoneApp.sentinel.pauseSub'), tone: 'butter', hidden: !s || s.paused, onPress: () => pause(true) },
          { Icon: Monitor, label: t('phone.needs.openOnMac'), sub: t('phoneApp.sentinel.openOnMacSub'), tone: 'plain', onPress: () => void openOnMac({ topic }) },
        ]}
      />
    </Screen>
  );
}
