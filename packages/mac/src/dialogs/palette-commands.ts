import { type AppState, channelOf } from '@beluga/core/store.js';
import { canRunOn } from '@beluga/core/trust.js';
import { type WorkspaceAction, findWorkspace, workspaceButtons } from '@beluga/ui/workspace-models.js';
import type { IconName } from '../components/Icon.js';
import type { Actions } from '../lib/actions.js';
import type { UiStore } from '../lib/beluga.js';
import type { SocketClient } from '@beluga/ipc/socket-client.js';
import { openSettings } from '../lib/native-routes.js';
import { openSheet } from '../lib/sheets.js';
import { openEarnings } from '../lib/earnings.js';
import { openSupport } from '../lib/support.js';
import { SHOW_WELCOME } from '../onboarding/onboarding-model.js';
import { previewRequestPopup } from '../gateway/request-native.js';
import { revealLabel } from '../lib/os-words.js';
import { t } from '../../../../src/shared/i18n/index.js';

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly keywords?: string[];
}

interface Ctx {
  readonly client: SocketClient;
  readonly ui: UiStore;
  readonly actions: Actions;
  readonly state: AppState;
}

/** One command: a name you'd look for, what it does, and the /command it stands for (so typing that finds it too). */
const cmd = (slash: string, id: string, label: string, icon: IconName, run: () => void, hint?: string): PaletteCommand => ({ id: `cmd:${id}`, label, icon, run, keywords: [`/${slash}`, slash], ...(hint ? { hint } : {}) });

/** What you can do in the workspace on screen that its toolbar buttons (the palette's "Here") don't already list. */
function workspaceCommands({ ui, actions, state }: Ctx): PaletteCommand[] {
  const ws = state.view.kind === 'workspace' ? findWorkspace(state.projects, state.view.id) : undefined;
  if (!ws || ws.archived) return [];
  const here = new Set(workspaceButtons(state, ws).filter((b) => !b.disabled).map((b) => b.action));
  const act = (action: WorkspaceAction) => () => actions.run({ type: 'ws', id: ws.id, action });
  const project = state.projects.find((p) => p.id === ws.projectId);
  const worktree = ws.kind === 'worktree';
  const list: Array<[WorkspaceAction, PaletteCommand, boolean]> = [
    ['pr', cmd('pr', 'pr', state.prs[ws.id] ? t('macLib.palette.pr') : t('macLib.palette.createPr'), 'pr', act('pr'), t('macLib.palette.prHint')), worktree],
    ['fork', cmd('fork', 'fork', t('macLib.palette.fork'), 'branch', act('fork'), t('macLib.palette.forkHint')), ws.kind !== 'chat'],
    ['handoff', cmd('handoff', 'handoff', t('macLib.palette.handoff'), 'hand', act('handoff'), t('macLib.palette.handoffHint')), worktree],
    ['commit', cmd('commit', 'commit', t('macLib.palette.commit'), 'commit', act('commit')), worktree && Boolean(ws.status?.changed)],
    ['merge', cmd('merge', 'merge', t('macLib.palette.merge'), 'merge', act('merge')), worktree],
    ['compact', cmd('compact', 'compact', t('macLib.palette.compact'), 'wand', act('compact'), t('macLib.palette.compactHint')), true],
    ['run', cmd('run', 'run', t('macLib.palette.run'), 'play', act('run')), Boolean(project?.scripts?.run)],
    ['setup', cmd('setup', 'setup', t('macLib.palette.setup'), 'refresh', act('setup')), Boolean(project?.scripts?.setup)],
    ['finder', cmd('finder', 'finder', revealLabel(), 'folder', act('finder')), true],
    ['archive', cmd('archive', 'archive', t('macLib.palette.archive'), 'archive', act('archive')), ws.kind !== 'main'],
    ['delete', cmd('delete', 'delete', t('macLib.palette.delete'), 'alert', act('delete')), ws.kind !== 'main'],
  ];
  return [
    ...list.filter(([action, , ok]) => ok && !here.has(action)).map(([, c]) => c),
    ...(project?.root ? [cmd('project', 'scripts', t('macLib.palette.projectSettings'), 'terminal', () => ui.openMenu({ kind: 'scripts', projectId: project.id }), t('macLib.palette.projectSettingsHint'))] : []),
  ];
}

/**
 * The /commands as things to do: a name you'd look for, no `<arg>` syntax. The ones that need
 * more (a name, a command, a note for Claude) open their sheet; nothing is typed for you.
 */
