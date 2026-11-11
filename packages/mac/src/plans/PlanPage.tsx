import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AUTONOMIES, AUTONOMY_INFO, type Autonomy, MAX_PARALLEL, type Plan, TESTS_AT, TESTS_AT_INFO, reviewState, shownBody } from '@beluga/core/plans/model.js';
import { type PlanView, tidyOffer } from '@beluga/core/plans/progress.js';
import { CONTINUE_PROMPT, decodeFailure, resetWords } from '@beluga/shared/run-failure.js';
import { formatDuration } from '@beluga/shared/text.js';
import { activityOf } from '@beluga/ui/workspace-models.js';
import { useNow } from '../chat/Items.js';
import { Icon, type IconName } from '../components/Icon.js';
import { ActionsDropdown, type ActionItem } from '../components/SpecMenu.js';
import { usePrefs } from '../lib/prefs.js';
import { PLAN_CHAT_TOGGLE } from '../lib/panel.js';
import { OPEN_DECISION } from './plan-ask-model.js';
import { ResizeHandle } from '../layout/panel/ResizeHandle.js';
import { taskChatsItem } from '../layout/plan-task-chats.js';
import { Button, Empty, IconButton, Segmented, Tip, Working, cx } from '../components/ui.js';
import { copyText } from '../lib/copy.js';
import { toast, useApp, useBeluga } from '../lib/beluga.js';
import { RunsOnLabel } from '../chat/RunsOn.js';
import { YOUR_AGENT, agentMenuItems, useAgentEntries, useStartWith } from '../components/agent-options.js';
import { SplitButton } from '../components/SplitButton.js';
import { agentName, useMyAgent } from '../lib/agent-words.js';
import { agentMark } from '@beluga/shared/agent-marks.js';
import { agentForChoice } from '@beluga/ui/agent-choice.js';
import type { AgentRef } from '@beluga/protocol.js';
import { openSheet } from '../lib/sheets.js';
import { mod, openExternal } from '../lib/system.js';
import { MilestoneBar, PlanPrChip, PlanProgress, Said, TonePill } from './marks.js';
import { PlanChat } from './PlanChat.js';
import { BRANCH, DECISIONS, FEED, PlanDetails } from './PlanDetails.js';
import { PlanOutline } from './PlanOutline.js';
import { ReviewLine } from './ReviewLine.js';
import { CHAT_DEFAULT, DEFAULT_PLAN_LAYOUT, type Display, PLAN_LAYOUT_KEY, type PlanLayout, chatOpen, clampChatWidth, readPlanLayout, setChatOpen } from './plan-layout.js';
import { barColumns, changeWords, headline, nextWords, shipAction, titleOf } from './plans-model.js';
import { useCheckerChat, useConversationLoaded, usePlanActions, usePlanStep, usePlanView, usePlans } from './use-plans.js';
import p from './plans.module.css';
import { TeamReviews, usePlanTeamItems } from '../team/SharedPlans.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { revealLabel } from '../lib/os-words.js';
import { useActions } from '../lib/actions.js';
import { onMachine } from '../machines/pane-model.js';
import { useMoveTo } from './move-to.js';
import { useT } from '../lib/i18n.js';
import { t as say } from '@beluga/shared/i18n/index.js';

const PlanCanvas = lazy(() => import('./PlanCanvas.js'));

function readPrefs(): PlanLayout {
  try {
    return readPlanLayout(JSON.parse(localStorage.getItem(PLAN_LAYOUT_KEY) ?? '{}'));
  } catch {
    return DEFAULT_PLAN_LAYOUT;
  }
}

/**
 * A plan's page: what it is and the one thing it waits for, at the top; the plan as a living graph
 * (or an outline) in the middle; and the conversation with Claude beside it, where the plan is
 * talked through and changed. Everything else is a click away (⋯, a task, a gate).
 */
export function PlanPage({ id, task }: { id: string; task?: string }) {
  const t = useT();
  const plan = usePlans().plans.find((x) => x.id === id);
  const view = usePlanView(plan);
  const [prefs, setPrefsState] = useState(readPrefs);
  const setPrefs = useCallback((change: (layout: PlanLayout) => PlanLayout): void => {
    setPrefsState((was) => {
      const next = change(was);
      try {
        localStorage.setItem(PLAN_LAYOUT_KEY, JSON.stringify(next));
      } catch {
        // Kept for now.
      }
      return next;
    });
  }, []);
  const [picked, setPicked] = useState<string | undefined>(task);
  // Opened at a task (a notification about it): that task is picked.
  useEffect(() => {
    if (task) setPicked(task);
  }, [task]);
  const { openList } = usePlanActions();
  // A task taken out of the plan isn't picked any more.
  useEffect(() => {
    if (picked && view && picked !== FEED && picked !== BRANCH && picked !== DECISIONS && !picked.startsWith('gate:') && !view.milestones.some((m) => m.tasks.some((t) => t.task.id === picked))) setPicked(undefined);
  }, [view, picked]);
  if (!plan || !view) return <Empty icon="flag" title={t('plans.gone')} detail={t('plans.goneDetail')} action={<Button onClick={() => openList()}>{t('plans.backToPlans')}</Button>} />;
  return <Page view={view} prefs={prefs} setPrefs={setPrefs} picked={picked} setPicked={setPicked} />;
}

