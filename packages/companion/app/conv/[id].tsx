import { useLocalSearchParams } from 'expo-router';
import { resetWhen } from '../../../../src/shared/run-failure';
import { KeyboardLift } from '../../components/KeyboardLift';
import { Activity, Bot, Camera, ChevronRight, Map as MapIcon, CircleCheck, CircleX, Clock, Cpu, FolderTree, GitMerge, History, Images, Laptop, MessagesSquare, Monitor, Network, OctagonX, Plus, Send, Square, SquareTerminal, Trash2, Undo2 } from 'lucide-react-native';
import { AgentList, Breathe, LivePanel, StepList, StepsFold, ToolBadge, TypingDots } from '../../components/Live';
import { ThreadsSheet, threadsSummary } from '../../components/ThreadsSheet';
import { BranchBand, MergeBand, MergeSheet } from '../../components/Merge';
import { ProjectMark } from '../../components/ProjectMark';
import { openOnMac } from '../../lib/mac';
import { useRef, useState } from 'react';
import { Platform, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Composer, QueueTray } from '../../components/Composer';
import { AgentChips, Prose, StepTicker } from '../../components/Conv';
import { answer, NeedButtons, NeedFace } from '../../components/Needs';
import { Options } from '../../components/Options';
import { QuickReactions, ReactionChips } from '../../components/Reactions';
import { OutputGrid, OutputsTopic, TurnOutputs } from '../../components/Outputs';
import { DeleteMacChat, MacChatsSheet, newMacChat } from '../../components/MacChats';
import { Header, Screen, useScrolled } from '../../components/Screen';
import { Sheet } from '../../components/Sheet';
import { EditPromptSheet } from '../../components/EditPrompt';
import { AgentPickerSheet } from '../../components/AgentPicker';
import { agentMark, markIcon, markOfName, runtimeMark } from '../../components/AgentMark';
import { Avatar, Card, IconBadge, More, Pill, Press, T, type Tone, toneOf } from '../../components/ui';
import { ago, elapsed, useComputer, useSince, useSupports, useView, useVisibleNeeds } from '../../lib/hooks';
import { OnComputer, useOn } from '../../lib/scope';
import { calls } from '../../lib/link/calls';
import { convAbilities, scoped } from '../../lib/link/scoped';
import { type ConvView, type HomeView, type OutputView, type SubAgentView, type Topic, type TurnView, isMacTopic } from '../../lib/link/protocol';
import { type Send as Pending, sends, useSends, whereOf } from '../../lib/sends';
import { SendStatus } from '../../components/SendStatus';
import { AgentStrip, SubAgentSheet } from '../../components/SubAgents';
import { store } from '../../lib/store';
import { upload } from '../../lib/pick';
import { color } from '../../lib/theme';
import { router } from 'expo-router';
import { useT } from '../../lib/language';

/**
 * One conversation: your messages, Claude's answers as cards (code folded into chips), the live
 * step, sub-agents as chips (tap: a sheet with their steps and outputs), what it waits on you for,
 * and a composer with Send and Stop.
 */

/** An empty Your Mac: three first things to ask, one tap each (the composer is there too). */
function MacStarters({ topic, on }: { readonly topic: Topic; readonly on?: string }) {
  const say = useT();
  const starters = [
    { label: say('phoneApp.conv.starterShot'), Icon: Camera, tone: 'sky' as Tone, text: say('phoneApp.conv.starterShotText') },
    { label: say('phoneApp.conv.starterCpu'), Icon: Cpu, tone: 'peach' as Tone, text: say('phoneApp.conv.starterCpuText') },
    { label: say('phoneApp.conv.starterRunning'), Icon: Activity, tone: 'mint' as Tone, text: say('phoneApp.conv.starterRunningText') },
  ];
  return (
    <Animated.View entering={FadeIn.duration(260)} style={{ alignItems: 'center', gap: 14, marginTop: 40 }}>
      <IconBadge Icon={Laptop} tone="sky" size={56} />
      <T v="heading">{say('phone.home.askYourMac')}</T>
      <T v="callout" style={{ textAlign: 'center', paddingHorizontal: 24 }}>
        {say('phoneApp.conv.macIntro')}
      </T>
      <View style={{ gap: 8, alignSelf: 'stretch', marginTop: 6 }}>
        {starters.map((s) => (
          <Press key={s.label} scaleTo={0.985} onPress={() => sends.message(topic, s.text, calls.send(topic, s.text), on ? { on } : {})}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 }}>
              <IconBadge Icon={s.Icon} tone={s.tone} size={30} />
              <T v="body">{s.label}</T>
            </Card>
          </Press>
        ))}
      </View>
    </Animated.View>
  );
}

