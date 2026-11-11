import { useFocusEffect } from 'expo-router';
import { Cable, CircleCheck, Download, Hand, Monitor, ShieldAlert, ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, Screen, useScrolled } from '../components/Screen';
import { Button, Card, Pill, Row, T } from '../components/ui';
import { accessibilityOn, addonInstalled, downloadLink, onAccessibilityChange, openAccessibilitySettings } from '../lib/phone';
import { useT } from '../lib/language';

/**
 * Settings › Get Beluga Link (BLG-390): what Beluga Link is, why it's an app of its own, that
 * Android may block it when it's downloaded, and the two ways to install it: from the Mac over a
 * cable (which Play Protect doesn't block, and which turns it on too), or downloading it here.
 * Once it's installed, what's left is turning it on.
 */
export default function Link() {
  const { scrolled, onScroll } = useScrolled();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [installed, setInstalled] = useState(addonInstalled());
  const [on, setOn] = useState(accessibilityOn());
  const refresh = useCallback(() => {
    setInstalled(addonInstalled());
    setOn(accessibilityOn());
  }, []);
  // Back from the download, the installer or Android's settings: show what's true now.
  useFocusEffect(refresh);
  useEffect(() => onAccessibilityChange(refresh), [refresh]);

  const section = (title: string) => (
    <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
      {title}
    </T>
  );
  const note = (text: string) => (
    <T v="caption" style={{ paddingHorizontal: 6 }}>
      {text}
    </T>
  );

  return (
    <Screen>
      <Header scrolled={scrolled} back title="Beluga Link" /> {/* i18n-ignore */}
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}>
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 }}>
            {on ? <Pill label={t('phoneApp.link.on')} tone="mint" Icon={CircleCheck} /> : installed ? <Pill label={t('phoneApp.link.installedOff')} tone="butter" /> : <Pill label={t('phoneApp.link.notInstalled')} tone="plain" />}
          </View>
          <T v="body" style={{ paddingHorizontal: 6 }}>
            {t('phoneApp.link.intro')}
          </T>

          {section(t('phoneApp.link.whySeparate'))}
          {note(t('phoneApp.link.whySeparateNote'))}

          {on ? (
            <Card>
              <Row first Icon={CircleCheck} tone="mint" label={t('phoneApp.link.isOn')} sub={t('phoneApp.link.isOnSub')} chevron={false} />
            </Card>
          ) : installed ? (
            <>
              {section(t('phoneApp.link.turnOn'))}
              <Card>
                <Row first Icon={ShieldCheck} tone="peach" label={t('phoneApp.settings.turnOnLink')} sub={t('phoneApp.link.turnOnSub')} onPress={openAccessibilitySettings} />
              </Card>
              {note(t('phoneApp.link.restricted'))}
            </>
          ) : (
            <>
              {section(t('phoneApp.link.mayBlock'))}
              <Card>
                <Row
                  first
                  Icon={ShieldAlert}
                  tone="butter"
                  label={t('phoneApp.link.blocked')}
                  sub={t('phoneApp.link.blockedSub')}
                  chevron={false}
                />
              </Card>
              {note(t('phoneApp.link.playProtect'))}

              {section(t('phoneApp.link.fromMac'))}
              <Card>
                <Row first Icon={Cable} tone="sky" label={t('phoneApp.link.step1')} sub={t('phoneApp.link.step1Sub')} chevron={false} />
                <Row Icon={Monitor} tone="sky" label={t('phoneApp.link.step2')} sub={t('phoneApp.link.step2Sub')} chevron={false} />
                <Row Icon={Hand} tone="sky" label={t('phoneApp.link.step3')} sub={t('phoneApp.link.step3Sub')} chevron={false} />
              </Card>
              {note(t('phoneApp.link.askAgent'))}

              {section(t('phoneApp.link.download'))}
              {note(t('phoneApp.link.downloadNote'))}
              <Button label={t('phoneApp.link.downloadButton')} Icon={Download} quiet onPress={downloadLink} />
            </>
          )}
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}
