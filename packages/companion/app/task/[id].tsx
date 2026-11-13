import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRightLeft, Check, CircleSlash, GitBranch, Clock, GitPullRequest, MessageSquare, Monitor, Play, Route, User } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { agentMark, isAgentActor, markIcon, markOfName, runtimeMark } from '../../components/AgentMark';
import { AgentChoiceSheet, agentOfRow } from '../../components/AgentPicker';
import { Composer } from '../../components/Composer';
import { convHref, Prose } from '../../components/Conv';
import { KeyboardLift } from '../../components/KeyboardLift';
import { Options } from '../../components/Options';
import { ProjectMark } from '../../components/ProjectMark';
import { Header, Screen, useScrolled } from '../../components/Screen';
import { PRIORITY, statusOf } from '../../components/Tasks';
import { TaskWords } from '../../components/render/TaskChip';
import { Avatar, Button, Card, haptic, IconBadge, More, Pill, Press, T, toneBg, toneInk } from '../../components/ui';
import { ago, useSupports, useView } from '../../lib/hooks';
import { calls } from '../../lib/link/calls';
import type { TaskPageView, Topic } from '../../lib/link/protocol';
import { agentPicksSupported } from '../../lib/agent-picks';
import { openOnMac } from '../../lib/mac';
import { store } from '../../lib/store';
import { color } from '../../lib/theme';
import { agentName } from '../../../../src/shared/agent-label';
import { t as say0, useT } from '../../lib/language';

/** How hard its drafter judged it (docs/routing.md). */
const difficultyWords = () => ({ simple: say0('phoneApp.task.simple'), normal: say0('phoneApp.task.normal'), hard: say0('phoneApp.task.hard') }) as const;

/**
 * One task (BLG-48): its goal (code folded), the acceptance criteria with their ticks, the
 * worktree and pull request doing it, and its activity, live. Comment below; start it in a new
 * worktree with Claude, or move it along, from here. Editing the brief stays on the Mac.
 */
