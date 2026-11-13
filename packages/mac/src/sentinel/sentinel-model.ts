import {
  type Access,
  type AfterTrigger,
  type BelugaTrigger,
  type GitHubTrigger,
  type SentryTrigger,
  type StripeTrigger,
  type UptimeTrigger,
  type WebhookTrigger,
  hostOf,
  type HttpStep,
  type MergeStep,
  type RunState,
  type SentinelAsk,
  type RunSummary,
  type ScheduleEvery,
  type ScheduleHours,
  type ScheduleTrigger,
  type Sentinel,
  type SentinelState,
  type Recipe,
  type Step,
  type ClaudeStep,
  type StepDraft,
  type StepKind,
  type TriggerKind,
  type Trigger,
  ACCESS_INFO,
  CLAUDE_CHANGED,
  RUN_STATE_INFO,
  SERVICE_PRESETS,
  STEP_INFO,
  TRIGGER_INFO,
  isLive,
  pausedWords,
  lastRunOf,
  scheduleSentence,
  stepAvailable,
  stepRefusal,
  triggerAvailable,
} from '../../../../src/core/sentinel/model.js';
import { agentForChoice } from '../../../../src/ui/agent-choice.js';
import type { IconName } from '../components/Icon.js';
import { ago } from '../tasks/tasks-model.js';
import { ASSISTANT_TITLE } from '../../../../src/shared/assistant.js';
import { computerTitle, computerWord } from '../lib/os-words.js';
import { t as tx } from '../../../../src/shared/i18n/index.js';
import { formatDateWith } from '../../../../src/shared/i18n/format.js';

/**
 * Sentinel's window, its plain parts (docs/sentinel.md §3): the list's rows and groups, the
 * sidebar's line, the foot, times and durations in words, the schedule's controls, the Ask Claude
 * presets and the step edits. Pure (tests/mac-sentinel.test.ts).
 */

/** The list's project switch: every sentinel, Your Mac's (no project), or one project's. */
export const MAC_SCOPE = 'mac';
export type Show = 'watching' | 'paused' | 'all';

/** What a later update brings (shown on the disabled choices). */
export const LATER = 'Comes with a later update';
/** The same, in the app's language (LATER stays the English, for the tests). */
export const later = (): string => tx('sentinel.model.later');

// ---------------------------------------------------------------- icons

const SENTINEL_ICONS: ReadonlySet<string> = new Set(['calendar', 'check', 'refresh', 'tag', 'issue', 'wrench', 'globe', 'eye', 'bell', 'terminal', 'flag', 'pr', 'coin', 'pulse', 'task', 'claude', 'clock', 'hand', 'sentinel', 'laptop', 'search', 'chartLine', 'merge', 'link', 'alert', 'people', 'play', 'gauge', 'graph']);

/** A sentinel's (or a recipe's) icon: the name it carries when the window has it, else the shield. */
export const iconOf = (name: string | undefined): IconName => (name && SENTINEL_ICONS.has(name) ? (name as IconName) : 'sentinel');

export const TRIGGER_ICON: Readonly<Record<TriggerKind, IconName>> = {
  schedule: 'clock',
  manual: 'hand',
  after: 'refresh',
  beluga: 'claude',
  github: 'pr',
  stripe: 'coin',
  uptime: 'pulse',
  sentry: 'alert',
  webhook: 'link',
};

export const STEP_ICON: Readonly<Record<StepKind, IconName>> = {
  claude: 'claude',
  script: 'terminal',
  notify: 'bell',
  http: 'globe',
  pr: 'pr',
  merge: 'merge',
  message: 'chat',
  friend: 'people',
  trigger: 'play',
  measure: 'gauge',
};

// ---------------------------------------------------------------- times

const pad = (n: number): string => String(n).padStart(2, '0');

/** "7:00" (the Mac's local time, 24 hours, as the schedule's sentence says it). */
export const clockOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
};

const DAY = 86_400_000;
const startOf = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** When a run was: "Today 7:00", "Yesterday 7:00", "Fri 2:00", "Oct 3 2:00". */
export function whenText(ts: number, now: number): string {
  const days = Math.round((startOf(now) - startOf(ts)) / DAY);
  const at = clockOf(ts);
  if (days === 0) return tx('sentinel.model.todayAt', { at });
  if (days === 1) return tx('sentinel.model.yesterdayAt', { at });
  if (days > 1 && days < 7) return `${formatDateWith(ts, { weekday: 'short' })} ${at}`;
  return `${formatDateWith(ts, { month: 'short', day: 'numeric' })} ${at}`;
}

/** When it runs next, short: "7:00" today, "Tue 7:00" this week, "Nov 3" later. */
export function nextText(ts: number, now: number): string {
  const days = Math.round((startOf(ts) - startOf(now)) / DAY);
  if (days <= 0) return clockOf(ts);
  if (days === 1) return tx('sentinel.model.tomorrowAt', { at: clockOf(ts) });
  if (days < 7) return `${formatDateWith(ts, { weekday: 'short' })} ${clockOf(ts)}`;
  return formatDateWith(ts, { month: 'short', day: 'numeric' });
}

/** How long something took: "48 s", "2.1 s", "4 min 12 s", "1 h 3 min". */
export function durationText(ms: number): string {
  if (ms < 0) return '';
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toString()} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** A run's length: from its start to its end, or to now while it goes. */
export const runDuration = (run: Pick<RunSummary, 'startedAt' | 'endedAt'>, now: number): number => (run.endedAt ?? now) - run.startedAt;

// ---------------------------------------------------------------- the list

export interface Counts {
  readonly watching: number;
  readonly paused: number;
  readonly all: number;
}

export const countsOf = (items: readonly Sentinel[]): Counts => {
  const paused = items.filter((s) => s.paused).length;
  return { watching: items.length - paused, paused, all: items.length };
};

/** In the project switch's scope: every one, Your Mac's, or one project's. */
export const inScope = (s: Pick<Sentinel, 'projectId'>, scope: string | undefined): boolean => (!scope ? true : scope === MAC_SCOPE ? !s.projectId : s.projectId === scope);

/** The list's sentinels: in the scope, watching or paused, matching the filter (name, trigger, steps). */
export function filterSentinels(items: readonly Sentinel[], opts: { readonly scope?: string; readonly show: Show; readonly query?: string }): Sentinel[] {
  const q = opts.query?.trim().toLowerCase();
  return items.filter((s) => {
    if (!inScope(s, opts.scope)) return false;
    if (opts.show === 'watching' && s.paused) return false;
    if (opts.show === 'paused' && !s.paused) return false;
    if (!q) return true;
    const words = [s.name, scheduleSentence(s.trigger), ...s.steps.map((st) => `${st.name} ${STEP_INFO[st.kind].label}`)].join(' ').toLowerCase();
    return words.includes(q);
  });
}

