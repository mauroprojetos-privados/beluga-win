import type { Assignee, BoardState, Issue, IssueStatus } from '../../../../src/core/board/model.js';
import { ISSUE_STATUSES, STATUS_INFO, boardName, boardOf, childrenOf, filterIssues, isOpen, isOwnBoard, openBlockers, reposOf, showsOn } from '../../../../src/core/board/model.js';
import { type Tally, parseCriterion, tally } from '../../../../src/core/board/criteria.js';
import type { Graph, GraphNode, GraphEdge } from '../../../../src/shared/graph-spec.js';
import { type Key, t } from '../../../../src/shared/i18n/index.js';
import { formatDateWith } from '../../../../src/shared/i18n/format.js';

/**
 * The Tasks screen's pure parts (no DOM): what you're looking at (remembered per window), the
 * people a task can be for, the dependency graph, and words for times and counts.
 */

export type Scope = 'active' | 'backlog' | 'all' | 'archived';
export type Display = 'list' | 'board' | 'graph';

export interface TasksPrefs {
  readonly scope: Scope;
  readonly display: Display;
  /** The project you were last in (Tasks opens on a board that covers it). */
  readonly project: string;
  /** The board you last looked at in Tasks (a board covers one repo or several). */
  readonly board: string;
  /** The repos a board of several shows ([] = all of them): those not on the board you're on are left aside. */
  readonly repos: readonly string[];
  /** Whose tasks ('' = everyone's): an assignee key (assigneeKey), 'nobody', or 'private' (BLG-501). */
  readonly who: string;
  /** Status groups folded in the list. */
  readonly folded: readonly IssueStatus[];
  /**
   * Epics whose sub-tasks you opened out (their ids). The rest keep theirs tucked under them, the
   * epic's card standing for them. Yours alone: kept in this window, never on the shared board.
   */
  readonly opened: readonly string[];
}

export const DEFAULT_TASKS_PREFS: TasksPrefs = { scope: 'active', display: 'board', project: '', board: '', repos: [], who: '', folded: ['canceled'], opened: [] };

/** A scope, its words said when read (so a language change shows at once). */
const scope = (value: Scope, label: Key, hint: Key): { readonly value: Scope; readonly label: string; readonly hint: string } => ({
  value,
  get label() {
    return t(label);
  },
  get hint() {
    return t(hint);
  },
});

export const SCOPES: ReadonlyArray<{ readonly value: Scope; readonly label: string; readonly hint: string }> = [
  scope('active', 'tasks.m.active', 'tasks.m.activeHint'),
  scope('backlog', 'tasks.m.backlog', 'tasks.m.backlogHint'),
  scope('all', 'tasks.m.all', 'tasks.m.allHint'),
  scope('archived', 'tasks.m.archive', 'tasks.m.archiveHint'),
];

/** Saved prefs, read kindly (anything odd falls back to the default). */
export function readTasksPrefs(raw: string | null): TasksPrefs {
  try {
    const p = JSON.parse(raw ?? '{}') as Partial<TasksPrefs>;
    return {
      scope: SCOPES.some((s) => s.value === p.scope) ? p.scope! : DEFAULT_TASKS_PREFS.scope,
      display: p.display === 'board' || p.display === 'graph' || p.display === 'list' ? p.display : DEFAULT_TASKS_PREFS.display,
      project: typeof p.project === 'string' ? p.project : '',
      board: typeof p.board === 'string' ? p.board : '',
      repos: Array.isArray(p.repos) ? p.repos.filter((r): r is string => typeof r === 'string') : [],
      who: typeof p.who === 'string' ? p.who : '',
      folded: Array.isArray(p.folded) ? p.folded.filter((s): s is IssueStatus => (ISSUE_STATUSES as readonly string[]).includes(s)) : DEFAULT_TASKS_PREFS.folded,
      opened: Array.isArray(p.opened) ? p.opened.filter((id): id is string => typeof id === 'string') : DEFAULT_TASKS_PREFS.opened,
    };
  } catch {
    return DEFAULT_TASKS_PREFS;
  }
}

/**
 * Prefs saved before the board became the default (beluga.tasks.v1): kept, but for the display,
 * which opens on the board once; a choice made after that is kept as usual.
 */
export function fromV1TasksPrefs(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const { display: _display, ...rest } = JSON.parse(raw) as Partial<TasksPrefs>;
    return JSON.stringify(rest);
  } catch {
    return null;
  }
}

