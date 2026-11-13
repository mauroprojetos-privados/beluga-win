import type { BoardState } from '../../../../src/core/board/model.js';
import type { Actor } from '../../../../src/core/board/model.js';
import { AUTONOMY_INFO, type Autonomy, type Plan, type PlanBody, type PlanEvent, type PlanPr, type PlansState, diffBodies, milestoneDeps, planTitle, reviewState, shownBody } from '../../../../src/core/plans/model.js';
import { type MilestoneState, type MilestoneView, type NextStep, type PlanView, type TaskState, type TaskView, agentNowWords } from '../../../../src/core/plans/progress.js';
import { pulseWords } from '../../../../src/core/plans/watchdog.js';
import { type Key, t } from '../../../../src/shared/i18n/index.js';

/**
 * The Plans screens' pure parts (no DOM): words and tones for states, what a plan waits for as a
 * button, the plans of a project in the order they're shown, and the plan graph's structure (what
 * the layout depends on, kept apart from the live state so a task moving on never re-lays it out).
 */

export type Tone = 'muted' | 'neutral' | 'claude' | 'info' | 'ok' | 'warn' | 'error' | 'accent';

const and = (xs: readonly string[]): string => xs.join(` ${t('common.and')} `);

/** Its words are said at render (getters), so a language change shows at once. */
const stateWords = <S extends string>(words: Record<S, readonly [Key, Tone]>): Readonly<Record<S, { readonly label: string; readonly tone: Tone }>> =>
  Object.fromEntries(Object.entries<readonly [Key, Tone]>(words).map(([s, [key, tone]]) => [s, { get label() { return t(key); }, tone }])) as Record<S, { readonly label: string; readonly tone: Tone }>;

export const TASK_STATE: Readonly<Record<TaskState, { readonly label: string; readonly tone: Tone }>> = stateWords<TaskState>({
  draft: ['plans.m.draft', 'muted'],
  later: ['plans.m.later', 'muted'],
  blocked: ['plans.m.waiting', 'muted'],
  ready: ['plans.m.ready', 'accent'],
  running: ['plans.m.working', 'claude'],
  asking: ['plans.m.waitingForYou', 'warn'],
  idle: ['plans.m.stoppedUnfinished', 'warn'],
  stalled: ['plans.m.needsYou', 'warn'],
  review: ['plans.m.inReview', 'info'],
  planned: ['plans.m.mergedIntoPlan', 'info'],
  done: ['plans.m.taskDone', 'ok'],
  canceled: ['plans.m.canceled', 'muted'],
  missing: ['plans.m.deleted', 'muted'],
});

export const MILESTONE_STATE: Readonly<Record<MilestoneState, { readonly label: string; readonly tone: Tone }>> = stateWords<MilestoneState>({
  draft: ['plans.m.draft', 'muted'],
  later: ['plans.m.upNext', 'muted'],
  running: ['plans.m.inProgress', 'claude'],
  checking: ['plans.m.agentChecking', 'claude'],
  gate: ['plans.m.readyToPass', 'accent'],
  failed: ['plans.m.checkFailed', 'error'],
  merging: ['plans.m.mergingIntoPlan', 'claude'],
  passed: ['plans.m.passed', 'ok'],
});

/**
 * A milestone's status text in the plan's list: its state, plus when it runs. Open milestones say
 * they run side by side with the others open now; a waiting one says what it waits on.
 */
export function milestoneLabel(view: Pick<PlanView, 'milestones' | 'open'>, m: MilestoneView): string {
  const base = MILESTONE_STATE[m.state].label;
  const title = (id: string): string => `“${view.milestones.find((x) => x.milestone.id === id)?.milestone.title ?? id}”`;
  if (m.state === 'later') {
    const waits = m.dependsOn.filter((d) => view.milestones.find((x) => x.milestone.id === d)?.state !== 'passed');
    return waits.length ? t('plans.m.after', { list: and(waits.map(title)) }) : base;
  }
  const beside = view.open.filter((x) => x.milestone.id !== m.milestone.id);
  if (!view.open.some((x) => x.milestone.id === m.milestone.id) || !beside.length) return base;
  return t('plans.m.alongside', { base, who: beside.length > 2 ? t('plans.m.others', { count: beside.length }) : and(beside.map((x) => title(x.milestone.id))) });
}

/** How a plan is, in one word, for lists and the page's header. */
export function planStatus(view: Pick<PlanView, 'plan' | 'next'>): { readonly label: string; readonly tone: Tone } {
  const { plan, next } = view;
  if (!plan.body) return { label: t('plans.m.draft'), tone: 'muted' };
  if (plan.status === 'done' && !plan.draft) return next.kind === 'ship' ? { label: plan.pr?.state === 'CLOSED' ? t('plans.m.prClosed') : plan.pr ? t('plans.m.prOpen') : t('plans.m.readyToShip'), tone: plan.pr?.state === 'CLOSED' ? 'warn' : 'accent' } : { label: t('plans.m.done'), tone: 'ok' };
  if (plan.draft) return { label: t('plans.m.changesProposed'), tone: 'accent' };
  if (plan.paused) return { label: t('plans.m.paused'), tone: 'muted' };
  switch (next.kind) {
    case 'pass':
    case 'start':
    case 'answer':
    case 'stalled':
      return { label: t('plans.m.waitingForYou'), tone: 'accent' };
    case 'failed':
      return { label: t('plans.m.needsFix'), tone: 'error' };
    case 'checking':
      return { label: t('plans.m.checking'), tone: 'claude' };
    case 'merging':
      return next.milestone.merging?.conflict?.stuck ? { label: t('plans.m.waitingForYou'), tone: 'accent' } : { label: t('plans.m.merging'), tone: 'claude' };
    case 'working':
      return { label: t('plans.m.running'), tone: 'claude' };
    default:
      return { label: t('plans.m.waiting'), tone: 'muted' };
  }
}