export interface Group {
  /** The project's id (none: Your Mac). */
  readonly projectId?: string;
  readonly name: string;
  readonly items: readonly Sentinel[];
}

/** Rows grouped by project, in the sidebar's order of projects, Your Mac last; names A to Z inside. */
export function groupSentinels(items: readonly Sentinel[], projects: ReadonlyArray<{ readonly id: string; readonly name: string }>): Group[] {
  const byName = (a: Sentinel, b: Sentinel): number => a.name.localeCompare(b.name);
  const out: Group[] = [];
  for (const p of projects) {
    const mine = items.filter((s) => s.projectId === p.id);
    if (mine.length) out.push({ projectId: p.id, name: p.name, items: [...mine].sort(byName) });
  }
  const known = new Set(projects.map((p) => p.id));
  const mac = items.filter((s) => !s.projectId || !known.has(s.projectId));
  if (mac.length) out.push({ name: ASSISTANT_TITLE, items: [...mac].sort(byName) });
  return out;
}

export interface Row {
  readonly sentence: string;
  /** Why its trigger can't watch now (the alert mark's tooltip). */
  readonly trouble?: string;
  readonly last?: { readonly state: RunState; readonly label: string; readonly tone: (typeof RUN_STATE_INFO)[RunState]['tone']; readonly headline: string; readonly when: string; readonly id: string };
  /** "next 7:00" (watching schedules only). */
  readonly next?: string;
  readonly live: boolean;
  readonly steps: ReadonlyArray<{ readonly kind: StepKind; readonly name: string }>;
}

const nameOfIn =
  (state: Pick<SentinelState, 'items'>) =>
  (id: string): string | undefined =>
    state.items.find((i) => i.id === id)?.name;

/** One sentinel's row: its sentence, its last run (pill and headline), when it runs next. */
export function rowOf(state: SentinelState, s: Sentinel, now: number): Row {
  const last = lastRunOf(state, s.id);
  const next = state.nextAt[s.id];
  const info = last ? RUN_STATE_INFO[last.state] : undefined;
  const trouble = troubleOf(state, s);
  return {
    sentence: scheduleSentence(s.trigger, nameOfIn(state)),
    ...(trouble ? { trouble } : {}),
    ...(last && info ? { last: { id: last.id, state: last.state, label: info.label, tone: info.tone, headline: headlineOf(last), when: ago(last.startedAt, now) } } : {}),
    ...(next !== undefined && !s.paused ? { next: tx('sentinel.model.next', { when: nextText(next, now) }) } : {}),
    live: Boolean(last && isLive(last.state) && last.state !== 'needs-you'),
    steps: s.steps.map((st) => ({ kind: st.kind, name: st.name })),
  };
}

/**
 * Why a sentinel's trigger can't watch now, in words with what to do: its own trouble (no gh, no
 * Stripe key, no token), or for a webhook that's on, the tunnel's (it didn't open). A paused one has none.
 */
export function troubleOf(state: Pick<SentinelState, 'troubles' | 'webhook'>, s: Pick<Sentinel, 'id' | 'paused' | 'trigger'>): string | undefined {
  if (s.paused) return undefined;
  const own = state.troubles?.[s.id];
  if (own) return own;
  if (s.trigger.kind === 'webhook' && state.webhook && !state.webhook.ready && state.webhook.why) return state.webhook.why;
  return undefined;
}

/** A run's one line: its headline, else what it's doing. */
export function headlineOf(run: Pick<RunSummary, 'headline' | 'state' | 'why'>): string {
  if (run.headline) return run.headline;
  if (run.state === 'running') return tx('sentinel.model.running');
  if (run.state === 'queued') return tx('sentinel.model.queued');
  return run.why ?? RUN_STATE_INFO[run.state].label;
}

/** The sidebar row's line, and whether it's a problem (paused after failures; Claude's change isn't one). */
/** Why a sentinel stopped on its own (failures in a row, a limit hit), in words; undefined while it's on, paused by hand, or paused because your agent changed it. */
export const brokenWords = (s: Sentinel): string | undefined => (s.paused && s.pausedWhy && s.pausedWhy !== CLAUDE_CHANGED ? (pausedWords(s) ?? tx('sentinel.model.pausedAfterFailures')) : undefined);

export function sidebarLine(state: SentinelState): { readonly text: string; readonly problem: boolean } {
  const broken = state.items.map(brokenWords).find((w) => w !== undefined);
  if (broken) return { text: broken, problem: true };
  const watching = state.items.filter((s) => !s.paused);
  if (!state.items.length) return { text: tx('sentinel.model.nothingYet'), problem: false };
  if (!watching.length) return { text: tx('sentinel.model.nothingPaused', { count: state.items.length }), problem: false };
  const soonest = watching.map((s) => state.nextAt[s.id]).filter((n): n is number => n !== undefined).sort((a, b) => a - b)[0];
  return { text: soonest !== undefined ? tx('sentinel.model.watchingNext', { count: watching.length, at: clockOf(soonest) }) : tx('sentinel.model.watching', { count: watching.length }), problem: false };
}

/** Whether any run is going now (the sidebar's live dot). */
export const anyRunning = (state: SentinelState): boolean => Object.values(state.live).some((l) => l.state === 'running' || l.state === 'queued');

/** The list's foot: "3 watching · 1 paused · last run 2 min ago". */
export function footLine(items: readonly Sentinel[], runs: readonly RunSummary[], now: number): string {
  const c = countsOf(items);
  const ids = new Set(items.map((s) => s.id));
  const last = runs.filter((r) => ids.has(r.sentinelId)).reduce<number | undefined>((at, r) => (at === undefined || r.startedAt > at ? r.startedAt : at), undefined);
  return [tx('sentinel.model.watching', { count: c.watching }), ...(c.paused ? [tx('sentinel.model.paused', { count: c.paused })] : []), ...(last !== undefined ? [tx('sentinel.model.lastRun', { ago: ago(last, now) })] : [])].join(' · ');
}

// ---------------------------------------------------------------- runs

/** Who or what started a run, in words: "schedule", "you", "your phone", "after Nightly tests". */
export function byWords(run: Pick<RunSummary, 'by' | 'trigger'>, state: Pick<SentinelState, 'items' | 'runs'>): string {
  switch (run.by) {
    case 'schedule':
      return tx('sentinel.model.bySchedule');
    case 'you':
      return tx('sentinel.model.byYou');
    case 'phone':
      return tx('sentinel.model.byPhone');
    case 'claude':
      return tx('sentinel.model.byAgent');
    case 'event':
      return run.trigger.summary || tx('sentinel.model.byEvent');
    default: {
      const before = state.runs.find((r) => r.id === run.by.slice('after:'.length));
      const name = before ? state.items.find((s) => s.id === before.sentinelId)?.name : undefined;
      return name ? tx('sentinel.model.byAfter', { name }) : tx('sentinel.model.byAfterAnother');
    }
  }
}