/** A conversation, on your Mac or (`?on=`) on one of your computers, over its own link (BLG-810). */
export default function ConversationScreen() {
  const { on } = useLocalSearchParams<{ on?: string }>();
  return (
    <OnComputer.Provider value={on || undefined}>
      <Conversation />
    </OnComputer.Provider>
  );
}

function Conversation() {
  const { scrolled, onScroll } = useScrolled();
  const { id } = useLocalSearchParams<{ id: string }>();
  // One of your computers': its calls go over its link, nothing waits for it, and what only your Mac does is left out.
  const on = useOn();
  const say = useT();
  const computer = useComputer(on);
  const away = on && computer?.phase !== 'open' ? say('phoneApp.conv.away', { name: computer?.computer.name ?? say('phoneApp.conv.thatComputer') }) : undefined;
  const { call, where } = scoped(store, on);
  const topic = `conv:${decodeURIComponent(id ?? '')}` as Topic;
  const conv = useView<ConvView>(topic);
  const c = conv?.data;
  const needs = useVisibleNeeds(on ? store.placeNeeds(on, c?.needsYou) : c?.needsYou);
  /** What you sent that the Mac's view doesn't show yet (lib/sends.ts). */
  const pending = useSends(whereOf(topic, on));
  const insets = useSafeAreaInsets();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const atEnd = useRef(true);
  const [agent, setAgent] = useState<SubAgentView | undefined>();
  const [olderBusy, setOlderBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  /** A steered message of yours Claude hasn't read yet, long-pressed: its sheet offers Send now. */
  const [unread, setUnread] = useState<TurnView | undefined>();
  // A steered message you took back: its words, back in the box.
  const [refill, setRefill] = useState<{ text: string; key: number } | undefined>();
  /** Your message, long-pressed to edit it (1.28): Rewind Here or New Fork. */
  const [editing, setEditing] = useState<TurnView | undefined>();
  const [picking, setPicking] = useState(false);
  const canEdit = useSupports('editPrompt');
  // 1.41 (BLG-702): a person's message in the room's or a workspace's chat takes emoji reactions.
  const reacts = useSupports('reactions');
  const supportsCancel = useSupports('cancelSteer');
  const [reacting, setReacting] = useState<TurnView | undefined>();
  const react = (t: TurnView, emoji: string, on: boolean): void => void call(calls.reactTurn(topic, t.id, emoji, on), { queue: false }).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
  const chipsOf = (t: TurnView) => (reacts && t.reactions?.length ? <ReactionChips reactions={t.reactions} mine={t.who === 'you'} onToggle={(e, on) => react(t, e, on)} onWho={(text) => store.toast({ text, tone: 'info' })} /> : null);
  const reactPress = (t: TurnView) => (reacts && t.reactable ? () => setReacting(t) : undefined);
  const older = async () => {
    if (!c) return;
    setOlderBusy(true);
    await call(calls.older(topic, c.turns[0]?.id ?? '')).catch(() => undefined);
    setOlderBusy(false);
  };

  // Keep the newest in view while you're at the end; leave you be when you've scrolled up.
  const follow = () => {
    if (atEnd.current) scroll.current?.scrollToEnd({ animated: true });
  };
  const liveAgent = agent && c ? c.turns.flatMap((t) => t.subagents ?? []).find((a) => a.id === agent.id) ?? agent : agent;
  // The viewer swipes through this worktree's outputs (all of them, since 1.3; else the turns').
  const all: OutputView[] = c ? (c.outputs ?? c.turns.flatMap((t) => [...(t.outputs ?? []), ...(t.subagents ?? []).flatMap((a) => a.outputs)])) : [];
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  // What waits its turn is in the queue above the composer, not a turn of its own.
  const turns = c ? c.turns.filter((t) => !(c.queue && t.who === 'claude' && t.status === 'queued')) : [];
  // A worktree (or chat folder) of yours has files to read and terminals to share with the Mac (1.7).
  const can = convAbilities(scoped(store, on), { topic, agent: c?.agent, mergeable: c?.mergeable, branch: c?.branch, macTopic: isMacTopic(topic), askedTask: topic.startsWith('conv:task:') });
  const hasFolder = can.hasFolder;
  // Your Mac's chats (1.14): a list to switch between in the header, New chat and Delete under •••.
  const canChats = useSupports('macChats');
  const macChats = canChats && can.macChats;
  const home = useView<HomeView>(macChats ? 'home' : undefined);
  const chatCount = home?.data.macChats?.length ?? 0;
  const [chatsOpen, setChatsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** A request you asked of a friend's Claude: Stop cancels it (no run of yours to stop), Remove forgets it. */
  const askedTask = topic.startsWith('conv:task:') ? topic.slice('conv:task:'.length) : undefined;

  return (
    <OutputsTopic.Provider value={topic}>
      <Screen>
        <Header scrolled={scrolled} back eyebrow={c?.project} title={c?.title ?? say('phoneApp.conv.title')} at={conv?.at} lead={isMacTopic(topic) ? <IconBadge Icon={Laptop} tone="sky" size={30} /> : c?.project ? <ProjectMark name={c.project} icon={c.icon} size={30} /> : undefined} right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {c?.working && !all.length ? <Pill label={say('phone.home.workingStep')} tone="peach" /> : null}
              {all.length ? (
                <Press onPress={() => setOutputsOpen(true)} accessibilityLabel={say('phoneApp.conv.outputsCount', { count: all.length })} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: color.sunken }}>
                  <Images color={color.text2} size={16} />
                  <T v="caption" c={color.text2} style={{ fontWeight: '700' }}>
                    {all.length}
                  </T>
                </Press>
              ) : null}
              {macChats ? (
                <Press onPress={() => setChatsOpen(true)} accessibilityLabel={say('phone.home.macChats', { count: chatCount })} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: color.sunken }}>
                  <MessagesSquare color={color.text2} size={16} />
                  {chatCount > 1 ? (
                    <T v="caption" c={color.text2} style={{ fontWeight: '700' }}>
                      {chatCount}
                    </T>
                  ) : null}
                </Press>
              ) : null}
              <More onPress={() => setMenu(true)} label={say('phoneApp.conv.options')} />
            </View>
          }
        />
        <KeyboardLift>
          {/* Where a merge stands stays in view while the conversation scrolls under it. */}
          {c?.merge ? (
            <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 }}>
              <MergeBand topic={topic} merge={c.merge} onCheck={() => setMergeOpen(true)} />
            </View>
          ) : c?.branch ? (
            // Where its branch stands (the Mac toolbar's state), unless a merge from here is under way.
            <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 }}>
              <BranchBand topic={topic} branch={c.branch} canMerge={can.branchMerge} onMerge={() => setMergeOpen(true)} />
            </View>
          ) : null}
          {/* The plan this chat writes and runs (1.15): its milestones and map are a tap away. */}
          {c?.plan ? (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10, paddingTop: c.merge || c.branch ? 0 : 10 }}>
              <Press scaleTo={0.985} onPress={() => router.push(`/plan/${c.plan!.topic.slice('plan:'.length)}`)} accessibilityLabel={say('phoneApp.conv.openPlan', { title: c.plan.title })}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
                  <IconBadge Icon={MapIcon} tone="lavender" size={28} />
                  <View style={{ flex: 1 }}>
                    <T v="callout" c={color.text} numberOfLines={1} style={{ fontWeight: '700' }}>
                      {c.plan.title}
                    </T>
                    <T v="caption" numberOfLines={1}>
                      {c.plan.milestones ? say('phoneApp.conv.planLine', { count: c.plan.milestones, done: c.plan.done, total: c.plan.total }) : say('phoneApp.conv.writingPlan')}
                    </T>
                  </View>
                  <Pill label={c.plan.state} tone={toneOf(c.plan.state)} />
                  <ChevronRight color={color.text3} size={16} />
                </Card>
              </Press>
            </View>
          ) : null}
          {/* Its sub-agents at work stay in view, wherever their turn is (BLG-110). */}
          <AgentStrip turns={turns} onOpen={setAgent} />
          <ScrollView
            ref={scroll}
            onContentSizeChange={follow}
            onScroll={(e) => {
              onScroll(e);
              const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
              atEnd.current = contentOffset.y + layoutMeasurement.height > contentSize.height - 80;
            }}
            scrollEventThrottle={64}
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 18, gap: 14 }}
            keyboardDismissMode="interactive"
          >
            {c?.more ? (
              <Press
                onPress={() => void older()}
                style={{ alignSelf: 'center', paddingHorizontal: 14, height: 30, borderRadius: 15, justifyContent: 'center', backgroundColor: color.sunken }}
              >
                <T v="caption" c={color.text2}>
                  {olderBusy ? say('common.loading') : say('phoneApp.conv.earlier')}
                </T>
              </Press>
            ) : null}
            {!c ? <T v="callout" style={{ textAlign: 'center', marginTop: 40 }}>{say('phoneApp.conv.opening')}</T> : null}
            {c && isMacTopic(topic) && !turns.length && !pending.length ? <MacStarters topic={topic} {...where} /> : null}
            {turns.map((t, i) => (
              <Animated.View key={t.id} entering={i > turns.length - 3 ? FadeIn.duration(180) : undefined}>
                {t.dialogue ? (
                  <DialogueTurn d={t.dialogue} />
                ) : t.who === 'you' ? (
                  <YourTurn t={t} chips={chipsOf(t)} onLongPress={t.steer?.waiting === 'next_step' ? () => setUnread(t) : t.edit && canEdit ? () => setEditing(t) : reactPress(t)} />
                ) : t.who === 'friend' && reactPress(t) ? (
                  <Press onLongPress={reactPress(t)} haptics={false} scaleTo={0.99}>
                    <ClaudeTurn t={t} all={all} onAgent={setAgent} topic={topic} runtime={c?.agent?.runtime} chips={chipsOf(t)} />
                  </Press>
                ) : (
                  <ClaudeTurn t={t} all={all} onAgent={setAgent} topic={topic} runtime={c?.agent?.runtime} chips={chipsOf(t)} />
                )}
              </Animated.View>
            ))}
            {pending.map((p) => (
              <Animated.View key={p.id} entering={FadeIn.duration(180)}>
                <PendingTurn s={p} />
              </Animated.View>
            ))}
            {needs.map((n) => (
              <Animated.View key={n.id} entering={FadeIn.duration(180)}>
                <Card style={{ padding: 16, gap: 14 }}>
                  <NeedFace item={n} more  />
                  <NeedButtons item={n} onAnswer={(t) => answer(n, t)} />
                </Card>
              </Animated.View>
            ))}
          </ScrollView>
          {c?.terminal ? <TerminalBand label={c.terminal.label} onTakeOver={() => void call(calls.takeOver(topic)).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }))} /> : null}
          <Composer
            {...(refill ? { refill } : {})}
            placeholder={c?.waiting ?? (c?.working ? say('phoneApp.conv.whatsNext') : say('phoneApp.conv.reply'))}
            working={c?.working}
            // The room: "@codex", "@bob:codex" as you type @ (BLG-520).
            {...(c?.tags?.length ? { tags: c.tags } : {})}
            disabled={away ?? (c?.terminal ? say('phoneApp.conv.terminalHas', { label: c.terminal.label }) : c && !c.canSend ? say('phoneApp.conv.readOnly') : undefined)}
            photos={!on}
            onSend={(text, photos) => {
              atEnd.current = true;
              // Photos go up first (`put`), then the message names them; on the Mac it waits its
              // turn while Claude works, as a queued message does.
              if (photos.length) return sends.message(topic, text, async () => calls.send(topic, text, await Promise.all(photos.map(upload))), { photo: true });
              // While Claude works, Send queues (after), as on the Mac; Steer is a long-press away.
              const msg = c?.working && !topic.startsWith('conv:task:') ? calls.queue(topic, text) : calls.send(topic, text);
              sends.message(topic, text, msg, where);
            }}
            onSteer={
              topic.startsWith('conv:task:')
                ? undefined
                : (text) => {
                    atEnd.current = true;
                    sends.message(topic, text, calls.steer(topic, text), where);
                  }
            }
            onStop={() => void call(askedTask ? calls.cancelTask(askedTask) : calls.stop(topic))}
            bottom={insets.bottom}
            above={
              c?.queue?.length ? (
                <QueueTray
                  queue={c.queue}
                  onSteer={(qid) => void call(calls.steerQueued(qid)).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }))}
                  onRemove={(qid) => void call(calls.unqueue(qid)).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }))}
                />
              ) : null
            }
          />
        </KeyboardLift>
        <SubAgentSheet topic={topic} turn={agent ? c?.turns.find((t) => t.subagents?.some((a) => a.id === agent.id))?.id : undefined} agent={liveAgent} onClose={() => setAgent(undefined)} />
        <Sheet
          visible={outputsOpen}
          onDismiss={() => setOutputsOpen(false)}
          header={
            <View style={{ paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <IconBadge Icon={Images} tone="sky" size={32} />
              <View style={{ flex: 1 }}>
                <T v="title" style={{ fontSize: 20 }}>
                  {say('phoneApp.conv.outputs')}
                </T>
                <T v="caption">{say('phoneApp.conv.outputsSub')}</T>
              </View>
            </View>
          }
        >
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
            <OutputGrid items={all} cols={3} />
          </ScrollView>
        </Sheet>
        {c?.mergeable ? <MergeSheet topic={topic} visible={mergeOpen} onClose={() => setMergeOpen(false)} /> : null}
        <EditPromptSheet turn={editing} onClose={() => setEditing(undefined)} />
        <ThreadsSheet threadFamily={c?.threadFamily} visible={threadsOpen} onClose={() => setThreadsOpen(false)} />
        <Options
          visible={Boolean(reacting)}
          onClose={() => setReacting(undefined)}
          head={
            reacting ? (
              <QuickReactions
                quick={c?.quick}
                reactions={reacting.reactions}
                onPick={(e, on) => {
                  const t = reacting;
                  setReacting(undefined);
                  react(t, e, on);
                }}
              />
            ) : undefined
          }
          options={[]}
        />
        <AgentPickerSheet topic={topic} picker={c?.agent} visible={picking} onClose={() => setPicking(false)} />
        <Options
          visible={Boolean(unread)}
          onClose={() => setUnread(undefined)}
          title={say('phoneApp.conv.unread')}
          options={[
            {
              Icon: Send,
              label: say('phoneApp.conv.sendNow'),
              sub: say('phoneApp.conv.sendNowSub'),
              tone: 'peach',
              onPress: () => {
                const request = unread?.steer?.request;
                if (request) void call(calls.steerNow(request)).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
              },
            },
            {
              Icon: Undo2,
              label: say('common.cancel'),
              sub: say('phoneApp.conv.cancelSub'),
              tone: 'rose',
              hidden: !supportsCancel,
              onPress: () => {
                const request = unread?.steer?.request;
                if (!request) return;
                void call(calls.cancelSteer(request))
                  .then((r) => {
                    const back = r as { cancelled?: boolean; prompt?: string } | undefined;
                    if (back?.cancelled && back.prompt) setRefill({ text: back.prompt, key: Date.now() });
                  })
                  .catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
              },
            },
          ]}
        />
        <Options
          visible={menu}
          onClose={() => setMenu(false)}
          title={c?.title}
          options={[
            { Icon: c?.agent ? markIcon(runtimeMark(c.agent.runtime)) : Bot, label: say('phoneApp.conv.agent', { label: c?.agent?.label ?? '' }), sub: say('phoneApp.conv.agentSub'), tone: 'lavender', hidden: !can.agentPicker, onPress: () => setPicking(true) },
            { Icon: Plus, label: say('phoneApp.conv.newChat'), sub: say('phoneApp.conv.newChatSub'), tone: 'sky', hidden: !macChats, onPress: () => newMacChat((h) => router.replace(h as never)) },
            { Icon: Square, label: askedTask ? say('phoneApp.conv.stopAsking') : say('phoneApp.conv.stopAgent'), tone: 'rose', hidden: !c?.working, onPress: () => void call(askedTask ? calls.cancelTask(askedTask) : calls.stop(topic)) },
            { Icon: Network, label: say('phoneApp.conv.threads'), sub: threadsSummary(c?.threadFamily), tone: 'lavender', hidden: !c?.threadFamily, onPress: () => setThreadsOpen(true) },
            { Icon: Images, label: say('phoneApp.conv.outputs'), sub: all.length ? say('phoneApp.conv.fromWorktree', { count: all.length }) : say('phoneApp.conv.nothingYet'), tone: 'sky', hidden: !all.length, onPress: () => setOutputsOpen(true) },
            { Icon: GitMerge, label: say('phoneApp.conv.merge'), sub: say('phoneApp.conv.mergeSub'), tone: 'lavender', hidden: !can.merge, onPress: () => setMergeOpen(true) },
            { Icon: FolderTree, label: say('phoneApp.conv.files'), sub: say('phoneApp.conv.filesSub'), tone: 'sky', hidden: !can.files, onPress: () => router.push({ pathname: '/files', params: { topic, name: c?.title ?? say('phoneApp.conv.worktree') } }) },
            { Icon: SquareTerminal, label: say('phoneApp.conv.terminal'), sub: say('phoneApp.conv.terminalSub'), tone: 'lavender', hidden: !can.terminal, onPress: () => router.push({ pathname: '/terminal', params: { topic, title: c?.title ?? '' } }) },
            { Icon: History, label: say('phoneApp.conv.earlier'), tone: 'sky', hidden: !c?.more, onPress: () => void older() },
            { Icon: Monitor, label: say('phone.needs.openOnMac'), sub: say('phoneApp.conv.openOnMacSub'), tone: 'plain', hidden: !can.openOnMac, onPress: () => void openOnMac({ topic }) },
            { Icon: Trash2, label: say('phoneApp.conv.deleteChat'), sub: say('phoneApp.conv.deleteChatSub'), tone: 'rose', hidden: !macChats, onPress: () => setDeleting(true) },
            {
              Icon: Trash2,
              label: say('phoneApp.conv.remove'),
              sub: c?.working ? say('phoneApp.conv.removeWorkingSub') : say('phoneApp.conv.removeSub'),
              tone: 'rose',
              hidden: !can.forget,
              onPress: () => void call(calls.forgetTask(askedTask!)).then(() => (router.canGoBack() ? router.back() : router.replace('/' as never))),
            },
          ]}
        />
        {macChats ? (
          <>
            <MacChatsSheet visible={chatsOpen} onClose={() => setChatsOpen(false)} current={topic} />
            <DeleteMacChat topic={deleting ? topic : undefined} onClose={() => setDeleting(false)} after={() => (router.canGoBack() ? router.back() : router.replace('/' as never))} />
          </>
        ) : null}
      </Screen>
    </OutputsTopic.Provider>
  );
}