/**
 * A task's state in words for its card: a started task says how it's doing right now (“Working”
 * with its step and how long, “Running a long command · 12m”, “Stopped without finishing”), never
 * “working” when no turn runs.
 */
export function taskWords(t: TaskView, now: number): { readonly label: string; readonly tone: Tone; readonly sub?: string } {
  const base = TASK_STATE[t.state];
  if (!t.pulse || t.combining) return { ...base, ...(t.state === 'running' && t.step ? { sub: t.step } : t.state === 'blocked' || t.state === 'later' ? (t.why ? { sub: t.why } : {}) : {}) };
  const w = pulseWords(t.pulse, now);
  // Woken: the card says so while it works again.
  const sub = t.watch && !t.watch.needsYou && t.pulse.kind !== 'stopped' && t.pulse.kind !== 'waiting' ? `${w.sub ?? ''}${w.sub ? ' · ' : ''}${t.watch.line}` : w.sub;
  return { label: w.label, tone: w.tone, ...(sub ? { sub } : {}) };
}

/** A milestone's Claude right now, for its header and details (see agentNowWords): nothing while it isn't at work. */
export function milestoneNowWords(m: Pick<MilestoneView, 'agentNow' | 'agent' | 'tasks'>, now: number): { readonly label: string; readonly tone: Tone; readonly sub?: string; readonly onCard: boolean } | undefined {
  const w = agentNowWords(m, now);
  return w ? { label: w.label, tone: w.asking ? 'warn' : 'claude', ...(w.sub ? { sub: w.sub } : {}), onCard: w.onCard } : undefined;
}

/** The one thing to do next, in words (the page's main button and its line). */
export function nextWords(next: NextStep): { readonly title: string; readonly detail?: string } {
  switch (next.kind) {
    case 'approve':
      return { title: t('plans.approvePlan'), detail: t('plans.m.approveDetail') };
    case 'review_changes':
      return { title: t('plans.applyChanges'), detail: t('plans.m.reviewChangesDetail') };
    case 'resume':
      return { title: t('plans.resume'), detail: t('plans.m.resumeDetail') };
    case 'start': {
      // Yours: no worktree, you answer it in the plan's conversation (see core/plans/decisions.ts).
      const yours = next.tasks.filter((x) => x.forYou);
      if (yours.length === next.tasks.length) return { title: yours.length === 1 ? t('plans.m.answerOne', { title: yours[0]!.task.title }) : t('plans.m.answerMany', { count: yours.length }), detail: t('plans.m.answerDetail') };
      const claude = next.tasks.length - yours.length;
      return { title: claude === 1 ? t('plans.m.startOne', { title: next.tasks.find((x) => !x.forYou)!.task.title }) : t('plans.m.startMany', { count: claude }), detail: claude === 1 ? t('plans.m.readyToGo') : t('plans.m.readyToGoSide') };
    }
    case 'pass':
      return { title: t('plans.m.passTitle', { title: next.milestone.milestone.title }), detail: next.milestone.run.check ? (next.milestone.run.check.verdict === 'pass' ? t('plans.m.checkedHolds') : t('plans.m.checkFoundProblems')) : t('plans.m.everyTaskFinished') };
    case 'checking':
      return { title: t('plans.m.agentChecking'), detail: t('plans.m.passCriteriaOf', { title: next.milestone.milestone.title }) };
    case 'failed':
      return { title: t('plans.m.needsFix'), detail: t('plans.m.didntPass', { title: next.milestone.milestone.title }) };
    case 'answer':
      return { title: t('plans.m.agentAsked'), detail: next.tasks.map((x) => x.issue?.key ?? x.task.title).join(', ') };
    case 'stalled':
      return { title: next.tasks.length === 1 ? t('plans.m.resumeOne', { what: next.tasks[0]!.issue?.key ?? `“${next.tasks[0]!.task.title}”` }) : t('plans.m.resumeMany', { count: next.tasks.length }), detail: next.tasks.map((x) => x.watch?.line ?? t('plans.m.stoppedAgain', { what: x.issue?.key ?? x.task.title })).join(' · ') };
    case 'working':
      return { title: next.tasks.length ? t('plans.m.inProgressCount', { count: next.tasks.length }) : t('tasks.starting'), ...(next.note ? { detail: next.note } : {}) };
    case 'waiting':
      return { title: t('plans.m.waiting'), detail: next.why };
    case 'merging':
      return { title: next.text, detail: t('plans.m.passesOnceMerged', { title: next.milestone.milestone.title }) };
    case 'ship':
      if (next.pr?.state === 'OPEN') return { title: t('plans.m.prIsOpen', { number: next.pr.number }), detail: `${next.branch} → main: ${prWords(next.pr)}` };
      if (next.pr?.state === 'CLOSED') return { title: t('plans.m.prWasClosed', { number: next.pr.number }), detail: t('plans.m.closedDetail') };
      return { title: t('plans.openPr'), detail: t('plans.m.everyPassedBranch', { branch: next.branch }) };
    case 'done':
      return { title: t('plans.m.done'), detail: t('plans.m.everyPassed') };
  }
}