/** The statuses a scope shows as groups (or columns), in order. */
export function statusesFor(scope: Scope): readonly IssueStatus[] {
  switch (scope) {
    case 'active':
      return ['todo', 'in_progress', 'in_review', 'in_plan'];
    case 'backlog':
      return ['backlog'];
    case 'archived':
      return ['done', 'canceled'];
    default:
      return ISSUE_STATUSES;
  }
}

/**
 * The tasks to show, sub-tasks left tucked under their epics unless you opened that epic out, and
 * how many were (and under which epics). A sub-task stays when its epic isn't shown (nothing would
 * stand for it), and a filter finds everything.
 */
export function untucked(issues: readonly Issue[], opened: readonly string[], query = ''): { shown: readonly Issue[]; hidden: number; tucked: readonly string[] } {
  if (query.trim()) return { shown: issues, hidden: 0, tucked: [] };
  const here = new Set(issues.map((i) => i.id));
  const open = new Set(opened);
  const byId = new Map(issues.map((i) => [i.id, i]));
  /** The epic above it that tucks it away: its parent, or one further up (a plan → its milestones → their tasks). */
  const tuckedBy = (i: Issue): string | undefined => {
    const seen = new Set<string>();
    for (let up = i.parent; up && here.has(up) && !seen.has(up); up = byId.get(up)?.parent) {
      seen.add(up);
      if (!open.has(up)) return up;
    }
    return undefined;
  };
  const away = (i: Issue): boolean => tuckedBy(i) !== undefined;
  const shown = issues.filter((i) => !away(i));
  if (shown.length === issues.length) return { shown: issues, hidden: 0, tucked: [] };
  return { shown, hidden: issues.length - shown.length, tucked: [...new Set(issues.filter(away).map((i) => i.parent!))] };
}

/** Opens an epic's sub-tasks out, or tucks them back under it. */
export const toggleOpened = (opened: readonly string[], epicId: string): string[] => (opened.includes(epicId) ? opened.filter((id) => id !== epicId) : [...opened, epicId]);

/** Whether a task is for `who` ('' = anyone, 'nobody' = unassigned, 'private' = only you see it, else an assignee key). */
export const isFor = (issue: Issue, who: string): boolean => (!who ? true : who === 'nobody' ? !issue.assignee : who === 'private' ? Boolean(issue.private) : assigneeKey(issue.assignee) === who);

/**
 * One board's tasks in a scope, for someone, matching words, in list order (`project` is the board;
 * `repos`: only those running in these, none or empty: all). A repo's own board also shows the tasks
 * running in its repo from other boards (`showsOn`).
 */
export function scoped(board: BoardState, prefs: Pick<TasksPrefs, 'scope' | 'project' | 'who'> & { readonly repos?: readonly string[] }, selfId: string, query = '', now = Date.now()): Issue[] {
  return filterIssues(board, { scope: prefs.scope, selfId, now, boardId: prefs.project, visiting: true, ...(prefs.repos?.length ? { repos: prefs.repos } : {}), ...(query.trim() ? { query } : {}) }).filter((i) => isFor(i, prefs.who));
}

/** How many unfinished tasks each scope has on a board (for someone, in some repos), and how many are archived: the tabs' counts. */
export function scopeCounts(board: BoardState, project: string, who: string, selfId: string, now = Date.now(), repos: readonly string[] = []): Readonly<Record<Scope, number>> {
  const count = (scope: Scope): number => scoped(board, { scope, project, who, repos }, selfId, '', now).filter((i) => isOpen(i.status)).length;
  return { active: count('active'), backlog: count('backlog'), all: count('all'), archived: scoped(board, { scope: 'archived', project, who, repos }, selfId, '', now).length };
}

/** Done tasks a board shows (not archived yet): what Archive Done takes. */
export const doneCount = (board: BoardState, boardId: string | undefined): number => board.issues.filter((i) => i.status === 'done' && boardId !== undefined && showsOn(i, boardId) && i.archivedAt === undefined).length;

// ---- boards (many to many with repos)

export interface BoardChoice {
  readonly id: string;
  readonly name: string;
  /** The repos it covers (project ids), its own first; those no longer here left out. */
  readonly repos: readonly string[];
  /** A board of its own (made in Tasks), not one repo's. */
  readonly own: boolean;
}

