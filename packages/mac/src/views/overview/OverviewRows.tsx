import type { KeyboardEvent, MouseEvent } from 'react';
import { activityOf, stateOf } from '@beluga/ui/workspace-models.js';
import { describePr, formatBytes } from '@beluga/shared/format.js';
import { Icon } from '../../components/Icon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, Dot, IconButton, Tip, cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApp, useBeluga } from '../../lib/beluga.js';
import { sameDeep } from '../../lib/stable.js';
import { workspaceItems } from '../../layout/workspace-row.js';
import type { OverviewItem } from './overview-model.js';
import s from '../overview.module.css';
import { revealLabel } from '../../lib/os-words.js';
import { chordLabel } from '../../lib/shortcuts-model.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';

const ago = (ts: number, now: number): string => {
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return t('views.history.justNow');
  if (m < 60) return t('views.history.minAgo', { n: m });
  const h = Math.round(m / 60);
  return h < 24 ? t('views.history.hAgo', { n: h }) : t('views.history.dAgo', { n: Math.round(h / 24) });
};

/** What every row shares: it's focusable (one at a time, the arrow keys move it), and clicking selects it. */
interface RowBase {
  readonly item: OverviewItem;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  /** Return (or a click): open it. */
  readonly onOpen: (item: OverviewItem) => void;
}

const rowProps = ({ item, selected, onSelect, onOpen }: RowBase, label: string) => ({
  role: 'listitem',
  tabIndex: selected ? 0 : -1,
  'data-row': item.ws.id,
  'aria-label': label,
  'aria-current': selected ? ('true' as const) : undefined,
  onFocus: () => onSelect(item.ws.id),
  onClick: (e: MouseEvent) => {
    // A button inside the row does its own thing.
    if ((e.target as HTMLElement).closest('button')) return;
    onOpen(item);
  },
  onKeyDown: (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(item);
    }
  },
});

/** A live plan: one row (its tasks are inside it), with what the plan as a whole waits on. */
function PlanItemRow(props: RowBase & { now: number }) {
  const t = useT();
  const { item, now } = props;
  const plan = item.plan!;
  const act = useApp((st) => activityOf(st.log, `ws:${item.ws.id}`));
  const tone = item.needs ? 'warn' : item.rank === 2 ? 'claude' : 'muted';
  const items: ActionItem[] = [{ label: t('views.rows.openPlan'), icon: 'chevronRight', onSelect: () => props.onOpen(item) }];
  return (
    <ActionsContext items={items}>
      <div {...rowProps(props, plan.tip ? t('views.rows.planLabelTip', { title: plan.title, tip: plan.tip }) : t('views.rows.planLabel', { title: plan.title }))} className={s.row} data-plan-item={plan.plan.id}>
        <span className={s.kind}>
          <Icon name="flag" size={14} />
        </span>
        <span className={s.name}>
          {plan.title}
          {plan.unread ? <span className={s.unread}>{t('views.rows.new', { count: plan.unread })}</span> : null}
        </span>
        <span className={s.branch}>{t('views.rows.plan')}</span>
        <span className={cx(s.state, s[`tone_${tone}`])}>
          <Dot tone={tone === 'claude' ? 'plan' : tone} live={item.rank === 2} />
          {plan.tip || t('views.rows.planState')}
        </span>
        <span className={s.extra} title={item.last}>
          {item.last ?? ''}
        </span>
        <span className={s.when}>{act.lastTs ? ago(act.lastTs, now) : ''}</span>
      </div>
    </ActionsContext>
  );
}

/** A live worktree or chat: as the Overview always showed it (state, PR, context, when). A plan's is the plan's row. */
export function ActiveRow(props: RowBase & { now: number }) {
  return props.item.plan ? <PlanItemRow {...props} /> : <WorkspaceItemRow {...props} />;
}

const sameRow = <T,>(a: T, b: T): boolean => sameDeep(a, b, 2);

function WorkspaceItemRow(props: RowBase & { now: number }) {
  const { item, now } = props;
  const t = useT();
  const w = item.ws;
  const actions = useActions();
  const { client } = useBeluga();
  // What the row shows, worked out from the shared state: drawn again only when part of it changes.
  const { st, running, lastTs, unread, pr, ctx } = useApp((full) => {
    const act = activityOf(full.log, `ws:${w.id}`);
    return { st: stateOf(full, w, 0), running: act.running, lastTs: act.lastTs, unread: full.unread[`ws:${w.id}`] ?? 0, pr: full.prs[w.id], ctx: full.context[`ws:${w.id}`] };
  }, sameRow);
  return (
    <ActionsContext items={() => workspaceItems(client.store.getState(), w, actions.run, client)}>
      <div {...rowProps(props, t('views.rows.rowLabel', { name: w.name, state: st.label }))} className={s.row}>
        <span className={s.kind}>
          <Icon name={w.kind === 'chat' ? 'chat' : w.kind === 'main' ? 'folder' : 'branch'} size={14} />
        </span>
        <span className={s.name}>
          {w.name}
          {unread ? <span className={s.unread}>{t('views.rows.new', { count: unread })}</span> : null}
        </span>
        <span className={s.branch}>{w.branch ?? (w.kind === 'chat' ? t('views.rows.chat') : '')}</span>
        <span className={cx(s.state, s[`tone_${st.tone}`])}>
          <Dot tone={running && w.kind === 'worktree' ? 'worktree' : st.tone} live={running} />
          {st.label}
        </span>
        <span className={s.extra} title={item.last}>
          {pr ? describePr(pr) : ''}
          {ctx ? `${pr ? ' · ' : ''}${t('views.rows.context', { percent: Math.round((ctx.used / ctx.window) * 100) })}` : ''}
          {!pr && !ctx && item.last ? item.last : ''}
        </span>
        <span className={s.when}>{lastTs ? ago(lastTs, now) : item.size !== undefined ? formatBytes(item.size) : ''}</span>
      </div>
    </ActionsContext>
  );
}