/** Under a run's title: "Nightly tests · ran by schedule · Fri 2:00 · 4 min 12 s". */
export function runLine(run: RunSummary, name: string | undefined, state: Pick<SentinelState, 'items' | 'runs'>, now: number): string {
  const took = run.endedAt !== undefined ? durationText(run.endedAt - run.startedAt) : tx('sentinel.model.soFar', { took: durationText(now - run.startedAt) });
  return [name ?? tx('sentinel.model.aSentinel'), tx('sentinel.model.ranBy', { by: byWords(run, state) }), whenText(run.startedAt, now), took].join(' · ');
}

/** The history's dot strip: up to the last 30 runs, oldest first, each with its tone. */
export function dotStrip(runs: readonly RunSummary[], keep = 30): Array<{ readonly id: string; readonly state: RunState; readonly tone: (typeof RUN_STATE_INFO)[RunState]['tone']; readonly label: string }> {
  return [...runs]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-keep)
    .map((r) => ({ id: r.id, state: r.state, tone: RUN_STATE_INFO[r.state].tone, label: `${RUN_STATE_INFO[r.state].label} · ${headlineOf(r)}` }));
}

/** Where a run's chat opens: a worktree's or a project chat's conversation, or one of Your Mac's chats. */
export type ChatPlace = { readonly kind: 'workspace'; readonly id: string } | { readonly kind: 'assistant'; readonly chat?: string };

export function chatPlaceOf(channel: string | undefined): ChatPlace | undefined {
  if (!channel) return undefined;
  if (channel.startsWith('ws:')) return { kind: 'workspace', id: channel.slice(3) };
  if (channel === 'mac:assistant') return { kind: 'assistant' };
  if (channel.startsWith('mac:assistant:')) return { kind: 'assistant', chat: channel.slice('mac:assistant:'.length) };
  return undefined;
}

/** A runs folder from a report's path (…/sentinel/runs/<runId>/report.md), for Open the Runs Folder. */
export function runsFolderOf(runs: ReadonlyArray<Pick<RunSummary, 'report'>>): string | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    const m = /^(.*\/sentinel\/runs)\/[^/]+\/report\.md$/.exec(runs[i]!.report ?? '');
    if (m) return m[1];
  }
  return undefined;
}

// ---------------------------------------------------------------- the When card

// Labels are getters: said in the app's language when drawn, not when this loads.
export const EVERY_CHOICES: ReadonlyArray<{ readonly value: ScheduleEvery; readonly label: string }> = [
  {
    value: 'day',
    get label() {
      return tx('sentinel.model.everyDay');
    },
  },
  {
    value: 'other-day',
    get label() {
      return tx('sentinel.model.everyOtherDay');
    },
  },
  {
    value: 'week',
    get label() {
      return tx('sentinel.model.everyWeek');
    },
  },
  {
    value: 'month',
    get label() {
      return tx('sentinel.model.everyMonth');
    },
  },
  {
    value: 'hours',
    get label() {
      return tx('sentinel.model.everyFewHours');
    },
  },
];

export const DEFAULT_SCHEDULE: ScheduleTrigger = { kind: 'schedule', every: 'day', at: '07:00', missed: 'catch-up' };

/** Another "every": the fields that kind needs, the rest kept where they make sense. */
export function withEvery(t: ScheduleTrigger, every: ScheduleEvery): ScheduleTrigger {
  const base = { kind: 'schedule' as const, every, at: t.at, missed: t.missed };
  if (every === 'week') return { ...base, days: t.days?.length ? t.days : [1] };
  if (every === 'month') return { ...base, day: t.day ?? 1 };
  if (every === 'hours') return { ...base, hours: t.hours ?? 3 };
  return base;
}

