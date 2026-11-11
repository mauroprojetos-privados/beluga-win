import { useMemo } from 'react';
import { CLAUDE_CHANGED, type RunSummary, type Sentinel, type SentinelDraft, type SentinelPatch, type SentinelState } from '@beluga/core/sentinel/model.js';
import type { Args } from '@beluga/ipc/api.js';
import type { View } from '@beluga/core/store.js';
import type { ActionItem } from '../components/SpecMenu.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { copyText } from '../lib/copy.js';
import { openSheet } from '../lib/sheets.js';
import { type ChatPlace, chatPlaceOf, runsFolderOf } from './sentinel-model.js';
import { openFolderThere } from '../lib/remote-open.js';
import { t as tx } from '@beluga/shared/i18n/index.js';

/** What Sentinel's screens share: the slice, and acting on sentinels with errors as toasts. */

export const useSentinelState = (): SentinelState => useApp((s) => s.sentinel);

const message = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error: /, '') : String(err));

export function useSentinelActions() {
  const api = useApi();
  const { client } = useBeluga();
  const actions = useActions();
  return useMemo(() => {
    const act = async <T,>(run: () => Promise<T>, done?: string): Promise<T | undefined> => {
      try {
        const result = await run();
        if (done) toast(client, done, 'success');
        return result;
      } catch (err) {
        toast(client, message(err), 'error');
        return undefined;
      }
    };
    const go = (view: View): void => actions.run({ type: 'view', view });
    const openChat = (place: ChatPlace | undefined): void => {
      if (!place) return;
      if (place.kind === 'workspace') actions.run({ type: 'open_ws', id: place.id, tab: 'chat' });
      else go({ kind: 'assistant', ...(place.chat ? { chat: place.chat } : {}) });
    };
    const self = {
      api: api.sentinel,
      act,
      /** The model's types are readonly; the API's (from zod) aren't: the same shape. */
      create: (draft: SentinelDraft): Promise<Sentinel> => api.sentinel.create(draft as Args<'sentinel.create'>[0]),
      update: (id: string, patch: SentinelPatch): Promise<Sentinel> => api.sentinel.update(id, patch as Args<'sentinel.update'>[1]),
      openList: (projectId?: string): void => go({ kind: 'sentinel', ...(projectId ? { projectId } : {}) }),
      open: (id: string): void => go({ kind: 'sentinel_page', id }),
      openRun: (runId: string): void => go({ kind: 'sentinel_run', runId }),
      openChannel: (channel: string | undefined): void => openChat(chatPlaceOf(channel)),
      runNow: (s: Pick<Sentinel, 'id' | 'name'>): Promise<RunSummary | undefined> => act(() => api.sentinel.run(s.id), tx('sentinel.nav.running', { name: s.name })),
      setPaused: (s: Pick<Sentinel, 'id' | 'name'>, paused: boolean): Promise<Sentinel | undefined> => act(() => api.sentinel.pause(s.id, paused), paused ? tx('sentinel.use.paused', { name: s.name }) : tx('sentinel.use.on', { name: s.name })),
      duplicate: async (s: Pick<Sentinel, 'id' | 'name'>): Promise<void> => {
        const copy = await act(() => api.sentinel.duplicate(s.id), tx('sentinel.use.copied', { name: s.name }));
        if (copy) go({ kind: 'sentinel_page', id: copy.id });
      },
      remove: (s: Pick<Sentinel, 'id' | 'name'>, after?: () => void): void =>
        openSheet({
          kind: 'confirm',
          title: tx('sentinel.dash.deleteTitle', { name: s.name }),
          message: tx('sentinel.use.deleteMessage'),
          confirm: tx('sentinel.use.deleteSentinel'),
          destructive: true,
          run: () => void act(() => api.sentinel.remove(s.id), tx('sentinel.dash.deleted', { name: s.name })).then(() => after?.()),
        }),
      /** Delete a run's chat, or the whole run (BLG-577), after asking. `after`: where to go once the run is gone. */
      deleteRun: (run: Pick<RunSummary, 'id' | 'headline'>, what: 'chat' | 'run', after?: () => void): void =>
        openSheet({
          kind: 'confirm',
          title: what === 'chat' ? tx('sentinel.use.deleteChatTitle') : tx('sentinel.use.deleteRunTitle'),
          message: what === 'chat' ? tx('sentinel.use.deleteChatMessage') : tx('sentinel.use.deleteRunMessage'),
          confirm: what === 'chat' ? tx('sentinel.chat.deleteChat') : tx('sentinel.use.deleteRun'),
          destructive: true,
          run: () => void act(async () => (await api.sentinel.runDelete(run.id, what), true), what === 'chat' ? tx('sentinel.use.deletedChat') : tx('sentinel.use.deletedRun')).then((done) => done && what === 'run' && after?.()),
        }),
      copyJson: (s: Sentinel): void => void copyText(JSON.stringify(s, null, 2)).then(() => toast(client, tx('sentinel.use.copiedJson', { name: s.name }), 'success')),
      // A sentinel on a computer: its runs folder over Remote-SSH, else its path copied; never opened over there (BLG-852).
      openFolder: (path: string): void => void act(() => openFolderThere(client, path)),
    };
    return self;
  }, [api, client, actions]);
}

export type SentinelActions = ReturnType<typeof useSentinelActions>;

/** The runs folder, when the runs say where it is (memory-only runs don't). */
export const useRunsFolder = (): string | undefined => useApp((s) => runsFolderOf(s.sentinel.runs));

/** A sentinel's menu (right-click and ⋯ on its row): Run Now, Pause or Turn On, Open Last Run, Duplicate, Delete…. */
export function sentinelMenu(s: Sentinel, last: RunSummary | undefined, a: SentinelActions): ActionItem[] {
  return [
    { label: tx('sentinel.page.runNow'), icon: 'play', hint: s.paused ? tx('sentinel.use.onceEvenPaused') : undefined, onSelect: () => void a.runNow(s) },
    s.paused
      ? { label: s.pausedWhy && s.pausedWhy !== CLAUDE_CHANGED ? tx('sentinel.page.resume') : tx('sentinel.dash.turnOn'), icon: 'play', hint: s.trigger.kind === 'schedule' ? tx('sentinel.use.onSchedule') : undefined, onSelect: () => void a.setPaused(s, false) }
      : { label: tx('sentinel.page.pause'), icon: 'pause', hint: tx('sentinel.use.pauseHint'), onSelect: () => void a.setPaused(s, true) },
    { label: tx('sentinel.page.openLastRun'), icon: 'arrowRight', disabled: !last, separate: true, onSelect: () => last && a.openRun(last.id) },
    { label: tx('sentinel.cards.duplicate'), icon: 'copy', onSelect: () => void a.duplicate(s) },
    { label: tx('sentinel.page.deleteMenu'), danger: true, separate: true, onSelect: () => a.remove(s) },
  ];
}
