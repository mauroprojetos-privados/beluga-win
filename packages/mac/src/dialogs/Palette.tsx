import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { findWorkspace, workspaceButtons } from '@beluga/ui/workspace-models.js';
import { macTabs } from '../lib/go.js';
import { groupChatOpen } from '../lib/group-chat.js';
import { worktreeOrigin } from '@beluga/workspaces/origin.js';
import { Icon, type IconName } from '../components/Icon.js';
import { useActions } from '../lib/actions.js';
import { asksBeforeWork } from '../lib/work-confirm.js';
import { useApp, useBeluga, useUi } from '../lib/beluga.js';
import { pickTheme, setPrefs, usePrefs, zoom } from '../lib/prefs.js';
import { THEMES } from '../lib/themes.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { showPanelTab, tabsOf, togglePanel, toggleTerminal } from '../lib/panel.js';
import { PANEL_LABELS, panelFits } from '../lib/panel-model.js';
import { paletteCommands } from './palette-commands.js';
import { newChatProject } from '../lib/project-home.js';
import { networkPaletteItems } from '../network/net-palette.js';
import { useT } from '../lib/i18n.js';
import s from './palette.module.css';

interface Item {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly keys?: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly keywords?: string[];
}

/** A shortcut's keys for an item, when it has some (yours: Settings › Keyboard). */
const keysOf = (id: string): { keys?: string } => {
  const keys = shortcutKeys(id);
  return keys ? { keys } : {};
};

const VIEW_ICONS: Record<string, IconName> = { files: 'folder', overview: 'grid', search: 'search', usage: 'gauge', terminal: 'terminal', tasks: 'task' };

/**
 * Everything you can do, one keystroke away: go anywhere, act on what's open, start something
 * new, any /command, people, and this window's settings. Type to filter.
 */