/** A weekday chip pressed: on or off (one stays on). Monday first, as the chips show them. */
export function toggleDay(days: readonly number[] | undefined, day: number): number[] {
  const now = new Set(days?.length ? days : [1]);
  if (now.has(day)) {
    if (now.size > 1) now.delete(day);
  } else now.add(day);
  return [...now].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

/** The chips' order: Monday … Sunday. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export const HOURS_CHOICES: readonly ScheduleHours[] = [1, 2, 3, 6, 12];

/** "What starts it": a schedule, by hand, after another sentinel, or an event (each kind this Beluga runs). */
export function triggerChoices(): Array<{ readonly value: TriggerKind; readonly label: string; readonly disabled: boolean; readonly description?: string }> {
  return (Object.keys(TRIGGER_INFO) as TriggerKind[]).map((k) => ({ value: k, label: k === 'schedule' ? tx('sentinel.model.onSchedule') : TRIGGER_INFO[k].label, disabled: !triggerAvailable(k), ...(triggerAvailable(k) ? { description: tx(TRIGGER_HINT[k]) } : { description: later() }) }));
}

/** The menu's one line under each kind. */
const TRIGGER_HINT = {
  schedule: 'sentinel.model.hint.schedule',
  manual: 'sentinel.model.hint.manual',
  after: 'sentinel.model.hint.after',
  beluga: 'sentinel.model.hint.beluga',
  github: 'sentinel.model.hint.github',
  stripe: 'sentinel.model.hint.stripe',
  uptime: 'sentinel.model.hint.uptime',
  sentry: 'sentinel.model.hint.sentry',
  webhook: 'sentinel.model.hint.webhook',
} as const satisfies Readonly<Record<TriggerKind, string>>;

/** A trigger of another kind, with what it needs filled in (an uptime starts on the project's site when it has one). */
export function triggerOfKind(kind: TriggerKind, was: Trigger): Trigger | undefined {
  if (kind === was.kind) return was;
  switch (kind) {
    case 'schedule':
      return DEFAULT_SCHEDULE;
    case 'manual':
      return { kind: 'manual' };
    case 'after':
      return { kind: 'after', sentinelId: '', on: 'failure' };
    case 'beluga':
      return { kind: 'beluga', what: 'task-done' };
    case 'github':
      return { kind: 'github', what: 'workflow-failed', minutes: 2 };
    case 'stripe':
      return { kind: 'stripe', what: 'payment-failed' };
    case 'uptime':
      return { kind: 'uptime', url: 'https://example.com', minutes: 5 };
    case 'sentry':
      return { kind: 'sentry', org: '', project: '', what: 'new-issue' };
    case 'webhook':
      return { kind: 'webhook' };
  }
}

/** An event's card: its name, one line, its icon. */
export interface EventCard<W extends string = string> {
  readonly value: W;
  readonly label: string;
  readonly line: string;
  readonly icon: IconName;
}

/** An event card whose words are said in the app's language when drawn (`sentinel.model.<group>.<value>` and `….line`). */
const card = <W extends string>(group: string, value: W, icon: IconName): EventCard<W> => ({
  value,
  icon,
  get label() {
    return tx(`sentinel.model.${group}.${value}` as Parameters<typeof tx>[0]);
  },
  get line() {
    return tx(`sentinel.model.${group}.${value}.line` as Parameters<typeof tx>[0]);
  },
});

export const BELUGA_CARDS: ReadonlyArray<EventCard<BelugaTrigger['what']>> = [
  card('beluga', 'task-done', 'task'),
  card('beluga', 'pr-opened', 'pr'),
  card('beluga', 'pr-merged', 'merge'),
  card('beluga', 'milestone-passed', 'flag'),
  card('beluga', 'claude-finished', 'claude'),
  card('beluga', 'friend-asks', 'people'),
];

export const GITHUB_CARDS: ReadonlyArray<EventCard<GitHubTrigger['what']>> = [
  card('github', 'workflow-failed', 'alert'),
  card('github', 'issue-opened', 'issue'),
  card('github', 'issue-labelled', 'tag'),
  card('github', 'pr-opened', 'pr'),
  card('github', 'deployment-failed', 'globe'),
];

export const STRIPE_CARDS: ReadonlyArray<EventCard<StripeTrigger['what']>> = [
  card('stripe', 'payment-failed', 'alert'),
  card('stripe', 'subscription-started', 'play'),
  card('stripe', 'subscription-ended', 'stop'),
  card('stripe', 'dispute-opened', 'flag'),
  card('stripe', 'refund', 'refresh'),
];

export const SENTRY_CARDS: ReadonlyArray<EventCard<SentryTrigger['what']>> = [
  card('sentry', 'new-issue', 'spark'),
  card('sentry', 'regression', 'refresh'),
  card('sentry', 'spike', 'chartLine'),
];

/** The cards each event kind shows (uptime and webhook have fields, not choices). */
export function eventCards(kind: TriggerKind): ReadonlyArray<EventCard> | undefined {
  switch (kind) {
    case 'beluga':
      return BELUGA_CARDS;
    case 'github':
      return GITHUB_CARDS;
    case 'stripe':
      return STRIPE_CARDS;
    case 'sentry':
      return SENTRY_CARDS;
    default:
      return undefined;
  }
}

export const GITHUB_MINUTES: readonly number[] = [1, 2, 5, 15, 30, 60];
export const UPTIME_MINUTES: ReadonlyArray<UptimeTrigger['minutes']> = [1, 5, 15];
export const SIGNATURES: ReadonlyArray<{ readonly value: 'none' | NonNullable<WebhookTrigger['signature']>; readonly label: string; readonly description: string }> = [
  {
    value: 'none',
    get label() {
      return tx('sentinel.model.sigNone');
    },
    get description() {
      return tx('sentinel.model.sigNoneLine');
    },
  },
  {
    value: 'github',
    label: 'GitHub',
    get description() {
      return tx('sentinel.model.sigGithubLine');
    },
  },
  {
    value: 'stripe',
    label: 'Stripe',
    get description() {
      return tx('sentinel.model.sigStripeLine');
    },
  },
];

const every = (minutes: number): string => tx('sentinel.model.everyMinutes', { count: minutes });

/** One sentence of what will happen, under the event's fields. `where`: the project's name and GitHub repository, when known. */
export function eventSentence(t: Trigger, where: { readonly project?: string; readonly repo?: string } = {}): string | undefined {
  const anyProject = tx('sentinel.model.inAnyProject');
  const project = where.project ? tx('sentinel.model.inProject', { project: where.project }) : anyProject;
  switch (t.kind) {
    case 'beluga': {
      const p = t.projectId ? project : anyProject;
      const what = BELUGA_CARDS.find((c) => c.value === t.what)?.label.toLowerCase() ?? t.what;
      return tx('sentinel.model.ev.beluga', { what, where: p });
    }
    case 'github': {
      const repo = where.repo ?? tx('sentinel.model.ev.theRepo');
      const what =
        t.what === 'workflow-failed'
          ? tx('sentinel.model.ev.workflowFailed')
          : t.what === 'issue-labelled'
            ? t.label
              ? tx('sentinel.model.ev.issueLabel', { label: t.label })
              : tx('sentinel.model.ev.issueAnyLabel')
            : t.what === 'deployment-failed'
              ? tx('sentinel.model.ev.deploymentFailed')
              : t.what === 'issue-opened'
                ? tx('sentinel.model.ev.issueOpened')
                : tx('sentinel.model.ev.prOpened');
      return tx('sentinel.model.ev.github', { repo, every: every(t.minutes ?? 2), what });
    }
    case 'stripe':
      return tx('sentinel.model.ev.stripe');
    case 'uptime':
      return tx('sentinel.model.ev.uptime', { host: hostOf(t.url) || tx('sentinel.model.ev.theAddress'), every: every(t.minutes), expect: t.expect ?? 200 });
    case 'sentry':
      return t.org && t.project
        ? tx('sentinel.model.ev.sentry', { place: `${t.org}/${t.project}`, what: t.what === 'spike' ? tx('sentinel.model.ev.sentrySpike') : t.what === 'regression' ? tx('sentinel.model.ev.sentryRegression') : tx('sentinel.model.ev.sentryNew') })
        : tx('sentinel.model.ev.sentryWhich');
    case 'webhook':
      return t.signature === 'github' ? tx('sentinel.model.ev.webhookGithub') : t.signature === 'stripe' ? tx('sentinel.model.ev.webhookStripe') : tx('sentinel.model.ev.webhook');
    default:
      return undefined;
  }
}

/** A whole http(s) address (a host, a port, a path: http://localhost:3000/health is one). */
export function looksLikeUrl(v: string): boolean {
  const text = v.trim();
  if (!text || /\s/.test(text)) return false;
  try {
    const u = new URL(text);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** The address the tunnel changes: quick tunnels get a new name when Beluga restarts. */
export const webhookMoves = (): string => tx('sentinel.model.webhookMoves');

const afterOn = (value: AfterTrigger['on'], key: string): { readonly value: AfterTrigger['on']; readonly label: string; readonly description: string } => ({
  value,
  get label() {
    return tx(`sentinel.model.after.${key}` as Parameters<typeof tx>[0]);
  },
  get description() {
    return tx(`sentinel.model.after.${key}.line` as Parameters<typeof tx>[0]);
  },
});

export const AFTER_ON: ReadonlyArray<{ readonly value: AfterTrigger['on']; readonly label: string; readonly description: string }> = [afterOn('failure', 'failure'), afterOn('success', 'success'), afterOn('always', 'always')];

/** The sentinels an "after" (or Run another sentinel) may name: every other one, A to Z. */
export const otherSentinels = (items: readonly Sentinel[], self: string): Array<{ readonly value: string; readonly label: string; readonly description?: string }> =>
  items
    .filter((i) => i.id !== self)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ value: i.id, label: i.name, ...(i.paused ? { description: tx('sentinel.model.pausedOther') } : {}) }));