/** It moved to another computer (BLG-806): this is its record here; it runs there. */
function MovedAway({ plan }: { plan: Plan }) {
  const t = useT();
  const actions = useActions();
  const to = plan.movedTo;
  if (!to) return null;
  const page = { kind: 'plan' as const, id: to.planId ?? plan.id };
  return (
    <div className={p.changes} role="status">
      <Icon name="send" size={13} />
      <strong>{t('plans.movedTo', { name: to.name })}</strong>
      <span>{t('plans.movedDetail')}</span>
      <span className={p.grow} />
      <Button size="small" onClick={() => actions.run({ type: 'view', view: to.id ? onMachine(to.id, page) : page })}>
        {t('plans.openThere')}
      </Button>
    </div>
  );
}

/**
 * Your usage limit stopped the plan: when it goes on by itself, and Resume now. Beluga resumes the
 * head Claude and each paused task once the limit resets (see core/plans/watchdog.ts).
 */
function LimitPause({ view }: { view: PlanView }) {
  const t = useT();
  const { plan } = view;
  const { api, act } = usePlanActions();
  const { client } = useBeluga();
  const paused = view.active.filter((x) => x.pulse?.kind === 'paused');
  // The head Claude's own last turn, when your limit stopped it.
  const home = useApp((st) => {
    const card = st.log.findLast((l) => l.type === 'agent' && l.channel === plan.home);
    const f = card?.type === 'agent' && card.status === 'error' ? decodeFailure(card.text) : undefined;
    return f?.kind === 'usage_limit' ? (f.resetsAt ?? 0) : undefined;
  });
  if (plan.status !== 'active' || (!paused.length && home === undefined)) return null;
  const until = Math.max(home ?? 0, ...paused.map((x) => (x.pulse?.kind === 'paused' ? x.pulse.until : 0)));
  const resume = (): void => {
    if (home !== undefined) void act(() => client.api.session.submit(CONTINUE_PROMPT, { channel: plan.home, urgent: true }));
    for (const x of paused) void act(() => api.resumeTask(plan.id, x.task.id));
  };
  return (
    <div className={p.changes} role="status">
      <Icon name="clock" size={13} />
      <strong>{t('plans.pausedLimit')}</strong>
      <span>{until > Date.now() ? t('plans.resumesAt', { when: resetWords(until) }) : t('plans.resumingAsUsage')}</span>
      <span className={p.grow} />
      <Button size="small" variant="primary" icon="play" onClick={resume}>
        {t('plans.resumeNow')}
      </Button>
    </div>
  );
}