export function Palette() {
  const t = useT();
  const { ui, client } = useBeluga();
  const actions = useActions();
  const open = useUi((u) => u.palette);
  const state = useApp((st) => st);
  const prefs = usePrefs();
  if (!open) return null;
  const close = (): void => ui.patch({ palette: false });
  const go = (fn: () => void) => () => {
    close();
    fn();
  };

  const nav: Item[] = macTabs(state).map((tab) => ({ id: `view:${tab.kind}`, label: tab.label, hint: tab.hint.split(' · ')[0], ...keysOf(`go-${tab.kind}`), icon: VIEW_ICONS[tab.kind] ?? 'grid', run: () => actions.run({ type: 'view', view: { kind: tab.kind } }) }));
  const places: Item[] = [
    // Each project's home (its main folder: Update main, its worktrees and chats).
    ...state.projects.filter((p) => p.root).map((p) => ({ id: `project:${p.id}`, label: p.name, hint: t('sheets.palette.projectHome'), icon: 'folder' as IconName, run: () => actions.run({ type: 'view', view: { kind: 'project', id: p.id } }) })),
    ...state.projects.flatMap((p) =>
      p.workspaces
        // A project's main checkout is no conversation (BLG-70): the project itself is listed instead.
        .filter((w) => !w.archived && w.kind !== 'main' && worktreeOrigin(w) !== 'agent')
        .map((w) => ({ id: `ws:${w.id}`, label: p.root ? `${p.name} › ${w.name}` : w.name, hint: w.branch ?? (w.kind === 'chat' ? t('sheets.palette.chat') : ''), icon: (w.kind === 'chat' ? 'chat' : 'branch') as IconName, run: () => actions.run({ type: 'open_ws', id: w.id }) })),
    ),
    ...state.shared.map((w) => ({ id: `shared:${w.id}`, label: w.name, hint: t('sheets.palette.sharedBy', { name: state.peers.find((p) => p.peerId === w.owner)?.name ?? t('sheets.palette.someone') }), icon: 'share' as IconName, run: () => actions.run({ type: 'open_shared', owner: w.owner, id: w.id, tab: 'chat' }) })),
  ];
  const ws = state.view.kind === 'workspace' ? findWorkspace(state.projects, state.view.id) : undefined;
  const here: Item[] = ws
    ? [
        // The right panel's tabs (the center stays on the conversation).
        ...tabsOf(state).map((tab) => ({ id: `panel:${tab}`, label: t('sheets.palette.showTab', { tab: PANEL_LABELS[tab] }), hint: t('sheets.palette.inThePanel'), ...keysOf(`panel-${tab}`), icon: (tab === 'changes' ? 'diff' : tab === 'files' ? 'folder' : tab === 'terminal' ? 'terminal' : tab === 'history' ? 'clock' : tab === 'scratch' ? 'pulse' : tab === 'background' ? 'play' : tab === 'phone' ? 'phone' : 'inspector') as IconName, run: () => void showPanelTab(state, tab) })),
        ...workspaceButtons(state, ws)
          .filter((b) => !b.disabled)
          .map((b) => ({ id: `ws-action:${b.action}`, label: asksBeforeWork(b.action) ? `${b.label}…` : b.label, hint: b.hint, icon: (b.action === 'merge' ? 'merge' : b.action === 'pr' ? 'pr' : b.action === 'run' ? 'play' : b.action === 'archive' ? 'archive' : b.action === 'share' ? 'share' : b.action === 'handoff' ? 'hand' : b.action === 'review_claude' ? 'review' : b.action === 'commit' ? 'commit' : 'claude') as IconName, run: () => actions.run({ type: 'ws', id: ws.id, action: b.action }) })),
      ]
    : [];
  const chatHere = newChatProject(state);
  const create: Item[] = [
    { id: 'new-chat', label: t('sheets.palette.newChat'), hint: chatHere === 'chats' ? t('sheets.palette.talkAnything') : t('sheets.palette.inProject', { project: state.projects.find((p) => p.id === chatHere)?.name ?? t('sheets.palette.thisProject') }), ...keysOf('new-chat'), icon: 'chat', run: () => actions.run({ type: 'new_chat', projectId: chatHere }) },
    ...state.projects.filter((p) => p.root).flatMap((p) => [
      { id: `new-wt:${p.id}`, label: t('sheets.palette.newWorktreeIn', { project: p.name }), hint: t('sheets.palette.fromLatestOrigin'), icon: 'branch' as IconName, run: () => actions.run({ type: 'new_worktree', projectId: p.id }) },
      { id: `new-chat:${p.id}`, label: t('sheets.palette.newChatIn', { project: p.name }), hint: t('sheets.palette.inMainFolder'), icon: 'chat' as IconName, run: () => actions.run({ type: 'new_chat', projectId: p.id }) },
    ]),
    { id: 'add-project', label: t('sheets.palette.addProject'), icon: 'plus', run: () => actions.run({ type: 'add_project' }) },
    { id: 'new-project', label: t('sheets.palette.newProject'), hint: t('sheets.palette.newProjectHint'), icon: 'folder', keywords: ['create project', 'start project', 'git init'], run: () => ui.patch({ addProject: 'new' }) },
    { id: 'clone-project', label: t('sheets.palette.cloneProject'), hint: t('sheets.palette.cloneProjectHint'), icon: 'download', keywords: ['git clone', 'git url', 'github', 'repository'], run: () => ui.patch({ addProject: 'clone' }) },
    { id: 'share-folder', label: t('sheets.palette.shareFolder'), icon: 'share', run: () => ui.openMenu({ kind: 'share_folder', launchDir: state.home, mine: state.myShares }) },
    // One entry for inviting and adding a friend (BLG-203): /invite does the same.
    { id: 'invite', label: t('sheets.palette.addFriend'), hint: t('sheets.palette.addFriendHint'), icon: 'people', keywords: ['invite', 'invite someone', 'friend', 'code', 'link'], run: () => document.dispatchEvent(new CustomEvent('beluga:invite')) },
    { id: 'templates', label: t('sheets.palette.fromTemplate'), icon: 'wand', run: () => ui.openMenu({ kind: 'templates' }) },
  ];
  const people: Item[] = [
    ...(groupChatOpen(state) ? [{ id: 'view:room', label: t('sheets.palette.groupChat'), hint: t('sheets.palette.groupChatHint'), icon: 'chat' as IconName, run: () => actions.run({ type: 'view', view: { kind: 'room' } }) }] : []),
    ...state.peers
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => p.peerId !== state.selfId)
      .map(({ p, index }) => ({ id: `person:${p.peerId}`, label: p.name, hint: t('sheets.palette.personHint'), icon: 'person' as IconName, run: () => ui.openMenu({ kind: 'person', index }) })),
  ];
  // Friends and groups (the Beluga network), and adding a friend or a group.
  const net = networkPaletteItems(state, client);
  // The /commands as things to do (no `<arg>` syntax); the ones that need more open their sheet.
  const commands: Item[] = paletteCommands({ client, ui, actions, state });
  const window: Item[] = [
    { id: 'settings', label: t('sheets.palette.settings'), ...keysOf('settings'), icon: 'gear', run: () => ui.patch({ settings: 'general' }) },
    { id: 'shortcuts', label: t('sheets.palette.shortcuts'), hint: t('sheets.palette.shortcutsHint'), keywords: ['keys', 'shortcuts', 'remap', 'hotkeys', 'keyboard'], ...keysOf('help-keys'), icon: 'command', run: () => ui.patch({ settings: 'keyboard' }) },
    { id: 'inbox', label: t('sheets.palette.notifications'), hint: t('sheets.palette.notificationsHint'), ...keysOf('inbox'), icon: 'bell', run: () => ui.patch({ notices: true }) },
    { id: 'appearance', label: t('sheets.palette.appearance', { mode: prefs.appearance === 'dark' ? t('sheets.palette.light') : prefs.appearance === 'light' ? t('sheets.palette.system') : t('sheets.palette.dark') }), icon: 'eye', run: () => setPrefs({ appearance: prefs.appearance === 'dark' ? 'light' : prefs.appearance === 'light' ? 'system' : 'dark' }) },
    ...THEMES.map((th) => ({ id: `theme:${th.id}`, label: t('sheets.palette.theme', { name: th.name }), hint: th.base === 'dark' ? t('sheets.palette.darkTheme') : t('sheets.palette.lightTheme'), keywords: ['theme', 'colours', 'colors', 'appearance'], icon: 'eye' as IconName, run: () => pickTheme(th.id) })),
    { id: 'sidebar', label: prefs.sidebar ? t('sheets.palette.hideSidebar') : t('sheets.palette.showSidebar'), ...keysOf('toggle-sidebar'), icon: 'sidebar', run: () => setPrefs({ sidebar: !prefs.sidebar }) },
    ...(panelFits(state.view)
      ? [{ id: 'inspector', label: prefs.inspector ? t('sheets.palette.hidePanel') : t('sheets.palette.showPanel'), hint: t('sheets.palette.panelHint'), ...keysOf('toggle-inspector'), icon: 'panelRight' as IconName, run: () => togglePanel(state.view) }]
      : state.view.kind === 'plan'
        ? [{ id: 'inspector', label: t('sheets.palette.togglePlanChat'), ...keysOf('toggle-inspector'), icon: 'claude' as IconName, run: () => togglePanel(state.view) }]
        : []),
    { id: 'terminal-toggle', label: t('sheets.palette.toggleTerminal'), hint: prefs.termIn === 'drawer' ? t('sheets.palette.underChat') : t('sheets.palette.inThePanel'), ...keysOf('toggle-dock'), icon: 'terminal', run: () => void toggleTerminal(client.store.getState()) },
    { id: 'bigger', label: t('sheets.palette.biggerText'), ...keysOf('zoom-in'), icon: 'plus', run: () => zoom('in') },
    { id: 'smaller', label: t('sheets.palette.smallerText'), ...keysOf('zoom-out'), icon: 'x', run: () => zoom('out') },
    { id: 'copy-answer', label: t('sheets.palette.copyAnswer'), ...keysOf('conv-copy'), icon: 'copy', run: () => void client.api.session.copyLastAnswer() },
    { id: 'stop', label: t('sheets.palette.stopAgent'), icon: 'stop', run: () => void client.api.session.stopAgent() },
  ];
  const groups: Array<[string, Item[]]> = [
    [t('sheets.palette.here'), here],
    [t('sheets.palette.goTo'), nav],
    [t('sheets.palette.workspaces'), places],
    [t('sheets.palette.new'), [...create, ...net.create]],
    [t('sheets.palette.friendsGroups'), net.friends],
    [t('sheets.palette.inRoom'), people],
    [t('sheets.palette.window'), window],
    [t('sheets.palette.commands'), commands],
  ];
  return (
    <Dialog.Root open onOpenChange={(v) => (v ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.palette} aria-describedby={undefined}>
          <Dialog.Title className="visually-hidden">{t('sheets.palette.everything')}</Dialog.Title>
          <Command label={t('sheets.palette.everything')} loop>
            <div className={s.inputRow}>
              <Icon name="search" size={15} />
              <Command.Input className={s.input} placeholder={t('sheets.palette.placeholder')} autoFocus />
            </div>
            <Command.List className={s.list}>
              <Command.Empty className={s.empty}>{t('sheets.palette.nothingMatches')}</Command.Empty>
              {groups.map(([heading, items]) =>
                items.length ? (
                  <Command.Group key={heading} heading={heading} className={s.group}>
                    {items.map((it) => (
                      <Command.Item key={it.id} value={`${it.label} ${it.hint ?? ''} ${it.id}`} keywords={it.keywords} className={s.item} onSelect={go(it.run)}>
                        <Icon name={it.icon} size={14} className={s.itemIcon} />
                        <span className={s.label}>{it.label}</span>
                        {it.hint ? <span className={s.hint}>{it.hint}</span> : null}
                        {it.keys ? <kbd className={s.keys}>{it.keys}</kbd> : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null,
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