// ---------------------------------------------------------------- the Steps card

/** Ask Claude presets (docs/sentinel.md §1): a good prompt to start from, editable. */
export const CLAUDE_PRESETS: ReadonlyArray<{ readonly id: string; readonly label: string; readonly prompt: string }> = [
  {
    id: 'brief',
    get label() {
      return tx('sentinel.model.preset.brief');
    },
    prompt: [
      'Write a brief for {{project}} ({{date}}) of what changed since the last run: commits on the default branch (`git log --since="24 hours ago"`), pull requests opened, merged or waiting for review (`gh pr list`), new issues (`gh issue list`), the latest CI runs (`gh run list --limit 10`), and these open tasks:',
      '{{tasks}}',
      '',
      'Start with what needs me first, then what moved, then what is next. Short bullets. If nothing changed, say so in one line and stop.',
    ].join('\n'),
  },
  {
    id: 'tasks',
    get label() {
      return tx('sentinel.model.preset.tasks');
    },
    prompt: [
      'Here is what came in:',
      '{{previous}}',
      '',
      'Make a task with task_create for each real thing worth doing on {{project}}: a short title in your own words, what done means, a priority. One task per thing; skip noise and anything already open:',
      '{{tasks}}',
      '',
      'If there is nothing worth a task, say so and stop.',
    ].join('\n'),
  },
  {
    id: 'fix',
    get label() {
      return tx('sentinel.model.preset.fix');
    },
    prompt: [
      'Something needs looking at:',
      '{{trigger}}',
      '{{previous}}',
      '',
      'Find out why it happens and reproduce it. Fix it with the smallest change that is clearly right, add or update a test that shows it, and run the tests. Commit the fix with a message that says what broke. If you can’t reproduce it, say what you tried and stop.',
    ].join('\n'),
  },
  {
    id: 'review',
    get label() {
      return tx('sentinel.model.preset.review');
    },
    prompt: [
      'Review what changed in {{project}} since the last run (`git log --since="24 hours ago" -p`, and open pull requests with `gh pr diff`).',
      '',
      'Look for bugs, missing tests and anything risky; say what to fix, file by file, most important first. Praise nothing; skip style nits. If there is nothing new, say so and stop.',
    ].join('\n'),
  },
  {
    id: 'deps',
    get label() {
      return tx('sentinel.model.preset.deps');
    },
    prompt: [
      'Update this project’s dependencies within the ranges its manifest allows, with its own package manager and lockfile.',
      'Run the tests and the type check. If something breaks, fix it when the fix is small and clear; otherwise put that dependency back and say why.',
      'Commit what works with a message listing what moved. If everything is current, say so and stop.',
    ].join('\n'),
  },
  {
    id: 'notes',
    get label() {
      return tx('sentinel.model.preset.notes');
    },
    prompt: [
      'Write release notes for {{project}} up to {{date}} from the pull requests merged and the tasks done since the last release.',
      'Group them as New, Better and Fixed, one line each in plain words a user understands, in the voice of the project’s README and earlier notes. Leave out internal chores. If nothing shipped, say so in one line.',
    ].join('\n'),
  },
];

/** The one line under a text field: what it can say. */
export const templateHelp = (): string => tx('sentinel.model.templateHelp');

export interface StepChoice {
  readonly kind: StepKind;
  readonly label: string;
  readonly hint: string;
  readonly disabled: boolean;
}

/** Add a step: the ten kinds, each with why it can't be added when it can't (a later update, or the access). */
export function stepChoices(access: Access): StepChoice[] {
  return (Object.keys(STEP_INFO) as StepKind[]).map((kind) => {
    const info = STEP_INFO[kind];
    const later = !stepAvailable(kind);
    const refused = later ? undefined : stepRefusal(access, kind);
    return { kind, label: info.label, hint: later ? tx('sentinel.model.later') : (refused ?? info.hint), disabled: later || Boolean(refused) };
  });
}

/** A new step of a kind this Beluga runs, with what it needs filled in. */
export function newStep(kind: StepKind): StepDraft {
  switch (kind) {
    case 'claude':
      return { kind: 'claude', name: tx('sentinel.model.new.claude'), prompt: '', where: 'project' };
    case 'script':
      return { kind: 'script', name: tx('sentinel.model.new.script'), command: '', cwd: 'project', timeoutSec: 120 };
    case 'notify':
      return { kind: 'notify', name: tx('sentinel.model.new.notify'), phone: false };
    case 'http':
      return { kind: 'http', name: tx('sentinel.model.new.http'), method: 'GET', url: 'https://', headers: {}, timeoutSec: 30, preset: 'url' };
    case 'pr':
      return { kind: 'pr', name: tx('sentinel.model.new.pr') };
    case 'merge':
      return { kind: 'merge', name: tx('sentinel.model.new.merge'), require: { checks: true, approval: true }, method: 'squash' };
    case 'message':
      return { kind: 'message', name: tx('sentinel.model.new.message'), to: '', text: '{{sentinel}}: {{previous}}' };
    case 'friend':
      return { kind: 'friend', name: tx('sentinel.model.new.friend'), peerId: '', prompt: '' };
    case 'trigger':
      return { kind: 'trigger', name: tx('sentinel.model.new.trigger'), sentinelId: '' };
    case 'measure':
      return { kind: 'measure', name: tx('sentinel.model.new.measure'), from: 'previous', metrics: [] };
  }
}

// ---------------------------------------------------------------- phase 2's step fields

export const SERVICE_CHOICES = (Object.keys(SERVICE_PRESETS) as Array<keyof typeof SERVICE_PRESETS>).map((k) => ({ value: k, label: SERVICE_PRESETS[k].label, description: SERVICE_PRESETS[k].line }));

export const HTTP_METHODS: ReadonlyArray<HttpStep['method']> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** The one line under a service's fields: where secrets go, and that headers stay out of reports. */
export const secretsNote = (): string => tx('sentinel.model.secretsNote');

/** Headers as rows to edit (one empty row to add to, at the end). */
export function headerRows(headers: Readonly<Record<string, string>>): Array<{ readonly key: string; readonly value: string }> {
  return [...Object.entries(headers).map(([key, value]) => ({ key, value })), { key: '', value: '' }];
}

