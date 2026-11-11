import type { Workspace } from '@beluga/workspaces/types.js';
import { worktreeRef } from '@beluga/shared/worktree-refs.js';
import type { ActionItem } from '../components/SpecMenu.js';
import { copyText } from '../lib/copy.js';
import { toast, type useBeluga } from '../lib/beluga.js';
import { t } from '@beluga/shared/i18n/index.js';

/**
 * Copy Link on a worktree (BLG-878): its ref ("worktree:wt-…") on the clipboard, to paste in another
 * chat, where it shows as the worktree's chip and its Claude is told which worktree it is.
 * None for a chat or a main folder (the chip is a worktree's).
 */
export function copyLinkItems(ws: Workspace, client: ReturnType<typeof useBeluga>['client']): ActionItem[] {
  if (ws.kind !== 'worktree') return [];
  const ref = worktreeRef(ws.id);
  return [
    {
      label: t('layout.link.copy'),
      icon: 'copy',
      separate: true,
      onSelect: () =>
        void copyText(ref).then(
          () => toast(client, t('layout.link.copied', { name: ws.name }), 'success'),
          () => toast(client, t('layout.link.cannotCopy'), 'error'),
        ),
    },
  ];
}