/** A project's plans: running first, then drafts, then finished; newest first in each. */
export function plansOf(state: PlansState, projectId: string | undefined): Plan[] {
  const rank = (p: Plan): number => (p.status === 'active' ? 0 : p.status === 'draft' ? 1 : 2);
  // One that moved to another computer runs there: its record here stays off the lists (its page still opens).
  return state.plans.filter((p) => p.projectId === projectId && !p.movedTo).sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

export const titleOf = planTitle;

/** How far along each milestone is, for a plan's progress bar (finished share per milestone). */
export function bars(view: PlanView): ReadonlyArray<{ readonly id: string; readonly title: string; readonly state: MilestoneState; readonly share: number }> {
  return view.milestones.map((m) => ({ id: m.milestone.id, title: m.milestone.title, state: m.state, share: m.state === 'passed' ? 1 : m.total ? m.finished / m.total : 0 }));
}

/**
 * Milestones in rows by what they wait on: the first row waits on nothing, each next row on the
 * rows before it. Milestones in one row run side by side (ids, in the plan's order).
 */
export function milestoneRows(body: PlanBody | undefined): ReadonlyArray<readonly string[]> {
  const ms = body?.milestones ?? [];
  const depth = new Map<string, number>();
  const of = (id: string, seen: ReadonlySet<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const m = ms.find((x) => x.id === id);
    if (!m || seen.has(id)) return 0;
    const d = Math.max(-1, ...milestoneDeps(body, m).map((x) => of(x, new Set([...seen, id])))) + 1;
    depth.set(id, d);
    return d;
  };
  const rows: string[][] = [];
  for (const m of ms) (rows[of(m.id, new Set())] ??= []).push(m.id);
  return rows.filter(Boolean);
}

/** The plan's progress bar: one column per row of milestones, the milestones of a row stacked in it (side by side in time). */
export function barColumns(view: PlanView): ReadonlyArray<ReturnType<typeof bars>> {
  const all = new Map(bars(view).map((b) => [b.id, b]));
  return milestoneRows(view.body ?? shownBody(view.plan)).map((row) => row.flatMap((id) => all.get(id) ?? []));
}

// ---- the plan's one sentence

/** Who a sentence is about: you (something waits for you), Claude (it's at work), Beluga (the plan itself). */
export type Who = 'you' | 'claude' | 'beluga';

export interface Headline {
  readonly who: Who;
  readonly text: string;
}

/** The plan's branch bits, when the plan carries them (plan-branch-flow): read loosely. */
interface BranchBits {
  readonly branch?: string;
  readonly merging?: Readonly<Record<string, { readonly catchUp?: boolean; readonly conflict?: { readonly key?: string; readonly merging?: string; readonly files?: readonly string[]; readonly stuck?: boolean } }>>;
}
const branchBits = (plan: Plan): BranchBits => plan as Plan & BranchBits;

const quoted = (m: MilestoneView): string => `“${m.milestone.title}”`;
/** “3 tasks”, said (`plans.m.n.<what>` is a plural entry). */
const count = (n: number, what: 'task' | 'thing' | 'milestone' | 'otherTask' | 'readyTask'): string => t(`plans.m.n.${what}`, { count: n });

/** What's merging into the plan's branch now, when the plan carries that (a conflict first). */
function mergingLine(view: PlanView): Headline | undefined {
  const merging = branchBits(view.plan).merging ?? {};
  const entries = Object.entries(merging).filter(([, m]) => !m.catchUp);
  const conflict = entries.find(([, m]) => m.conflict);
  if (conflict) {
    const c = conflict[1].conflict!;
    const what = c.key ?? c.merging ?? t('plans.thePlansBranch');
    return c.stuck ? { who: 'you', text: c.files?.length ? t('plans.m.fixConflictFiles', { what, files: c.files.slice(0, 2).join(', ') }) : t('plans.m.fixConflict', { what }) } : { who: 'claude', text: t('plans.m.fixingConflictIn', { what }) };
  }
  const first = entries[0];
  if (!first) return undefined;
  const m = view.milestones.find((x) => x.milestone.id === first[0]);
  return { who: 'beluga', text: t('plans.m.mergingInto', { what: m ? quoted(m) : t('plans.aMilestone'), branch: branchBits(view.plan).branch ?? t('plans.thePlansBranch') }) };
}

/**
 * The plan in one sentence, with who it's about: what waits for you (“You: pass “API” — Claude
 * checked all 4 criteria”), else what Claude or Beluga is doing (“Claude is checking “API””, “3
 * tasks running in 2 milestones”).
 */
export function headline(view: PlanView): Headline {
  const { plan, next } = view;
  const running = view.active.filter((x) => x.state === 'running' || x.state === 'idle');
  const inMilestones = new Set(running.map((x) => x.milestoneId)).size;
  const alsoRunning = running.length ? t('plans.m.alsoRunning', { tasks: count(running.length, 'task') }) : '';
  if (!plan.body && view.milestones.length) {
    // The draft's review before approval (BLG-772).
    const review = reviewState(plan);
    if (review === 'reviewing') return { who: 'claude', text: plan.review?.thenApprove ? t('plans.m.verifyingThenApprove') : t('plans.verifyingToast') };
    if (review === 'findings' && !plan.review?.fixAsked) return { who: 'you', text: t('plans.m.verifyFound', { things: count(plan.review!.findings.length, 'thing') }) };
  }
  if (!plan.body) return view.milestones.length ? { who: 'you', text: t('plans.m.approveDraft', { milestones: count(view.milestones.length, 'milestone'), tasks: count(view.total, 'task') }) } : { who: 'claude', text: t('plans.m.writingPlan') };
  if (plan.draft) return { who: 'you', text: t('plans.m.reviewChanges', { changes: changeWords(plan) }) };
  if (next.kind !== 'done' && next.kind !== 'answer' && next.kind !== 'failed') {
    const merging = mergingLine(view);
    if (merging) return merging;
  }
  switch (next.kind) {
    case 'approve':
    case 'review_changes':
      return { who: 'you', text: t('plans.m.reviewChanges', { changes: changeWords(plan) }) };
    case 'resume':
      return { who: 'you', text: t('plans.m.resumePlan') };
    case 'answer':
      return { who: 'you', text: t('plans.m.answerAgentIn', { list: next.tasks.map((x) => x.issue?.key ?? `“${x.task.title}”`).join(', ') }) };
    case 'failed':
      return { who: 'you', text: t('plans.m.failedLine', { title: quoted(next.milestone) }) };
    case 'pass': {
      const m = next.milestone;
      const failed = m.run.mergeFailed;
      if (failed) return { who: 'you', text: t('plans.m.couldntMergeLine', { title: quoted(m), branch: plan.branch ?? t('plans.thePlansBranch'), reason: failed.reason }) };
      const n = m.milestone.criteria.length;
      const why = m.run.check?.verdict === 'pass' ? (n === 1 ? t('plans.m.checkedIts') : n === 2 ? t('plans.m.checkedBoth') : t('plans.m.checkedAll', { n })) : t('plans.m.everyTaskFinishedLower');
      return { who: 'you', text: t('plans.m.passLine', { title: quoted(m), why }) };
    }
    case 'start':
      return { who: 'you', text: next.tasks.length === 1 ? t('plans.m.startOne', { title: next.tasks[0]!.task.title }) : t('plans.m.startLine', { tasks: count(next.tasks.length, 'task') }) };
    case 'checking':
      return { who: 'claude', text: t('plans.m.agentCheckingLine', { title: quoted(next.milestone), also: alsoRunning }) };
    case 'working': {
      if (running.length) return { who: 'claude', text: inMilestones > 1 ? t('plans.m.runningIn', { tasks: count(running.length, 'task'), n: inMilestones }) : t('plans.m.runningTasks', { tasks: count(running.length, 'task') }) };
      const starting = startingMilestones(view);
      return { who: 'beluga', text: starting.length ? settingUp(view, starting) : t('plans.m.startingNext') };
    }
    case 'waiting':
      return { who: 'beluga', text: next.why };
    case 'merging':
      return { who: next.milestone.merging?.conflict?.stuck ? 'you' : 'beluga', text: next.text };
    case 'stalled':
      return { who: 'you', text: t('plans.m.resumeStalled', { list: next.tasks.map((x) => x.issue?.key ?? `“${x.task.title}”`).join(', ') }) };
    case 'ship':
      return shipHeadline(plan, next.branch, next.pr);
    case 'done':
      return { who: 'beluga', text: t('plans.m.doneLine') };
  }
}

/** From a task's worktree: where it stands in its plan, in the same voice as the plan's sentence. */
export function taskHeadline(view: PlanView, taskId: string): Headline | undefined {
  const task = view.milestones.flatMap((m) => m.tasks).find((x) => x.task.id === taskId);
  const m = task && view.milestones.find((x) => x.milestone.id === task.milestoneId);
  if (!task || !m) return undefined;
  const into = t('plans.m.into');
  const state = task.state as string;
  if (state === 'planned') return { who: 'beluga', text: t('plans.m.tMerged') };
  switch (task.state) {
    case 'running':
      return { who: 'claude', text: task.step ? t('plans.m.tWorkingStep', { step: task.step }) : t('plans.m.tWorking') };
    case 'asking':
      return { who: 'you', text: t('plans.m.tAsked') };
    case 'idle':
      return { who: 'beluga', text: t('plans.m.tIdle') };
    case 'ready':
      if (task.forYou) return { who: 'you', text: t('plans.m.tYours') };
      if (task.queued) return { who: 'claude', text: t('plans.m.tQueued') };
      return m.autonomy === 'step' ? { who: 'you', text: t('plans.m.tReadyStep') } : { who: 'beluga', text: t('plans.m.tReadyAuto') };
    case 'blocked':
    case 'later':
      return { who: 'beluga', text: task.why ?? t('plans.m.waiting') };
    case 'done':
      return { who: 'beluga', text: m.state === 'passed' ? t('plans.m.tDoneIn') : t('plans.m.tDoneWaiting', { title: quoted(m) }) };
    case 'canceled':
    case 'missing':
      return { who: 'beluga', text: t('plans.m.tTakenOut') };
    case 'draft':
      return { who: 'you', text: t('plans.m.tDraft') };
    case 'review':
      break;
  }
  // Done here: what's left is the milestone's.
  const others = m.tasks.filter((x) => x !== task && !['review', 'done', 'canceled', 'missing', 'planned'].includes(x.state)).length;
  if (m.state === 'running') return { who: 'beluga', text: t('plans.m.tWaitOthers', { others: count(others, 'otherTask'), title: quoted(m), into }) };
  if (m.state === 'checking' || (m.state === 'gate' && m.milestone.criteria.length && !m.run.check)) return { who: 'claude', text: t('plans.m.tChecking', { title: quoted(m), into }) };
  if (m.state === 'gate') return m.autonomy === 'autopilot' ? { who: 'beluga', text: t('plans.m.tPassesItself', { title: quoted(m), into }) } : { who: 'you', text: t('plans.m.tPassIt', { title: quoted(m), into }) };
  if (m.state === 'failed') return { who: 'you', text: t('plans.m.tFailed', { title: quoted(m) }) };
  return { who: 'beluga', text: t('plans.m.tWaitCheck', { into }) };
}

// ---- changing how a plan runs

/** What switching a plan to `to` changes from now on, in plain words (and what happens at once). */
export function modeChange(view: PlanView, to: Autonomy): { readonly title: string; readonly from: string; readonly now?: string } {
  const branch = branchBits(view.plan).branch;
  const label = AUTONOMY_INFO[to].label;
  const from = {
    step: t('plans.m.fromStep'),
    gated: t('plans.m.fromGated'),
    autopilot: branch ? t('plans.m.fromAutopilotBranch', { branch }) : t('plans.m.fromAutopilot'),
  }[to];
  const open = view.open;
  const nowBits: string[] = [];
  if (to === 'autopilot') {
    const passing = open.filter((m) => m.state === 'gate' && (m.run.check?.verdict === 'pass' || !m.milestone.criteria.length));
    if (passing.length) nowBits.push(t('plans.m.passNow', { count: passing.length, list: and(passing.map(quoted)) }));
  }
  if (to !== 'step') {
    const ready = view.ready.filter((x) => !x.forYou).length;
    const room = Math.max(0, view.plan.maxParallel - view.active.length);
    const starts = Math.min(ready, room);
    if (starts) nowBits.push(t('plans.m.startNow', { count: starts }));
  }
  if (view.plan.body?.milestones.some((m) => m.autonomy && m.autonomy !== to)) nowBits.push(t('plans.m.ownWayToo'));
  const now = nowBits.length ? `${nowBits.join('; ')}.` : undefined;
  return { title: t('plans.m.switchTo', { label }), from, ...(now ? { now: now[0]!.toUpperCase() + now.slice(1) } : {}) };
}

// ---- what happened

export type FeedKind = 'started' | 'finished' | 'checking' | 'checked' | 'failed' | 'merged' | 'passed' | 'mode' | 'approved' | 'changed' | 'paused' | 'resumed' | 'done' | 'problem' | 'branch' | 'pr';

export interface FeedItem {
  readonly id: string;
  readonly at: number;
  readonly by: Actor;
  readonly kind: FeedKind;
  /** What happened (the newest of a run of repeats), after the actor's name. */
  readonly text: string;
  /** Repeats folded into it (1: none). */
  readonly count: number;
  /** Every text folded in, newest first. */
  readonly texts: readonly string[];
}

function feedKind(e: PlanEvent): FeedKind | undefined {
  switch (e.kind) {
    case 'started':
    case 'finished':
    case 'checked':
    case 'failed':
    case 'merged':
    case 'approved':
    case 'changed':
    case 'paused':
    case 'resumed':
    case 'done':
    case 'problem':
      return e.kind;
    case 'passed':
      return /^merged\b/.test(e.text) ? 'merged' : 'passed';
    case 'gate':
      return /^checked\b/.test(e.text) ? 'checked' : 'checking';
    case 'autonomy':
      return 'mode';
    // Where the work goes: the plan's branch made, its pull request opened (other notes stay out).
    case 'note':
      return /^(made the plan’s branch|collects the plan’s work on)\b/.test(e.text) ? 'branch' : /^opened pull request #\d+/.test(e.text) ? 'pr' : undefined;
    default:
      return undefined;
  }
}

/** Repeats this close together are one line. */
const FOLD_MS = 30 * 60 * 1000;

/**
 * What the plan did, newest first: started / finished / checked / merged / passed / the mode
 * changed (and the few other things worth seeing). A run of the same thing by the same one is one
 * line (“Beluga started 3 tasks”); the same line again and again says ×3.
 */
export function feedOf(activity: readonly PlanEvent[]): readonly FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of [...activity].reverse()) {
    const kind = feedKind(e);
    if (!kind) continue;
    const last = out.at(-1);
    const fold = last && last.kind === kind && sameBy(last.by, e.by) && last.at - e.at < FOLD_MS && (last.texts[0] === e.text || kind === 'started' || kind === 'finished');
    if (!fold) {
      out.push({ id: e.id, at: e.at, by: e.by, kind, text: e.text, count: 1, texts: [e.text] });
      continue;
    }
    const texts = [...last.texts, e.text];
    const same = texts.every((x) => x === texts[0]);
    out[out.length - 1] = { ...last, count: texts.length, texts, text: same ? last.texts[0]! : `${kind} ${count(texts.length, 'task')}: ${texts.map((x) => /\b[A-Z][A-Z0-9]*-\d+\b/.exec(x)?.[0] ?? x.replace(/^\w+\s+/, '')).reverse().join(', ')}` };
  }
  return out;
}