/** Rows back to headers: empty names left out, the last one with a name wins. */
export function rowsToHeaders(rows: ReadonlyArray<{ readonly key: string; readonly value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value;
  return out;
}

/** Where a Message step can write: your friends and the groups you're in. */
export function chatChoices(network: { readonly friends: ReadonlyArray<{ readonly peerId: string; readonly name: string }>; readonly groups: ReadonlyArray<{ readonly id: string; readonly name: string; readonly active: boolean }> }): Array<{ readonly value: string; readonly label: string; readonly description: string }> {
  return [
    ...[...network.friends].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ value: `dm:${f.peerId}`, label: f.name, description: tx('sentinel.model.dm') })),
    ...network.groups.filter((g) => g.active).sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ value: `group:${g.id}`, label: g.name, description: tx('sentinel.model.group') })),
  ];
}

/** The merge step in words: who decides. */
export const mergeWords = (step: Pick<MergeStep, 'require'>): string =>
  step.require.approval ? tx('sentinel.model.mergeAsks') : tx('sentinel.model.mergeAlone');

/** The access sentence, as the picker shows it (Ship says when a merge goes by itself). */
export function accessSentence(access: Access, steps: readonly Step[]): string {
  if (access === 'ship' && steps.some((st) => st.kind === 'merge' && !st.require.approval)) return tx('sentinel.model.shipAlone');
  return ACCESS_INFO[access].sentence;
}

// ---------------------------------------------------------------- New Sentinel

/** A recipe's row in New Sentinel: when it runs, in the sentence its page will show. */
export const recipeWhen = (r: Recipe): string => (r.sentinel.trigger ? scheduleSentence(r.sentinel.trigger) : TRIGGER_INFO.manual.label);

// ---------------------------------------------------------------- Claude changing it (the page's box)

/** Describe it: a name to start with, from the words (Claude names it properly). */
export function describedName(text: string): string {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(every|each)\s+(other\s+)?(weekday|week|day|morning|evening|night|hour)s?(\s+(morning|evening|night))?,?\s*/i, '')
    .replace(/^(at|by|on)\s+[\w:]+(\s*(am|pm))?\s*,?\s*/i, '')
    .replace(/^(please|can you|i want( you)? to|make (it|a sentinel) (that|to))\s+/i, '')
    .split(/[,.;:!?]/)[0]!
    .split(' ')
    .slice(0, 5)
    .join(' ')
    .replace(/(\s+(and|or|the|a|an|to|of|with|for))+$/i, '');
  return words ? (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80) : tx('sentinel.model.newSentinel');
}

export interface AskLine {
  readonly who: 'claude' | 'done' | 'failed';
  readonly text: string;
}

/** The box's line: what Claude is doing now (its conversation's last line), its answer, or what went wrong. */
export function askLine(ask: SentinelAsk | undefined, live: { readonly running: boolean; readonly last?: string } | undefined): AskLine | undefined {
  if (!ask) return undefined;
  if (ask.state === 'writing') {
    const last = live?.running && live.last && live.last !== ask.text ? live.last : undefined;
    return { who: 'claude', text: last ? tx('sentinel.model.writingDoing', { doing: toolWords(last) }) : tx('sentinel.model.writing') };
  }
  if (ask.state === 'failed') return { who: 'failed', text: ask.answer ? tx('sentinel.model.stoppedWhy', { why: ask.answer }) : tx('sentinel.model.stopped') };
  return { who: 'done', text: ask.answer || tx('common.done') };
}

/** Claude's words with each `sentinel:<id>` it names said by name (“Open pull requests”), as a one-line status shows them. */
export function namedLine(text: string, nameOf: (id: string) => string | undefined): string {
  return text.replace(/`sentinel:([\w-]+)`/g, (m, id: string) => {
    const name = nameOf(id);
    return name ? `“${name}”` : m;
  });
}

/** A tool step in plain words ("mcp__beluga_sentinel__sentinel_update" → "changing the sentinel"). */
function toolWords(line: string): string {
  if (/sentinel_update/.test(line)) return tx('sentinel.model.changing');
  if (/sentinel_get|sentinel_list/.test(line)) return tx('sentinel.model.reading');
  return line.replace(/^mcp__\w+__/, '').slice(0, 120);
}

/** Steps moved: `at` goes `by` places (kept in the list). */
export function moveStep<T>(steps: readonly T[], at: number, by: number): T[] {
  const to = at + by;
  if (at < 0 || at >= steps.length || to < 0 || to >= steps.length) return [...steps];
  const out = [...steps];
  const [s] = out.splice(at, 1);
  out.splice(to, 0, s!);
  return out;
}

/** A step copied right after itself (a new id from the daemon, "copy" on its name). */
export function duplicateStep(steps: readonly Step[], at: number): StepDraft[] {
  const s = steps[at];
  if (!s) return [...steps];
  const { id: _id, ...rest } = s;
  const copy = { ...rest, name: tx('sentinel.model.copyName', { name: s.name }).slice(0, 80) } as StepDraft;
  return [...steps.slice(0, at + 1), copy, ...steps.slice(at + 1)];
}

/** One step changed (its fields merged). */
export const patchStep = (steps: readonly Step[], id: string, patch: Partial<Step>): Step[] => steps.map((s) => (s.id === id ? ({ ...s, ...patch } as Step) : s));

// ---------------------------------------------------------------- properties

export const PER_DAY_CHOICES: readonly number[] = [0, 1, 2, 3, 4, 6, 12, 24];
export const PAUSE_AFTER_CHOICES: readonly number[] = [0, 1, 2, 3, 5, 10];

export const perDayLabel = (n: number | undefined): string => (!n ? tx('sentinel.model.noLimit') : tx('sentinel.model.perDay', { count: n }));
export const pauseAfterLabel = (n: number): string => (n === 0 ? tx('sentinel.model.never') : tx('sentinel.model.failures', { count: n }));

export const NOTIFY_LABEL: Readonly<Record<Sentinel['notify'], string>> = {
  get mac() {
    return tx('sentinel.model.notifyMac', { computer: computerWord() });
  },
  get phone() {
    return tx('sentinel.model.notifyPhone');
  },
  get both() {
    return tx('sentinel.model.notifyBoth', { computer: computerTitle() });
  },
  get off() {
    return tx('common.off');
  },
};

/** The model the Claude steps share ('' for Claude Code's default, undefined when they differ or there are none). */
export function sharedModel(steps: readonly Step[]): string | undefined {
  const models = new Set(steps.filter((s) => s.kind === 'claude').map((s) => (s.kind === 'claude' ? (s.model ?? '') : '')));
  return models.size === 1 ? [...models][0] : models.size === 0 ? '' : undefined;
}

