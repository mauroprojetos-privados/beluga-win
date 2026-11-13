import type { KeyboardEvent, MouseEvent } from 'react';
import type { ArchivePreview } from '@beluga/workspaces/archive.js';
import { formatBytes } from '@beluga/shared/format.js';
import { planTitle } from '@beluga/core/plans/model.js';
import { planOwnerOf } from '@beluga/core/plans/owner.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, IconButton, Tip, cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApp } from '../../lib/beluga.js';
import { outsideLocation } from '../../layout/outside-model.js';
import { agoText } from '../project/home-model.js';
import { type MadeBy, type WorktreeRow, archivedText } from './worktrees-model.js';
import s from './worktrees.module.css';
import { revealLabel } from '../../lib/os-words.js';
import { useT } from '../../lib/i18n.js';
import { t } from '@beluga/shared/i18n/index.js';
import { formatDateTime } from '@beluga/shared/i18n/format.js';

const archivingWords = (): Record<'saving' | 'compressing' | 'removing', string> => ({ saving: t('project.worktrees.saving'), compressing: t('project.worktrees.compressing'), removing: t('project.worktrees.removing') });
const stop = (e: MouseEvent): void => e.stopPropagation();

export interface ItemActions {
  readonly archive: (rows: readonly WorktreeRow[]) => void;
  readonly free: (rows: readonly WorktreeRow[]) => void;
  readonly restore: (rows: readonly WorktreeRow[]) => void;
  readonly remove: (rows: readonly WorktreeRow[]) => void;
}

/** Who made it, as a small tinted tag: Beluga's own, a sub-agent's (Claude's colour), or another tool's. */
const made = (): Record<MadeBy['kind'], { icon: IconName; short: string }> => ({
  beluga: { icon: 'terminal', short: 'Beluga' }, // i18n-ignore
  agent: { icon: 'bot', short: t('project.worktrees.subAgent') },
  outside: { icon: 'external', short: t('project.worktrees.outsideBeluga') },
});

function MadeByTag({ by }: { by: MadeBy }) {
  const t = useT();
  const orphan = by.kind === 'agent' && by.orphan;
  const tag = made()[by.kind];
  return (
    <span className={cx(s.madeBy, s[`by_${by.kind}`], orphan && s.orphan)} title={by.label}>
      <Icon name={tag.icon} size={11} />
      <span className={s.madeByText}>{orphan ? t('project.worktrees.shortGone', { short: tag.short }) : tag.short}</span>
    </span>
  );
}

/** The project it's in, by its icon (its name on hover). */
function ProjectMark({ row }: { row: WorktreeRow }) {
  return (
    <Tip label={row.project.name}>
      <span className={s.project} aria-label={row.project.name}>
        <ProjectIcon id={row.project.id} name={row.project.name} size={16} />
      </span>
    </Tip>
  );
}

/** What's in it that isn't in main, as icons and numbers (the words on hover); done: why it's done. */
function Left({ row }: { row: WorktreeRow }) {
  const t = useT();
  const left = row.left;
  if (row.work.done && !left?.files) {
    return (
      <span className={cx(s.work, s.done)} title={row.work.label}>
        <Icon name="check" size={11} /> {row.work.label}
      </span>
    );
  }
  if (!left) return <span className={cx(s.work, s.pending)}>{row.work.label}</span>;
  return (
    <span className={s.work}>
      {left.files ? (
        <Tip label={t('project.worktrees.uncommittedFiles', { count: left.files })}>
          <span className={s.count} aria-label={t('project.worktrees.uncommittedFiles', { count: left.files })}>
            <Icon name="pencil" size={11} />
            {left.files}
          </span>
        </Tip>
      ) : null}
      {left.commits ? (
        <Tip label={t('project.worktrees.commitsNotInMain', { count: left.commits })}>
          <span className={s.count} aria-label={t('project.worktrees.commitsNotInMain', { count: left.commits })}>
            <Icon name="commit" size={12} />
            {left.commits}
          </span>
        </Tip>
      ) : null}
    </span>
  );
}

/** Its name (what a sub-agent was asked, else the worktree's), cut short with all of it on hover; its branch below (and its plan, when it does one's task). */
function NameCell({ row }: { row: WorktreeRow }) {
  const home = useApp((st) => st.home);
  const t = useT();
  const w = row.ws;
  const plan = useApp((st) => {
    const owner = planOwnerOf(st.plans, st.board, w.id);
    return owner ? planTitle(owner.plan) : undefined;
  });
  const where = outsideLocation({ home }, w);
  const task = row.madeBy.kind === 'agent' ? row.madeBy.task : undefined;
  const name = task ?? w.name;
  return (
    <span role="cell" className={s.nameCell}>
      <ProjectMark row={row} />
      <span className={s.nameText}>
        <span className={s.name} title={task ? `${task}\n${w.name}` : name}>
          {name}
        </span>
        <span className={s.sub} title={where?.path ?? w.path}>
          {plan ? (
            <span className={s.planTag} title={t('project.worktrees.partOfPlan', { plan })}>
              <Icon name="flag" size={10} />
              {plan}
            </span>
          ) : null}
          {[w.branch, where?.folder].filter(Boolean).join(' · ') || w.path}
        </span>
      </span>
    </span>
  );
}

