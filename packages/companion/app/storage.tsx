import { Archive, Eraser, FileText, Film, FolderOpen, HardDrive, ImageIcon, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Switch, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Options, type Option } from '../components/Options';
import { sizeOf } from '../components/Outputs';
import { Header, Screen, useScrolled } from '../components/Screen';
import { Card, haptic, Row, T } from '../components/ui';
import { useView } from '../lib/hooks';
import { isMacTopic, type WorkView } from '../lib/link/protocol';
import { cacheSize, cleanupOn, clearCache, folderName, keepsTrack, pickFolder, prune, removeSaved, type SavedFile, setCleanup, useSaved } from '../lib/saved';
import { groups, totalBytes } from '../lib/saved-list';
import { store } from '../lib/store';
import { color, ink } from '../lib/theme';
import { useT } from '../lib/language';

/**
 * Settings › Storage (BLG-125): what Beluga keeps on the phone. The files you saved, by the
 * conversation they came from (each, or a conversation's, deleted from the ••• sheet), the cache
 * (full pictures shown, emptied at every launch, or here), where saves go, and whether saved files
 * go when their conversation is archived or deleted on your Mac.
 */
export default function Storage() {
  const { scrolled, onScroll } = useScrolled();
  const insets = useSafeAreaInsets();
  const t = useT();
  const saved = useSaved();
  const work = useView<WorkView>('work');
  const [cache, setCache] = useState(0);
  const [cleanup, setCleanupOn] = useState(cleanupOn());
  const [folder, setFolder] = useState(folderName());
  const [sheet, setSheet] = useState<{ title: string; options: Option[] }>();
  useEffect(() => {
    // Files you deleted in the gallery or Files leave the list.
    prune();
    setCache(cacheSize());
  }, []);

  const titles = new Map((work?.data.projects ?? []).flatMap((p) => p.conversations.map((c) => [c.topic as string, c.title] as const)));
  const titleOf = (topic: string | undefined): string => (!topic ? t('phoneApp.storage.elsewhere') : isMacTopic(topic) ? t('phone.home.yourMac') : (titles.get(topic) ?? t('phoneApp.storage.aConversation')));
  const byConv = groups(saved, titleOf);

  const remove = (which: readonly SavedFile[]) => {
    haptic.warn();
    const n = removeSaved(which);
    store.toast({ text: n === 1 ? t('phoneApp.storage.deletedOne') : t('phoneApp.storage.deletedMany', { count: n }), tone: 'ok' });
  };
  const toggle = (on: boolean) => (
    <View pointerEvents="none">
      <Switch value={on} trackColor={{ true: ink.mint, false: color.hairlineStrong }} thumbColor={color.white} {...(Platform.OS === 'web' ? ({ activeThumbColor: color.white } as object) : {})} />
    </View>
  );

  return (
    <Screen>
      <Header scrolled={scrolled} back title={t('phoneApp.settings.storage')} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 20 }}>
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: 20 }}>
          <Card>
            <Row first Icon={HardDrive} tone="sky" label={t('phoneApp.storage.savedHere')} sub={saved.length ? t('phoneApp.storage.files', { count: saved.length, size: sizeOf(totalBytes(saved)) }) : t('phoneApp.conv.nothingYet')} chevron={false} />
            <Row
              Icon={Eraser}
              tone="butter"
              label={t('phoneApp.storage.cache')}
              sub={t('phoneApp.storage.cacheSub', { size: sizeOf(cache) })}
              onPress={() =>
                setSheet({
                  title: t('phoneApp.storage.cache'),
                  options: [
                    {
                      Icon: Eraser,
                      label: t('phoneApp.storage.clear'),
                      sub: t('phoneApp.storage.clearSub'),
                      tone: 'butter',
                      onPress: () =>
                        void clearCache().then(() => {
                          setCache(cacheSize());
                          store.toast({ text: t('phoneApp.storage.cleared'), tone: 'ok' });
                        }),
                    },
                  ],
                })
              }
            />
          </Card>

          {keepsTrack ? (
            <Card>
              <Row
                first
                Icon={Archive}
                tone="mint"
                label={t('phoneApp.storage.removeArchived')}
                sub={t('phoneApp.storage.removeArchivedSub')}
                right={toggle(cleanup)}
                chevron={false}
                onPress={() => {
                  haptic.tap();
                  setCleanupOn(!cleanup);
                  setCleanup(!cleanup);
                }}
              />
              <Row Icon={FolderOpen} tone="lavender" label={t('phoneApp.storage.saveTo')} sub={folder ?? t('phoneApp.storage.saveToSub')} onPress={() => void pickFolder().then(() => setFolder(folderName()))} />
            </Card>
          ) : (
            <T v="caption" style={{ paddingHorizontal: 6 }}>
              {t('phoneApp.storage.iphone')}
            </T>
          )}

          {byConv.map((g) => (
            <View key={g.key} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 8 }}>
                <T v="eyebrow" numberOfLines={1} style={{ flex: 1 }}>
                  {g.title}
                </T>
                <T v="caption">{sizeOf(g.bytes)}</T>
              </View>
              <Card>
                {g.files.map((f, i) => (
                  <Row
                    key={f.uri}
                    first={i === 0}
                    Icon={f.kind === 'image' ? ImageIcon : f.kind === 'video' ? Film : FileText}
                    tone={f.kind === 'image' ? 'peach' : f.kind === 'video' ? 'lavender' : 'sky'}
                    label={f.name}
                    sub={`${sizeOf(f.size)} · ${new Date(f.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
                    chevron={false}
                    onPress={() =>
                      setSheet({
                        title: f.name,
                        options: [
                          { Icon: Trash2, label: t('phoneApp.storage.delete'), tone: 'rose', onPress: () => remove([f]) },
                          { Icon: Trash2, label: t('phoneApp.storage.deleteAll', { count: g.files.length }), sub: `${g.title} · ${sizeOf(g.bytes)}`, tone: 'rose', hidden: g.files.length < 2, onPress: () => remove(g.files) },
                        ],
                      })
                    }
                  />
                ))}
              </Card>
            </View>
          ))}
          {!saved.length ? (
            <T v="caption" style={{ paddingHorizontal: 6 }}>
              {t('phoneApp.storage.empty')}
            </T>
          ) : null}
        </Animated.View>
      </ScrollView>
      <Options visible={Boolean(sheet)} onClose={() => setSheet(undefined)} title={sheet?.title} options={sheet?.options ?? []} />
    </Screen>
  );
}
