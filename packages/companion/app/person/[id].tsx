import { router, useLocalSearchParams } from 'expo-router';
import { Eye, FolderOpen, MessageCircle, Monitor, Sparkles, SquareTerminal } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatHref, convHref } from '../../components/Conv';
import { Header, Screen, useScrolled } from '../../components/Screen';
import { UsageBars } from '../../components/Usage';
import { Avatar, Card, haptic, IconBadge, Pill, Press, T, type Tone } from '../../components/ui';
import { useView } from '../../lib/hooks';
import { calls } from '../../lib/link/calls';
import type { PeopleView, Topic } from '../../lib/link/protocol';
import { store } from '../../lib/store';
import { color } from '../../lib/theme';
import { t, useT } from '../../lib/language';

const word = () => ({ online: t('phone.people.online'), away: t('phone.people.away'), dnd: t('phone.people.busy'), offline: t('phone.people.offline') }) as const;
const updateWord = () => ({ them: t('phone.people.theyNeedUpdate'), you: t('phone.people.youNeedUpdate') }) as const;
const offer = (): Record<string, { label: string; Icon: typeof Eye }> => ({ screen: { label: t('phoneApp.person.screen'), Icon: Eye }, commands: { label: t('phoneApp.person.commands'), Icon: SquareTerminal }, files: { label: t('phoneApp.conv.files'), Icon: FolderOpen } });

/** A friend: Message, Ask their Claude, Screenshot of their desktop. */
export default function Person() {
  const { scrolled, onScroll } = useScrolled();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const say = useT();
  const view = useView<PeopleView>('people');
  const p = view?.data.people.find((x) => x.peerId === decodeURIComponent(id ?? ''));
  if (!p) {
    return (
      <Screen>
        <Header back title={say('phoneApp.person.friend')} />
      </Screen>
    );
  }
  const OFFER = offer();
  const canScreen = p.offers.includes('screen');
  const reachable = p.presence !== 'offline';

  const screenshot = async () => {
    haptic.commit();
    const r = await store.call<{ topic?: Topic }>(calls.screenshot(p.peerId, p.name)).catch((e: Error) => (store.toast({ text: e.message, tone: 'error' }), undefined));
    if (r?.topic) router.push(convHref(r.topic));
    else store.toast({ text: say('phoneApp.person.askedShot', { name: p.name }), tone: 'ok' });
  };

  const action = (Icon: typeof Sparkles, label: string, tone: Tone, onPress: () => void, disabled: boolean, delay: number) => (
    <Animated.View entering={FadeIn.duration(180)} style={{ flex: 1 }}>
      <Press disabled={disabled} onPress={onPress} accessibilityLabel={label} style={{ opacity: disabled ? 0.4 : 1 }}>
        <Card style={{ paddingVertical: 16, alignItems: 'center', gap: 10 }}>
          <IconBadge Icon={Icon} tone={tone} size={46} />
          <T v="callout" c={color.text} style={{ fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>
            {label}
          </T>
        </Card>
      </Press>
    </Animated.View>
  );

  return (
    <Screen>
      <Header scrolled={scrolled} back title="" />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={{ alignItems: 'center', paddingTop: 4 }}>
          <Animated.View entering={FadeIn.duration(320)}>
            <Avatar name={p.name} size={88} presence={p.presence} />
          </Animated.View>
          <T v="title" style={{ marginTop: 14 }}>
            {p.name}
            {p.emoji && !p.update && p.presence !== 'offline' ? ` ${p.emoji}` : ''}
          </T>
          <T v="callout" style={{ marginTop: 2 }}>
            {p.update ? updateWord()[p.update] : word()[p.presence]}
            {p.note && !p.update ? ` · ${p.note}` : ''}
          </T>
          {p.beluga ? (
            <T v="caption" style={{ marginTop: 2 }}>
              {say('phoneApp.settings.belugaVersion', { version: p.beluga })}
            </T>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 24 }}>
          {action(MessageCircle, say('phoneApp.person.message'), 'sky', () => p.chat && router.push(chatHref(p.chat)), !p.chat, 40)}
          {action(Sparkles, say('phoneApp.person.askAgent'), 'peach', () => router.push({ pathname: '/ask', params: { friend: p.peerId } }), !reachable, 80)}
          {action(Monitor, say('phoneApp.person.screenshot'), 'lavender', () => void screenshot(), !canScreen || !reachable, 120)}
        </View>
        {!canScreen ? (
          <T v="caption" style={{ textAlign: 'center', marginTop: 8 }}>
            {say('phoneApp.person.notShared', { name: p.name })}
          </T>
        ) : null}

        {p.usage ? (
          <Animated.View entering={FadeIn.duration(180)} style={{ marginTop: 24, marginHorizontal: 16 }}>
            <Card style={{ padding: 16, gap: 14 }}>
              <T v="heading">{say('phone.home.usage')}</T>
              <UsageBars usage={p.usage} />
            </Card>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeIn.duration(180)} style={{ marginTop: 24, paddingHorizontal: 20, gap: 10 }}>
          <T v="eyebrow">{say('phoneApp.person.canUse')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {p.offers.length ? p.offers.map((o) => <Pill key={o} label={OFFER[o]?.label ?? o} Icon={OFFER[o]?.Icon} tone="mint" />) : <T v="callout">{say('phoneApp.person.onlyChat')}</T>}
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}
