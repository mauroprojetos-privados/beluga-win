import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Workspace } from '@beluga/workspaces/types.js';
import { type ActionItem } from '../components/SpecMenu.js';
import { toast, useBeluga } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import { chatBulkActions, chatJoins, chatSelectionStore, joinValue, retainVisibleChats, visibleChatIds } from './chat-selection.js';
import { toolbarActions } from './toolbar-actions.js';
import s from './Sidebar.module.css';
import { useT } from '../lib/i18n.js';
import { t } from '@beluga/shared/i18n/index.js';

interface SidebarSelection {
  readonly ids: readonly string[];
  readonly busy: boolean;
  readonly click: (id: string, shift: boolean) => boolean;
  readonly items: () => readonly ActionItem[];
  readonly clear: () => void;
}

const SelectionContext = createContext<SidebarSelection | undefined>(undefined);

/** One selection for project chats and chats without a project. It stays in this window. */
export function SidebarChatSelection({ children }: { children: ReactNode }) {
  const { client } = useBeluga();
  const root = useRef<HTMLDivElement>(null);
  const [store] = useState(chatSelectionStore);
  const { selection, busy } = useSyncExternalStore(store.subscribe, store.get);
  // Read the rendered rows so plan task chats and custom project ordering use the same order as the screen.
  const visible = useCallback((): string[] => visibleChatIds(Array.from(root.current?.querySelectorAll<HTMLElement>('[data-chat-id]') ?? [], (row) => ({
    id: row.dataset.chatId!,
    folded: Boolean(row.closest('[data-chats-folded="true"]')),
  }))), []);
  // Selected rows that touch on screen become one box (Sidebar.module.css): each row says which sides go on.
  // Set on the rows themselves, so joining doesn't draw every row again.
  const join = useCallback((): void => {
    const rows = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-chat-id]') ?? []);
    const chosen = new Set(store.get().selection.ids);
    const joins = chatJoins(rows.filter((row) => chosen.has(row.dataset.chatId!)).map((row) => {
      const box = row.getBoundingClientRect();
      return { id: row.dataset.chatId!, top: box.top, bottom: box.bottom };
    }));
    for (const row of rows) {
      const value = joinValue(joins.get(row.dataset.chatId!));
      if ((row.dataset.chatJoin ?? '') === value) continue;
      if (value) row.dataset.chatJoin = value;
      else delete row.dataset.chatJoin;
    }
  }, [store]);
  useLayoutEffect(join, [selection.ids, join]);
  useEffect(() => {
    const click = (event: MouseEvent): void => {
      const target = event.target;
      // Menu and alert clicks belong to the batch that opened them.
      if (target instanceof Element && target.closest('[role="menu"], [role="alertdialog"]')) return;
      if (!event.shiftKey) store.clear();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') store.clear();
    };
    const observer = new MutationObserver(() => {
      store.retain(visible());
      join();
    });
    if (root.current) observer.observe(root.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-id', 'data-chats-folded'] });
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [store, visible, join]);

  const items = useCallback((): readonly ActionItem[] => {
    const current = retainVisibleChats(store.get().selection, visible());
    const state = client.store.getState();
    const chats = current.ids.flatMap((id) => state.projects.flatMap((p) => p.workspaces).filter((w) => w.id === id && w.kind === 'chat' && !w.archived && !w.pending));
    const count = chats.length;
    const run = async (action: (typeof chatBulkActions)[number]): Promise<void> => {
      const result = await store.run(chats, async (chat) => {
        // A chat can become a worktree while the confirmation is open.
        const latest = client.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === chat.id);
        if (!latest || latest.kind !== 'chat' || latest.archived || latest.pending) throw new Error(t('layout.chatsel.gone'));
        // Quiet: one message for the whole batch below, not one per chat.
        if (action.id === 'archive') return await client.api.workspaces.archive(chat.id, false, { quiet: true }) === true;
        await client.api.workspaces.remove(chat.id, { quiet: true });
        // Remove returns no result, including when the daemon reports a failure. Check its published state.
        return !client.store.getState().projects.some((p) => p.workspaces.some((w) => w.id === chat.id));
      });
      if (!result) return;
      store.retain(visible());
      if (result.failed.length) {
        const message = result.failed.map((chat) => `${chat.name}: ${chat.reason}`).join('\n');
        toast(client, t(`layout.chatsel.${action.id}.failed`, { count, failed: result.failed.length, message }), 'error');
        openSheet({ kind: 'confirm', title: t('layout.chatsel.failedTitle', { count: result.failed.length }), message, confirm: t('common.ok'), run: () => undefined });
      } else toast(client, t(`layout.chatsel.${action.id}.done`, { count }), 'success');
    };
    return chatBulkActions.map((action) => ({
      label: t(`layout.chatsel.${action.id}.menu`, { count }),
      icon: action.icon,
      danger: true,
      disabled: store.get().busy || count === 0 || chats.some((chat: Workspace) => {
        const menu = toolbarActions(state, chat);
        return ![...(menu.primary ? [menu.primary] : []), ...menu.icons, ...menu.more.flat()].some((item) => item.action === action.id && !item.disabled);
      }),
      onSelect: () => openSheet({
        kind: 'confirm',
        title: t(`layout.chatsel.${action.id}.title`, { count }),
        message: t(`layout.chatsel.${action.id}.message`),
        confirm: t(`layout.chatsel.${action.id}.confirm`, { count }),
        destructive: action.id === 'delete',
        run: () => void run(action),
      }),
    }));
  }, [client, store, visible]);

  const click = useCallback((id: string, shift: boolean): boolean => {
    const order = visible();
    if (!order.includes(id)) return false;
    store.click(order, id, shift);
    return shift;
  }, [store, visible]);

  // Every chat row reads this: a new value only when what they show changes (KLD-48).
  const value = useMemo<SidebarSelection>(() => ({ ids: selection.ids, busy, clear: store.clear, items, click }), [selection.ids, busy, store, items, click]);
  return (
    <SelectionContext.Provider value={value}>
      <div ref={root} style={{ display: 'contents' }}>{children}</div>
    </SelectionContext.Provider>
  );
}

export const useChatSelection = (): SidebarSelection | undefined => useContext(SelectionContext);

export function ChatSelectionCount() {
  const tl = useT();
  const selection = useChatSelection();
  const count = selection?.ids.length ?? 0;
  // The last count stays while the bar folds away.
  const [shown, setShown] = useState(count);
  if (count && count !== shown) setShown(count);
  if (!selection) return null;
  return (
    <div className={s.chatSelection} data-open={count > 0} role="status" aria-live="polite" aria-hidden={!count}>
      <div className={s.chatSelectionFold}>
        <div className={s.chatSelectionBar}>
          <span>{tl(selection.busy ? 'layout.chatsel.selectedWorking' : 'layout.chatsel.selected', { count: shown })}</span>
          <button type="button" onClick={selection.clear} disabled={selection.busy || !count} tabIndex={count ? 0 : -1} aria-label={tl('layout.chatsel.clearSelection')}>{tl('layout.sub.clear')}</button>
        </div>
      </div>
    </div>
  );
}
