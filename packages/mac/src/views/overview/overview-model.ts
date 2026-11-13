import type { AppState } from '../../../../../src/core/store.js';
import { type Plan, planTitle } from '../../../../../src/core/plans/model.js';
import { planOf } from '../../../../../src/core/plans/owner.js';
import { planSignal } from '../../layout/attention-model.js';
import { activityOf } from '../../../../../src/ui/workspace-models.js';
import { worktreeOrigin } from '../../../../../src/workspaces/origin.js';
import type { Project, Workspace } from '../../../../../src/workspaces/types.js';
import { isReady } from '../project/home-model.js';
import { t } from '../../../../../src/shared/i18n/index.js';

/**
 * What the Overview shows and how it's narrowed: every worktree and chat, archived ones too,
 * by filter, project and search, sorted and grouped by project. Pure, so it's tested on its
 * own (tests/mac-overview.test.ts); Overview.tsx only draws it.
 */

export const FILTERS = ['all', 'active', 'needs', 'ready', 'archived'] as const;
export type OverviewFilter = (typeof FILTERS)[number];
export const SORTS = ['recent', 'name', 'size'] as const;
export type OverviewSort = (typeof SORTS)[number];

const FILTER_KEYS = { all: 'views.overview.filterAll', active: 'views.overview.filterActive', needs: 'views.overview.filterNeeds', ready: 'views.overview.filterReady', archived: 'views.overview.filterArchived' } as const satisfies Record<OverviewFilter, string>;
const SORT_KEYS = { recent: 'views.overview.sortRecent', name: 'views.overview.sortName', size: 'views.overview.sortSize' } as const satisfies Record<OverviewSort, string>;
/** A segment's name, in the app's language. */
export const filterLabel = (f: OverviewFilter): string => t(FILTER_KEYS[f]);
/** A sort's name, in the app's language. */
export const sortLabel = (x: OverviewSort): string => t(SORT_KEYS[x]);

export interface OverviewItem {
  readonly ws: Workspace;
  readonly project: Project;
  readonly archived: boolean;
  /** Waiting on you: an approval, a merge conflict, or failing checks. */
  readonly needs: boolean;
  /** Committed work that isn't in the base yet, nothing uncommitted, no conflict. */
  readonly ready: boolean;
  /** The conversation's last line (only for conversations that are loaded). */
  readonly last?: string;
  /** When something last happened there (its last message, else when it was made). */
  readonly when: number;
  /** Bytes on disk, when measured and the folder still exists. */
  readonly size?: number;
  /** What needs you first: 0 conflict/approval, 1 failing checks, 2 Claude working, 3 unread, 4 the rest. */
  readonly rank: number;
  /**
   * A live plan, shown as one item where its conversation is (its tasks' worktrees aren't listed):
   * its news and what waits on you are the plan's, added up.
   */
  readonly plan?: { readonly plan: Plan; readonly title: string; readonly unread: number; readonly tip: string };
}

export interface OverviewGroup {
  readonly project: Project;
  readonly active: readonly OverviewItem[];
  readonly archived: readonly OverviewItem[];
}

/** What the Overview shows: live worktrees and chats (not sub-agents' scratch worktrees), and everything archived. */
/** Not a project's main checkout: it's no conversation (BLG-70), its project's home is. */
const shown = (w: Workspace): boolean => w.kind !== 'main' && (w.archived === true || worktreeOrigin(w) !== 'agent');

/**
 * An archived worktree's folder is gone, so a size measured before it was archived is stale.
 * An archived chat keeps its folder.
 */
function sizeOf(state: AppState, w: Workspace): number | undefined {
  if (w.archived && w.kind === 'worktree') return undefined;
  return state.disk[w.id];
}