/** Your message. Steered into Claude's turn and not read yet: dimmed, with a clock (long-press: Send now, or Cancel from 1.43); else long-press edits it (1.28). */
function YourTurn({ t, onLongPress, chips }: { t: TurnView; onLongPress?: (() => void) | undefined; chips?: React.ReactNode }) {
  const waiting = t.steer?.waiting;
  const say = useT();
  return (
    <Press onLongPress={onLongPress} disabled={!onLongPress} scaleTo={0.99} style={{ alignItems: 'flex-end', paddingLeft: 48 }}>
      {t.via ? (
        <T v="caption" style={{ marginBottom: 4, marginRight: 4 }}>
          {say('phoneApp.conv.sentBy', { who: t.via })}
        </T>
      ) : null}
      <View style={{ backgroundColor: color.card, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14, opacity: waiting ? 0.6 : 1 }}>
        <Prose prose={t.prose} size={15} tasks />
      </View>
      {chips ? <View style={{ marginTop: 4 }}>{chips}</View> : null}
      {waiting ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, marginRight: 4 }}>
          <Clock color={color.text2} size={12} />
          <T v="caption">{waiting === 'stopping' ? say('phoneApp.conv.sentStopping') : say('phoneApp.conv.sentAfter')}</T>
        </View>
      ) : (
        <T v="caption" style={{ marginTop: 4, marginRight: 4 }}>
          {ago(t.ts)}
        </T>
      )}
    </Press>
  );
}