/** Every Claude step on one model ('' : Claude Code's default). */
export const withModel = (steps: readonly Step[], model: string): Step[] =>
  steps.map((s) => {
    if (s.kind !== 'claude') return s;
    const { model: _m, ...rest } = s;
    return model ? { ...rest, model } : rest;
  });

/**
 * An agent step's agent as a pop-up value (BLG-497): '' for your default agent, else agentChoices'
 * `runtime:model` (a model with no runtime, from an older step, is Claude's).
 */
export const stepAgentChoice = (step: Pick<ClaudeStep, 'runtime' | 'model'>): string => (!step.runtime && !step.model ? '' : `${step.runtime ?? 'claude'}:${step.model ?? ''}`);

/** The runtime and model a pop-up value stands for, as a step's fields ('' : neither, your default agent). */
export function agentFields(value: string): Pick<ClaudeStep, 'runtime' | 'model'> {
  if (!value) return { runtime: undefined, model: undefined };
  const ref = agentForChoice(value);
  return { runtime: ref.runtime, model: ref.model };
}

/** The agent every agent step shares, as a pop-up value ('' : your default; undefined when they differ). */
export function sharedAgent(steps: readonly Step[]): string | undefined {
  const picks = new Set(steps.flatMap((s) => (s.kind === 'claude' ? [stepAgentChoice(s)] : [])));
  return picks.size === 1 ? [...picks][0] : picks.size === 0 ? '' : undefined;
}

/** Every agent step on one agent and model ('' : your default). */
export const withAgent = (steps: readonly Step[], value: string): Step[] =>
  steps.map((s) => {
    if (s.kind !== 'claude') return s;
    const { runtime: _r, model: _m, ...rest } = s;
    const { runtime, model } = agentFields(value);
    return { ...rest, ...(runtime ? { runtime } : {}), ...(model ? { model } : {}) };
  });

/** Whether a run's chat (a Claude step's) is there to open. */
export const hasChat = (run: Pick<RunSummary, 'channel' | 'steps'>): boolean => Boolean(run.channel ?? run.steps.some((s) => s.channel));

export const isRunning = (state: RunState): boolean => state === 'running' || state === 'queued';

// ---------------------------------------------------------------- Sentinel's views (BLG-300)

/**
 * Views that are Sentinel's: the sidebar's row is selected, the toolbar says Sentinel, they get the
 * whole window. `sentinel`, `dashboard` and `sentinel_chat` are its one page (the board picked, the
 * chat open beside it); a sentinel's page and a run's page open from it.
 */
export const SENTINEL_VIEWS: ReadonlySet<string> = new Set(['sentinel', 'dashboard', 'sentinel_chat', 'sentinel_page', 'sentinel_run']);
export const isSentinelView = (kind: string): boolean => SENTINEL_VIEWS.has(kind);

// ---------------------------------------------------------------- one page (BLG-300)

/** What a sentinel does, in a few words: its steps' names in order ("Read what changed → Notify me"). */
export const doesLine = (s: Pick<Sentinel, 'steps'>): string => (s.steps.length ? s.steps.map((st) => st.name).join(' → ') : tx('sentinel.model.noSteps'));

/** A run as a dot in a row's strip: its state's tone, and what to say on hover. */
export interface RunDot {
  readonly id: string;
  readonly state: RunState;
  readonly label: string;
}

/** A sentinel's last `n` runs, oldest first (the row's dot strip). */
export function dotsOf(state: Pick<SentinelState, 'runs'>, id: string, now: number, n = 12): RunDot[] {
  return state.runs
    .filter((r) => r.sentinelId === id)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-n)
    .map((r) => ({ id: r.id, state: r.state, label: `${ago(r.startedAt, now)} · ${RUN_STATE_INFO[r.state].label}${r.headline ? ` · ${r.headline}` : ''}` }));
}

/** Something on Sentinel's page that waits for you, with what you'd do about it. */
export type Need =
  | { readonly kind: 'merge'; readonly key: string; readonly sentinel: Sentinel; readonly run: RunSummary; readonly title: string; readonly detail: string }
  | { readonly kind: 'draft' | 'changed' | 'failing' | 'trouble'; readonly key: string; readonly sentinel: Sentinel; readonly title: string; readonly detail: string };

/**
 * What needs you, first on the page: runs waiting for your Merge, sentinels Claude changed (they
 * wait to be turned on again), ones paused after failures, ones that can't watch, and drafts (made,
 * never turned on nor run). Each once, the most pressing first.
 */
export function needsOf(state: SentinelState, scope?: string): Need[] {
  const items = state.items.filter((s) => inScope(s, scope));
  const out: Need[] = [];
  const nameOf = nameOfIn(state);
  for (const run of state.runs) {
    if (run.state !== 'needs-you') continue;
    const s = items.find((i) => i.id === run.sentinelId);
    if (!s) continue;
    out.push({ kind: 'merge', key: `run:${run.id}`, sentinel: s, run, title: run.pr ? tx('sentinel.model.needMerge', { name: s.name, number: run.pr.number }) : tx('sentinel.model.needWaits', { name: s.name }), detail: headlineOf(run) });
  }
  for (const s of items) {
    if (s.paused && s.pausedWhy === CLAUDE_CHANGED) out.push({ kind: 'changed', key: `s:${s.id}`, sentinel: s, title: tx('sentinel.model.needChanged', { name: s.name }), detail: tx('sentinel.model.needChangedLine') });
    else if (s.paused && s.pausedWhy) out.push({ kind: 'failing', key: `s:${s.id}`, sentinel: s, title: tx('sentinel.model.needFailing', { name: s.name, why: pausedWords(s) ?? tx('sentinel.model.pausedWord') }), detail: headlineOf(lastRunOf(state, s.id) ?? { headline: '', state: 'failed' }) });
    else if (!s.paused && troubleOf(state, s)) out.push({ kind: 'trouble', key: `s:${s.id}`, sentinel: s, title: tx('sentinel.model.needTrouble', { name: s.name }), detail: troubleOf(state, s)! });
  }
  for (const s of items) {
    if (s.paused && !s.pausedWhy && !lastRunOf(state, s.id)) out.push({ kind: 'draft', key: `s:${s.id}`, sentinel: s, title: tx('sentinel.model.needDraft', { name: s.name }), detail: [scheduleSentence(s.trigger, nameOf), doesLine(s)].join(' · ') });
  }
  return out;
}