function itemOf(state: AppState, project: Project, ws: Workspace): OverviewItem {
  const act = activityOf(state.log, `ws:${ws.id}`);
  const archived = ws.archived === true;
  const conflict = Boolean(state.conflicts[ws.id]?.length);
  const failing = state.prs[ws.id]?.checks === 'failing' && state.prs[ws.id]?.state === 'OPEN';
  const needs = !archived && (conflict || act.awaiting || failing);
  const ready = isReady(state, ws);
  const rank = conflict || act.awaiting ? 0 : failing ? 1 : act.running ? 2 : state.unread[`ws:${ws.id}`] ? 3 : 4;
  const size = sizeOf(state, ws);
  return {
    ws,
    project,
    archived,
    needs,
    ready,
    when: act.lastTs ?? ws.createdAt,
    rank: archived ? 5 : rank,
    ...(act.last ? { last: act.last } : {}),
    ...(size !== undefined ? { size } : {}),
  };
}

/** A plan's conversation stands for the plan: what the plan as a whole is waiting on. */
function planItemOf(state: AppState, item: OverviewItem, plan: Plan): OverviewItem {
  const sig = planSignal(state, plan);
  const needs = sig.level === 'needs';
  const rank = needs ? 0 : sig.working ? 2 : sig.unread ? 3 : 4;
  return { ...item, needs, ready: false, rank, plan: { plan, title: planTitle(plan), unread: sig.unread, tip: sig.tip } };
}

/** Every workspace the Overview can show, in the projects' order: a live plan once (where its conversation is), not its tasks' worktrees. */
export function overviewItems(state: AppState): OverviewItem[] {
  return state.projects.flatMap((p) =>
    p.workspaces.filter(shown).flatMap((w) => {
      const plan = w.archived ? undefined : planOf(state, w.id);
      if (!plan) return [itemOf(state, p, w)];
      return plan.home === `ws:${w.id}` ? [planItemOf(state, itemOf(state, p, w), plan)] : [];
    }),
  );
}

export function inFilter(item: OverviewItem, filter: OverviewFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return !item.archived;
    case 'needs':
      return item.needs;
    case 'ready':
      return item.ready;
    case 'archived':
      return item.archived;
  }
}

/** Every word must appear in the name, branch, project or last message (any case). */
export function matchesSearch(item: OverviewItem, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.plan?.title ?? '', item.ws.name, item.ws.branch ?? '', item.project.root ? item.project.name : 'Chats', item.last ?? ''].join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Before the segment: the project popup and the search. */
export function narrow(items: readonly OverviewItem[], project: string | undefined, search: string): OverviewItem[] {
  return items.filter((i) => (!project || i.project.id === project) && matchesSearch(i, search));
}

/** How many each segment would show (after the project and the search). */
export function filterCounts(items: readonly OverviewItem[]): Record<OverviewFilter, number> {
  const out = { all: 0, active: 0, needs: 0, ready: 0, archived: 0 };
  for (const i of items) for (const f of FILTERS) if (inFilter(i, f)) out[f]++;
  return out;
}

