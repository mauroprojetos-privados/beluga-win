import { NewLabelSheet } from '../../tasks/NewLabelSheet.js';
import { ProjectContextSheet } from '../../tasks/ProjectContextSheet.js';
import { EnvironmentSheet } from '../EnvironmentSheet.js';
import { NewTaskSheet } from '../../tasks/NewTaskSheet.js';
import { BoardSheet } from '../../tasks/boards.js';
import { NewSentinelSheet } from '../../sentinel/NewSentinelSheet.js';
import { AddTileSheet } from '../../sentinel/AddTileSheet.js';
import { DocumentSheet } from '../../sentinel/DocumentSheet.js';
import { DataSheet } from '../../sentinel/DataSheet.js';
import { ShareProjectSheet } from './ShareProjectSheet.js';
import { SyncSheet } from '../../tasks/SyncSheet.js';
import { NewPlanSheet, PlanModeSheet, PlanStyleSheet, SendBackSheet } from '../../plans/PlanSheets.js';
import { useState } from 'react';
import { channelOf } from '@beluga/core/store.js';
import { canRunOn } from '@beluga/core/trust.js';
import { menuSpec } from '@beluga/ui/menus.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Alert } from '../../components/Alert.js';
import { Field, FormSheet, Popup, TextInput } from '../../components/FormSheet.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp, useBeluga, useMachine } from '../../lib/beluga.js';
import { type NativeSheet, closeSheet, useSheet } from '../../lib/sheets.js';
import { RemoteWorktreeForm } from './RemoteWorktreeSheet.js';
import { TemplateEditorSheet } from './TemplatesSheet.js';
import { ContinueSheet } from './ContinueSheet.js';
import { ForkToMacSheet } from './ForkToMacSheet.js';
import { ImportConversationSheet } from './ImportConversationSheet.js';
import { CleanUpWorktreesAlert } from './CleanUpWorktrees.js';
import { DeleteProjectAlert } from './DeleteProjectAlert.js';
import { WorkConfirm } from './WorkConfirm.js';
import { GitTroubleSheet } from './GitTroubleSheet.js';
import { useT } from '../../lib/i18n.js';
import { rich } from './parts.js';

/** The folder and branch name Beluga makes from a name (as the core's `slug` does). */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Fork a workspace: a copy with its committed work and its conversation, under a new name. */
function ForkSheet({ wsId, close }: { wsId: string; close: () => void }) {
  const api = useApi();
  const t = useT();
  const ws = useApp((st) => findWorkspace(st.projects, wsId));
  const siblings = useApp((st) => st.projects.find((p) => p.workspaces.some((w) => w.id === wsId))?.workspaces);
  const [name, setName] = useState(ws ? `${ws.name}-2` : '');
  if (!ws) return null;
  const taken = siblings?.some((w) => w.name === slug(name));
  return (
    <FormSheet
      title={t('native.workSheets.forkTitle', { name: ws.name })}
      icon="branch"
      intro={t('native.workSheets.forkIntro')}
      submitLabel={t('native.fork.fork')}
      canSubmit={Boolean(slug(name)) && !taken}
      onSubmit={() => {
        void api.workspaces.fork(ws.id, name.trim());
        close();
      }}
      onCancel={close}
      width={500}
    >
      <Field label={t('native.fork.name')} htmlFor="fork-name" error={taken ? t('native.workSheets.nameTaken') : undefined} hint={slug(name) ? rich(t('native.workSheets.branchHint'), { branch: <code>beluga/{slug(name)}</code> }) : undefined}>
        <TextInput id="fork-name" value={name} onChange={setName} maxLength={120} invalid={taken} />
      </Field>
    </FormSheet>
  );
}