/**
 * The boards Tasks offers: every repo's own board (it shows everything that runs in its repo), then
 * boards of their own, by name.
 */
export function boardChoices(board: BoardState, projects: ReadonlyArray<{ readonly id: string; readonly name: string }>): BoardChoice[] {
  const name = (id: string): string | undefined => projects.find((p) => p.id === id)?.name;
  const here = (repos: readonly string[]): string[] => repos.filter((r) => projects.some((p) => p.id === r));
  const own = Object.keys(board.projects).filter(isOwnBoard);
  const repoBoards = projects.map((p) => ({ id: p.id, name: boardName(board, p.id, name), repos: here(reposOf(board, p.id)), own: false }));
  const made = own.map((id) => ({ id, name: boardName(board, id, name), repos: here(reposOf(board, id)), own: true })).sort((a, b) => a.name.localeCompare(b.name));
  return [...repoBoards, ...made];
}

/**
 * The board Tasks shows: the one asked for, else the one you last looked at while it covers the repo
 * you were last in, else that repo's, else the one with the most unfinished tasks, else the first.
 */
export function boardToShow(board: BoardState, boards: readonly BoardChoice[], asked: string | undefined, lastRepo: string, lastBoard = ''): string | undefined {
  const known = (id: string | undefined): id is string => Boolean(id && boards.some((b) => b.id === id));
  if (known(asked)) return asked;
  if (known(lastBoard) && (!lastRepo || boards.find((b) => b.id === lastBoard)!.repos.includes(lastRepo))) return lastBoard;
  if (known(lastRepo)) return lastRepo;
  if (known(lastBoard)) return lastBoard;
  const open = (id: string): number => board.issues.filter((i) => showsOn(i, id) && isOpen(i.status)).length;
  return [...boards].sort((a, b) => open(b.id) - open(a.id))[0]?.id;
}

/** The repos a board shows tasks from: the ones it covers, and any its tasks still run in (a repo taken off it). */
export function boardRepos(board: BoardState, boardId: string | undefined, projects: ReadonlyArray<{ readonly id: string }>): string[] {
  if (!boardId) return [];
  const running = board.issues.filter((i) => showsOn(i, boardId)).map((i) => i.projectId);
  return [...new Set([...reposOf(board, boardId), ...running])].filter((r) => projects.some((p) => p.id === r));
}

/** The repos you picked that are on this board (none left: all of them). */
export const pickedRepos = (picked: readonly string[], repos: readonly string[]): string[] => picked.filter((r) => repos.includes(r));

/** A repo filter's words: "All repos", one's name, or "2 repos". */
export function reposLabel(picked: readonly string[], name: (id: string) => string | undefined): string {
  if (!picked.length) return t('tasks.m.allRepos');
  return picked.length === 1 ? (name(picked[0]!) ?? t('tasks.m.repos', { count: 1 })) : t('tasks.m.repos', { count: picked.length });
}

/**
 * The project Tasks shows: the one asked for, else the one you were last in, else the one with
 * the most unfinished tasks, else the first. Never all of them at once.
 */
export function projectToShow(board: BoardState, projects: ReadonlyArray<{ readonly id: string }>, asked: string | undefined, last: string): string | undefined {
  const known = (id: string | undefined): id is string => Boolean(id && projects.some((p) => p.id === id));
  if (known(asked)) return asked;
  if (known(last)) return last;
  const open = (id: string): number => board.issues.filter((i) => i.projectId === id && isOpen(i.status)).length;
  return [...projects].sort((a, b) => open(b.id) - open(a.id))[0]?.id;
}

/**
 * Whether you work alone on a project: no teammates on it and no task there for anyone but you. Then who a task is for isn't shown at all.
 */
export function isSolo(board: BoardState, projectId: string | undefined, selfId: string, others: number): boolean {
  if (others > 0) return false;
  return !board.issues.some((i) => (i.projectId === projectId || boardOf(i) === projectId) && i.assignee && i.assignee.id !== selfId);
}