const byName = (a: OverviewItem, b: OverviewItem): number => a.ws.name.localeCompare(b.ws.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Recent: what needs you first (the Overview's job), then the latest. Name: A to Z.
 * Size: biggest first, unmeasured last.
 */
export function sortItems(items: readonly OverviewItem[], sort: OverviewSort): OverviewItem[] {
  const list = [...items];
  if (sort === 'name') return list.sort(byName);
  if (sort === 'size') return list.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || byName(a, b));
  return list.sort((a, b) => a.rank - b.rank || b.when - a.when || byName(a, b));
}

/** By project (in the sidebar's order), live ones first, then the archived ones. */
export function groupItems(items: readonly OverviewItem[], sort: OverviewSort): OverviewGroup[] {
  const groups = new Map<string, { project: Project; active: OverviewItem[]; archived: OverviewItem[] }>();
  for (const i of items) {
    const g = groups.get(i.project.id) ?? { project: i.project, active: [], archived: [] };
    (i.archived ? g.archived : g.active).push(i);
    groups.set(i.project.id, g);
  }
  return [...groups.values()].map((g) => ({ project: g.project, active: sortItems(g.active, sort), archived: sortItems(g.archived, sort) }));
}

/** The rows in the order they're drawn (for the arrow keys). */
export const rowOrder = (groups: readonly OverviewGroup[]): string[] => groups.flatMap((g) => [...g.active, ...g.archived].map((i) => i.ws.id));

/** The row the arrow keys move to (stays put at either end, like a Finder list). */
export function stepRow(order: readonly string[], current: string | undefined, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): string | undefined {
  if (!order.length) return undefined;
  if (key === 'Home') return order[0];
  if (key === 'End') return order[order.length - 1];
  const at = current ? order.indexOf(current) : -1;
  if (at < 0) return key === 'ArrowDown' ? order[0] : order[order.length - 1];
  return order[Math.max(0, Math.min(order.length - 1, at + (key === 'ArrowDown' ? 1 : -1)))];
}

/** What the Overview remembers between visits (the search isn't kept, like Finder's). */
export interface OverviewPrefs {
  readonly filter: OverviewFilter;
  readonly sort: OverviewSort;
  /** A project's id; unset: all projects. */
  readonly project?: string;
}

export const DEFAULT_OVERVIEW_PREFS: OverviewPrefs = { filter: 'all', sort: 'recent' };

/** Saved prefs, checked: anything unknown falls back to the default. */
export function readOverviewPrefs(raw: string | null): OverviewPrefs {
  try {
    const v = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    const filter = FILTERS.find((f) => f === v.filter) ?? DEFAULT_OVERVIEW_PREFS.filter;
    const sort = SORTS.find((x) => x === v.sort) ?? DEFAULT_OVERVIEW_PREFS.sort;
    const project = typeof v.project === 'string' && v.project.length <= 200 ? v.project : undefined;
    return { filter, sort, ...(project ? { project } : {}) };
  } catch {
    return DEFAULT_OVERVIEW_PREFS;
  }
}

/** What an empty list says, per segment (and with a project picked). */
export function emptyText(filter: OverviewFilter, projectName?: string): { title: string; detail: string } {
  const p = { project: projectName ?? '' };
  switch (filter) {
    case 'all':
      return { title: projectName ? t('views.overview.emptyAllIn', p) : t('views.overview.emptyAll'), detail: t('views.overview.emptyAllDetail') };
    case 'active':
      return { title: projectName ? t('views.overview.emptyActiveIn', p) : t('views.overview.emptyActive'), detail: t('views.overview.emptyActiveDetail') };
    case 'needs':
      return { title: projectName ? t('views.overview.emptyNeedsIn', p) : t('views.overview.emptyNeeds'), detail: t('views.overview.emptyNeedsDetail') };
    case 'ready':
      return { title: projectName ? t('views.overview.emptyReadyIn', p) : t('views.overview.emptyReady'), detail: t('views.overview.emptyReadyDetail') };
    case 'archived':
      return { title: projectName ? t('views.overview.emptyArchivedIn', p) : t('views.overview.emptyArchived'), detail: t('views.overview.emptyArchivedDetail') };
  }
}

/** A worktree (or a plan) on one of your computers that needs you (BLG-843), as the Overview lists it. */
export interface NeedsThere {
  readonly id: string;
  readonly title: string;
  /** Its project there ('Chats' outside one). */
  readonly project: string;
  /** What it waits on, in words. */
  readonly why: string;
  /** Its page on that computer. */
  readonly page: { readonly kind: 'workspace'; readonly id: string; readonly tab: 'chat' } | { readonly kind: 'plan'; readonly id: string };
}

/** What needs you among a computer's items (overviewItems of its state), for this Mac's Overview. */
export function needsThere(items: readonly OverviewItem[]): NeedsThere[] {
  return items
    .filter((i) => i.needs && !i.archived)
    .map((i) => ({
      id: i.ws.id,
      title: i.plan?.title ?? i.ws.name,
      project: i.project.root ? i.project.name : 'Chats',
      why: i.plan?.tip || (i.rank === 1 ? t('views.overview.checksFailing') : t('views.overview.waitingForYou')),
      page: i.plan ? { kind: 'plan' as const, id: i.plan.plan.id } : { kind: 'workspace' as const, id: i.ws.id, tab: 'chat' as const },
    }));
}

/** A computer's rows narrowed like this Mac's: the project picked (by name there) and the search's words. */
export function narrowThere(rows: readonly NeedsThere[], project: string | undefined, search: string): NeedsThere[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => (!project || r.project === project) && words.every((w) => `${r.title}\n${r.project}`.toLowerCase().includes(w)));
}
