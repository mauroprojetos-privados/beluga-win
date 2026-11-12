import { useEffect } from 'react';
import type { BotChat } from '@beluga/core/bots/schema.js';
import { assistantChatTitle } from '@beluga/shared/assistant.js';
import { Icon } from '../components/Icon.js';
import { IconButton, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { useT } from '../lib/i18n.js';
import { openSheet } from '../lib/sheets.js';
import { sameDeep } from '../lib/stable.js';
import { signalOf } from '../layout/attention-model.js';
import { SignalMark } from '../layout/signal-marks.js';
import s from '../chat/assistant-tabs.module.css';

/**
 * A bot's chats as tabs (docs/bots.md), like Your Mac's: + starts one, × deletes one for good after
 * asking. The open tab is kept across restarts (`bots.openChat`) and is the one the phone's row opens.
 * Shown once there's more than its first chat to switch to, or something said in it.
 */
export function BotTabs({ id }: { id: string }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const { client } = useBeluga();
  const bot = useApp((st) => st.bots.bots.find((x) => x.id === id), sameDeep);
  const shown = useApp((st) => (st.view.kind === 'bot' && st.view.id === id ? (st.view.chat ?? 'main') : undefined));
  const chats = bot?.chats ?? [];
  const active = chats.find((c) => c.channel === bot?.channel)?.id;
  // A chat this window went to (a tab, a notification) is the one open everywhere.
  useEffect(() => {
    if (shown && active && shown !== active && chats.some((c) => c.id === shown)) api.bots.openChat(id, shown).catch(() => undefined);
  }, [shown, active, chats, id, api]);
  if (!bot || bot.mac || !chats.length) return null;
  const open = shown ?? active ?? 'main';
  const fail = (err: unknown): void => toast(client, err instanceof Error ? err.message : String(err), 'error');
  const go = (chat: string): void => actions.run({ type: 'view', view: { kind: 'bot', id, ...(chat !== 'main' ? { chat } : {}) } });
  return (
    <div className={s.bar} role="tablist" aria-label={bot.name}>
      <div className={s.tabs}>
        {chats.map((c, i) => (
          <BotTab
            key={c.id}
            chat={c}
            n={i + 1}
            open={c.id === open}
            only={chats.length === 1}
            onOpen={() => go(c.id)}
            onDelete={() =>
              openSheet({
                kind: 'confirm',
                title: t('botStudio.chats.delete'),
                message: t('botStudio.chats.deleteConfirm', { name: bot.name }),
                confirm: t('botStudio.chats.delete'),
                destructive: true,
                run: () => api.bots.deleteChat(id, c.id).catch(fail),
              })
            }
          />
        ))}
      </div>
      <IconButton
        icon="plus"
        label={t('botStudio.chats.new')}
        className={s.add}
        onClick={() =>
          api.bots.newChat(id).then(
            (chat) => go(String(chat)),
            fail,
          )
        }
      />
    </div>
  );
}

function BotTab({ chat, n, open, only, onOpen, onDelete }: { chat: BotChat; n: number; open: boolean; only: boolean; onOpen: () => void; onDelete: () => void }) {
  const t = useT();
  const channel = chat.channel;
  const said = useApp((st) => st.log.some((l) => l.channel === channel));
  const title = useApp((st) => (said ? assistantChatTitle(channel, st.log) : t('botStudio.chats.name', { n })));
  const signal = useApp((st) => signalOf(st, channel), sameDeep);
  return (
    <div className={cx(s.tab, open && s.tabOn)}>
      <Tip label={signal.tip || title}>
        <button type="button" role="tab" aria-selected={open} className={s.tabMain} onClick={onOpen}>
          <Icon name="chat" size={12} className={s.tabIcon} />
          <span className={s.tabTitle}>{title}</span>
          {open ? null : <SignalMark signal={signal} />}
        </button>
      </Tip>
      {!only || said ? <IconButton icon="x" label={t('botStudio.chats.delete')} className={s.close} onClick={onDelete} /> : null}
    </div>
  );
}