const sameBy = (a: Actor, b: Actor): boolean => a.kind === b.kind && (a.kind === 'person' ? a.id === (b as typeof a).id : a.kind === 'claude' ? a.owner === (b as typeof a).owner : true);

/** What a draft changes in an approved plan, per task id (for marks on the graph and outline). */
export function changeMarks(plan: Plan): ReadonlyMap<string, 'added' | 'changed'> {
  if (!plan.body || !plan.draft) return new Map();
  const d = diffBodies(plan.body, plan.draft);
  return new Map([...d.added.map((id) => [id, 'added'] as const), ...d.changed.map((id) => [id, 'changed'] as const)]);
}

export function changeWords(plan: Plan): string {
  const d = diffBodies(plan.body, plan.draft);
  const parts = [d.added.length ? t('plans.m.nNew', { n: d.added.length }) : '', d.changed.length ? t('plans.m.nChanged', { n: d.changed.length }) : '', d.removed.length ? t('plans.m.nTakenOut', { n: d.removed.length }) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('plans.m.milestonesChanged');
}

// ---- the graph's structure

export interface PlanGraphShape {
  /** Milestones as boxes (in order), each with its tasks and a gate at its end listing its criteria (they size it). */
  readonly milestones: ReadonlyArray<{ readonly id: string; readonly tasks: readonly string[]; readonly criteria: readonly string[] }>;
  /** Milestones by row: those in a row run side by side (milestoneRows). */
  readonly rows: ReadonlyArray<readonly string[]>;
  /** Lines: task → task (waits on), task → gate (finishes the milestone), gate → a milestone that waits on it. */
  readonly edges: ReadonlyArray<{ readonly id: string; readonly from: string; readonly to: string; readonly kind: 'blocks' | 'finish' | 'next' }>;
  /** Changes when (and only when) the layout must: its JSON. */
  readonly key: string;
}

export const gateId = (milestoneId: string): string => `gate:${milestoneId}`;
export const groupId = (milestoneId: string): string => `m:${milestoneId}`;
export const taskNodeId = (taskId: string): string => `t:${taskId}`;

/** The plan graph's structure from what's shown (the draft while there is one). */
export function graphShape(plan: Plan): PlanGraphShape {
  const body = shownBody(plan);
  const milestones = (body?.milestones ?? []).map((m) => ({ id: m.id, tasks: m.tasks.map((t) => t.id), criteria: m.criteria }));
  const edges: Array<PlanGraphShape['edges'][number]> = [];
  for (const m of body?.milestones ?? []) {
    const inside = new Set(m.tasks.map((t) => t.id));
    const needed = new Set(m.tasks.flatMap((t) => t.blockedBy.filter((b) => inside.has(b))));
    for (const t of m.tasks) {
      for (const b of t.blockedBy) edges.push({ id: `${b}->${t.id}`, from: taskNodeId(b), to: taskNodeId(t.id), kind: 'blocks' });
      // The last tasks of a milestone lead to its gate.
      if (!needed.has(t.id)) edges.push({ id: `${t.id}->gate`, from: taskNodeId(t.id), to: gateId(m.id), kind: 'finish' });
    }
  }
  // A milestone's gate opens the milestones that wait on it (only those: the others run alongside),
  // and only the nearest: one that waits on A and on B (which waits on A) gets its line from B alone.
  const deps = new Map((body?.milestones ?? []).map((m) => [m.id, milestoneDeps(body, m)] as const));
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
    (deps.get(from) ?? []).some((d) => d === to || (!seen.has(d) && (seen.add(d), reaches(d, to, seen))));
  for (const m of body?.milestones ?? []) {
    const mine = deps.get(m.id) ?? [];
    for (const d of mine) if (!mine.some((o) => o !== d && reaches(o, d))) edges.push({ id: `ms:${d}->${m.id}`, from: gateId(d), to: groupId(m.id), kind: 'next' });
  }
  const rows = milestoneRows(body);
  return { milestones, rows, edges, key: JSON.stringify({ milestones, rows, edges: edges.map((e) => e.id) }) };
}

/** A board task's key, if the plan's task is on the board. */
export function keyOf(board: BoardState, issueId: string | undefined): string | undefined {
  return issueId ? board.issues.find((i) => i.id === issueId)?.key : undefined;
}

export type { MilestoneView };

// ---------------------------------------------------------------- between milestones

/** A milestone's line into one that waits on it, from how it stands: passed (merged in), merging, at its gate, or not yet. */
export interface MilestoneLink {
  readonly state: 'done' | 'ready' | 'waiting';
  /** What the line says just below the gate it leaves. */
  readonly label: string;
}

/**
 * How a milestone's line reads. Passing it merges its work into the plan's branch first (by
 * itself; a conflict goes to Claude), and what waits on it unlocks only once that's in: so the line
 * says Merging, Fixing a conflict or Conflict while that runs, never a silent "Passed".
 */
export function milestoneLink(m: MilestoneView | undefined): MilestoneLink {
  if (!m) return { state: 'waiting', label: t('plans.m.unlocks') };
  if (m.state === 'merging') {
    const c = m.merging?.conflict;
    return { state: 'ready', label: c ? (c.stuck ? t('plans.conflictNeedsYou') : t('plans.m.fixingAConflict')) : t('plans.m.merging') };
  }
  if (m.state === 'passed' || m.run.passedAt) return { state: 'done', label: t('plans.m.unlocked') };
  return { state: m.state === 'gate' || m.state === 'checking' ? 'ready' : 'waiting', label: t('plans.m.unlocks') };
}

/**
 * Where the lines from several milestones meet before the one that waits on all of them: how many
 * are in, and what it says. One line in has no join (it simply leads there).
 */
export interface MilestoneJoin {
  readonly passed: number;
  readonly total: number;
  readonly state: MilestoneLink['state'];
  /** Its tooltip: which are in, which it still waits on, and the branch it starts from. */
  readonly tip: string;
}

export function milestoneJoin(parents: readonly (MilestoneView | undefined)[], branch: string | undefined): MilestoneJoin | undefined {
  if (parents.length < 2) return undefined;
  const links = parents.map(milestoneLink);
  const passed = links.filter((l) => l.state === 'done').length;
  const total = parents.length;
  const state: MilestoneLink['state'] = passed === total ? 'done' : links.some((l) => l.state === 'ready') ? 'ready' : 'waiting';
  const left = parents.filter((m, i) => m && links[i]!.state !== 'done').map((m) => `“${m!.milestone.title}”`);
  const into = branch ? t('plans.m.andMergedInto', { branch }) : '';
  const tip = passed === total ? t('plans.m.joinAllPassed', { total, into, from: branch ?? t('plans.m.theirWork') }) : t('plans.m.joinWaiting', { total, into, list: left.join(', ') });
  return { passed, total, state, tip };
}

/** What a gated milestone's lock says: what it waits on, or the branch it starts from once they're in. */
export function lockWords(waitsOn: readonly string[], dependsOn: number, branch: string | undefined): string {
  const names = and(waitsOn.map((x) => `“${x}”`));
  if (waitsOn.length) return branch ? t('plans.m.lockWaitsBranch', { count: waitsOn.length, names, branch }) : t('plans.m.lockWaits', { count: waitsOn.length, names });
  if (!branch) return t('plans.m.unlocked');
  return dependsOn === 1 ? t('plans.m.unlockedFromOne', { branch }) : t('plans.m.unlockedFromAll', { branch, n: dependsOn });
}

// ---------------------------------------------------------------- setting up

/**
 * Open milestones whose Claude Beluga is starting right now: on their way (not Step by Step, where
 * you start each task), with a task of Claude's ready and nothing of theirs begun or handed to a
 * Claude yet. Between approving and the first step this is everything there is to see, so it's
 * said, never left looking frozen.
 */
export function startingMilestones(view: Pick<PlanView, 'plan' | 'open'>): readonly MilestoneView[] {
  if (view.plan.status !== 'active' || view.plan.paused) return [];
  return view.open.filter(
    (m) =>
      m.state === 'running' &&
      m.autonomy !== 'step' &&
      !m.run.agent &&
      m.tasks.some((t) => t.state === 'ready' && !t.forYou && !t.queued) &&
      !m.tasks.some((t) => t.worktree || t.state === 'running' || t.state === 'asking' || t.state === 'idle' || t.state === 'review'),
  );
}

/** “Setting up: making the plan's branch, then starting an agent for “API” and “UI”” */
export function settingUp(view: Pick<PlanView, 'plan'>, starting: readonly MilestoneView[]): string {
  const names = starting.map((m) => `“${m.milestone.title}”`);
  const list = names.length > 2 ? `${names.slice(0, -1).join(', ')} ${t('common.and')} ${names.at(-1)}` : and(names);
  return view.plan.branch ? t('plans.m.settingUp', { list }) : t('plans.m.settingUpBranch', { list });
}

// ---- the plan's branch and pull request

/** What stands in the way of the plan's pull request, in a few words (“checks pending · needs a review”). */
export function prWords(pr: PlanPr): string {
  if (pr.state === 'MERGED') return t('plans.m.pr.merged');
  if (pr.state === 'CLOSED') return t('plans.m.pr.closed');
  const bits: string[] = [];
  if (pr.draft) bits.push(t('plans.m.pr.draft'));
  if (pr.conflicts) bits.push(t('plans.m.pr.conflicts'));
  else if (pr.mergeState === 'behind') bits.push(t('plans.m.pr.behind'));
  if (pr.checks === 'failing') bits.push(t('plans.m.pr.failing'));
  else if (pr.checks === 'pending') bits.push(t('plans.m.pr.pending'));
  else if (pr.checks === 'passing') bits.push(t('plans.m.pr.passing'));
  if (pr.review === 'CHANGES_REQUESTED') bits.push(t('plans.m.pr.changesRequested'));
  else if (pr.review === 'REVIEW_REQUIRED') bits.push(t('plans.m.pr.needsReview'));
  else if (pr.review === 'APPROVED') bits.push(t('plans.m.pr.approved'));
  if (pr.autoMerge) bits.push(t('plans.m.pr.autoMerge'));
  return bits.length ? bits.join(' · ') : t('plans.m.pr.ready');
}

/**
 * What the plan's last step is now, once every milestone passed: open its pull request, bring main
 * in (it conflicts), wait on Claude fixing that, merge it now or once its checks pass, or nothing (queued).
 */
export type ShipAction =
  | { readonly kind: 'open'; readonly again: boolean }
  | { readonly kind: 'catching_up'; readonly main: string }
  | { readonly kind: 'fixing'; readonly files: readonly string[] }
  | { readonly kind: 'stuck'; readonly files: readonly string[] }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'merge' }
  | { readonly kind: 'merged' };