export default function Task() {
  const { scrolled, onScroll } = useScrolled();
  const { id } = useLocalSearchParams<{ id: string }>();
  const topic = `task:${decodeURIComponent(id ?? '')}` as Topic;
  const tasksOn = useSupports('tasks');
  const view = useView<TaskPageView>(tasksOn ? topic : undefined);
  const t = view?.data;
  const say = useT();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [starting, setStarting] = useState(false);
  // Start with… (BLG-506): this start only, by another agent; the task's own stays as it is.
  const [startWith, setStartWith] = useState(false);
  const st = t ? statusOf(t.status) : undefined;
  const pr = t ? PRIORITY[t.priority] : undefined;
  const canStart = t && !t.conv && (t.status === 'todo' || t.status === 'backlog' || t.status === 'in_progress');

  /** Start it in a new worktree: by its own agent (else your default), or by `agent` this once (a Mac with SINCE.workAgents). */
  const start = async (agent?: { runtime: string; label: string; model?: string }) => {
    if (!t || starting) return;
    haptic.commit();
    setStarting(true);
    const ws = await store.call<string>(calls.start(t.key, agent), { queue: false }).catch((e: Error) => (store.toast({ text: e.message, tone: 'error' }), undefined));
    setStarting(false);
    if (typeof ws === 'string') {
      store.toast({ text: say('phoneApp.task.started', { key: t.key, who: agent ? agent.label : t.agent ? agentName(t.agent) : say('phoneApp.task.yourAgentLower') }), tone: 'ok' });
      router.push(convHref(`conv:ws:${ws}`));
    }
  };

  // Who works it (BLG-498), shown only (BLG-569): with a worktree on it (conv), what runs there (changed
  // in its conversation); else its own agent, or your default.
  const defaultLabel = t?.agents?.groups.find((g) => g.isDefault)?.label;
  const agentWords = t?.agent ? agentName(t.agent, { model: true }) : defaultLabel ? say('phoneApp.plan.yourAgentIs', { label: defaultLabel }) : say('phoneApp.plan.yourAgent');
  const agentRuntime = t?.agent?.runtime ?? t?.agents?.groups.find((g) => g.isDefault)?.runtime;
  // The main Start is its own agent's (else yours); Start with… lists every agent, from ⋯.
  const startLabel = t?.agent ? say('phoneApp.task.startWithAgent', { agent: agentName(t.agent) }) : say('phoneApp.task.startWithYours');
  const canStartWith = Boolean(canStart && t?.agents && agentPicksSupported());

  return (
    <Screen>
      <Header
        scrolled={scrolled}
        back
        eyebrow={t ? `${t.key} · ${t.project}` : say('phoneApp.task.task')}
        title={t?.title ?? say('phoneApp.task.task')}
        at={view?.at}
        lead={t ? <ProjectMark name={t.project} icon={t.icon} size={30} /> : undefined}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {st ? <Pill label={st.label} tone={st.tone} Icon={st.Icon} /> : null}
            <More onPress={() => setMenu(true)} label={say('phoneApp.task.options')} />
          </View>
        }
      />
      <KeyboardLift>
        <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20, gap: 14 }} keyboardDismissMode="interactive">
          {!t ? <T v="callout" style={{ textAlign: 'center', marginTop: 40 }}>{tasksOn ? say('phoneApp.task.opening') : say('phoneApp.task.update')}</T> : null}
          {t ? (
            <Animated.View entering={FadeIn.duration(220)} style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {pr && t.priority !== 'none' ? <Pill label={pr.label} tone={pr.tone} /> : null}
                <Pill label={t.assignee ?? say('phoneApp.task.noOne')} Icon={User} tone={t.assignee ? 'lavender' : 'plain'} />
                {/* On a combo (docs/routing.md): the combo, and the target its newest run went to ("Economy · Codex"). */}
                {t.difficulty ? <Pill label={difficultyWords()[t.difficulty]} tone="plain" /> : null}
                {/* 1.52 (docs/routing.md): its kind of work and what it starts on ("Visual · Strong"); changed on the Mac. */}
                {t.kind?.category ? <Pill label={t.kind.words} Icon={Route} tone="plain" /> : null}
                {t.kind?.ok !== undefined ? <Pill label={t.kind.ok ? say('phoneApp.task.wentWell') : say('phoneApp.task.didntGoWell')} Icon={t.kind.ok ? Check : CircleSlash} tone={t.kind.ok ? 'mint' : 'butter'} /> : null}
                {t.agent || t.agents ? <Pill label={agentWords} Icon={t.agent?.comboName ? Route : markIcon(runtimeMark(agentRuntime))} tone="plain" /> : null}
                {t.working ? <Pill label={t.working} Icon={User} tone="mint" /> : null}
                {t.waiting ? <Pill label={t.waiting} Icon={Clock} tone="butter" /> : null}
                {t.checks ? <Pill label={say('phoneApp.task.checked', { done: t.checks.done, total: t.checks.total })} Icon={Check} tone={t.checks.done === t.checks.total ? 'mint' : 'plain'} /> : null}
              </View>

              {t.kind?.why || t.kind?.outcome ? <T v="caption">{[t.kind.why, t.kind.outcome].filter(Boolean).join(' · ')}</T> : null}

              {canStart ? <Button label={starting ? say('phoneApp.task.starting') : startLabel} Icon={Play} disabled={starting} onPress={() => void start()} /> : null}
              {t.conv ? <Button label={say('phoneApp.task.openConv')} Icon={MessageSquare} quiet onPress={() => router.push(convHref(t.conv!))} /> : null}

              {t.goal?.text.trim() ? (
                <Card style={{ padding: 16, gap: 8 }}>
                  <T v="eyebrow">{say('phoneApp.task.goal')}</T>
                  <Prose prose={t.goal} size={15} tasks />
                </Card>
              ) : null}

              {t.acceptance.length ? (
                <Card style={{ padding: 16, gap: 10 }}>
                  <T v="eyebrow">{say('phoneApp.task.acceptance')}</T>
                  {t.acceptance.map((a, i) => {
                    const done = a.state === 'done';
                    const why = a.state === 'deferred' || a.state === 'not_done';
                    return (
                      <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                        <View style={{ width: 20, height: 20, borderRadius: 6, marginTop: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? toneBg('mint') : why ? toneBg('butter') : 'transparent', borderWidth: done || why ? 0 : 1.5, borderColor: color.hairlineStrong }}>
                          {done ? <Check color={toneInk('mint')} size={13} strokeWidth={2.2} /> : why ? <CircleSlash color={toneInk('butter')} size={12} /> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <T v="callout" c={done ? color.text2 : color.text}>
                            {a.text}
                          </T>
                          {a.reason ? (
                            <T v="caption" style={{ marginTop: 2 }}>
                              {a.state === 'deferred' ? say('phoneApp.task.deferred', { reason: a.reason }) : say('phoneApp.task.notDone', { reason: a.reason })}
                            </T>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </Card>
              ) : null}

              {t.worktree || t.pr ? (
                <Card style={{ padding: 6 }}>
                  {t.worktree ? (
                    <Press onPress={() => (t.conv ? router.push(convHref(t.conv)) : undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                      <IconBadge Icon={GitBranch} tone="lavender" size={32} />
                      <View style={{ flex: 1 }}>
                        <T v="body" style={{ fontWeight: '500' }} numberOfLines={1}>
                          {t.worktree}
                        </T>
                        <T v="caption">{say('phoneApp.task.worktree')}</T>
                      </View>
                    </Press>
                  ) : null}
                  {t.pr ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                      <IconBadge Icon={GitPullRequest} tone={t.pr.state === 'MERGED' ? 'mint' : t.pr.state === 'CLOSED' ? 'plain' : 'sky'} size={32} />
                      <View style={{ flex: 1 }}>
                        <T v="body" style={{ fontWeight: '500' }} numberOfLines={1}>
                          #{t.pr.number} {t.pr.title}
                        </T>
                        <T v="caption">
                          {t.pr.state.toLowerCase()}
                          {t.pr.checks && t.pr.checks !== 'none' ? ` · ${say('phoneApp.task.prChecks', { checks: t.pr.checks })}` : ''}
                        </T>
                      </View>
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {t.activity.length ? (
                <View style={{ gap: 10 }}>
                  <T v="eyebrow" style={{ paddingHorizontal: 4 }}>
                    {say('phoneApp.task.activity')}
                  </T>
                  {t.activity.map((a) => (
                    <Animated.View key={a.id} entering={FadeIn.duration(220)} layout={LinearTransition.duration(180)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <Avatar name={a.who} size={26} {...(a.agent ? { mark: agentMark(a.agent) } : isAgentActor(a.who) ? { mark: markOfName(a.who, 'claude') } : {})} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <T v="callout">
                          <T v="callout" c={color.text} style={{ fontWeight: '600' }}>
                            {a.who}
                          </T>{' '}
                          {a.text} · {ago(a.at)}
                        </T>
                        {a.body ? (
                          <Card r={16} style={{ padding: 12 }}>
                            <T v="callout" c={color.text}>
                              <TaskWords text={a.body} />
                            </T>
                          </Card>
                        ) : null}
                      </View>
                    </Animated.View>
                  ))}
                </View>
              ) : null}
            </Animated.View>
          ) : null}
        </ScrollView>
        {t ? (
          <Composer
            placeholder={say('phoneApp.task.comment', { key: t.key })}
            onSend={(text) => void store.call(calls.comment(t.key, text)).then(() => store.toast({ text: say('phoneApp.task.commented'), tone: 'ok' }), (e: Error) => store.toast({ text: e.message, tone: 'error' }))}
            bottom={insets.bottom}
          />
        ) : null}
      </KeyboardLift>
      <Options
        visible={menu}
        onClose={() => setMenu(false)}
        title={t ? `${t.key} ${t.title}` : undefined}
        options={[
          { Icon: Play, label: startLabel, sub: say('phoneApp.task.startSub', { who: t?.agent ? agentName(t.agent) : say('phoneApp.task.yourAgentLower') }), tone: 'peach', hidden: !canStart, onPress: () => void start() },
          { Icon: markIcon(runtimeMark(agentRuntime)), label: say('phoneApp.task.startWithMenu'), sub: say('phoneApp.task.startWithMenuSub'), tone: 'mint', hidden: !canStartWith, onPress: () => setStartWith(true) },
          { Icon: ArrowRightLeft, label: say('phoneApp.task.moveTo'), sub: st ? say('phoneApp.task.now', { status: st.label }) : undefined, tone: 'sky', hidden: !t?.moves.length, onPress: () => setMoving(true) },
          { Icon: Monitor, label: say('phone.needs.openOnMac'), sub: say('phoneApp.task.openOnMacSub'), tone: 'plain', onPress: () => void openOnMac({ topic }) },
        ]}
      />
      <Options
        visible={moving}
        onClose={() => setMoving(false)}
        title={t ? say('phoneApp.task.moveTitle', { key: t.key }) : undefined}
        options={(t?.moves ?? []).map((m) => {
          const s = statusOf(m.status);
          return { Icon: s.Icon, label: m.label, tone: s.tone, onPress: () => void store.call(calls.move(t!.key, m.status, m.label)).then(() => store.toast({ text: say('phoneApp.task.isNow', { key: t!.key, status: m.label }), tone: 'ok' }), (e: Error) => store.toast({ text: e.message, tone: 'error' })) };
        })}
      />
      <AgentChoiceSheet
        title={say('phoneApp.task.startWithTitle')}
        caption={say('phoneApp.task.startWithCaption', { key: t?.key ?? say('phoneApp.task.it'), agent: agentWords })}
        picker={t?.agents}
        visible={startWith}
        onClose={() => setStartWith(false)}
        onPick={(g, value) => void start(agentOfRow(g, value))}
      />
    </Screen>
  );
}