export function paletteCommands(ctx: Ctx): PaletteCommand[] {
  const { client, ui, state } = ctx;
  const api = client.api;
  const channel = channelOf(state.view);
  const talking = state.view.kind === 'room' || state.view.kind === 'assistant' || state.view.kind === 'workspace';
  const following = state.peers.find((p) => p.peerId === state.follow);
  const canRun = state.peers.some((p) => canRunOn(state.granted[p.peerId]?.level));
  return [
    ...workspaceCommands(ctx),
    ...(talking
      ? [
          cmd('clear', 'clear', state.view.kind === 'room' ? t('macLib.palette.clearGroup') : t('macLib.palette.clearConversation'), 'x', () => ui.openMenu({ kind: 'clear', channel, host: state.isHost })),
          cmd('plan', 'plan', state.planMode[channel] ? t('macLib.palette.planOff') : t('macLib.palette.planOn'), 'claude', () => ctx.actions.run({ type: 'plan_toggle', channel }), t('macLib.palette.planHint')),
          cmd('visualize', 'visualize', t('macLib.palette.visualize'), 'grid', () => void api.session.submit('/visualize', { channel }), t('macLib.palette.visualizeHint')),
          cmd('model', 'model', t('macLib.palette.model'), 'spark', () => ui.openMenu({ kind: 'model', ...(channel === 'room' ? {} : { channel }) }), t('macLib.palette.modelHint')),
        ]
      : []),
    ...(state.board.enabled
      ? [
          { id: 'tasks:new', label: t('macLib.palette.newTask'), icon: 'task' as const, hint: t('macLib.palette.newTaskHint'), keywords: ['task', 'issue', 'todo', 'ticket'], run: () => openSheet({ kind: 'new_task' }) },
          { id: 'plans:new', label: t('macLib.palette.newPlan'), icon: 'flag' as const, hint: t('macLib.palette.newPlanHint'), keywords: ['plan', 'milestone', 'roadmap', 'project'], run: () => openSheet({ kind: 'new_plan' }) },
          { id: 'plans:open', label: t('macLib.palette.goPlans'), icon: 'flag' as const, hint: t('macLib.palette.goPlansHint'), keywords: ['plans', 'milestones', 'roadmap'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'plans' } }) },
          { id: 'tasks:open', label: t('macLib.palette.goTasks'), icon: 'task' as const, hint: t('macLib.palette.goTasksHint'), keywords: ['tasks', 'board', 'issues', 'backlog', 'kanban'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'tasks' } }) },
          { id: 'issues:open', label: t('macLib.palette.goIssues'), icon: 'issue' as const, hint: t('macLib.palette.goIssuesHint'), keywords: ['issues', 'github', 'bugs', 'triage', 'investigate', 'fix'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'issues' } }) },
          { id: 'pulls:open', label: t('macLib.palette.goPulls'), icon: 'pr' as const, hint: t('macLib.palette.goPullsHint'), keywords: ['pull requests', 'prs', 'pulls', 'github', 'review', 'merge'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'pulls' } }) },
          { id: 'actions:open', label: t('macLib.palette.goActions'), icon: 'pulse' as const, hint: t('macLib.palette.goActionsHint'), keywords: ['actions', 'github', 'ci', 'workflows', 'runs', 'builds', 'checks', 'pipeline'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'actions' } }) },
        ]
      : []),
    ...(state.sentinel.enabled
      ? [
          { id: 'sentinel:open', label: t('macLib.palette.goSentinel'), icon: 'sentinel' as const, hint: t('macLib.palette.goSentinelHint'), keywords: ['sentinel', 'schedule', 'cron', 'watch', 'every morning', 'brief', 'recurring'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'sentinel' } }) },
          { id: 'dashboard:open', label: t('macLib.palette.goDashboard'), icon: 'gauge' as const, hint: t('macLib.palette.goDashboardHint'), keywords: ['dashboard', 'numbers', 'metrics', 'kpi', 'stats', 'revenue', 'subscribers', 'tiles'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'dashboard' } }) },
          { id: 'sentinel:chat', label: t('macLib.palette.goSentinelChat'), icon: 'chat' as const, hint: t('macLib.palette.goSentinelChatHint'), keywords: ['sentinel', 'chat', 'ask', 'watchers'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'sentinel_chat', ...(ctx.state.sentinel.chats?.active ? { chat: ctx.state.sentinel.chats.active } : {}) } }) },
          { id: 'sentinel:new', label: t('macLib.palette.newSentinel'), icon: 'sentinel' as const, hint: t('macLib.palette.newSentinelHint'), keywords: ['sentinel', 'schedule', 'cron', 'watch', 'recipe', 'automate'], run: () => openSheet({ kind: 'new_sentinel' }) },
        ]
      : []),
    cmd('template', 'template-new', t('macLib.palette.newTemplate'), 'wand', () => openSheet({ kind: 'template' }), t('macLib.palette.newTemplateHint')),
    cmd('template', 'templates', t('macLib.palette.manageTemplates'), 'wand', () => ui.openMenu({ kind: 'templates', manage: true })),
    ...(canRun ? [cmd('run', 'peer-run', t('macLib.palette.peerRun'), 'terminal', () => openSheet({ kind: 'peer_run' }), t('macLib.palette.peerRunHint'))] : []),
    ...(following ? [cmd('unfollow', 'unfollow', t('macLib.palette.unfollow', { name: following.name }), 'eye', () => void api.session.follow(undefined))] : []),
    ...(state.myShares.length ? [cmd('unshare', 'unshare', t('macLib.palette.unshare'), 'share', () => ui.openMenu({ kind: 'share_folder', launchDir: client.launchDir, mine: state.myShares }))] : []),
    cmd('name', 'name', t('macLib.palette.name'), 'person', () => openSettings(ui, 'general', 'settings-name'), state.self?.name ? t('macLib.palette.nameNow', { name: state.self.name }) : undefined),
    cmd('people', 'people', t('macLib.palette.people'), 'people', () => openSettings(ui, 'people'), t('macLib.palette.peopleHint')),
    earningsCommand(state),
    { id: 'cmd:support', label: t('macLib.palette.support'), icon: 'cup', hint: t('macLib.palette.supportHint'), keywords: ['support', 'coffee', 'donate', 'tip', 'sponsor', 'star', 'github'], run: () => openSupport('coffee') },
    cmd('env', 'env', t('macLib.palette.env'), 'lock', () => openSettings(ui, 'environment'), t('macLib.palette.envHint')),
    cmd('shell', 'shell', t('macLib.palette.shell'), 'terminal', () => openSettings(ui, 'terminal'), t('macLib.palette.shellHint')),
    {
      id: 'cmd:popup-preview',
      label: t('macLib.palette.popup'),
      icon: 'bell',
      hint: t('macLib.palette.popupHint'),
      keywords: ['popup', 'pop-up', 'request', 'notification', 'preview', 'test', 'friend'],
      run: previewRequestPopup,
    },
    { id: 'cmd:welcome', label: t('macLib.palette.welcome'), icon: 'spark', hint: t('macLib.palette.welcomeHint'), keywords: ['onboarding', 'welcome', 'tour', 'intro'], run: () => void document.dispatchEvent(new CustomEvent(SHOW_WELCOME)) },
    ...(state.isHost
      ? [
          cmd('lock', 'lock', state.roomOpen ? t('macLib.palette.closeRoom') : t('macLib.palette.openRoom'), 'lock', () => void api.session.setRoomOpen(!state.roomOpen)),
          cmd('newlink', 'newlink', t('macLib.palette.newLink'), 'link', () =>
            openSheet({ kind: 'confirm', title: t('macLib.palette.newLinkTitle'), message: t('macLib.palette.newLinkMessage'), confirm: t('macLib.palette.newLinkConfirm'), run: () => void api.session.newInviteLink() }),
          ),
        ]
      : [cmd('quit', 'quit', t('macLib.palette.leave'), 'x', () => openSheet({ kind: 'confirm', title: t('macLib.palette.leaveTitle'), message: t('macLib.palette.leaveMessage'), confirm: t('macLib.palette.leaveConfirm'), destructive: true, run: () => void api.session.quit() }))]),
  ];
}

/** Connect earnings (or see them) for the project on screen, or pick one in the sheet. */
function earningsCommand(state: AppState): PaletteCommand {
  const ws = state.view.kind === 'workspace' ? findWorkspace(state.projects, state.view.id) : undefined;
  const project = state.projects.find((p) => p.root && p.id === ws?.projectId);
  const connected = project ? Boolean(state.earnings[project.root] || state.revenuecat[project.root]) : false;
  return {
    id: 'cmd:earnings',
    label: project ? (connected ? t('macLib.palette.earnings', { name: project.name }) : t('macLib.palette.connectEarningsTo', { name: project.name })) : t('macLib.palette.connectEarnings'),
    hint: t('macLib.palette.earningsHint'),
    icon: 'coin',
    keywords: ['stripe', 'revenuecat', 'earnings', 'revenue', 'money', 'sales'],
    run: () => openEarnings(project?.id),
  };
}
