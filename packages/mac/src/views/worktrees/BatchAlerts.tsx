import { formatBytes } from '@beluga/shared/format.js';
import type { ThreadChildren } from '@beluga/shared/threads.js';
import { Alert } from '../../components/Alert.js';
import { useThreadsChoice } from '../../dialogs/native/ThreadsChoice.js';
import type { WorktreeRow } from './worktrees-model.js';
import { useT } from '../../lib/i18n.js';

/**
 * Before archiving, removing build files from or deleting several worktrees at once: what
 * happens to them, and what it frees or loses. Archiving keeps everything of yours; removing
 * build files keeps the worktrees and clears only what's made again; deleting (live or archived
 * ones) is for good.
 */

export type Batch = 'archive' | 'free' | 'delete';

export function BatchAlert({ batch, rows, rebuildable, onConfirm, onCancel }: { batch: Batch; rows: readonly WorktreeRow[]; rebuildable: number; onConfirm: (children?: ThreadChildren) => void; onCancel: () => void }) {
  const t = useT();
  const n = rows.length;
  const threads = useThreadsChoice(rows.map((r) => r.ws.id), batch === 'delete' ? 'delete' : 'archive');
  const go = (): void => onConfirm(threads.children);
  const freed = rebuildable ? t('project.batch.about', { size: formatBytes(rebuildable) }) : t('project.batch.theirSpace');
  const outside = rows.filter((r) => r.madeBy.kind === 'outside').length;
  if (batch === 'free') {
    return (
      <Alert
        icon="archive"
        tone="info"
        title={t('project.batch.freeTitle', { count: n })}
        message={
          <>
            <p>{t('project.batch.freeDeletes', { freed })}</p>
            <p>{t('project.batch.freeStays')}</p>
          </>
        }
        confirm={{ label: t('project.batch.removeBuildFiles'), onClick: () => onConfirm() }}
        onCancel={onCancel}
      />
    );
  }
  if (batch === 'delete' && !rows.some((r) => r.archived)) {
    // Beluga's own go with everything in them; another tool's (or a sub-agent's) only if git lets them, branch kept.
    const own = rows.filter((r) => r.madeBy.kind === 'beluga');
    const files = own.reduce((k, r) => k + (r.left?.files ?? 0), 0);
    const commits = own.filter((r) => r.ws.branch).reduce((k, r) => k + (r.left?.commits ?? 0), 0);
    const branches = own.filter((r) => r.ws.branch).length;
    const theirs = n - own.length;
    return (
      <Alert
        icon="alert"
        tone="danger"
        title={t('project.batch.deleteTitle', { count: n })}
        message={
          <>
            <p>
              {t(n === 1 ? 'project.batch.itsFolder' : 'project.batch.theirFolders')}
              {branches ? t('project.batch.andBranches', { count: branches }) + (commits ? t('project.batch.commitsNotInMain', { count: commits }) : '') : ''}.
              {files ? ` ${t('project.batch.filesLost', { count: files })}` : ''}
            </p>
            {theirs ? <p>{n === 1 ? t('project.batch.theirsIt') : theirs === 1 ? t('project.batch.theirsOne') : t('project.batch.theirsMany', { n: theirs })}</p> : null}
            <p>{t(n === 1 ? 'project.batch.cantUndoIt' : 'project.batch.cantUndoThem')}</p>
          </>
        }
        confirm={{ label: t('project.batch.deleteConfirm', { count: n }), destructive: true, onClick: go }}
        onCancel={onCancel}
      >
        {threads.box}
      </Alert>
    );
  }
  if (batch === 'delete') {
    const branches = rows.filter((r) => r.madeBy.kind === 'beluga' && r.ws.branch).length;
    const saved = rows.filter((r) => r.ws.archive).length;
    const savedWords = saved ? (saved === n ? t('project.batch.theirArchives') : t('project.batch.archives', { count: saved })) : '';
    const branchWords = branches ? t('project.batch.branchesMade', { count: branches }) : '';
    return (
      <Alert
        icon="alert"
        tone="danger"
        title={t('project.batch.deleteArchivedTitle', { count: n })}
        message={
          <>
            <p>
              {savedWords && branchWords ? t('project.batch.bothGo', { saved: savedWords, branches: branchWords }) : savedWords || branchWords ? t('project.batch.go', { what: savedWords || branchWords }) : t('project.batch.conversationsGo')} {t('project.batch.otherBranchesKept')}
            </p>
            <p>{t('project.batch.cantUndo')}</p>
          </>
        }
        confirm={{ label: t('project.batch.deleteConfirm', { count: n }), destructive: true, onClick: go }}
        onCancel={onCancel}
      >
        {threads.box}
      </Alert>
    );
  }
  return (
    <Alert
      icon="archive"
      tone="info"
      title={t('project.batch.archiveTitle', { count: n })}
      message={
        <>
          <p>{t('project.batch.archiveKept', { freed })}</p>
          <p>{t('project.batch.archiveStays')}</p>
          {outside ? <p>{outside === 1 ? t('project.batch.outsideOne') : t('project.batch.outsideMany', { n: outside })}</p> : null}
        </>
      }
      confirm={{ label: t('project.batch.archiveConfirm', { count: n }), onClick: go }}
      onCancel={onCancel}
    >
      {threads.box}
    </Alert>
  );
}
