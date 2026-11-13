import { type ThreadChildren, type ThreadState, isThreadWorking, threadRank } from '../../../src/shared/threads';
import type { ConvSummary, ThreadCountView, ThreadFamilyView } from './link/protocol';
import { t } from '../../../src/shared/i18n/index';

/** Child threads as the phone lists them and asks about them (1.47). Pure: no React. */

export interface ConvRow {
  readonly conv: ConvSummary;
  /** How far under the top of the list: its parent's row is just above it. */
  readonly depth: number;
}

/**
 * The rows of a project: each child after its parent, the rest in the order they came. A child whose
 * parent isn't in the list is a row of its own, so nothing the Mac sends drops out.
 */
export function nestRows(convs: readonly ConvSummary[]): ConvRow[] {
  const topics = new Set(convs.map((c) => c.topic));
  const under = new Map<string, ConvSummary[]>();
  for (const c of convs) if (c.parent && topics.has(c.parent)) under.set(c.parent, [...(under.get(c.parent) ?? []), c]);
  const rows: ConvRow[] = [];
  const seen = new Set<string>();
  const add = (conv: ConvSummary, depth: number): void => {
    if (seen.has(conv.topic)) return;
    seen.add(conv.topic);
    rows.push({ conv, depth });
    for (const child of under.get(conv.topic) ?? []) add(child, depth + 1);
  };
  for (const c of convs) if (!c.parent || !topics.has(c.parent)) add(c, 0);
  // Parents that point at each other never come up from the top: they still get a row.
  for (const c of convs) add(c, 0);
  return rows;
}

/**
 * The answer an archive or a delete sends. Undefined: nothing was asked, and the call stays as it
 * was. An older Mac refuses an argument it doesn't know, and keeps the children anyway.
 */
export function branchChildren(supported: boolean, family: ThreadCountView | undefined, too: boolean): ThreadChildren | undefined {
  if (!supported || !family?.count) return undefined;
  return too ? 'with' : 'keep';
}

/** The one question about a chat's threads, in the Mac's words (ThreadsChoice.tsx). */
export function threadsQuestion(action: 'archive' | 'delete', family: ThreadCountView): { readonly label: string; readonly detail: string } {
  const working = family.running ? t('shared.threads.working', { count: family.running }) : '';
  const detail = [t(action === 'archive' ? 'shared.threads.archiveDetail' : 'shared.threads.deleteDetail'), working, t('shared.threads.keep')].filter(Boolean).join(' ');
  return { label: t(action === 'archive' ? 'shared.threads.alsoArchive' : 'shared.threads.alsoDelete', { count: family.count }), detail };
}

/** One row of a chat's Threads sheet: a child thread, or a native sub-agent (read-only: no Stop, no page). */
export type FamilyRow = ({ readonly kind: 'thread' } & ThreadFamilyView['children'][number]) | ({ readonly kind: 'agent'; readonly working: boolean; readonly topic?: undefined } & NonNullable<ThreadFamilyView['agents']>[number]);

/** Threads and native sub-agents in one list, as on the Mac: needs you, then working, then finished; threads first within each. */
export function familyRows(family: ThreadFamilyView): FamilyRow[] {
  const rows: FamilyRow[] = [...family.children.map((c): FamilyRow => ({ kind: 'thread', ...c })), ...[...(family.agents ?? [])].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)).map((a): FamilyRow => ({ kind: 'agent', ...a, working: isThreadWorking(a.state as ThreadState) }))];
  return rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row.state) - rank(b.row.state) || a.i - b.i).map(({ row }) => row);
}

/** How many of a family's rows work now, threads and native sub-agents alike. */
export function familyRunning(family: ThreadFamilyView): number {
  return familyRows(family).filter((r) => r.working).length;
}

/** A newer Mac may send a state this phone doesn't know: it sorts with the finished ones. */
const rank = (state: string): number => threadRank(state as ThreadState);
