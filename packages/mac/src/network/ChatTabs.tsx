import { type ReactNode, useEffect } from 'react';
import type { NetworkState } from '@beluga/net/mesh/views.js';
import type { SocketClient } from '@beluga/ipc/socket-client.js';
import { Icon } from '../components/Icon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../components/SpecMenu.js';
import { Badge, Tip, cx } from '../components/ui.js';
import { copyText } from '../lib/copy.js';
import { useBeluga } from '../lib/beluga.js';
import { getPrefs, setPrefs, usePrefs } from '../lib/prefs.js';
import { GroupAvatar, PersonAvatar } from './Avatars.js';
import { MAIN_TAB, channelName, chatTabs, closeTab, openTab } from './chat-model.js';
import { conversationOf, groupId, openGroupInvitation, shownState, sortFriends } from './net-model.js';
import { openNet } from './net-sheets.js';
import { errorText, openConversation, useNetwork, useSay } from './use-net.js';
import s from './network.module.css';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';

/**
 * Chats as tabs above the conversation: your main channel (all your friends) always first,
 * then the channels and people you opened. Close a tab and the chat stays in the sidebar;
 * + starts a new channel or opens a friend (⌘W stays the window's: the menu bar owns it).
 */

/** Go to the main channel (made the first time). */
export async function openMain(client: SocketClient): Promise<void> {
  const id = await client.api.network['channels.main']();
  openConversation(client, groupId(id));
}

/** Go to a chat and keep its tab open. */
export function openChat(client: SocketClient, id: string): void {
  if (id === MAIN_TAB) return void openMain(client).catch((err) => client.store.dispatch({ type: 'toast', text: errorText(err), level: 'error' }));
  openConversation(client, id);
}

/** Close a chat's tab (the conversation stays in the sidebar); the one on screen goes to its neighbour. */
export function closeChat(client: SocketClient, id: string, shown: string | undefined): void {
  const { open, next } = closeTab(getPrefs().chatTabs, id);
  setPrefs({ chatTabs: open });
  if (shown === id) openChat(client, next);
}

function tabInfo(id: string, net: NetworkState): { name: string; unread: number; icon: ReactNode } | undefined {
  if (id === MAIN_TAB) {
    const g = net.main ? net.groups.find((x) => x.id === net.main) : undefined;
    return { name: t('network.allFriends'), unread: g?.unread ?? 0, icon: <Icon name="people" size={13} /> };
  }
  const target = conversationOf(id);
  if (target?.kind === 'dm') {
    const f = net.friends.find((x) => x.peerId === target.peerId);
    return f ? { name: f.name, unread: f.unread, icon: <PersonAvatar name={f.name} id={f.peerId} state={shownState(f)} size={16} /> } : undefined;
  }
  const g = target ? net.groups.find((x) => x.id === target.groupId) : undefined;
  return g ? { name: channelName(net, g), unread: g.active ? g.unread : 0, icon: <GroupAvatar name={g.name} id={g.id} size={16} muted={!g.active} /> } : undefined;
}

export function ChatTabs({ shown }: { shown: string }) {
  const t = useT();
  const { client } = useBeluga();
  const net = useNetwork();
  const prefs = usePrefs();
  const say = useSay();
  const tabs = chatTabs(prefs.chatTabs, shown, net);
  const current = net.main && shown === groupId(net.main) ? MAIN_TAB : shown;
  // What's on screen has a tab (opened from the sidebar, a notification, a link).
  useEffect(() => {
    if (current !== MAIN_TAB && !getPrefs().chatTabs.includes(current) && conversationOf(current)) setPrefs({ chatTabs: openTab(getPrefs().chatTabs, current) });
  }, [current]);

  const newItems: ActionItem[] = [
    { label: t('network.tabs.newChannel'), icon: 'people', onSelect: () => openNet({ kind: 'new_group' }) },
    ...(net.friends.length
      ? [
          {
            label: t('network.sidebar.message'),
            icon: 'chat' as const,
            onSelect: () => undefined,
            submenu: sortFriends(net.friends).map((f) => ({ label: f.name, onSelect: () => openChat(client, `dm:${f.peerId}`) })),
          },
        ]
      : []),
    { label: t('network.settings.addFriendButton'), icon: 'plus', separate: true, onSelect: () => openNet({ kind: 'add_friend' }) },
  ];
  const itemsFor = (id: string): ActionItem[] => {
    const target = conversationOf(id === MAIN_TAB && net.main ? groupId(net.main) : id);
    const g = target?.kind === 'group' ? net.groups.find((x) => x.id === target.groupId) : undefined;
    const copyLink = async (): Promise<void> => {
      if (!g) return;
      const open = openGroupInvitation(net.invitations, g.id) ?? (await client.api.network['groups.invite'](g.id));
      await copyText(open.link);
      say(t('network.sidebar.copiedInvite', { name: channelName(net, g) }));
    };
    return [
      ...(g?.active && g.admin
        ? [
            { label: t('network.sidebar.addPeople'), icon: 'plus' as const, onSelect: () => openNet({ kind: 'add_people', groupId: g.id }) },
            { label: t('network.sidebar.copyInvite'), icon: 'link' as const, onSelect: () => void copyLink().catch(() => undefined) },
          ]
        : []),
      ...(g ? [{ label: t('network.header.channelInfo'), icon: 'info' as const, onSelect: () => openNet({ kind: 'group_info', groupId: g.id }) }] : []),
      ...(id !== MAIN_TAB
        ? [
            { label: t('network.tabs.closeTab'), separate: true, onSelect: () => closeChat(client, id, current) },
            { label: t('network.tabs.closeOthers'), disabled: tabs.length <= 2, onSelect: () => setPrefs({ chatTabs: [id] }) },
          ]
        : []),
      ...(g?.active ? [{ label: t('network.sidebar.leaveChannel'), danger: true, separate: true, onSelect: () => openNet({ kind: 'leave_group', groupId: g.id }) }] : []),
      ...(g && !g.active ? [{ label: t('network.sidebar.deleteChannel'), danger: true, separate: true, onSelect: () => openNet({ kind: 'delete_group', groupId: g.id }) }] : []),
    ];
  };

  return (
    <div className={s.tabs} role="tablist" aria-label={t('network.tabs.chats')}>
      {tabs.map((id) => {
        const info = tabInfo(id, net);
        if (!info) return null;
        const selected = id === current;
        return (
          <ActionsContext key={id} items={() => itemsFor(id)}>
            <div className={cx(s.tab, selected && s.tabOn)} data-chat-tab={id}>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className={s.tabMain}
                onClick={() => openChat(client, id)}
                onAuxClick={(e) => {
                  if (e.button === 1 && id !== MAIN_TAB) closeChat(client, id, current);
                }}
              >
                <span className={s.tabIcon}>{info.icon}</span>
                <span className={s.tabName}>{info.name}</span>
                {info.unread && !selected ? <Badge count={info.unread} urgent /> : null}
              </button>
              {id !== MAIN_TAB ? (
                <button type="button" className={s.tabClose} aria-label={t('network.tabs.closeName', { name: info.name })} onClick={() => closeChat(client, id, current)}>
                  <Icon name="x" size={9} />
                </button>
              ) : null}
            </div>
          </ActionsContext>
        );
      })}
      <ActionsDropdown items={newItems} align="start">
        <span>
          <Tip label={t('network.tabs.newTip')}>
            <button type="button" className={s.tabNew} aria-label={t('network.tabs.newChat')}>
              <Icon name="plus" size={12} />
            </button>
          </Tip>
        </span>
      </ActionsDropdown>
    </div>
  );
}
