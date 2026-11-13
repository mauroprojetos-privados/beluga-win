import { ArrowDownToLine } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { appUpdate } from '../modules/app-update';
import { installUpdate, type UpdateState, useUpdate } from '../lib/update';
import { t } from '../lib/language';
import { color, ink } from '../lib/theme';
import { Sheet } from './Sheet';
import { Button, Press, T } from './ui';

/**
 * A new version of the phone app (BLG-426, lib/update.ts), as the Mac's sidebar pill does it: a
 * small pill under Home's greeting, "Beluga 1.8.0 is ready", that opens a sheet with the release's
 * notes, Update Now and Later.
 */
const shows = (u: UpdateState): boolean => !!u.release && ['found', 'downloading', 'ready', 'installing', 'confirm', 'failed'].includes(u.phase);

export function UpdatePill({ onPress }: { readonly onPress: () => void }) {
  const u = useUpdate();
  if (!shows(u)) return null;
  const label = t(u.phase === 'downloading' ? 'phoneParts.update.getting' : u.phase === 'found' ? 'phoneParts.update.out' : 'phoneParts.update.ready', { version: u.release!.version });
  return (
    <Animated.View entering={FadeIn.duration(200)} style={{ marginTop: 12, flexDirection: 'row' }}>
      <Press onPress={onPress} accessibilityLabel={label} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: color.sunken }}>
        <ArrowDownToLine color={ink.mint} size={15} />
        <T v="caption" c={color.text} style={{ fontWeight: '600' }}>
          {label}
        </T>
      </Press>
    </Animated.View>
  );
}

export function UpdateSheet({ visible, onClose }: { readonly visible: boolean; readonly onClose: () => void }) {
  const u = useUpdate();
  const r = u.release;
  const pct = Math.round((u.progress ?? 0) * 100);
  const label =
    u.phase === 'downloading' ? t('phoneParts.update.downloading', { pct }) : u.phase === 'installing' ? t('phoneParts.update.installing') : u.phase === 'confirm' ? t('phoneParts.update.waitingAndroid') : t('phoneParts.update.now');
  const sub = u.phase === 'found' ? t('phoneParts.update.size', { mb: Math.round((r?.size ?? 0) / 1e6) }) : u.phase === 'ready' ? t('phoneParts.update.checked') : undefined;
  const busy = u.phase === 'downloading' || u.phase === 'installing' || u.phase === 'confirm';
  return (
    <Sheet window visible={visible && !!r} onDismiss={onClose}>
      {r ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 14, flexShrink: 1 }}>
          <View style={{ gap: 2 }}>
            <T v="heading" style={{ fontSize: 19 }}>
              {t('phoneParts.update.title', { version: r.version })}
            </T>
            {sub ? <T v="caption">{sub}</T> : null}
          </View>
          {r.notes ? (
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 4 }}>
              <T v="callout" c={color.text2} style={{ lineHeight: 21 }}>
                {r.notes}
              </T>
            </ScrollView>
          ) : null}
          {u.phase === 'downloading' ? (
            <View style={{ height: 6, borderRadius: 3, backgroundColor: color.sunken, overflow: 'hidden' }}>
              <View style={{ height: 6, width: `${pct}%`, borderRadius: 3, backgroundColor: ink.mint, opacity: 0.6 }} />
            </View>
          ) : null}
          {u.error ? (
            <T v="caption" c={color.warn}>
              {u.error}
            </T>
          ) : null}
          {!appUpdate.canInstall() ? (
            <T v="caption">{t('phoneParts.update.androidAsks')}</T>
          ) : (
            <T v="caption">{t('phoneParts.update.closes')}</T>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button quiet label={t('phone.needs.later')} onPress={onClose} flex={1} />
            <Button label={label} Icon={busy ? undefined : ArrowDownToLine} disabled={busy} onPress={() => void installUpdate()} flex={2} />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