function Page({ view, prefs, setPrefs, picked, setPicked }: { view: PlanView; prefs: PlanLayout; setPrefs: (change: (layout: PlanLayout) => PlanLayout) => void; picked?: string; setPicked: (id: string | undefined) => void }) {
  const t = useT();
  const { plan } = view;
  const chat = chatOpen(prefs, plan.id);
  const showChat = useCallback((open: boolean) => setPrefs((l) => setChatOpen(l, plan.id, open)), [plan.id, setPrefs]);
  // ⌥⌘0 (and View › Show Panel): on a plan's page its right side is the chat.
  useEffect(() => {
    const toggle = (): void => setPrefs((l) => setChatOpen(l, plan.id, !chatOpen(l, plan.id)));
    document.addEventListener(PLAN_CHAT_TOGGLE, toggle);
    return () => document.removeEventListener(PLAN_CHAT_TOGGLE, toggle);
  }, [plan.id, setPrefs]);
  const { api, act, openList, openWorktree } = usePlanActions();
  const { client } = useBeluga();
  const runtimes = useApp((s) => s.runtimes);
  const agents = useAgentEntries();
  const startWith = useStartWith();
  const mine = useMyAgent();
  // The plan's conversation (its chat, the head Claude's last turn) loads with the page, the chat shown or not.
  useConversationLoaded(plan.home);
  const uiPrefs = usePrefs();
  const body = shownBody(plan);
  const keys = useMemo(() => new Map(view.milestones.flatMap((m) => m.tasks.flatMap((x) => (x.issue ? [[x.task.id, x.issue.key] as const] : [])))), [view]);
  const startable = useMemo(() => {
    if (!plan.body || plan.draft || !view.open.length) return new Set<string>();
    // Yours never start in a worktree: their button is Decide…, which opens the plan's conversation (its card asks you).
    const yours = view.ready.filter((x) => x.forYou).map((x) => x.task.id);
    if (view.active.length >= plan.maxParallel) return new Set(yours);
    const step = new Set(view.open.filter((m) => m.autonomy === 'step').map((m) => m.milestone.id));
    return new Set([...yours, ...view.ready.filter((x) => !x.forYou && (plan.paused || step.has(x.milestoneId))).map((x) => x.task.id)]);
  }, [view, plan]);
  // The chat's width: dragged (live), else the one you left it at, never past half the plan's area.
  const split = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number>();
  const splitWidth = (): number => split.current?.clientWidth ?? window.innerWidth;
  const [areaWidth, setAreaWidth] = useState(0);
  useLayoutEffect(() => {
    const el = split.current;
    if (!el) return;
    setAreaWidth(el.clientWidth);
    const watch = new ResizeObserver(() => setAreaWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const chatWidth = drag ?? clampChatWidth(prefs.chatWidth, areaWidth || window.innerWidth);
  const start = useCallback(
    (taskId: string, agent?: AgentRef) => (view.ready.some((x) => x.task.id === taskId && x.forYou) ? showChat(true) : void act(() => api.startTask(plan.id, taskId, agent))),
    [plan.id, act, api, view, showChat],
  );
  // Decide… on a task of yours (the outline, its details): the conversation, where its card is.
  useEffect(() => {
    const open = (): void => showChat(true);
    document.addEventListener(OPEN_DECISION, open);
    return () => document.removeEventListener(OPEN_DECISION, open);
  }, [showChat]);
  const next = view.next;
  const words = nextWords(next);
  const checker = useCheckerChat(next.kind === 'checking' ? next.milestone : undefined);
  const line = headline(view);
  // Claude is writing the first plan: one placeholder and one line say so, nothing else.
  const drafting = !plan.body && !body?.milestones.length;

  // The big steps (Open PR, Merge, Resolve Conflicts, Pass): the button says what's under way and
  // waits; what went wrong stays on the page with Try Again (see usePlanStep).
  const step = usePlanStep(plan.id);
  const pr = plan.pr;
  const conflictWaits = Boolean(plan.mainMerge?.conflict?.stuck || Object.values(plan.merging ?? {}).some((m) => m.conflict?.stuck));
  const conflictHere = Boolean(plan.mainMerge?.conflict || Object.values(plan.merging ?? {}).some((m) => m.conflict) || Object.values(plan.combining ?? {}).some((c) => c.conflict));
  // Conflicts go to the plan's head agent: yours.
  const who = agentName(mine);
  const askAgain = (): void => void step.run(t('plans.askAgainWhat', { who }), t('plans.asking', { who }), () => api.retryConflicts(plan.id), t('plans.onConflictAgain', { who }));
  const mergeNow = (auto: boolean): void =>
    void step.run(auto ? t('plans.autoMergeWhat', { number: String(pr?.number) }) : t('plans.mergeWhat', { number: String(pr?.number) }), auto ? t('plans.turningOn') : t('plans.merging'), () => api.mergePr(plan.id, auto ? { auto: true } : {}), auto ? t('plans.mergesOnceChecks', { number: String(pr?.number) }) : t('plans.merged', { number: String(pr?.number) }));
  const openPr = (): void => void step.run(t('plans.openPrWhat'), t('plans.openingPr'), () => api.openPr(plan.id), t('plans.openedPr'));

  // Start with ▸ (BLG-506): "Your agent" over a plan with its own agent is yours by name (none would mean the plan's again).
  const startTasks = (tasks: readonly { readonly task: { readonly id: string } }[], agent?: AgentRef): void => tasks.forEach((x) => void act(() => api.startTask(plan.id, x.task.id, agent)));
  const approvePlan = (): void => void act(() => api.approve(plan.id), t('plans.approved'));
  // Verifying a first draft with a fresh agent, when you ask (BLG-772): Approve Plan waits for it, or Fix what it found.
  const review = reviewState(plan);
  const fixReview = (): void => void act(() => api.fixReview(plan.id), t('plans.sentToAgent'));
  const verify = (thenApprove: boolean): void => void act(() => api.verify(plan.id, { thenApprove }), thenApprove ? t('plans.verifyingThenApprove') : t('plans.verifyingToast'));
  // `with`: the same action by another agent, as the ▾ of a split button.
  const primary = ((): { label: string; run?: () => void; icon?: IconName; busy?: boolean; with?: { readonly label: string; readonly items: ActionItem[] } } | undefined => {
    if (step.busy) return { label: step.busy, busy: true };
    switch (next.kind) {
      case 'approve':
        if (body?.milestones.length && review === 'reviewing') return { label: t('plans.verifying'), busy: true };
        if (body?.milestones.length && review === 'findings' && !plan.review?.fixAsked) return { label: t('plans.fix'), icon: 'wand', run: fixReview, with: { label: t('plans.approveAnywayMenu'), items: [{ label: t('plans.approveAnyway'), onSelect: approvePlan }] } };
        // Approve, worked by ▸: who works its milestones and tasks, set as it's approved.
        return body?.milestones.length
          ? {
              label: t('plans.approvePlan'),
              icon: 'check',
              run: approvePlan,
              with: {
                label: t('plans.moreWaysToApprove'),
                items: [
                  // A fresh agent reads it first (contradictions, duplicates, stale decisions), and approves it once nothing needs fixing.
                  // Who: the same agents and models as Approve, worked by ▸; the one picked verifies it and then works it.
                  {
                    label: t('plans.verifyThenApprove'),
                    icon: 'eye',
                    onSelect: () => undefined,
                    submenu: startWith(plan.agent, (a) => void act(async () => (await api.setWorkAgent(plan.id, a ?? null), api.verify(plan.id, { thenApprove: true })), t('plans.verifyingThenApprove')), ''),
                  },
                  ...startWith(plan.agent, (a) => void act(async () => (await api.setWorkAgent(plan.id, a ?? null), api.approve(plan.id)), t('plans.approved')), t('plans.approveWorkedBy')).map((item, i) => (i === 0 ? { ...item, separate: true } : item)),
                ],
              },
            }
          : undefined;
      case 'review_changes':
        return { label: t('plans.applyChanges'), icon: 'check', run: () => void act(() => api.approve(plan.id), t('plans.changesApplied')) };
      case 'resume':
        return { label: t('plans.resume'), icon: 'play', run: () => void act(() => api.setPaused(plan.id, false)) };
      case 'start':
        // Yours: the plan's conversation, where its card asks you; Claude's: started.
        if (next.tasks.every((x) => x.forYou)) return { label: words.title, run: () => showChat(true) };
        return {
          label: words.title,
          icon: 'play',
          run: () => startTasks(next.tasks.filter((x) => !x.forYou)),
          with: { label: t('plans.startWithAnother'), items: startWith(plan.agent, (a) => startTasks(next.tasks.filter((x) => !x.forYou), a ?? (plan.agent ? mine : undefined))) },
        };
      case 'pass': {
        const again = Boolean(next.milestone.run.mergeFailed);
        return { label: again ? t('plans.passAgain') : t('plans.passMilestone'), icon: 'check', run: () => void step.run(t('plans.passWhat', { title: next.milestone.milestone.title }), t('plans.passing'), () => api.pass(plan.id, next.milestone.milestone.id)) };
      }
      case 'merging': {
        // Merging runs by itself; a conflict goes to Claude, and only one it couldn't fix waits for you.
        const c = next.milestone.merging?.conflict;
        if (c?.stuck) return { label: t('plans.askAgain', { who }), icon: agentMark(mine), run: askAgain };
        return { label: c ? t('plans.fixingConflict', { who }) : t('plans.merging'), busy: true };
      }
      case 'checking':
        // Its checker's conversation (off the sidebar, folded into the plan); the head Claude's own check: the plan's chat.
        return { label: t('plans.watchCheck'), icon: 'eye', run: checker ? () => openWorktree(checker) : () => showChat(true) };
      case 'failed':
        return { label: t('plans.notYet'), run: () => openSheet({ kind: 'plan_send_back', planId: plan.id, milestone: next.milestone.milestone.id }) };
      case 'ship': {
        // One pull request for the whole plan (plan/<slug> → main): opened, brought up to date with main when it conflicts, merged.
        const a = shipAction(plan, next.pr);
        switch (a.kind) {
          case 'open':
            return { label: a.again ? t('plans.openPrAgain') : t('plans.openPr'), icon: 'pr', run: openPr };
          case 'catching_up':
            return { label: t('plans.bringingMainIn'), busy: true };
          case 'fixing':
            return { label: t('plans.fixingConflict', { who }), busy: true };
          case 'stuck':
            return { label: t('plans.askAgain', { who }), icon: agentMark(mine), run: askAgain };
          case 'resolve':
            return { label: t('plans.resolveConflicts'), icon: 'merge', run: () => void step.run(t('plans.bringMainWhat', { branch: next.branch }), t('plans.bringingMainIn'), () => api.bringInMain(plan.id)) };
          case 'draft':
            return { label: t('plans.markReady'), icon: 'external', run: () => void openExternal(next.pr!.url) };
          case 'wait':
            return { label: t('plans.mergeWhenChecksPass'), icon: 'check', run: () => mergeNow(true) };
          case 'merge':
            return { label: t('plans.mergeOnGitHub'), icon: 'check', run: () => mergeNow(false) };
          default:
            return undefined;
        }
      }
      case 'answer':
        return next.tasks[0]?.worktree ? { label: next.tasks[0].issue?.key ? t('plans.answerIn', { key: next.tasks[0].issue.key }) : t('plans.answerInWorktree'), run: () => openWorktree(next.tasks[0]!.worktree!) } : undefined;
      case 'stalled':
        return { label: words.title, icon: 'play', run: () => next.tasks.forEach((x) => void act(() => api.resumeTask(plan.id, x.task.id))) };
      default:
        return undefined;
    }
  })();

  const teamItems = usePlanTeamItems(plan.id, plan.projectId);
  // Move To ▸ another computer of yours (BLG-806): Pause and Move To while something runs in it.
  const moveTo = useMoveTo(plan, view, step);
  // Agent for Its Work ▸ (BLG-498): who works what starts from now on; milestones at work keep theirs (the toast says so).
  const workAgent = (v: string): void =>
    void act(() => api.setWorkAgent(plan.id, v === YOUR_AGENT ? null : agentForChoice(v, runtimes))).then((said) => {
      if (typeof said === 'string') toast(client, said, 'success');
    });
  const more: ActionItem[] = [
    ...(plan.body && plan.status === 'active' ? [{ label: plan.paused ? t('plans.resume') : t('plans.pause'), onSelect: () => void act(() => api.setPaused(plan.id, !plan.paused)) }] : []),
    { label: t('plans.runAtOnce'), submenu: [1, 2, 3, 4, 6, MAX_PARALLEL].map((n) => ({ label: t('plans.milestones', { count: n }), checked: plan.maxParallel === n, onSelect: () => void act(() => api.setParallel(plan.id, n)) })), onSelect: () => undefined },
    ...(plan.status !== 'done' ? [{ label: t('plans.agentForWork'), submenu: agentMenuItems(agents, plan.agent, workAgent), onSelect: () => undefined }] : []),
    { label: t('plans.whenToRunTests'), submenu: TESTS_AT.map((at) => ({ label: TESTS_AT_INFO[at].label, hint: TESTS_AT_INFO[at].hint, checked: plan.testsAt === at, onSelect: () => void act(() => api.setTestsAt(plan.id, at), at === 'end' ? t('plans.testsAtEnd') : t('plans.testsAtMilestone')) })), onSelect: () => undefined },
    ...(review === 'reviewing' ? [{ label: t('plans.approveWithoutWaiting'), onSelect: approvePlan }] : []),
    ...(review !== 'off' && review !== 'reviewing' ? [{ label: review === 'none' ? t('plans.verifyPlan') : t('plans.verifyPlanAgain'), onSelect: () => verify(false) }] : []),
    ...(next.kind === 'stalled' ? next.tasks.flatMap((x) => (x.worktree ? [{ label: x.issue?.key ? t('plans.openChat', { key: x.issue.key }) : t('plans.openItsChat'), onSelect: () => openWorktree(x.worktree!) }] : [])) : []),
    ...(next.kind === 'pass' ? [{ label: t('plans.notYet'), onSelect: () => openSheet({ kind: 'plan_send_back', planId: plan.id, milestone: next.milestone.milestone.id }) }] : []),
    ...(next.kind === 'failed' || next.kind === 'checking'
      ? [
          { label: t('plans.checkAgain'), onSelect: () => void act(() => api.recheck(plan.id, next.milestone.milestone.id)) },
          { label: t('plans.passAnyway'), onSelect: () => void act(() => api.pass(plan.id, next.milestone.milestone.id)) },
        ]
      : []),
    ...(pr ? [{ label: t('plans.viewPr', { number: pr.number }), onSelect: () => void openExternal(pr.url) }] : []),
    ...(next.kind === 'ship'
      ? [
          ...(shipAction(plan, next.pr).kind === 'wait' ? [{ label: t('plans.mergeNow'), onSelect: () => mergeNow(false) }] : []),
          ...(next.pr?.state === 'OPEN' && !next.pr.conflicts && !plan.mainMerge ? [{ label: t('plans.bringMainIn'), hint: t('plans.bringMainHint', { branch: next.branch }), onSelect: () => void step.run(t('plans.bringMainWhat', { branch: next.branch }), t('plans.bringingMainIn'), () => api.bringInMain(plan.id), t('plans.mainIsIn', { branch: next.branch })) }] : []),
          { label: t('plans.mergeLocally'), onSelect: () => openSheet({ kind: 'confirm', title: t('plans.mergeLocallyTitle', { branch: next.branch }), message: t('plans.mergeLocallyMessage'), confirm: t('plans.merge'), run: () => void step.run(t('plans.mergeLocallyWhat', { branch: next.branch }), t('plans.merging'), () => api.mergeLocal(plan.id), t('plans.mergedLocally')) }) },
        ]
      : []),
    ...(conflictWaits && primary?.run !== askAgain ? [{ label: t('plans.askAgain', { who }), onSelect: askAgain }] : []),
    ...(conflictHere ? [{ label: revealLabel('Conflict'), onSelect: () => void act(() => api.showConflict(plan.id)) }] : []),
    ...(plan.status === 'active' ? [taskChatsItem(plan.id, uiPrefs)] : []),
    ...teamItems,
    ...(moveTo ? [moveTo] : []),
    { label: t('plans.copyMarkdown'), separate: true, onSelect: () => void copyText(markdownOf(view)) },
    { label: t('plans.planningStyle'), onSelect: () => openSheet({ kind: 'plan_style' }) },
    ...(plan.draft ? [{ label: plan.body ? t('plans.discardChanges') : t('plans.discardDraft'), danger: true, separate: true, onSelect: () => openSheet({ kind: 'confirm', title: plan.body ? t('plans.discardChangesTitle') : t('plans.discardDraftTitle'), message: plan.body ? t('plans.discardChangesMessage') : t('plans.discardDraftMessage'), confirm: t('plans.discard'), destructive: true, run: () => void act(() => api.discard(plan.id)) }) }] : []),
    ...(plan.body ? [{ label: t('plans.deletePlan'), danger: true, separate: !plan.draft, onSelect: () => openSheet({ kind: 'confirm', title: t('plans.deleteTitle', { title: titleOf(plan) }), message: t('plans.deleteMessage'), confirm: t('common.delete'), destructive: true, run: () => void act(() => api.remove(plan.id)).then(() => openList(plan.projectId)) }) }] : []),
  ];

  return (
    <div className={p.page}>
      <header className={p.pageHead}>
        <div className={p.headMain}>
          <div className={p.titleRow}>
            <IconButton icon="back" label={t('plans.allPlans')} className={p.back} onClick={() => openList(plan.projectId)} />
            <TitleField value={titleOf(plan)} onSave={(title) => void act(() => api.edit(plan.id, [{ op: 'retitle', title }]))} />
          </div>
          {drafting ? null : (
            <>
              {view.milestones.length && plan.body ? <PlanProgress columns={barColumns(view)} /> : null}
              <button type="button" className={p.saidButton} onClick={() => setPicked(picked === FEED ? undefined : FEED)} aria-label={t(line.who === 'you' ? 'plans.saidAriaYou' : 'plans.saidAria', { text: line.text })}>
                <Said line={line} />
              </button>
            </>
          )}
        </div>
        <div className={p.headActions}>
          {/* Where it runs (BLG-786): the computer it was made on. Only with a computer paired. */}
          <RunsOnLabel tip={t('plans.runsOnTip')} />
          {/* The plan's pull request, always one click from GitHub, with what stands in its way. */}
          {pr ? <PlanPrChip pr={pr} /> : null}
          {/* How it runs: nothing to run while Claude writes it. A real decision: its sheet says what changes. */}
          {drafting ? null : (
            <Button size="small" variant="quiet" icon="gauge" title={AUTONOMY_INFO[plan.autonomy].hint} onClick={() => openSheet({ kind: 'plan_mode', planId: plan.id })}>
              {t('plans.runsOn', { mode: AUTONOMY_INFO[plan.autonomy].label })}
              {view.milestones.some((m) => m.milestone.autonomy && m.milestone.autonomy !== plan.autonomy) ? ` ${t('plans.mixed')}` : ''}
            </Button>
          )}
          {/* The orchestrator's chat beside the plan, in and out: always here, whichever way it is. */}
          <Tip label={chat ? t('plans.hideChatTip') : t('plans.openChatTip')} keys={shortcutKeys('toggle-inspector')}>
            <Button size="small" variant="quiet" icon="claude" aria-pressed={chat} onClick={() => showChat(!chat)}>
              {chat ? t('plans.hideOrchestrator') : t('plans.openOrchestrator')}
            </Button>
          </Tip>
          <ActionsDropdown items={more}>
            <IconButton icon="more" label={t('plans.options')} />
          </ActionsDropdown>
          {primary?.with && !primary.busy ? (
            <SplitButton label={primary.with.label} items={primary.with.items}>
              <Button variant="primary" size="small" {...(primary.icon ? { icon: primary.icon } : {})} onClick={primary.run}>
                {primary.label}
              </Button>
            </SplitButton>
          ) : primary ? (
            <Button variant="primary" size="small" {...(primary.icon && !primary.busy ? { icon: primary.icon } : {})} disabled={primary.busy} aria-busy={primary.busy || undefined} className={primary.busy ? p.busyButton : undefined} onClick={primary.run}>
              {primary.busy ? <Working /> : null}
              {primary.label}
            </Button>
          ) : null}
        </div>
      </header>
      {step.trouble ? (
        <div className={cx(p.changes, p.trouble)} role="alert">
          <Icon name="alert" size={13} />
          <strong>{t('plans.couldnt', { what: step.trouble.what })}</strong>
          <span className={p.troubleWhy}>{step.trouble.why}</span>
          <span className={p.grow} />
          <Button size="small" variant="quiet" onClick={step.dismiss}>
            {t('plans.dismiss')}
          </Button>
          {step.trouble.retry ? (
            <Button size="small" onClick={step.trouble.retry}>
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <MovedAway plan={plan} />
      <ConflictLine view={view} onShow={setPicked} />
      <MergeFailed view={view} onPass={(id, title) => void step.run(t('plans.passWhat', { title }), t('plans.passing'), () => api.pass(plan.id, id))} />
      <LimitPause view={view} />
      <TidyOffer view={view} />
      <TeamReviews planId={plan.id} />
      <ReviewLine plan={plan} onApprove={approvePlan} />
      {plan.body && plan.draft ? (
        <div className={p.changes} role="status">
          <Icon name="wand" size={13} />
          <strong>{t('plans.proposesChanges')}</strong>
          <span>{changeWords(plan)}</span>
          <span className={p.grow} />
          <Button size="small" variant="quiet" onClick={() => void act(() => api.discard(plan.id))}>
            {t('plans.discard')}
          </Button>
          <Button size="small" variant="primary" onClick={() => void act(() => api.approve(plan.id), t('plans.changesApplied'))}>
            {t('plans.applyChanges')}
          </Button>
        </div>
      ) : null}
      <div ref={split} className={cx(p.split, chat && p.splitChat)} style={chat ? { gridTemplateColumns: `minmax(0, 1fr) ${chatWidth}px` } : undefined}>
        <div className={p.stage}>
          <div className={p.stageTools}>
            {drafting ? null : (
              <Segmented<Display>
                label={t('plans.show')}
                value={prefs.display}
                onChange={(display) => setPrefs((l) => ({ ...l, display }))}
                options={[
                  { value: 'graph', label: t('plans.canvas'), hint: t('plans.canvasHint') },
                  { value: 'outline', label: t('plans.list'), hint: t('plans.listHint') },
                ]}
              />
            )}
            {drafting ? null : (
              <Button size="small" variant="quiet" icon="clock" onClick={() => setPicked(picked === FEED ? undefined : FEED)} aria-pressed={picked === FEED}>
                {t('plans.whatHappened')}
              </Button>
            )}
            {/* What the plan has decided (BLG-772): there once it decided something. */}
            {body?.decisions?.length ? (
              <Button size="small" variant="quiet" icon="bulb" onClick={() => setPicked(picked === DECISIONS ? undefined : DECISIONS)} aria-pressed={picked === DECISIONS}>
                {t('plans.decisions')}
              </Button>
            ) : null}
            {/* Where the work goes: each milestone into the plan's branch, the branch into main as one PR. */}
            {plan.body && !plan.draft ? (
              <Button size="small" variant="quiet" icon="branch" onClick={() => setPicked(picked === BRANCH ? undefined : BRANCH)} aria-pressed={picked === BRANCH} title={plan.branch ? t('plans.branchTipNamed', { branch: plan.branch }) : t('plans.branchTip')} className={p.branchButton}>
                {plan.branch ?? t('plans.branch')}
              </Button>
            ) : null}
          </div>
          {!body?.milestones.length ? (
            <Drafting plan={plan} />
          ) : prefs.display === 'graph' ? (
            <Suspense fallback={<div className={p.canvasNote}>{t('plans.layingOut')}</div>}>
              <PlanCanvas view={view} keys={keys} selected={picked} onSelect={setPicked} onStart={start} startable={startable} />
            </Suspense>
          ) : (
            <PlanOutline view={view} keys={keys} selected={picked} onSelect={setPicked} startable={startable} />
          )}
          {picked ? <PlanDetails view={view} picked={picked} canStart={startable.has(picked)} onPick={setPicked} onClose={() => setPicked(undefined)} /> : null}
        </div>
        {/* Hidden, not gone: what you typed, where you'd scrolled and a send to retry are there when it's back. */}
        {plan.home ? (
          <div className={p.chatSide} style={chat ? undefined : { display: 'none' }} aria-hidden={chat ? undefined : true}>
            <ResizeHandle
              axis="x"
              label={t('plans.resizeChat')}
              className={p.chatEdge}
              onMove={(x) => setDrag(clampChatWidth((split.current?.getBoundingClientRect().right ?? window.innerWidth) - x, splitWidth()))}
              onEnd={() => {
                if (drag !== undefined) setPrefs((l) => ({ ...l, chatWidth: drag }));
                setDrag(undefined);
              }}
              onReset={() => setPrefs((l) => ({ ...l, chatWidth: CHAT_DEFAULT }))}
              onStep={(dir) => setPrefs((l) => ({ ...l, chatWidth: clampChatWidth(chatWidth + dir * 24, splitWidth()) }))}
            />
            <PlanChat channel={plan.home} draft={!plan.body || Boolean(plan.draft)} drafting={drafting} project={plan.projectId} onClose={() => showChat(false)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The plan's name, changed in place: wraps instead of clipping (descenders and long names show whole); Enter saves. */
function TitleField({ value, onSave }: { value: string; onSave: (title: string) => void }) {
  const t = useT();
  const [text, setText] = useState(value);
  const box = useRef<HTMLTextAreaElement>(null);
  // What you typed and haven't saved: a name arriving meanwhile (your last rename coming back) never overwrites it.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setText(value);
  }, [value]);
  // As tall as its lines: on every change and whenever a new width changes the wrapping.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (): void => {
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      // Next frame: resizing the box inside its own observer's callback is a ResizeObserver loop.
      if (el.clientWidth !== width) (width = el.clientWidth), cancelAnimationFrame(frame), (frame = requestAnimationFrame(fit));
    });
    let frame = 0;
    watch.observe(el);
    return () => (watch.disconnect(), cancelAnimationFrame(frame));
  }, [text]);
  const save = (): void => {
    if (typed.current && text.trim() && text.trim() !== value) onSave(text.trim());
    else setText(value);
    typed.current = false;
  };
  return (
    <textarea
      ref={box}
      className={cx(p.title, 'selectable')}
      aria-label={t('plans.planName')}
      rows={1}
      spellCheck={false}
      value={text}
      onChange={(e) => ((typed.current = true), setText(e.target.value.replace(/\s*\n\s*/g, ' ')))}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          typed.current = false;
          setText(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * While Claude writes the first plan: the outline of three milestone columns, drawn softly inside
 * the canvas, and the one line that says what's going on (how long it's been at it).
 */
function Drafting({ plan }: { plan: Plan }) {
  const t = useT();
  const project = useApp((s) => s.projects.find((x) => x.id === plan.projectId)?.name);
  const activity = useApp((s) => activityOf(s.log, plan.home));
  const now = useNow(true);
  const since = activity.startedAt ?? plan.createdAt;
  const fresh = now - plan.createdAt < 20_000;
  const line = activity.running
    ? t('plans.draftingReading', { project: project ?? t('plans.theCode'), time: formatDuration(Math.max(0, now - since)) })
    : fresh
      ? t('plans.draftingStarting')
      : t('plans.draftingIdle');
  return (
    <div className={p.writing}>
      <div className={p.skeleton} data-live={activity.running || fresh ? 'true' : undefined} aria-hidden="true">
        {[3, 2, 2].map((n, i) => (
          <div key={i} className={p.skMilestone} style={{ animationDelay: `${i * 220}ms` }}>
            <div className={p.skHead} />
            {Array.from({ length: n }, (_, j) => (
              <div key={j} className={p.skTask} />
            ))}
          </div>
        ))}
      </div>
      <p className={p.writingLine} role="status">
        {line}
      </p>
    </div>
  );
}

/** The plan as Markdown (to paste somewhere). */
function markdownOf(view: PlanView): string {
  const body = shownBody(view.plan);
  if (!body) return '';
  const lines = [`# ${body.title}`, '', body.goal, ''];
  for (const m of view.milestones) {
    lines.push(`## ${m.index + 1}. ${m.milestone.title}`, '');
    if (m.milestone.goal) lines.push(m.milestone.goal, '');
    for (const x of m.tasks) lines.push(`- [${x.state === 'done' ? 'x' : ' '}] ${x.issue ? `${x.issue.key} ` : ''}${x.task.title}${x.task.blockedBy.length ? ` ${say('plans.mdAfter', { tasks: x.task.blockedBy.join(', ') })}` : ''}`);
    if (m.milestone.criteria.length) lines.push('', `**${say('plans.mdPassesWhen')}**`, ...m.milestone.criteria.map((c) => `- ${c}`));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The plan adopted a branch after some milestones passed: their tasks still In Review can be merged
 * into it and their worktrees cleared away, but only on your Yes (never by itself, nor on a restart).
 */
function TidyOffer({ view }: { view: PlanView }) {
  const t = useT();
  const { api, act } = usePlanActions();
  const tasks = tidyOffer(view);
  if (!tasks.length) return null;
  const plan = view.plan;
  return (
    <div className={p.changes} role="status" aria-label={t('plans.tidyUpAria')}>
      <Icon name="branch" size={13} />
      <strong>
        {t('plans.tidyUpQuestion', { count: tasks.length })}
      </strong>
      <span title={tasks.map((x) => `${x.issue!.key} ${x.task.title}`).join('\n')}>
        {t('plans.tidyUpBody', { keys: tasks.map((x) => x.issue!.key).join(', '), branch: plan.branch ?? '' })}
      </span>
      <span className={p.grow} />
      <Button size="small" variant="quiet" onClick={() => void act(() => api.tidyUp(plan.id, false), t('plans.leftAsTheyAre'))}>
        {t('common.no')}
      </Button>
      <Button size="small" variant="primary" onClick={() => void act(() => api.tidyUp(plan.id, true), t('plans.tidyingUp', { count: tasks.length }))}>
        {t('plans.tidyUp')}
      </Button>
    </div>
  );
}


/**
 * A merge conflict in the plan (a milestone merging into its branch, or main into it for the PR):
 * which files, and whether Claude is on it. One it couldn't fix waits for you: Ask Claude Again
 * and Show in Finder sit in ••• and the main button.
 */
function ConflictLine({ view, onShow }: { view: PlanView; onShow: (id: string) => void }) {
  const t = useT();
  const { plan } = view;
  const merging = Object.entries(plan.merging ?? {}).find(([, m]) => m.conflict);
  const main = plan.mainMerge?.conflict;
  const c = main ?? merging?.[1].conflict;
  if (!c) return null;
  const m = merging ? view.milestones.find((x) => x.milestone.id === merging[0]) : undefined;
  const what = main ? t('plans.conflictMain', { main: plan.mainMerge!.main, branch: String(plan.branch) }) : t('plans.conflictMilestone', { merging: merging![1].conflict!.key ?? merging![1].conflict!.merging, title: m?.milestone.title ?? t('plans.aMilestone'), branch: String(plan.branch) });
  const shown = c.files.slice(0, 4);
  return (
    <div className={cx(p.changes, c.stuck ? p.trouble : undefined)} role="status" aria-label={t('plans.mergeConflict')}>
      <Icon name="merge" size={13} />
      <strong>{c.stuck ? t('plans.conflictNeedsYou') : t('plans.agentFixingConflict')}</strong>
      <span className={p.troubleWhy} title={c.files.join('\n')}>
        {t('plans.mergingWhat', { what })} · {shown.map((f) => (
          <code key={f} className={p.conflictFile}>{f}</code>
        ))}
        {c.files.length > shown.length ? ` ${t('plans.andMore', { count: c.files.length - shown.length })}` : ''}
      </span>
      <span className={p.grow} />
      {!c.stuck ? <Working /> : null}
      <Button size="small" variant="quiet" onClick={() => onShow(main ? BRANCH : `gate:${merging![0]}`)}>
        {t('plans.details')}
      </Button>
    </div>
  );
}

/** A milestone you passed whose work couldn't go into the plan's branch (not a conflict): why, kept, and Pass Again. */
function MergeFailed({ view, onPass }: { view: PlanView; onPass: (milestoneId: string, title: string) => void }) {
  const t = useT();
  const failed = view.milestones.filter((m) => m.run.mergeFailed && !m.run.passedAt && m.state !== 'merging');
  if (!failed.length) return null;
  return (
    <>
      {failed.map((m) => (
        <div key={m.milestone.id} className={cx(p.changes, p.trouble)} role="alert">
          <Icon name="alert" size={13} />
          <strong>
            {t('plans.couldntMerge', { title: m.milestone.title, branch: view.plan.branch ?? t('plans.thePlansBranch') })}
          </strong>
          <span className={p.troubleWhy}>{m.run.mergeFailed!.reason}</span>
          <span className={p.grow} />
          <Button size="small" onClick={() => onPass(m.milestone.id, m.milestone.title)}>
            {t('plans.passAgain')}

          </Button>
        </div>
      ))}
    </>
  );
}
