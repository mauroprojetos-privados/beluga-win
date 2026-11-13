import { useMemo } from 'react';
import type { MachineView } from '@beluga/machines/machines.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { Row } from '../layout/sidebar-parts.js';
import side from '../layout/Sidebar.module.css';
import { makeActions, useActions } from '../lib/actions.js';
import { ActionsContext, type ActionItem } from '../components/SpecMenu.js';
import { machineClientOf, machineUiOf } from './pane-clients.js';
import { useApp } from '../lib/beluga.js';
import { MachineMark } from './MachineMark.js';
import { onMachine, paneOf } from './pane-model.js';
import { type Tagged, remoteOnlyProjects, remoteWorkIn, shortName, whereLine } from './remote-work.js';
import { useRemoteSources } from './use-remote.js';
import c from './machines.module.css';
import { useT } from '../lib/i18n.js';
import { t } from '@beluga/shared/i18n/index.js';

/**
 * Your computers' work in the sidebar (BLG-785): their worktrees and chats under the project of
 * the same name, and their projects this Mac doesn't have, each with the computer's mark and short
 * name. An offline computer's stay, greyed, saying when it was seen. Opening one opens it in the
 * pane, drawn with that computer's client (BLG-784).
 */

/**
 * The computer a row runs on: its mark alone (the AWS logo, a server, a Mac mini), so a narrow row
 * keeps its own name; the computer's name is on hover, and the row's label says it.
 */
export function MachineChip({ machine, offline }: { machine: MachineView; offline?: boolean }) {
  const t = useT();
  return (
    <span className={cx(c.rowTag, offline && c.rowTagOff)} title={t('project.machines.on', { name: machine.name })} data-machine-chip={shortName(machine.name)}>
      <MachineMark machine={machine} size={13} />
    </span>
  );
}

/** Whether the window is on this page of that computer. */
function useOnPage(machine: string, id: string): boolean {
  return useApp((st) => {
    const { machine: m, view } = paneOf(st.view);
    return m === machine && view.kind === 'workspace' && view.id === id;
  });
}

/**
 * A computer's worktree's right-click menu (BLG-795): Open, and Archive… and Delete… as on this
 * Mac's rows, asked and done there with its own screen. Offline, or a chat: Open only.
 */
function remoteItems(row: Tagged<{ readonly id: string; readonly kind: string }>, open: () => void): ActionItem[] {
  const items: ActionItem[] = [{ label: t('common.open'), icon: 'chevronRight', onSelect: open }];
  const client = machineClientOf(row.machine.id);
  const ui = machineUiOf(row.machine.id);
  if (row.offline || row.item.kind !== 'worktree' || !client || !ui) return items;
  const run = (action: 'archive' | 'delete') => () => makeActions(client, ui).run({ type: 'ws', id: row.item.id, action });
  return [
    ...items,
    { label: t('project.worktrees.archiveMenu'), icon: 'archive', hint: t('project.worktrees.archiveHint'), separate: true, onSelect: run('archive') },
    { label: t('project.worktrees.deleteMenu'), icon: 'trash', danger: true, onSelect: run('delete') },
  ];
}

function RemoteWorkRow({ t: row, indent }: { t: Tagged<{ readonly id: string; readonly name: string; readonly kind: string }>; indent: number }) {
  const actions = useActions();
  const t = useT();
  const here = useOnPage(row.machine.id, row.item.id);
  const open = (): void => actions.run({ type: 'view', view: onMachine(row.machine.id, { kind: 'workspace', id: row.item.id, tab: 'chat' }) });
  return (
    <ActionsContext items={() => remoteItems(row, open)}>
      <Row
        indent={indent}
        selected={here}
        className={cx(row.offline && c.offlineRow)}
        aria-label={t('project.machines.itemOn', { item: row.item.name, name: row.machine.name })}
        data-machine-row={row.machine.id}
        icon={<Icon name={row.item.kind === 'chat' ? 'chat' : 'branch'} size={13} />}
        label={row.item.name}
        detail={`${row.item.name} · ${whereLine(row)}`}
        trailing={<MachineChip machine={row.machine} offline={row.offline} />}
        onClick={open}
      />
    </ActionsContext>
  );
}

/** A project's worktrees and chats on your computers, under this Mac's project of the same name (`onlyHere`: folded, only the one you're on). */
export function RemoteWorkRows({ name, indent, onlyHere = false }: { name: string; indent: number; onlyHere?: boolean }) {
  const sources = useRemoteSources();
  const here = useApp((st) => {
    const { machine, view } = paneOf(st.view);
    return machine && view.kind === 'workspace' ? `${machine}/${view.id}` : undefined;
  });
  const rows = useMemo(() => remoteWorkIn(name, sources).filter((t) => !onlyHere || `${t.machine.id}/${t.item.id}` === here), [name, sources, onlyHere, here]);
  return (
    <>
      {rows.map((t) => (
        <RemoteWorkRow key={`${t.machine.id}/${t.item.id}`} t={t} indent={indent} />
      ))}
    </>
  );
}

/** Your computers' projects this Mac doesn't have: each with its computer, and its worktrees and chats. */
export function RemoteProjects({ local }: { local: ReadonlySet<string> }) {
  const sources = useRemoteSources();
  const t = useT();
  const projects = useMemo(() => remoteOnlyProjects(local, sources), [local, sources]);
  if (!projects.length) return null;
  return (
    <div role="group" aria-label={t('project.machines.onYourComputers')}>
      {projects.map((p) => (
        <div key={`${p.machine.id}/${p.item.id}`}>
          <Row
            className={cx(side.projectRow, p.offline && c.offlineRow)}
            aria-label={t('project.machines.itemOn', { item: p.item.name, name: p.machine.name })}
            icon={<Icon name="folder" size={13} />}
            label={p.item.name}
            detail={`${p.item.name} · ${whereLine(p)}`}
            trailing={<MachineChip machine={p.machine} offline={p.offline} />}
          />
          {p.item.workspaces
            .filter((w) => w.kind !== 'main')
            .map((w) => (
              <RemoteWorkRow key={w.id} t={{ ...p, item: w }} indent={2} />
            ))}
        </div>
      ))}
    </div>
  );
}