/** The project dropdown: All, then only the projects that have sentinels (sidebar order), then Your Mac, each with its count. */
export function scopesOf(items: readonly Sentinel[], projects: ReadonlyArray<{ readonly id: string; readonly name: string }>): Array<{ readonly value: string | undefined; readonly label: string; readonly count: number }> {
  const known = new Set(projects.map((p) => p.id));
  const mac = items.filter((s) => !s.projectId || !known.has(s.projectId)).length;
  return [
    { value: undefined, label: tx('sentinel.model.allProjects'), count: items.length },
    ...projects.flatMap((p) => {
      const count = items.filter((s) => s.projectId === p.id).length;
      return count ? [{ value: p.id, label: p.name, count }] : [];
    }),
    ...(mac ? [{ value: MAC_SCOPE, label: ASSISTANT_TITLE, count: mac }] : []),
  ];
}

/** The starting points on an empty Sentinel, grouped by what you get. */
export const START_GROUPS: ReadonlyArray<{ readonly label: string; readonly ids: readonly string[] }> = [
  {
    get label() {
      return tx('sentinel.model.group.tell');
    },
    ids: ['morning-brief', 'uptime-guard', 'review-new-prs', 'issues-to-tasks', 'release-notes', 'failed-payments', 'watch-the-web'],
  },
  {
    get label() {
      return tx('sentinel.model.group.fix');
    },
    ids: ['fix-what-broke', 'nightly-tests', 'dependency-updates', 'fix-and-ship'],
  },
  {
    get label() {
      return tx('sentinel.model.group.number');
    },
    ids: ['stripe-revenue', 'open-issues-prs', 'site-speed', 'customers-this-week', 'youtube-subscribers', 'last-job-run'],
  },
];

/** The recipes in their groups, `per` at most in each (the rest are in New Sentinel › Recipe). */
export function startingPoints(recipes: readonly Recipe[], per = 4): Array<{ readonly label: string; readonly recipes: readonly Recipe[] }> {
  return START_GROUPS.map((g) => ({ label: g.label, recipes: g.ids.flatMap((id) => recipes.filter((r) => r.id === id)).slice(0, per) })).filter((g) => g.recipes.length);
}

/** The toolbar's line under Sentinel: how it's doing ("8 watching · next at 7:00 · 2 need you"), or what it is. */
export function sentinelSubtitle(state: SentinelState): string {
  if (!state.items.length) return tx('sentinel.model.subtitleEmpty');
  const needs = needsOf(state).length;
  return [sidebarLine(state).text, ...(needs ? [tx('sentinel.model.needYou', { count: needs })] : [])].join(' · ');
}

/**
 * What came back, as messages (At a glance): each sentinel's latest run that ended (or the one going
 * now), newest first. One per sentinel, so one that runs every five minutes doesn't drown the rest.
 */
export function latestOf(state: Pick<SentinelState, 'items' | 'runs'>, scope: string | undefined, n = Infinity): Array<{ readonly sentinel: Sentinel; readonly run: RunSummary }> {
  const out: Array<{ sentinel: Sentinel; run: RunSummary }> = [];
  for (const s of state.items) {
    if (!inScope(s, scope)) continue;
    const runs = state.runs.filter((r) => r.sentinelId === s.id && r.state !== 'queued');
    const run = runs.reduce<RunSummary | undefined>((best, r) => (!best || r.startedAt > best.startedAt ? r : best), undefined);
    if (run) out.push({ sentinel: s, run });
  }
  return out.sort((a, b) => (b.run.endedAt ?? b.run.startedAt) - (a.run.endedAt ?? a.run.startedAt)).slice(0, n);
}

// ---------------------------------------------------------------- in the sidebar (BLG-570)

/**
 * A run as a row under its sentinel in the sidebar (BLG-576): the whole pipeline, its agent one step
 * of it. It opens the run's page (every step, its output, the agent's session). `chat`: its agent's
 * conversation while it's kept.
 */
export interface SideRun {
  readonly runId: string;
  readonly state: RunSummary['state'];
  readonly startedAt: number;
  readonly headline: string;
  readonly chat?: string;
}

/** A sentinel under the Sentinel row: how it's doing, and its runs, newest first. */
export interface SideSentinel {
  readonly sentinel: Sentinel;
  readonly live: boolean;
  readonly needs: boolean;
  readonly failed: boolean;
  /** Why it stopped on its own ("Paused after 3 failures in a row"): the Sentinel row's problem mark is about it. */
  readonly broken?: string;
  readonly runs: readonly SideRun[];
}

/** Folded, the Sentinel row keeps these under it: running, waiting for you, its last run failed, or it stopped on its own. */
export const needsALook = (x: Pick<SideSentinel, 'live' | 'needs' | 'failed' | 'broken'>): boolean => x.live || x.needs || x.failed || x.broken !== undefined;

/** The runs a sentinel row unfolds to at most; the rest are on its page. */
export const SIDE_RUNS = 5;

/** A run's agent conversation: the last agent step's (its worktree's too), unless it was put away. */
export function runChatOf(run: Pick<RunSummary, 'putAway' | 'channel' | 'steps'>): string | undefined {
  if (run.putAway) return undefined;
  const steps = run.steps.map((st) => st.channel).filter((c): c is string => chatPlaceOf(c) !== undefined);
  return chatPlaceOf(run.channel) ? run.channel! : steps.at(-1);
}

function sideRunOf(run: RunSummary): SideRun {
  const chat = runChatOf(run);
  return { runId: run.id, state: run.state, startedAt: run.startedAt, headline: headlineOf(run), ...(chat ? { chat } : {}) };
}

/**
 * The sentinels the sidebar lists under its Sentinel row (BLG-570): every one that's on, a paused
 * one while a run of it still goes or waits for you, and one that stopped on its own (the row's
 * problem mark is about it). The one that ran last first; one that never ran last, by name. Each
 * with its runs, newest first (every one the index keeps).
 */
export function sidebarSentinels(state: Pick<SentinelState, 'items' | 'runs'>): SideSentinel[] {
  const out: Array<SideSentinel & { readonly last: number }> = [];
  for (const sentinel of state.items) {
    const runs = state.runs.filter((r) => r.sentinelId === sentinel.id).sort((a, b) => b.startedAt - a.startedAt);
    const live = runs.some((r) => r.state === 'running' || r.state === 'queued');
    const needs = runs.some((r) => r.state === 'needs-you');
    const broken = brokenWords(sentinel);
    if (sentinel.paused && !live && !needs && !broken) continue;
    const ended = runs.find((r) => r.state !== 'running' && r.state !== 'queued');
    out.push({ sentinel, live, needs, failed: ended?.state === 'failed', ...(broken ? { broken } : {}), runs: runs.map(sideRunOf), last: runs[0]?.startedAt ?? 0 });
  }
  return out.sort((a, b) => b.last - a.last || a.sentinel.name.localeCompare(b.sentinel.name)).map(({ last: _l, ...rest }) => rest);
}