/** One worktree: tick it, open it (click), or right-click for what can be done with it. */
export function WorktreeItem({ row, plan, ticked, onTick, act }: { row: WorktreeRow; plan: ArchivePreview | undefined; ticked: boolean; onTick: (on: boolean) => void; act: ItemActions }) {
  const actions = useActions();
  const t = useT();
  const w = row.ws;
  const open = (): void => actions.run({ type: 'open_ws', id: w.id });
  const parent = row.madeBy.kind === 'agent' ? row.madeBy.parentId : undefined;
  const items: ActionItem[] = [
    { label: t('common.open'), icon: 'forward', onSelect: open },
    ...(parent ? [{ label: t('project.worktrees.openStarter'), icon: 'chat' as const, onSelect: () => actions.run({ type: 'open_ws', id: parent }) }] : []),
    { label: revealLabel(), icon: 'folder', onSelect: () => actions.run({ type: 'ws', id: w.id, action: 'finder' }) },
    { label: t('project.worktrees.removeBuildFiles'), icon: 'archive', separate: true, disabled: !plan?.dropBytes, hint: plan && !plan.dropBytes ? t('project.worktrees.noneToRemove') : t('project.worktrees.removeHint'), onSelect: () => act.free([row]) },
    { label: t('project.worktrees.archiveMenu'), icon: 'archive', hint: t('project.worktrees.archiveHint'), onSelect: () => act.archive([row]) },
    { label: t('project.worktrees.deletePermanently'), icon: 'x', danger: true, separate: true, disabled: Boolean(row.archiving), hint: row.madeBy.kind === 'beluga' ? t('project.worktrees.deleteHintOwn') : t('project.worktrees.deleteHintOther'), onSelect: () => act.remove([row]) },
  ];
  const onKey = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') open();
    if (e.key === ' ') {
      e.preventDefault();
      onTick(!ticked);
    }
  };
  return (
    <ActionsContext items={items}>
      <div role="row" tabIndex={0} aria-label={w.name} aria-selected={ticked} className={cx(s.row, ticked && s.ticked, row.archiving && s.busy)} onClick={open} onKeyDown={onKey} data-worktree={w.id}>
        <span role="cell" className={s.tick} onClick={stop}>
          <input type="checkbox" aria-label={t('project.worktrees.select', { name: w.name })} checked={ticked} disabled={Boolean(row.archiving)} onChange={(e) => onTick(e.target.checked)} />
        </span>
        <NameCell row={row} />
        <span role="cell" className={s.madeByCell}>
          <MadeByTag by={row.madeBy} />
        </span>
        <span role="cell">
          <Left row={row} />
        </span>
        <span role="cell" className={s.size}>
          {row.size !== undefined ? formatBytes(row.size) : '–'}
        </span>
        <span role="cell" className={s.size} title={plan?.drop.map((d) => `${d.path} (${d.what}): ${formatBytes(d.bytes)}`).join('\n') || undefined}>
          {row.archiving ? <span className={s.phase}>{archivingWords()[row.archiving]}</span> : plan ? (plan.dropBytes ? formatBytes(plan.dropBytes) : t('project.worktrees.noneSize')) : <span className={s.pending}>…</span>}
        </span>
        <span role="cell" className={s.more} onClick={stop}>
          <ActionsDropdown items={items}>
            <IconButton icon="more" label={t('project.worktrees.moreFor', { name: w.name })} />
          </ActionsDropdown>
        </span>
      </div>
    </ActionsContext>
  );
}

/** One archived worktree: whether it can come back (Restore, right there) and what deleting it would lose. */
export function ArchivedItem({ row, ticked, onTick, act, busy }: { row: WorktreeRow; ticked: boolean; onTick: (on: boolean) => void; act: ItemActions; busy: boolean }) {
  const t = useT();
  const w = row.ws;
  const a = row.archived!;
  const text = archivedText(row, formatBytes);
  const items: ActionItem[] = [
    { label: t('project.worktrees.restore'), icon: 'refresh', disabled: !a.restorable, hint: text.restore, onSelect: () => act.restore([row]) },
    { label: t('project.worktrees.deletePermanently'), icon: 'x', danger: true, separate: true, hint: text.remove, onSelect: () => act.remove([row]) },
  ];
  const onKey = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' && a.restorable) act.restore([row]);
    if (e.key === ' ') {
      e.preventDefault();
      onTick(!ticked);
    }
  };
  return (
    <ActionsContext items={items}>
      <div role="row" tabIndex={0} aria-label={w.name} aria-selected={ticked} className={cx(s.row, s.archivedRow, ticked && s.ticked)} onKeyDown={onKey} data-worktree={w.id}>
        <span role="cell" className={s.tick}>
          <input type="checkbox" aria-label={t('project.worktrees.select', { name: w.name })} checked={ticked} onChange={(e) => onTick(e.target.checked)} />
        </span>
        <NameCell row={row} />
        <span role="cell" className={s.madeByCell}>
          <MadeByTag by={row.madeBy} />
        </span>
        <span role="cell" className={s.size} title={a.at ? formatDateTime(a.at) : undefined}>
          {a.at ? agoText(a.at) : '–'}
        </span>
        <span role="cell" className={cx(s.comesBack, !a.restorable && s.cannot)} title={`${text.restore}. ${text.remove}`}>
          {a.restorable ? (w.archive ? t('project.worktrees.asItWas') : t('project.worktrees.fromBranch')) : t('project.worktrees.cantComeBackShort')}
        </span>
        <span role="cell" className={s.archivedActions}>
          {a.restorable ? (
            <Button size="small" variant="plain" icon="refresh" disabled={busy} onClick={() => act.restore([row])}>
              {t('project.worktrees.restore')}
            </Button>
          ) : null}
          <Tip label={text.remove}>
            <Button size="small" variant="quiet" disabled={busy} onClick={() => act.remove([row])}>
              {t('project.worktrees.deleteMenu')}
            </Button>
          </Tip>
        </span>
      </div>
    </ActionsContext>
  );
}
