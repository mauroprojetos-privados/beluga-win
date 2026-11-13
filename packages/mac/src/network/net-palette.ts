import type { AppState } from '@beluga/core/store.js';
import type { SocketClient } from '@beluga/ipc/socket-client.js';
import type { IconName } from '../components/Icon.js';
import { presenceLine, sortFriends, sortGroups } from './net-model.js';
import { openNet } from './net-sheets.js';
import { openDm, openGroup } from './use-net.js';
import { t } from '@beluga/shared/i18n/index.js';

export interface NetPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly keywords?: string[];
}

/** Friends, groups and their actions in the palette (⌘K): go to a conversation, add a friend, set your status. */
export function networkPaletteItems(state: AppState, client: SocketClient): { readonly create: NetPaletteItem[]; readonly friends: NetPaletteItem[] } {
  const net = state.network;
  if (!net.enabled) {
    return {
      create: [{ id: 'net:turn-on', label: t('network.palette.turnOn'), hint: t('network.palette.turnOnHint'), icon: 'people', run: () => void client.api.network.setEnabled(true), keywords: ['friends', 'network', 'add friend'] }],
      friends: [],
    };
  }
  return {
    create: [
      // Adding a friend is the palette's own Add a friend… (it's Invite too), not a second entry here.
      { id: 'net:new-group', label: t('network.palette.newGroup'), hint: t('network.palette.newGroupHint'), icon: 'people', run: () => openNet({ kind: 'new_group' }), keywords: ['group'] },
      { id: 'net:status', label: t('network.palette.status'), hint: t('network.palette.statusHint'), icon: 'person', run: () => openNet({ kind: 'status' }), keywords: ['away', 'dnd', 'do not disturb', 'offline', 'presence'] },
    ],
    friends: [
      ...sortFriends(net.friends).map((f) => ({ id: `friend:${f.peerId}`, label: f.name, hint: t('network.palette.messageHint', { presence: presenceLine(f) }), icon: 'chat' as IconName, run: () => openDm(client, f.peerId), keywords: ['message', 'friend'] })),
      ...sortGroups(net.groups)
        .filter((g) => g.active)
        .map((g) => ({ id: `group:${g.id}`, label: g.name, hint: t('network.palette.groupHint', { count: g.members.length }), icon: 'people' as IconName, run: () => openGroup(client, g.id), keywords: ['group'] })),
    ],
  };
}