/** Run one command on a friend's computer; the output shows in this chat. */
function PeerRunSheet({ peerId, close }: { peerId?: string; close: () => void }) {
  const api = useApi();
  const t = useT();
  const peers = useApp((st) => st.peers);
  const granted = useApp((st) => st.granted);
  const view = useApp((st) => st.view);
  const able = peers.filter((p) => canRunOn(granted[p.peerId]?.level));
  const [who, setWho] = useState(peerId ?? able[0]?.peerId ?? '');
  const [command, setCommand] = useState('');
  const peer = peers.find((p) => p.peerId === who);
  const full = granted[who]?.level === 'full';
  if (!able.length && !peer) {
    return (
      <Alert
        icon="terminal"
        tone="info"
        title={t('native.workSheets.nobodyRun')}
        message={t('native.workSheets.nobodyRunMessage')}
        cancel={false}
        confirm={{ label: t('common.ok'), onClick: close }}
        onCancel={close}
      />
    );
  }
  return (
    <FormSheet
      title={peer ? t('native.workSheets.runOn', { name: peer.name }) : t('native.workSheets.runOnFriend')}
      icon="terminal"
      intro={peer ? (full ? t('native.workSheets.runsRightAway') : t('native.workSheets.approvesFirst', { name: peer.name })) : t('native.workSheets.outputHere')}
      submitLabel={t('native.person.run')}
      canSubmit={Boolean(peer && command.trim())}
      onSubmit={() => {
        if (!peer) return;
        void api.session.runOnPeerByHand(peer.name, command.trim(), channelOf(view));
        close();
      }}
      onCancel={close}
      width={520}
    >
      {peerId ? null : (
        <Field label={t('native.workSheets.on')} htmlFor="run-peer">
          <Popup id="run-peer" label={t('native.workSheets.whoseComputer')} value={who} onChange={setWho} options={able.map((p) => ({ value: p.peerId, label: t('native.workSheets.nameComputer', { name: p.name }) }))} />
        </Field>
      )}
      <Field label={t('native.workSheets.command')} htmlFor="run-command">
        {/* i18n-ignore: a command */}
        <TextInput id="run-command" value={command} onChange={setCommand} mono placeholder="npm test" data-autofocus />
      </Field>
    </FormSheet>
  );
}

/** What removing or leaving does, asked before the menu option runs. */
function OptionAlert({ sheet, close }: { sheet: Extract<NativeSheet, { kind: 'confirm_option' }>; close: () => void }) {
  const actions = useActions();
  const t = useT();
  const { client } = useBeluga();
  const state = client.store.getState();
  const go = (): void => {
    close();
    actions.pick(sheet.menu, sheet.index, true);
  };
  const { menu } = sheet;
  const project = menu.kind === 'project' ? state.projects.find((p) => p.id === menu.id) : undefined;
  const shared = menu.kind === 'shared' ? state.shared.find((w) => w.owner === menu.owner && w.id === menu.id) : undefined;
  const owner = shared ? (state.peers.find((p) => p.peerId === shared.owner)?.name ?? t('native.workSheets.theOwner')) : '';
  switch (sheet.id) {
    case 'p-hide':
      return (
        <Alert
          icon="eye"
          tone="info"
          title={t('native.workSheets.hideTitle', { name: project?.name ?? t('native.workSheets.thisProject') })}
          message={t('native.workSheets.hideMessage')}
          confirm={{ label: t('native.workSheets.hideProject'), onClick: go }}
          onCancel={close}
        />
      );
    case 'sh-leave':
      return (
        <Alert
          icon="share"
          tone="caution"
          title={t('native.workSheets.leaveTitle', { name: shared?.name ?? t('native.workSheets.thisWorkspace') })}
          message={t('native.workSheets.leaveMessage', { owner })}
          confirm={{ label: t('native.person.leave'), destructive: true, onClick: go }}
          onCancel={close}
        />
      );
    default: {
      // Anything else that asks first: its own words from the menu.
      const option = menuSpec(state, menu)?.options[sheet.index];
      return <Alert title={t('native.workSheets.optionTitle', { label: option?.label ?? t('native.work.continue') })} message={option?.hint} confirm={{ label: option?.label ?? t('common.ok'), destructive: true, onClick: go }} onCancel={close} />;
    }
  }
}