/** The people a board's tasks are for, for the filter: you first, then the rest by name. */
export function assigneesIn(board: BoardState, boardId: string | undefined, selfId: string): ReadonlyArray<{ readonly key: string; readonly label: string; readonly assignee: Assignee }> {
  const seen = new Map<string, Assignee>();
  for (const i of board.issues) if (boardId !== undefined && showsOn(i, boardId) && i.assignee) seen.set(assigneeKey(i.assignee), i.assignee);
  const label = (a: Assignee): string => (a.id === selfId ? t('tasks.m.you') : a.name);
  const mine = (a: Assignee): number => (a.id === selfId ? 0 : 1);
  return [...seen.entries()].map(([key, assignee]) => ({ key, label: label(assignee), assignee })).sort((x, y) => mine(x.assignee) - mine(y.assignee) || x.label.localeCompare(y.label));
}

export interface Person {
  readonly id: string;
  readonly name: string;
}

/**
 * Who a task can be for: you, then the project's teammates (BLG-299). Never a Claude (BLG-278): who
 * works on it shows on the card. Someone it's already for stays in the list, so it still reads right.
 */
export function assigneeChoices(self: Person, people: readonly Person[], current?: Assignee): ReadonlyArray<{ readonly key: string; readonly label: string; readonly assignee: Assignee }> {
  const all = current && current.id !== self.id && !people.some((p) => p.id === current.id) ? [...people, { id: current.id, name: current.name }] : people;
  const others = all.filter((p) => p.id !== self.id).sort((a, b) => a.name.localeCompare(b.name));
  return [
    { key: `person:${self.id}`, label: t('tasks.m.you'), assignee: { kind: 'person', id: self.id, name: self.name } },
    ...others.map((p) => ({ key: `person:${p.id}`, label: p.name, assignee: { kind: 'person', id: p.id, name: p.name } as Assignee })),
  ];
}

export const assigneeKey = (a: Assignee | undefined): string => (a ? `person:${a.id}` : '');

/** A status on the graph: blocked when an unfinished task waits on another unfinished one; the backlog and canceled say so in words. */
function graphStatus(board: BoardState, issue: Issue): Pick<GraphNode, 'status' | 'sublabel'> {
  if (isOpen(issue.status) && openBlockers(board, issue).length) return { status: 'blocked' };
  switch (issue.status) {
    case 'todo':
      return { status: 'todo' };
    case 'in_progress':
      return { status: 'active' };
    case 'in_review':
    case 'in_plan':
      return { status: 'review' };
    case 'done':
      return { status: 'done' };
    default:
      return { sublabel: STATUS_INFO[issue.status].label };
  }
}

/** Tasks that wait on, hold up, contain or sit in another one shown: the ones a dependency graph is about. */
export function connected(board: BoardState, issues: readonly Issue[]): Issue[] {
  const shown = new Set(issues.map((i) => i.id));
  const linked = new Set<string>();
  for (const i of issues) {
    const ties = [...i.blockedBy, ...(i.parent ? [i.parent] : [])].filter((id) => shown.has(id));
    if (!ties.length) continue;
    linked.add(i.id);
    for (const id of ties) linked.add(id);
  }
  return issues.filter((i) => linked.has(i.id));
}

/**
 * What waits on what, as a graph: a task with sub-tasks is a box around them, a blocker points at
 * what it holds up (in the problem color while it's unfinished). Only the tasks shown.
 */
export function taskGraph(board: BoardState, issues: readonly Issue[]): Graph {
  const shown = new Set(issues.map((i) => i.id));
  const boxes = new Set(issues.filter((i) => childrenOf(board, i).some((c) => shown.has(c.id))).map((i) => i.id));
  const nodes: GraphNode[] = issues.map((i) => {
    const box = boxes.has(i.id);
    const inBox = i.parent && boxes.has(i.parent) ? { group: i.parent } : {};
    return {
      id: i.id,
      type: box ? 'group' : 'task',
      label: i.title.length > 80 ? `${i.title.slice(0, 79)}…` : i.title,
      tag: i.key,
      ...(box ? { sublabel: STATUS_INFO[i.status].label } : graphStatus(board, i)),
      ...inBox,
      ...(i.brief.goal ? { details: i.brief.goal.slice(0, 4000) } : {}),
      ...(i.priority === 'urgent' ? { emphasis: true } : {}),
    } as GraphNode;
  });
  const edges: GraphEdge[] = issues.flatMap((i) =>
    i.blockedBy
      .filter((b) => shown.has(b))
      .map((b) => {
        const blocker = issues.find((x) => x.id === b)!;
        return { id: `${b}->${i.id}`, from: b, to: i.id, kind: isOpen(blocker.status) ? ('blocks' as const) : ('depends' as const) };
      }),
  );
  return { title: t('tasks.m.whatWaits'), direction: 'right', nodes, edges, steps: [] };
}