export function shipAction(plan: Plan, pr: PlanPr | undefined): ShipAction {
  const main = plan.mainMerge;
  if (main?.conflict) return { kind: main.conflict.stuck ? 'stuck' : 'fixing', files: main.conflict.files };
  if (main) return { kind: 'catching_up', main: main.main };
  if (!pr || pr.state === 'CLOSED') return { kind: 'open', again: pr?.state === 'CLOSED' };
  if (pr.state === 'MERGED') return { kind: 'merged' };
  if (pr.conflicts) return { kind: 'resolve' };
  if (pr.draft) return { kind: 'draft' };
  if (pr.autoMerge) return { kind: 'queued' };
  if (pr.checks === 'pending' || pr.checks === 'failing' || pr.review === 'REVIEW_REQUIRED' || pr.review === 'CHANGES_REQUESTED' || pr.mergeState === 'blocked') return { kind: 'wait' };
  return { kind: 'merge' };
}

const fileList = (files: readonly string[]): string => files.slice(0, 2).join(', ') + (files.length > 2 ? ` ${t('plans.andMore', { count: files.length - 2 })}` : '');

function shipHeadline(plan: Plan, branch: string, pr: PlanPr | undefined): Headline {
  const a = shipAction(plan, pr);
  const n = pr ? `#${pr.number}` : t('plans.m.thePr');
  switch (a.kind) {
    case 'open':
      return a.again ? { who: 'you', text: t('plans.m.ship.closed', { n }) } : { who: 'you', text: t('plans.m.ship.open', { branch }) };
    case 'catching_up':
      return { who: 'beluga', text: t('plans.m.ship.catchingUp', { main: a.main, branch, n }) };
    case 'fixing':
      return { who: 'claude', text: t('plans.m.ship.fixing', { files: fileList(a.files) }) };
    case 'stuck':
      return { who: 'you', text: t('plans.m.ship.stuck', { files: fileList(a.files) }) };
    case 'resolve':
      return { who: 'you', text: t('plans.m.ship.resolve', { n, branch }) };
    case 'draft':
      return { who: 'you', text: t('plans.m.ship.draft', { n }) };
    case 'queued':
      return { who: 'beluga', text: t('plans.m.ship.queued', { n }) };
    case 'wait':
      return { who: 'you', text: t('plans.m.ship.wait', { n, why: prWords(pr!) }) };
    case 'merge':
      return { who: 'you', text: t('plans.m.ship.merge', { n, why: prWords(pr!) }) };
    case 'merged':
      return { who: 'beluga', text: t('plans.m.ship.merged', { n }) };
  }
}

