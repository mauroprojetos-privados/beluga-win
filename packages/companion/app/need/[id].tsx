import { router, useLocalSearchParams } from 'expo-router';
import { openOnMac } from '../../lib/mac';
import { KeyboardLift } from '../../components/KeyboardLift';
import { Infinity as Always, EyeOff, MessageSquare, Monitor, Shield, Workflow } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, ScrollView, TextInput, View } from 'react-native';
import { chatHref, convHref } from '../../components/Conv';
import { answer, NeedButtons, NeedFace, plainOf, sendOwn } from '../../components/Needs';
import { Sheet } from '../../components/Sheet';
import { Card, Hairline, Press, Row, T } from '../../components/ui';
import { useAllNeeds, useView } from '../../lib/hooks';
import { useT } from '../../lib/language';
import type { HomeView } from '../../lib/link/protocol';
import { store } from '../../lib/store';
import { color } from '../../lib/theme';

/**
 * One needs-you item, read whole: the "•••" of a card. Approve and Decline on top; then the
 * advanced ones, one row each: Always, your own words, open what it holds up, open on the Mac.
 */
export default function Need() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const home = useView<HomeView>('home');
  // Your Mac's and every computer's (BLG-810): answering goes back where it came from.
  const n = useAllNeeds(home?.data.needsYou).find((x) => x.id === decodeURIComponent(id ?? ''));
  // One of your computers' (its conversations open over its link; its plans and sentinels, and Open on Mac, are your Mac's).
  const on = n ? store.needOn(n.id) : undefined;
  const opens = n?.topic && (!on || n.topic.startsWith('conv:')) ? n.topic : undefined;
  const [visible, setVisible] = useState(true);
  const [words, setWords] = useState('');
  const close = (then?: () => void) => {
    setVisible(false);
    setTimeout(() => {
      router.back();
      if (then) setTimeout(then, 60);
    }, 230);
  };
  const act = (tone: 'main' | 'danger' | 'plain') => {
    if (!n) return;
    answer(n, tone);
    close();
  };
  const always = n ? plainOf(n) : undefined;
  return (
    <KeyboardLift>
      <Sheet visible={visible} onDismiss={() => close()} maxHeight={0.9}>
        {n ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 18 }} keyboardShouldPersistTaps="handled">
            <NeedFace item={n} full onAnswered={() => close()} />
            <NeedButtons item={n} onAnswer={(tone) => act(tone)} />
            <Card style={{ marginHorizontal: -4 }}>
              {always ? <Row first Icon={Always} tone="peach" label={always.label} sub={t('phone.needs.dontAskAgain')} onPress={() => act('plain')} chevron={false} /> : null}
              {opens ? (
                <Row
                  first={!always}
                  Icon={opens.startsWith('plan:') ? Workflow : opens.startsWith('sentinel:') ? Shield : MessageSquare}
                  tone="sky"
                  label={t(opens.startsWith('plan:') ? 'phone.needs.openPlan' : opens.startsWith('sentinel:') ? 'phone.needs.openSentinel' : 'phone.needs.openConversation')}
                  onPress={() => {
                    const to = opens;
                    close(() => router.push(to.startsWith('plan:') ? `/plan/${to.slice(5)}` : to.startsWith('sentinel:') ? `/sentinel/${encodeURIComponent(to.slice(9))}` : to.startsWith('chat:') ? chatHref(to) : (convHref(to, on) as never)));
                  }}
                />
              ) : null}
              {on ? null : <Row first={!always && !opens} Icon={Monitor} tone="plain" label={t('phone.needs.openOnMac')} onPress={() => (void openOnMac(n.topic ? { topic: n.topic } : { need: n.id }), close())} chevron={false} />}
              <Row Icon={EyeOff} tone="plain" label={t('phone.needs.dismiss')} sub={t('phone.needs.dismissSub')} onPress={() => (store.dismiss(n), close())} chevron={false} />
            </Card>
            {n.answer?.text ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow">{t(n.choices?.length ? 'phone.needs.orInYourWords' : 'phone.needs.yourAnswer')}</T>
                <Card style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, paddingVertical: 6 }}>
                  <TextInput value={words} onChangeText={setWords} placeholder={t('phone.needs.typeAnswer')} placeholderTextColor={color.text3} style={{ flex: 1, color: color.text, fontSize: 15.5, paddingVertical: 8, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) }} />
                  <Press disabled={!words.trim()} onPress={() => sendOwn(n, words.trim()) && close()} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: words.trim() ? color.primary : color.sunken }}>
                    <T v="callout" c={words.trim() ? color.onPrimary : color.text3} style={{ fontWeight: '600' }}>
                      {n.answer.label ?? t('common.send')}
                    </T>
                  </Press>
                </Card>
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={{ padding: 20 }}>
            <T v="callout">{t('phone.needs.alreadyAnswered')}</T>
            <Hairline />
          </View>
        )}
      </Sheet>
    </KeyboardLift>
  );
}