/** The tasks being worked on (in progress, in review), else the ones up next: where a busy graph opens. */
export function workGoingOn(issues: readonly Issue[]): string[] {
  const going = issues.filter((i) => i.status === 'in_progress' || i.status === 'in_review');
  return (going.length ? going : issues.filter((i) => i.status === 'todo')).map((i) => i.id);
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", "Oct 12". */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return t('tasks.m.justNow');
  if (s < 3600) return t('tasks.m.minAgo', { n: Math.floor(s / 60) });
  if (s < 86_400) return t('tasks.m.hAgo', { n: Math.floor(s / 3600) });
  if (s < 2 * 86_400) return t('tasks.m.yesterday');
  return formatDateWith(ts, { month: 'short', day: 'numeric' });
}

/** A due date in words: "Today", "Tomorrow", "In 3 days", "2 days late", "Nov 3". */
export function dueText(day: string, now = Date.now()): { readonly text: string; readonly late: boolean } {
  const [y, m, d] = day.split('-').map(Number);
  const due = new Date(y!, m! - 1, d!).getTime();
  const today = new Date(new Date(now).toDateString()).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days === 0) return { text: t('tasks.m.today'), late: false };
  if (days === 1) return { text: t('tasks.m.tomorrow'), late: false };
  if (days < 0) return { text: t('tasks.m.daysLate', { count: -days }), late: true };
  if (days < 7) return { text: t('tasks.m.inDays', { count: days }), late: false };
  return { text: formatDateWith(due, { month: 'short', day: 'numeric' }), late: false };
}

/** Acceptance criteria: ticked, deferred and not done (with a reason), and open, out of all of them. */
export function checklist(text: string | undefined): Tally {
  return tally(text);
}

/** Tick or untick the n-th checkbox in Markdown (clicking it on a task page). Ticking drops its reason: it's met now. */
export function toggleCheck(text: string, index: number): string {
  let n = -1;
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\s*[-*]\s+\[)([ xX])(\].*)$/.exec(line);
      if (!m) return line;
      n++;
      if (n !== index) return line;
      if (m[2] !== ' ') return `${m[1]} ${m[3]}`;
      const c = parseCriterion(line);
      return c?.reason ? `${m[1]}x] ${c.text}` : `${m[1]}x${m[3]}`;
    })
    .join('\n');
}

/** Someone on a task now (BLG-278): one of their worktrees does it; `running`: their Claude is at work there. */
export interface OnIt {
  readonly peerId: string;
  readonly name: string;
  readonly you: boolean;
  readonly running: boolean;
}

/** Who's on a task now, you first: separate from who it's for, and live. */
export function onIt(self: Person, mine: { readonly here: boolean; readonly running: boolean }, mates: ReadonlyArray<{ readonly peerId: string; readonly name: string; readonly running?: boolean }>): OnIt[] {
  const you: OnIt[] = mine.here ? [{ peerId: self.id, name: self.name, you: true, running: mine.running }] : [];
  return [...you, ...mates.filter((m) => m.peerId !== self.id).map((m) => ({ peerId: m.peerId, name: m.name, you: false, running: Boolean(m.running) }))];
}

/** "You · working", "You and Ata · on it": a card's line for who's on it (what Claude is doing stays in the tooltip). */
export function onItWords(people: readonly OnIt[]): string {
  if (!people.length) return '';
  const names = people.map((p) => (p.you ? t('tasks.m.you') : p.name));
  const who = names.length <= 2 ? names.join(` ${t('common.and')} `) : t('tasks.m.namesMore', { first: names[0]!, second: names[1]!, count: names.length - 2 });
  return `${who} · ${people.some((p) => p.running) ? t('tasks.m.working') : t('tasks.m.onIt')}`;
}

/** One face's tooltip: whose Claude is at work, or whose worktree has it. */
export const onItTip = (p: OnIt, doing?: string): string =>
  p.running ? (p.you ? (doing ? t('tasks.m.agentWorkingOn', { doing }) : t('tasks.m.agentWorking')) : t('tasks.m.theirAgentWorking', { name: p.name })) : p.you ? t('tasks.m.yourWorktree') : t('tasks.m.isOnIt', { name: p.name });