export interface ArchivedActions {
  readonly restore: (item: OverviewItem) => void;
  readonly read: (item: OverviewItem) => void;
  readonly finder: (item: OverviewItem) => void;
  readonly remove: (item: OverviewItem) => void;
  /** The one being restored right now (its button says so). */
  readonly restoring: string | undefined;
}

/** The archived row's menu: right-click, or its ⋯ button. */
export function archivedItems(item: OverviewItem, act: ArchivedActions): ActionItem[] {
  return [
    { label: t('views.rows.restore'), icon: 'refresh', hint: item.ws.kind === 'worktree' ? (item.ws.archive ? t('views.rows.restoreHintBack') : t('views.rows.restoreHintRemake')) : t('views.rows.restoreHintChat'), onSelect: () => act.restore(item) },
    { label: t('views.rows.readConversation'), icon: 'eye', keys: 'Space', onSelect: () => act.read(item) },
    ...(item.project.root ? [{ label: revealLabel('Project'), icon: 'folder' as const, onSelect: () => act.finder(item) }] : []),
    { label: t('views.rows.deleteForGood'), danger: true, keys: chordLabel('Cmd+Backspace'), onSelect: () => act.remove(item) },
  ];
}

/**
 * An archived worktree or chat, quiet: its folder is gone (a chat keeps its own), its branch
 * and conversation are kept. Hover (or select) for Restore, Read and ⋯; right-click for all.
 */
export function ArchivedRow(props: RowBase & { act: ArchivedActions }) {
  const t = useT();
  const { item, act } = props;
  const w = item.ws;
  const worktree = w.kind === 'worktree';
  const busy = act.restoring === w.id;
  // Archived smartly: everything of yours is kept, and it says what it freed.
  const smart = w.archive;
  const kept = smart ? (smart.freedBytes ? t('views.rows.freed', { size: formatBytes(smart.freedBytes) }) : t('views.rows.everythingKept')) : worktree && w.branch ? t('views.rows.branchKept') : t('views.rows.conversationKept');
  const keptLong = smart
    ? t('views.rows.keptLong', { size: formatBytes(smart.keptBytes) }) +
      (smart.freedBytes ? (smart.remake.length ? t('views.rows.clearedRemake', { size: formatBytes(smart.freedBytes), remake: smart.remake.join(', ') }) : t('views.rows.cleared', { size: formatBytes(smart.freedBytes) })) : '')
    : worktree && w.branch
      ? t('views.rows.folderRemoved', { branch: w.branch })
      : t('views.rows.conversationIsKept');
  const items = archivedItems(item, act);
  return (
    <ActionsContext items={items}>
      <div {...rowProps(props, t('views.rows.archivedLabel', { name: w.name }))} className={cx(s.row, s.archived)}>
        <span className={s.kind}>
          <Icon name="archive" size={14} />
        </span>
        <span className={s.name}>{w.name}</span>
        <span className={s.branch}>{w.branch ?? (w.kind === 'chat' ? t('views.rows.chat') : '')}</span>
        <span className={cx(s.state, s.tone_muted)}>
          <Dot tone="muted" />
          {t('views.rows.archived')}
        </span>
        <span className={s.extra} title={keptLong}>
          {kept}
        </span>
        <span className={s.when}>{smart ? formatBytes(smart.keptBytes) : item.size !== undefined ? formatBytes(item.size) : ''}</span>
        <span className={cx(s.hoverActions, busy && s.hoverBusy)}>
          <Tip label={worktree ? (smart ? t('views.rows.restoreTipBack') : t('views.rows.restoreTipRemake')) : t('views.rows.restoreTipChat')}>
            <Button size="small" variant="plain" disabled={busy} onClick={() => act.restore(item)}>
              {busy ? t('views.rows.restoring') : t('views.rows.restore')}
            </Button>
          </Tip>
          <IconButton icon="eye" label={t('views.rows.readConversation')} keys="Space" onClick={() => act.read(item)} />
          <ActionsDropdown items={items}>
            <button type="button" className={s.more} aria-label={t('views.rows.moreFor', { name: w.name })}>
              <Icon name="more" size={14} />
            </button>
          </ActionsDropdown>
        </span>
      </div>
    </ActionsContext>
  );
}
