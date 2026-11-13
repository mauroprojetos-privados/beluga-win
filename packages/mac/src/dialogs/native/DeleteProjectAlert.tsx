import { Alert } from '../../components/Alert.js';
import { worktreeOrigin } from '@beluga/workspaces/origin.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { useT } from '../../lib/i18n.js';
import { rich } from './parts.js';

/**
 * Delete Project…: it leaves Beluga, and so do the worktrees Beluga made for it (archived first,
 * so nothing of yours is lost). The project's own folder is never touched: not deleted, not
 * moved to the Trash. It leaves the sidebar at once; the archiving goes on in the background.
 */
export function DeleteProjectAlert({ projectId, close }: { projectId: string; close: () => void }) {
  const api = useApi();
  const t = useT();
  const project = useApp((st) => st.projects.find((p) => p.id === projectId && p.root));
  if (!project) return null;
  const worktrees = project.workspaces.filter((w) => w.kind === 'worktree' && !w.archived && worktreeOrigin(w) === 'beluga').length;
  const remove = (): void => {
    close();
    void api.workspaces.removeProject(project.id);
  };
  return (
    <Alert
      icon="alert"
      tone="danger"
      title={t('native.deleteProject.title', { name: project.name })}
      message={
        <>
          <p>
            {t('native.deleteProject.leaves')}
            {worktrees ? (
              <>
                {' '}
                {t('native.deleteProject.worktrees', { count: worktrees })}
              </>
            ) : null}
          </p>
          <p>{rich(t('native.deleteProject.folder'), { folder: <code>{project.root}</code> })}</p>
        </>
      }
      confirm={{ label: t('native.deleteProject.confirm'), destructive: true, onClick: remove }}
      onCancel={close}
    />
  );
}