/** Yours, before the Mac's view has it: sending, waiting for the Mac, or not sent (Retry, Remove). */
function PendingTurn({ s }: { s: Pending }) {
  const say = useT();
  return (
    <View style={{ alignItems: 'flex-end', paddingLeft: 48 }}>
      <View style={{ backgroundColor: color.card, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14, opacity: s.state === 'failed' ? 1 : 0.6, borderWidth: s.state === 'failed' ? 1 : 0, borderColor: color.error }}>
        <T v="body" style={{ fontSize: 15 }}>
          {s.text || say('phoneApp.conv.photo')}
        </T>
      </View>
      <SendStatus s={s} />
    </View>
  );
}

/** 1.34 (BLG-466): where a dialogue between agents begins: what it's about, how far it is, and Stop / Continue. */
function DialogueTurn({ d }: { d: NonNullable<TurnView['dialogue']> }) {
  const say = useT();
  const act = (call: ReturnType<typeof calls.dialogueStop>): void => void store.call(call).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
  return (
    <Card style={{ padding: 14, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MessagesSquare color={color.text2} size={15} />
        <T v="caption" c={color.text} style={{ fontWeight: '700' }}>
          {d.mode}
        </T>
        <T v="caption" style={{ flex: 1 }} numberOfLines={1}>
          {d.who}
        </T>
      </View>
      <T v="callout" c={color.text}>
        {d.topic}
      </T>
      <T v="caption">{[d.progress, d.budget, d.status].filter(Boolean).join(' · ')}</T>
      {d.canStop || d.canContinue ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {d.canContinue ? (
            <Press onPress={() => act(calls.dialogueContinue(d.id))} style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: color.sunken }}>
              <T v="caption" c={color.text} style={{ fontWeight: '600' }}>
                {say('phoneApp.conv.continue')}
              </T>
            </Press>
          ) : null}
          {d.canStop ? (
            <Press onPress={() => act(calls.dialogueStop(d.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: color.sunken }}>
              <OctagonX color={color.text2} size={14} />
              <T v="caption" c={color.text} style={{ fontWeight: '600' }}>
                {say('common.stop')}
              </T>
            </Press>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/** An agent's turn, under its name with its mark (BLG-498: the agent the Mac sends; an older Mac's, by the name, else the conversation's runtime). */
function ClaudeTurn({ t, all, onAgent, topic, runtime, chips }: { t: TurnView; all: OutputView[]; onAgent: (a: SubAgentView) => void; topic: Topic; runtime?: string | undefined; chips?: React.ReactNode }) {
  const working = t.status === 'working';
  const outs = t.outputs ?? [];
  const mins = t.endTs ? Math.max(1, Math.round((t.endTs - t.ts) / 60000)) : undefined;
  const say = useT();
  // No card around Claude's answer: it takes the screen's full width, your bubbles sit on the right.
  return (
    <View style={{ gap: 12, paddingTop: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Avatar name={t.name} size={26} {...(t.who === 'claude' ? { mark: t.agent ? agentMark(t.agent) : markOfName(t.name, runtime) } : {})} />
        <T v="callout" c={color.text} style={{ fontWeight: '700' }}>
          {t.name}
        </T>
        <T v="caption" style={{ flex: 1 }} numberOfLines={1}>
          {t.via ? `${say('phoneApp.conv.sentBy', { who: t.via })}${t.steps || mins ? ' · ' : ''}` : ''}
          {t.steps ? say('phoneApp.conv.steps', { count: t.steps }) : ''}
          {mins ? ` · ${say('phoneApp.conv.minutes', { count: mins })}` : ''}
        </T>
        <T v="caption">{ago(t.ts)}</T>
      </View>
      {t.prose.text ? <Prose prose={t.prose} at={{ topic, turn: t.id }} tasks /> : null}
      {chips}
      {working ? <LivePanel t={t} /> : <StepsFold t={t} />}
      {t.subagents?.length ? (
        working || t.subagents.length <= 3 ? (
          <AgentList agents={t.subagents} onOpen={onAgent} />
        ) : (
          <View style={{ gap: 8 }}>
            <T v="caption" style={{ fontWeight: '600' }}>
              {say('phoneApp.conv.subagents', { count: t.subagents.length })}
            </T>
            <AgentChips agents={t.subagents} onOpen={onAgent} />
          </View>
        )
      ) : null}
      {outs.length ? (
        <Animated.View entering={FadeIn}>
          <TurnOutputs items={outs} />
        </Animated.View>
      ) : null}
      {t.status === 'failed' || t.status === 'stopped' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {t.status === 'failed' ? <CircleX color={color.error} size={14} /> : <OctagonX color={color.text2} size={14} />}
          <T v="caption" c={t.status === 'failed' ? color.error : color.text2}>
            {t.status === 'failed' ? say('phoneApp.conv.failed') : say('phoneApp.conv.stopped')}
          </T>
        </View>
      ) : null}
      {t.resumesAt ? (
        // 1.42 (BLG-757): stopped on your usage limit; Beluga tells it to continue once the limit resets.
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Clock color={color.text2} size={14} />
          <T v="caption" c={color.text2}>
            {say('phoneApp.conv.resumesAt', { when: resetWhen(t.resumesAt) })}
          </T>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The Mac's terminal view drives this conversation (1.36, BLG-534): what you'd send here waits,
 * and Take Over gives it back to the chat (the terminal on the Mac closes, what was said there is here).
 */
function TerminalBand({ label, onTakeOver }: { readonly label: string; readonly onTakeOver: () => void }) {
  const say = useT();
  return (
    <Card tone="lavender" style={{ marginHorizontal: 16, marginBottom: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <IconBadge Icon={SquareTerminal} tone="lavender" size={30} />
      <T v="caption" style={{ flex: 1 }}>{say('phoneApp.conv.terminalDriving', { label })}</T>
      <Press onPress={onTakeOver} accessibilityRole="button" accessibilityLabel={say('phoneApp.conv.takeOverA11y')} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: color.card }}>
        <T v="caption" style={{ fontWeight: '600' }}>{say('phoneApp.conv.takeOver')}</T>
      </Press>
    </Card>
  );
}
