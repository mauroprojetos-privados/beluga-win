import { useEffect, useState } from 'react';
import type { ArchivePreview } from '@beluga/workspaces/archive.js';
import { formatBytes } from '@beluga/shared/format.js';
import type { EnvChange } from '@beluga/workspaces/env.js';
import type { DeletePlan } from '@beluga/workspaces/types.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Alert, Checkbox } from '../../components/Alert.js';
import { useApi, useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import { useThreadsChoice } from './ThreadsChoice.js';
import s from './menus.module.css';
import { useT } from '../../lib/i18n.js';
import { rich } from './parts.js';

const NO_ENV: readonly EnvChange[] = [];

/** The keys that differ in one env file, as small tags: +NEW, ~CHANGED, −REMOVED. */
export function EnvKeys({ change }: { change: EnvChange }) {
  const t = useT();
  if (change.binary) return <span className={s.muted}>{t('native.confirm.fileDiffers')}</span>;
  return (
    <span className={s.keys}>
      {change.added.map((k) => (
        <span key={`+${k}`} className={s.keyAdded} title={t('native.confirm.keyAdded')}>
          +{k}
        </span>
      ))}
      {change.changed.map((k) => (
        <span key={`~${k}`} className={s.keyChanged} title={t('native.confirm.keyChanged')}>
          ~{k}
        </span>
      ))}
      {change.removed.map((k) => (
        <span key={`-${k}`} className={s.keyRemoved} title={t('native.confirm.keyRemoved')}>
          −{k}
        </span>
      ))}
    </span>
  );
}

/** What archiving a worktree would clear (asked once the dialog opens; undefined until then). */
function useArchivePlan(id: string, worktree: boolean): ArchivePreview | undefined {
  const api = useApi();
  const [plan, setPlan] = useState<ArchivePreview | undefined>();
  useEffect(() => {
    if (!worktree) return;
    let live = true;
    api.workspaces.archivePlan(id).then(
      (p) => live && setPlan(p ?? undefined),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [id, worktree]);
  return plan;
}

/** What deleting a worktree would lose that archiving keeps: `null` once asked and there's nothing, undefined while asking. */
function useDeletePlan(id: string, worktree: boolean): DeletePlan | null | undefined {
  const api = useApi();
  const [plan, setPlan] = useState<DeletePlan | null | undefined>(worktree ? undefined : null);
  useEffect(() => {
    if (!worktree) return;
    let live = true;
    api.workspaces.deletePlan(id).then(
      (p) => live && setPlan(p ?? null),
      () => live && setPlan(null),
    );
    return () => {
      live = false;
    };
  }, [id, worktree]);
  return plan;
}

/**
 * Archive or delete a workspace: what happens, in a sentence; archiving keeps everything of
 * yours (uncommitted work too) and says how much space it frees; env changes the main folder
 * doesn't have are listed and copied back if you like.
 */
export function ConfirmAlert({ menu, close }: NativeMenuProps<'confirm'>) {
  const api = useApi();
  const t = useT();
  const threads = useThreadsChoice(menu.id, menu.action);
  const pick = usePick(threads.children ? { ...menu, children: threads.children } : menu);
  const ws = useApp((st) => findWorkspace(st.projects, menu.id));
  const env = useApp((st) => st.envChanges[menu.id] ?? NO_ENV);
  const [copyEnv, setCopyEnv] = useState(true);
  const [saveEnv, setSaveEnv] = useState(false);
  const plan = useArchivePlan(menu.id, menu.action !== 'delete' && ws?.kind === 'worktree' && !ws.archived);
  const lose = useDeletePlan(menu.id, menu.action === 'delete' && ws?.kind === 'worktree' && !ws.external);
  if (!ws) return null;
  const changed = ws.status?.changed ?? 0;
  const table = env.length
    ? {
        caption: t('native.confirm.envCaption'),
        columns: [t('native.confirm.file'), t('native.confirm.keys')],
        rows: env.map((c) => [<code key="f">{c.file}</code>, <EnvKeys key="k" change={c} />]),
      }
    : undefined;
  // Where its env changes go before it does: the main folder's file, Beluga, both, or nowhere (BLG-369).
  const envBox = env.length ? (
    <>
      <Checkbox checked={copyEnv} onChange={setCopyEnv} label={t('native.confirm.copyEnv')} detail={t('native.confirm.copyEnvDetail')} />
      <Checkbox checked={saveEnv} onChange={setSaveEnv} label={t('native.confirm.saveEnv')} detail={t('native.confirm.saveEnvDetail')} />
    </>
  ) : null;
  const boxes =
    envBox || threads.box ? (
      <>
        {threads.box}
        {envBox}
      </>
    ) : null;
  const withEnv = copyEnv && env.length > 0;
  /** Save in Beluga first (it reads the worktree's files, so before they go), then the option. */
  const go = (option: string): void => {
    if (saveEnv && env.length) void api.workspaces.saveEnvInBeluga(menu.id).then(() => pick(option), () => pick(option));
    else pick(option);
  };

  if (menu.action === 'delete') {
    const worktree = ws.kind === 'worktree' && !ws.external;
    const remove = (): void => go(withEnv ? 'confirm-delete-env' : 'confirm-delete');
    // Delete waits until it's known whether unpushed commits would go with it.
    const asking = lose === undefined;
    // Commits pushed nowhere (BLG-617): say how many, and Archive (which keeps them) is the main button.
    if (lose) {
      return (
        <Alert
          icon="alert"
          tone="danger"
          title={t('native.confirm.deleteUnpushedTitle', { name: ws.name })}
          message={
            <>
              <p>{rich(t('native.confirm.unpushed', { count: lose.unpushed }), { n: <strong>{t('native.confirm.commits', { count: lose.unpushed })}</strong>, branch: <code>{lose.branch}</code>, into: <code>{lose.into}</code> })}</p>
              {lose.subjects.length ? (
                <ul className={s.subjects}>
                  {lose.subjects.map((subject, i) => (
                    <li key={i}>{subject}</li>
                  ))}
                </ul>
              ) : null}
              <p>{ws.archived ? t('native.confirm.archivedKeeps') : t('native.confirm.archiveKeeps')}</p>
            </>
          }
          table={table}
          confirm={ws.archived ? { label: t('native.confirm.keepIt'), onClick: close } : { label: t('native.confirm.archiveInstead'), onClick: () => go(withEnv ? 'confirm-archive-env' : 'confirm-archive') }}
          alternative={{ label: t('native.confirm.deleteAnyway'), destructive: true, onClick: remove }}
          onCancel={close}
        >
          {boxes}
        </Alert>
      );
    }
    return (
      <Alert
        icon="alert"
        tone="danger"
        title={t('native.confirm.deleteTitle', { name: ws.name })}
        message={
          <>
            <p>{worktree ? rich(t('native.confirm.deletesWorktree'), { branch: <code>{ws.branch ?? ''}</code> }) : t('native.confirm.removesChat')}</p>
            <p>{t('native.confirm.cantUndo')}</p>
          </>
        }
        table={table}
        confirm={{ label: t('common.delete'), destructive: true, disabled: asking, onClick: remove }}
        onCancel={close}
      >
        {boxes}
      </Alert>
    );
  }

  const worktree = ws.kind === 'worktree';
  const freed = plan?.dropBytes ? t('native.confirm.freed', { size: formatBytes(plan.dropBytes) }) : '';
  const message = (
    <>
      <p>
        {worktree
          ? rich(t('native.confirm.archiveKept', { freed }), {
              changes: changed ? <strong>{t('native.confirm.uncommittedFiles', { count: changed })}</strong> : t('native.confirm.uncommittedChanges'),
              env: <code>.env</code>, // i18n-ignore
            })
          : t('native.confirm.chatLeaves')}
      </p>
      {worktree ? <p>{rich(t('native.confirm.archiveStays', { remake: plan?.remake.length ? t('native.confirm.remake') : '' }), { branch: <code>{ws.branch ?? ''}</code> })}</p> : null}
    </>
  );
  // With env changes, "copy them first" goes before whichever way you archive.
  const archive = (): void => go(withEnv ? 'confirm-archive-env' : 'confirm-archive');
  const commitAndArchive = (): void => {
    if (withEnv) void api.workspaces.applyEnvBack(menu.id).then(() => go('confirm-commit-archive'));
    else go('confirm-commit-archive');
  };
  return (
    <Alert
      icon="archive"
      tone="info"
      title={t('native.confirm.archiveTitle', { name: ws.name })}
      message={message}
      table={table}
      confirm={{ label: t('native.confirm.archive'), onClick: archive }}
      {...(changed ? { alternative: { label: t('native.confirm.commitAndArchive'), onClick: commitAndArchive } } : {})}
      onCancel={close}
    >
      {boxes}
    </Alert>
  );
}
