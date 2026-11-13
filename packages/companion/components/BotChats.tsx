import { router } from 'expo-router';
import { Bot, Plus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useT } from '../lib/language';
import { calls } from '../lib/link/calls';
import type { BotSummary, ConvSummary } from '../lib/link/protocol';
import { store } from '../lib/store';
import { convHref } from './Conv';
import { ChatRow } from './MacChats';
import { Sheet } from './Sheet';
import { haptic, IconBadge, Press, T } from './ui';

/**
 * A bot's chats on the phone (1.55, docs/bots.md): the same as its tabs on the Mac, New chat on top,
 * a chat deleted for good after asking (long-press). Opening one here doesn't move the Mac's tab.
 */
export function BotChatsSheet({ bot, visible, onClose }: { readonly bot: BotSummary | undefined; readonly visible: boolean; readonly onClose: () => void }) {
  const t = useT();
  const [deleting, setDeleting] = useState<ConvSummary | undefined>();
  const chats = bot?.chats ?? [];
  const close = () => {
    setDeleting(undefined);
    onClose();
  };
  const open = (c: ConvSummary) => {
    close();
    setTimeout(() => router.push(convHref(c.topic) as never), 180);
  };
  const fresh = () => {
    if (!bot) return;
    close();
    haptic.commit();
    void store.call<string>(calls.newBotChat(bot.id), { queue: false }).then(
      (id) => {
        if (id) setTimeout(() => router.push(convHref(calls.botChatTopic(bot.id, id)) as never), 180);
      },
      (e: Error) => store.toast({ text: e.message, tone: 'error' }),
    );
  };
  const remove = (c: ConvSummary) => {
    if (!bot) return;
    close();
    haptic.commit();
    void store.call(calls.deleteBotChat(bot.id, c.topic), { queue: false }).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
  };
  return (
    <Sheet
      visible={visible}
      onDismiss={close}
      window
      header={
        <View style={{ paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBadge Icon={Bot} tone="lavender" size={32} />
          <View style={{ flex: 1 }}>
            <T v="title" style={{ fontSize: 20 }}>
              {t('phone.bots.chatsTitle', { name: bot?.name ?? '' })}
            </T>
            <T v="caption">{t('phone.bots.chatsSub')}</T>
          </View>
        </View>
      }
    >
      {deleting ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 20 }}>
          <T v="eyebrow" style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
            {t('phone.bots.cantUndo')}
          </T>
          <Press scaleTo={0.98} onPress={() => remove(deleting)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 16 }}>
            <IconBadge Icon={Trash2} tone="rose" size={38} />
            <View style={{ flex: 1 }}>
              <T v="body" numberOfLines={1} style={{ fontWeight: '500' }}>
                {t('phone.bots.delete', { title: deleting.title })}
              </T>
              <T v="caption">{t('phone.bots.deleteSub')}</T>
            </View>
          </Press>
          <Press scaleTo={0.98} onPress={() => setDeleting(undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 16 }}>
            <IconBadge Icon={X} tone="plain" size={38} />
            <T v="body" style={{ fontWeight: '500' }}>
              {t('phone.bots.keep')}
            </T>
          </Press>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}>
          <Press scaleTo={0.98} onPress={fresh} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 16 }}>
            <IconBadge Icon={Plus} tone="lavender" size={38} />
            <T v="body" style={{ flex: 1, fontWeight: '600' }}>
              {t('phone.bots.newChat')}
            </T>
          </Press>
          {chats.map((c) => (
            <ChatRow key={c.topic} c={c} current={c.topic === bot?.topic} onPress={() => open(c)} onLongPress={() => setDeleting(c)} />
          ))}
          {chats.length ? (
            <T v="caption" style={{ paddingHorizontal: 10, paddingTop: 10 }}>
              {t('phone.bots.longPress')}
            </T>
          ) : null}
        </ScrollView>
      )}
    </Sheet>
  );
}
