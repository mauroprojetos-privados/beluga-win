import { router, useLocalSearchParams } from 'expo-router';
import { AlarmClock, Check, Folder, Inbox, Plus, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentMarkIcon, agentMark } from '../../components/AgentMark';
import { AgentDots, NotOnPrChip, convHref, notOnPrWords, statusIcon } from '../../components/Conv';
import { ComputersWork } from '../../components/Computers';
import { PlansList } from '../../components/Plans';
import { type Option, Options } from '../../components/Options';
import { Header, Screen, useScrolled } from '../../components/Screen';
import { Segments } from '../../components/Segments';
import { Card, FoldHead, Row, T, haptic } from '../../components/ui';
import { ago, useFolded, useSupports, useView } from '../../lib/hooks';
import { t, useT } from '../../lib/language';
import { type Call, calls } from '../../lib/link/calls';
import type { ConvSummary, PlansView, TasksView, WorkView } from '../../lib/link/protocol';
import { store } from '../../lib/store';
import { nestRows } from '../../lib/thread-rows';
import { categorySections, settledWords, triageOptions, whenWords } from '../../lib/triage';
import { remindPresets } from '../../../../src/shared/remind';
import { ProjectMark } from '../../components/ProjectMark';
import { TasksList } from '../../components/Tasks';
import { color, TAB_BAR_H } from '../../lib/theme';

type Rows = WorkView['projects'][number];

const CHILD_INDENT = 18;

/** The folded lists under the Inbox, in order. */
const FOLDED_SECTIONS = [
  { key: 'working', label: 'phone.work.working' },
  { key: 'snoozed', label: 'phone.work.later' },
  { key: 'settled', label: 'phone.work.settled' },
] as const;

/** Work: projects and their conversations (each project folds, remembered); plans and tasks beside them. */
export default function Work() {
  const t = useT();
  const { scrolled, onScroll } = useScrolled();
  const fold = useFolded('work');
  // Listed here is open, as these start folded.
  const opened = useFolded('work-categories');
  const [sheet, setSheet] = useState<ConvSummary | undefined>();
  const [snoozing, setSnoozing] = useState<ConvSummary | undefined>();
  const insets = useSafeAreaInsets();
  const work = useView<WorkView>('work');
  const plans = useView<PlansView>('plans');
  const { tab: wanted } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'convs' | 'plans' | 'tasks'>(wanted === 'tasks' || wanted === 'plans' ? wanted : 'convs');
  const runningPlans = plans?.data.plans.filter((p) => p.state === 'running').length ?? 0;
  const tasks = useView<TasksView>(useSupports('tasks') ? 'tasks' : undefined);
  const inReview = tasks?.data.projects.reduce((n, p) => n + (p.groups.find((g) => g.status === 'in_review')?.tasks.length ?? 0), 0) ?? 0;
  const canSort = useSupports('triage');
  const sections = canSort && work?.data.categories ? categorySections(work.data.projects) : undefined;

  const rows = (list: readonly ConvSummary[], flat = false) => (
    <Card style={{ marginHorizontal: 16, marginTop: 6 }}>
      {nestRows(list).map(({ conv: c, depth }, i) => {
        const st = statusIcon(c.needsYou ? 'waiting' : c.status);
        const signal = c.notOnPr ? <NotOnPrChip gap={c.notOnPr} /> : c.agents ? <AgentDots count={c.agents} /> : c.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.info }} /> : null;
        return (
          // A child sits under its parent, one step in (1.47).
          <View key={c.topic} style={{ paddingLeft: depth * CHILD_INDENT }}>
            <Row
              first={i === 0}
              Icon={st.Icon}
              tone={st.tone}
              label={c.title}
              sub={[...triageWords(c), c.notOnPr ? notOnPrWords(c.notOnPr) : undefined, flat ? c.project : undefined, c.needsYou ? t('phone.work.needsYou') : c.status === 'working' ? c.last : undefined, c.fresh ? t('phone.work.newOutputs', { count: c.fresh }) : undefined, ago(c.lastAt)].filter(Boolean).join(' · ') || c.last}
              right={
                c.harness ? (
                  <View accessible accessibilityLabel={c.harness.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {signal}
                    <AgentMarkIcon mark={agentMark(c.harness)} size={15} color={color.text3} muted />
                  </View>
                ) : (
                  signal
                )
              }
              onPress={() => router.push(convHref(c.topic))}
              onLongPress={sections && triageOptions(c).length ? () => setSheet(c) : undefined}
            />
          </View>
        );
      })}
    </Card>
  );
  const project = (p: Rows) => (
    <View key={p.id}>
      <FoldHead
        folded={fold.folded(p.id)}
        onToggle={() => fold.toggle(p.id)}
        lead={p.id === 'asked' || p.id === 'room' ? <Folder color={color.text3} size={18} /> : <ProjectMark name={p.name} icon={p.icon} size={22} />}
        label={p.name}
        {...(p.conversations.length ? { count: p.conversations.length } : {})}
      />
      {fold.folded(p.id) ? null : p.conversations.length ? (
        rows(p.conversations)
      ) : (
        <Card style={{ marginHorizontal: 16, marginTop: 6 }}>
          {/* A project with nothing in it yet (just added): one tap to start its first worktree. */}
          <Row first Icon={Plus} label={t('phone.work.noConversations')} sub={t('phone.work.startFirst')} onPress={() => router.push({ pathname: '/ask', params: { text: '', to: `project:${p.id}`, how: 'worktree' } })} />
        </Card>
      )}
    </View>
  );

  return (
    <Screen>
      <Header scrolled={scrolled} title={t('phone.tabs.work')} at={work?.at} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Segments
          value={tab}
          onChange={setTab}
          options={[
            { key: 'convs', label: t('phone.work.conversations') },
            { key: 'plans', label: t('phone.work.plans'), badge: runningPlans },
            { key: 'tasks', label: t('phone.work.tasks'), badge: inReview },
          ]}
        />
      </View>
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingTop: 8, paddingBottom: TAB_BAR_H + insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {tab === 'plans' ? (
          <Animated.View entering={FadeIn}>
            <PlansList />
          </Animated.View>
        ) : tab === 'tasks' ? (
          <Animated.View entering={FadeIn}>
            <TasksList />
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn} style={{ gap: 12 }}>
            {sections ? (
              <>
                <T v="eyebrow" style={{ paddingHorizontal: 20 }}>
                  {t('phone.work.inbox')}
                </T>
                {sections.active.map(project)}
                {FOLDED_SECTIONS.map(({ key, label }) =>
                  sections[key].length ? (
                    <View key={key}>
                      <FoldHead folded={!opened.folded(key)} onToggle={() => opened.toggle(key)} label={t(label)} count={sections[key].length} />
                      {opened.folded(key) ? rows(sections[key], true) : null}
                    </View>
                  ) : null,
                )}
              </>
            ) : (
              (work?.data.projects ?? []).map(project)
            )}
            <ComputersWork />
          </Animated.View>
        )}
      </ScrollView>
      <Options window visible={Boolean(sheet)} onClose={() => setSheet(undefined)} {...(sheet ? { title: sheet.title } : {})} options={sheet ? sheetOptions(sheet, () => setSnoozing(sheet)) : []} />
      <Options window visible={Boolean(snoozing)} onClose={() => setSnoozing(undefined)} title={t('phone.work.remindMe')} options={snoozing ? presetOptions(snoozing) : []} />
    </Screen>
  );
}