/** Sheets this window opens instead of typing into the message box (see lib/sheets.ts). */
export function NativeSheets() {
  // A computer's page draws its own (machines/MachinePane.tsx); the window's, this Mac's.
  const sheet = useSheet(useMachine());
  if (!sheet) return null;
  const close = closeSheet;
  switch (sheet.kind) {
    case 'fork':
      return <ForkSheet key={sheet.wsId} wsId={sheet.wsId} close={close} />;
    case 'continue_worktree':
      return <ContinueSheet key={sheet.wsId} wsId={sheet.wsId} close={close} />;
    case 'fork_to_mac':
      return <ForkToMacSheet key={sheet.wsId} owner={sheet.owner} wsId={sheet.wsId} close={close} />;
    case 'peer_run':
      return <PeerRunSheet key={sheet.peerId ?? ''} {...(sheet.peerId ? { peerId: sheet.peerId } : {})} close={close} />;
    case 'template':
      return <TemplateEditorSheet close={close} />;
    case 'remote':
      return <RemoteWorktreeForm key={sheet.peerId} peerId={sheet.peerId} {...(sheet.project ? { project: sheet.project } : {})} close={close} />;
    case 'confirm_option':
      return <OptionAlert sheet={sheet} close={close} />;
    case 'work':
      return <WorkConfirm key={`${sheet.wsId}:${sheet.action}`} wsId={sheet.wsId} action={sheet.action} close={close} />;
    case 'clean_up_worktrees':
      return <CleanUpWorktreesAlert key={sheet.projectId} projectId={sheet.projectId} close={close} />;
    case 'delete_project':
      return <DeleteProjectAlert key={sheet.projectId} projectId={sheet.projectId} close={close} />;
    case 'import_conversation':
      return <ImportConversationSheet key={sheet.projectId} projectId={sheet.projectId} close={close} />;
    case 'share_project':
      return <ShareProjectSheet key={sheet.projectId} projectId={sheet.projectId} close={close} />;
    case 'new_task':
      return <NewTaskSheet {...(sheet.boardId ? { boardId: sheet.boardId } : {})} {...(sheet.projectId ? { projectId: sheet.projectId } : {})} {...(sheet.status ? { status: sheet.status } : {})} {...(sheet.parent ? { parent: sheet.parent } : {})} close={close} />;
    case 'task_board':
      return <BoardSheet key={sheet.boardId ?? 'new'} {...(sheet.boardId ? { boardId: sheet.boardId } : {})} {...(sheet.repos ? { repos: sheet.repos } : {})} close={close} />;
    case 'new_label':
      return <NewLabelSheet key={sheet.projectId} projectId={sheet.projectId} {...(sheet.issueId ? { issueId: sheet.issueId } : {})} close={close} />;
    case 'task_sync':
      return <SyncSheet key={sheet.projectId} projectId={sheet.projectId} close={close} />;
    case 'project_context':
      return <ProjectContextSheet key={sheet.projectId} projectId={sheet.projectId} close={close} />;
    case 'project_env':
      return <EnvironmentSheet key={sheet.projectId} projectId={sheet.projectId} close={close} />;
    case 'new_plan':
      return <NewPlanSheet {...(sheet.projectId ? { projectId: sheet.projectId } : {})} close={close} />;
    case 'new_sentinel':
      return <NewSentinelSheet {...(sheet.projectId ? { projectId: sheet.projectId } : {})} {...(sheet.way ? { way: sheet.way } : {})} close={close} />;
    case 'add_tile':
      return <AddTileSheet key={sheet.dashboardId} dashboardId={sheet.dashboardId} close={close} />;
    case 'sentinel_data':
      return <DataSheet key={`${sheet.sentinelId}:${sheet.metric}`} sentinelId={sheet.sentinelId} metric={sheet.metric} close={close} />;
    case 'sentinel_document':
      return <DocumentSheet key={`${sheet.source}:${sheet.name}`} source={sheet.source} sentinelId={sheet.sentinelId} metric={sheet.metric} column={sheet.column} name={sheet.name} close={close} />;
    case 'plan_style':
      return <PlanStyleSheet close={close} />;
    case 'plan_send_back':
      return <SendBackSheet planId={sheet.planId} milestone={sheet.milestone} close={close} />;
    case 'plan_mode':
      return <PlanModeSheet key={sheet.planId} planId={sheet.planId} close={close} />;
    case 'git_trouble':
      return <GitTroubleSheet key={`${sheet.wsId}:${sheet.trouble.kind}`} wsId={sheet.wsId} trouble={sheet.trouble} retry={sheet.retry} close={close} />;
    case 'confirm':
      return (
        <Alert
          title={sheet.title}
          message={sheet.message}
          tone={sheet.destructive ? 'danger' : 'caution'}
          confirm={{
            label: sheet.confirm,
            destructive: sheet.destructive ?? false,
            onClick: () => {
              close();
              sheet.run();
            },
          }}
          {...(sheet.cancel ? { cancel: sheet.cancel } : {})}
          onCancel={close}
        />
      );
  }
}
