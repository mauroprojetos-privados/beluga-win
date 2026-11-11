import { worktreeOrigin } from '@beluga/workspaces/origin.js';
import { Alert } from '../../components/Alert.js';
import { useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import s from './menus.module.css';
import { useT } from '../../lib/i18n.js';

/** Tidy up the worktrees Claude Code sub-agents left in a project: which ones, and what's kept. */
export function AgentsAlert({ menu, close }: NativeMenuProps<'agents'>) {
  const pick = usePick(menu);
  const t = useT();
  const project = useApp((st) => st.projects.find((p) => p.id === menu.projectId));
  if (!project) return null;
  const agents = project.workspaces.filter((w) => !w.archived && worktreeOrigin(w) === 'agent');
  const clean = agents.filter((w) => w.status?.changed === 0).length;
  const table = {
    columns: [t('native.wsShare.worktree'), t('native.agents.branch'), t('native.shared.changes')],
    rows: agents.map((w) => [
      w.name,
      <code key="b">{w.branch ?? '–'}</code>,
      w.status?.changed ? <span className={s.warn}>{t('native.merge.files', { count: w.status.changed })}</span> : <span className={s.muted}>{t('native.agents.none')}</span>,
    ]),
  };
  if (!clean) {
    return (
      <Alert
        icon="branch"
        tone="info"
        title={t('native.agents.left', { count: agents.length, name: project.name })}
        message={t('native.agents.allChanged')}
        table={table}
        cancel={false}
        confirm={{ label: t('common.ok'), onClick: close }}
        onCancel={close}
      />
    );
  }
  return (
    <Alert
      icon="branch"
      tone="caution"
      title={t('native.agents.removeTitle', { count: clean })}
      message={t('native.agents.removeMessage', { count: clean, name: project.name })}
      table={table}
      confirm={{ label: t('native.agents.removeConfirm', { count: clean }), onClick: () => pick('agents-clean') }}
      onCancel={close}
    />
  );
}