/** One step on the way from the plan's milestones to main, for the branch view. */
export interface FlowStep {
  readonly id: string;
  readonly kind: 'main' | 'pr' | 'branch' | 'milestone';
  readonly label: string;
  readonly detail: string;
  readonly state: 'done' | 'active' | 'waiting' | 'problem' | 'later';
}

/**
 * Where the plan's work goes, from main back: main, the pull request into it, the plan's branch,
 * and each milestone merged into that branch (or merging, stopped at a conflict, couldn't, not yet).
 */
export function branchFlow(view: PlanView): readonly FlowStep[] {
  const { plan } = view;
  const branch = plan.branch;
  const pr = plan.pr;
  const steps: FlowStep[] = [];
  const shipped = plan.shipped;
  steps.push({ id: 'main', kind: 'main', label: 'main', detail: shipped ? (shipped.how === 'pr' ? t('plans.m.flow.inVia', { number: shipped.number ?? '' }) : t('plans.m.flow.inHere')) : t('plans.m.flow.goesHere'), state: shipped ? 'done' : 'waiting' });
  if (branch) {
    const ship = shipAction(plan, pr);
    const prState: FlowStep['state'] = shipped || pr?.state === 'MERGED' ? 'done' : ship.kind === 'stuck' || ship.kind === 'resolve' || pr?.state === 'CLOSED' || pr?.checks === 'failing' ? 'problem' : pr ? 'active' : 'waiting';
    const prDetail = plan.mainMerge?.conflict ? (plan.mainMerge.conflict.stuck ? t('plans.m.flow.conflictsStuck', { files: fileList(plan.mainMerge.conflict.files) }) : t('plans.m.flow.conflictsFixing', { files: fileList(plan.mainMerge.conflict.files) })) : pr ? prWords(pr) : shipped?.how === 'local' ? t('plans.m.flow.mergedHereInstead') : t('plans.m.flow.openedOnce');
    steps.push({ id: 'pr', kind: 'pr', label: pr ? t('plans.m.prIs', { number: pr.number }) : t('plans.m.pullRequest'), detail: `${branch} → main · ${prDetail}`, state: shipped?.how === 'local' ? 'done' : prState });
    steps.push({ id: 'branch', kind: 'branch', label: branch, detail: t('plans.m.flow.madeFromMain'), state: shipped ? 'done' : 'active' });
  } else if (plan.body && plan.status !== 'done') {
    const failed = [...plan.activity].reverse().find((e) => e.kind === 'problem' && /^couldn’t make the plan’s branch/.test(e.text));
    steps.push({ id: 'branch', kind: 'branch', label: t('plans.m.flow.noBranch'), detail: failed ? `${failed.text.replace(/^couldn’t make the plan’s branch /, 'couldn’t make ')}` : t('plans.m.flow.notMadeYet'), state: failed ? 'problem' : 'waiting' });
  }
  for (const m of view.milestones) {
    const c = m.merging?.conflict;
    const failed = m.run.mergeFailed;
    const state: FlowStep['state'] = m.state === 'merging' ? (c?.stuck ? 'problem' : 'active') : failed ? 'problem' : m.state === 'passed' ? 'done' : m.state === 'later' || m.state === 'draft' ? 'later' : 'waiting';
    const into = branch ?? t('plans.m.theBranch');
    const detail =
      m.state === 'merging'
        ? c
          ? t(c.stuck ? 'plans.m.flow.msConflictStuck' : 'plans.m.flow.msConflictFixing', { branch: into, what: c.key ?? c.merging, files: fileList(c.files) })
          : t('plans.m.flow.msMergingNow', { branch: into })
        : failed
          ? t('plans.m.flow.msCouldnt', { reason: failed.reason })
          : m.state === 'passed'
            ? branch
              ? t('plans.m.flow.msMergedInto', { branch })
              : t('plans.m.flow.msPassed')
            : t('plans.m.flow.msMergesWhen', { branch: branch ?? t('plans.thePlansBranch'), finished: m.finished, total: m.total });
    steps.push({ id: m.milestone.id, kind: 'milestone', label: m.milestone.title, detail, state });
  }
  return steps;
}