/** What a row says of its category (nothing without one). */
function triageWords(c: ConvSummary): readonly (string | undefined)[] {
  if (c.category === 'snoozed') return [c.snoozedUntil ? t('phone.work.remindsYou', { when: whenWords(c.snoozedUntil) }) : undefined];
  if (c.category === 'settled') return [settledWords(c.settledWhy)];
  return [c.back ? t('phone.work.back') : undefined];
}

function sheetOptions(c: ConvSummary, snooze: () => void): readonly Option[] {
  const all: Record<ReturnType<typeof triageOptions>[number], Option> = {
    settle: { Icon: Check, label: t('phone.work.settle'), sub: t('phone.work.settleSub'), onPress: () => change(calls.settle(c.topic)) },
    snooze: { Icon: AlarmClock, label: t('phone.work.remindLater'), sub: t('phone.work.remindLaterSub'), onPress: snooze },
    wake: { Icon: Sun, label: t('phone.work.showAgain'), sub: t('phone.work.showAgainSub'), onPress: () => change(calls.wake(c.topic)) },
    unsettle: { Icon: Inbox, label: t('phone.work.unsettle'), sub: t('phone.work.unsettleSub'), onPress: () => change(calls.unsettle(c.topic)) },
  };
  return triageOptions(c).map((o) => all[o]);
}

const presetOptions = (c: ConvSummary): readonly Option[] => remindPresets(Date.now()).map((p) => ({ Icon: AlarmClock, label: p.label, sub: whenWords(p.at), onPress: () => change(calls.snooze(c.topic, p.at)) }));

/** A category changes only while the Mac can answer: a queued reminder could come before it arrives. */
function change(call: Call): void {
  haptic.commit();
  void store.call(call, { queue: false }).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
}
