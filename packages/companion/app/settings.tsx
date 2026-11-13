import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { ArrowDownToLine, AtSign, Bell, Cable, Route, RefreshCw, Search, TriangleAlert, ChevronDown, ChevronUp, CircleCheck, Download, Hand, HardDrive, Info, LogOut, Mic, Monitor, MonitorSmartphone, Moon, MoonStar, Network, ShieldCheck, SlidersHorizontal, Smartphone, Sun } from 'lucide-react-native';
import { Segments } from '../components/Segments';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, ScrollView, Switch, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, Screen, useScrolled } from '../components/Screen';
import { Card, haptic, Pill, Row, T } from '../components/ui';
import { appearance, type Choice } from '../lib/appearance';
import { language, macLanguage, type PhoneLanguage, useT } from '../lib/language';
import { LOCALE_NAMES } from '../../../src/shared/i18n/locales';
import { useLink, useSupports, useView } from '../lib/hooks';
import { calls } from '../lib/link/calls';
import type { HomeView } from '../lib/link/protocol';
import { COMPANION_PROTO } from '../lib/link/protocol';
import { type NotifyPrefs, permission, prefs, setPrefs } from '../lib/notifications';
import { pathLabel } from '../lib/link/diagnose';
import { sizeOf } from '../components/Outputs';
import { useSaved } from '../lib/saved';
import { totalBytes } from '../lib/saved-list';
import { store } from '../lib/store';
import { askBatteryUnrestricted, batteryUnrestricted, setStay, stayAvailable, stayOn } from '../lib/stay';
import { accessibilityOn, addonInstalled, onAccessibilityChange, openAccessibilitySettings, phoneAllowed, phoneControlAvailable, setPhoneAllowed } from '../lib/phone';
import { color, ink } from '../lib/theme';
import { voiceAvailable, voiceChoice, voiceSetting } from '../lib/voice';
import { UpdateSheet } from '../components/Update';
import { appUpdate } from '../modules/app-update';
import { appVersion, autoOn, checkForUpdate, checkOn, setAuto, setCheck, updatesAvailable, useUpdate } from '../lib/update';
import { VOICE_MODELS } from '../../../src/shared/voice-models';

/**
 * The phone's own settings. On top: your Mac, notifications on or off, Storage, sign out. Everything else
 * (each kind of notification, the demo's switches, versions). Appearance sits with the basics under Advanced.
 * Voice (BLG-142) opens its own page: where the microphone's words are written down, and by which model.
 */
type KeepAwake = NonNullable<HomeView['mac']['keepAwake']>;

export default function Settings() {
  const { scrolled, onScroll } = useScrolled();
  const insets = useSafeAreaInsets();
  const link = useLink();
  const supportsAgents = useSupports('externalAgents');
  const supportsRouting = useSupports('routing');
  const [p, setP] = useState<NotifyPrefs>(prefs());
  const [perm, setPerm] = useState<string>('');
  const [asleep, setAsleep] = useState(store.demo?.sleeping ?? false);
  const [confirm, setConfirm] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [look, setLook] = useState<Choice>(appearance.get());
  const t = useT();
  const [lang, setLang] = useState<PhoneLanguage>(language.get());
  const macSays = macLanguage();
  const saved = useSaved();
  const home = useView<HomeView>('home');
  const [stay, setStayOn] = useState(stayOn());
  const [unrestricted, setUnrestricted] = useState(true);
  useEffect(() => setUnrestricted(batteryUnrestricted()), [stay]);
  // Let your Mac use this phone (BLG-150): the phone's own switch, and whether Accessibility is on.
  const canControl = link.mode === 'bare' && phoneControlAvailable();
  const [control, setControl] = useState(phoneAllowed());
  const [acc, setAcc] = useState(accessibilityOn());
  const [addon, setAddon] = useState(addonInstalled());
  // Updates (BLG-426): the phone app's own, as the Mac's Settings › General › Updates.
  const update = useUpdate();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(appUpdate.canInstall());
  // Back from Android's settings (notifications, battery, accessibility): show what's true now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void permission(false).then(setPerm);
      setUnrestricted(batteryUnrestricted());
      setAcc(accessibilityOn());
      setAddon(addonInstalled());
      setCanInstall(appUpdate.canInstall());
    });
    return () => sub.remove();
  }, []);
  // Beluga Link answers a moment after the app binds it: show its Accessibility as soon as it does.
  useEffect(
    () =>
      onAccessibilityChange(() => {
        setAcc(accessibilityOn());
        setAddon(addonInstalled());
      }),
    [],
  );
  const toggleControl = () => {
    haptic.tap();
    const next = !control;
    setPhoneAllowed(next);
    setControl(next);
    // Control needs the link up in the background, so turn Stay connected on with it.
    if (next && !stay) {
      setStay(true);
      setStayOn(true);
      if (perm !== 'granted') void permission(true).then(setPerm);
      if (!batteryUnrestricted()) askBatteryUnrestricted();
    }
    store.staySet();
    store.controlSet(next);
    // Without Beluga Link there's nothing to turn on yet: the guide says how to get it (BLG-390).
    if (next && !accessibilityOn()) {
      if (addonInstalled()) openAccessibilitySettings();
      else router.push('/link');
    }
  };
  const toggleStay = () => {
    haptic.tap();
    const next = !stay;
    setStay(next);
    setStayOn(next);
    store.staySet();
    if (!next) return;
    if (perm !== 'granted') void permission(true).then(setPerm);
    // Without it, Android's battery saver may still cut the link off after a while.
    if (!batteryUnrestricted()) askBatteryUnrestricted();
  };
  const canKeepAwake = useSupports('keepAwake');
  const [awake, setAwake] = useState<KeepAwake | undefined>(undefined);
  const keepAwake = awake ?? home?.data.mac.keepAwake ?? 'off';
  const chooseAwake = (mode: KeepAwake) => {
    haptic.tap();
    setAwake(mode);
    void store.call(calls.keepAwake(mode), { queue: false }).catch(() => {
      setAwake(undefined);
      store.toast({ text: t('phoneApp.settings.awayChange'), tone: 'warn' });
    });
  };
  useEffect(() => {
    void permission(false).then(setPerm);
  }, []);

  const save = (next: NotifyPrefs) => {
    haptic.tap();
    setP(next);
    setPrefs(next);
    if ((next.needsYou || next.done || next.mentions) && perm !== 'granted') void permission(true).then(setPerm);
  };
  const all = p.needsYou || p.done || p.mentions;
  const toggle = (on: boolean, onChange: () => void) => (
    <View pointerEvents="none">
      <Switch value={on} onValueChange={onChange} trackColor={{ true: ink.mint, false: color.hairlineStrong }} thumbColor={color.white} {...(Platform.OS === 'web' ? ({ activeThumbColor: color.white } as object) : {})} />
    </View>
  );

  return (
    <Screen>
      <Header scrolled={scrolled} back title={t('common.settings')} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 20 }}>
        <Animated.View entering={FadeIn.duration(300)}>
          <Card>
            <Row first Icon={Monitor} tone="mint" label={link.mac?.name ?? link.pairing?.macName ?? t('phone.home.yourMac')} sub={link.mode === 'demo' ? t('phoneApp.settings.demoMac') : t('phoneApp.settings.belugaVersion', { version: link.mac?.version ?? '' })} right={<Pill label={link.phase === 'open' ? t('phone.home.linked') : link.phase === 'asleep' ? t('phone.home.asleep') : t('phone.home.away')} tone={link.phase === 'open' ? 'mint' : 'sky'} />} />
            <Row
              Icon={Bell}
              tone="butter"
              label={t('phoneApp.settings.notifications')}
              sub={perm === 'denied' ? t('phoneApp.settings.notificationsOff') : undefined}
              right={toggle(all && perm !== 'denied', () => {})}
              // Off in Android: the switch takes you there (lib/notifications.ts), whatever the app's own choice.
              onPress={() => (perm === 'denied' ? void permission(true).then(setPerm) : save({ needsYou: !all, done: !all, mentions: !all }))}
              chevron={false}
            />
            {link.mode === 'bare' && stayAvailable() ? (
              <Row
                Icon={Cable}
                tone="lavender"
                label={t('phoneApp.settings.stay')}
                sub={stay ? t('phoneApp.settings.stayOnSub') : t('phoneApp.settings.stayOffSub')}
                right={toggle(stay, () => {})}
                onPress={toggleStay}
                chevron={false}
              />
            ) : null}
            {stay && !unrestricted ? (
              <Row
                Icon={TriangleAlert}
                tone="butter"
                label={t('phoneApp.settings.background')}
                sub={t('phoneApp.settings.backgroundSub')}
                onPress={askBatteryUnrestricted}
              />
            ) : null}
            {Platform.OS !== 'web' && voiceAvailable() ? <VoiceRow /> : null}
            {canControl ? (
              <Row
                Icon={MonitorSmartphone}
                tone="sky"
                label={t('phoneApp.settings.control')}
                sub={control ? t('phoneApp.settings.controlOnSub') : t('phoneApp.settings.controlOffSub')}
                right={toggle(control, () => {})}
                onPress={toggleControl}
                chevron={false}
              />
            ) : null}
            {canControl && control && !acc && !addon ? (
              <Row
                Icon={Download}
                tone="peach"
                label={t('phoneApp.settings.getLink')}
                sub={t('phoneApp.settings.getLinkSub')}
                onPress={() => router.push('/link')}
              />
            ) : null}
            {canControl && control && !acc && addon ? (
              <Row
                Icon={ShieldCheck}
                tone="peach"
                label={t('phoneApp.settings.turnOnLink')}
                sub={t('phoneApp.settings.turnOnLinkSub')}
                onPress={openAccessibilitySettings}
              />
            ) : null}
            {update.release && update.phase !== 'current' ? (
              <Row Icon={ArrowDownToLine} tone="mint" label={t('phoneApp.settings.updateTo', { version: update.release.version })} sub={update.phase === 'downloading' ? t('phoneApp.settings.downloading', { percent: Math.round((update.progress ?? 0) * 100) }) : update.phase === 'ready' ? t('phoneApp.settings.readyToInstall') : t('phoneApp.settings.seeWhatsNew')} onPress={() => setUpdateOpen(true)} />
            ) : null}
            {supportsRouting ? <Row Icon={Route} tone="mint" label={t('phoneApp.settings.routing')} sub={t('phoneApp.settings.routingSub')} onPress={() => router.push('/routing')} /> : null}
            {supportsAgents ? <Row Icon={Cable} tone="lavender" label={t('phoneApp.settings.agents')} sub={t('phoneApp.settings.agentsSub')} onPress={() => router.push('/agents')} /> : null}
            <Row Icon={HardDrive} tone="sky" label={t('phoneApp.settings.storage')} sub={saved.length ? t('phoneApp.settings.storageSaved', { count: saved.length, size: sizeOf(totalBytes(saved)) }) : t('phoneApp.settings.storageSub')} onPress={() => router.push('/storage')} />
            <Row
              Icon={LogOut}
              tone="rose"
              label={confirm ? t('phoneApp.settings.tapAgain') : link.mode === 'demo' ? t('phoneApp.settings.leaveDemo') : t('phoneApp.settings.signOut')}
              onPress={async () => {
                if (!confirm) {
                  haptic.warn();
                  setConfirm(true);
                  return;
                }
                const r = await store.signOut();
                if (link.mode === 'bare' && !r.onMac) store.toast({ text: t('phoneApp.settings.signedOutAway'), tone: 'warn' });
                router.replace('/pair');
              }}
              chevron={false}
            />
          </Card>
        </Animated.View>

            <View style={{ gap: 8 }}>
              <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                {t('phoneApp.settings.appearance')}
              </T>
              <Segments
                value={look}
                onChange={(c: Choice) => {
                  setLook(c);
                  appearance.set(c);
                }}
                options={[
                  { key: 'system', label: t('phoneApp.settings.system'), Icon: Smartphone },
                  { key: 'light', label: t('phoneApp.settings.light'), Icon: Sun },
                  { key: 'dark', label: t('phoneApp.settings.dark'), Icon: Moon },
                ]}
              />
            </View>

            <View style={{ gap: 8 }}>
              <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                {t('language.title')}
              </T>
              <Segments
                value={lang}
                onChange={(c: PhoneLanguage) => {
                  setLang(c);
                  language.set(c);
                }}
                options={[
                  { key: 'mac', label: t('language.macShort'), Icon: Monitor },
                  { key: 'en', label: LOCALE_NAMES.en },
                  { key: 'pt-BR', label: 'Português' }, // i18n-ignore
                ]}
              />
              <T v="caption" style={{ paddingHorizontal: 6 }}>
                {lang === 'mac' && macSays ? t('language.followMac', { language: LOCALE_NAMES[macSays] }) : t('language.phoneHint')}
              </T>
            </View>

        <Card>
          <Row first Icon={SlidersHorizontal} tone="lavender" label={t('phoneApp.settings.advanced')} onPress={() => setAdvanced((a) => !a)} chevron={false} right={advanced ? <ChevronUp color={color.text3} size={18} /> : <ChevronDown color={color.text3} size={18} />} />
        </Card>

        {advanced ? (
          <Animated.View entering={FadeIn.duration(250)} style={{ gap: 20 }}>
            {link.mode === 'bare' ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                  {t('phoneApp.settings.connection')}
                </T>
                <Card>
                  <Row
                    first
                    Icon={Network}
                    tone={link.path === 'relay' ? 'lavender' : 'mint'}
                    label={link.phase === 'open' && link.path ? pathLabel(link.path) : link.diagnosis?.title ?? t('phoneApp.settings.notLinked')}
                    sub={link.phase === 'open' && link.path === 'relay' ? t('phoneApp.settings.relaySub') : undefined}
                    chevron={false}
                  />
                </Card>
              </View>
            ) : null}
            {link.mode !== 'demo' && canKeepAwake ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                  {t('phoneApp.settings.keepAwake')}
                </T>
                <Segments
                  value={keepAwake}
                  onChange={chooseAwake}
                  options={[
                    { key: 'off', label: t('phoneApp.settings.never') },
                    { key: 'power', label: t('phoneApp.settings.onPower') },
                    { key: 'always', label: t('phoneApp.settings.always') },
                  ]}
                />
                <T v="caption" c={color.text3} style={{ paddingHorizontal: 6 }}>
                  {t('phoneApp.settings.keepAwakeHint')}
                </T>
              </View>
            ) : null}
            <View style={{ gap: 8 }}>
              <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                {t('phoneApp.settings.notifyAbout')}
              </T>
              <Card>
                <Row first Icon={Hand} tone="peach" label={t('phoneApp.settings.needsYou')} right={toggle(p.needsYou, () => {})} onPress={() => save({ ...p, needsYou: !p.needsYou })} chevron={false} />
                <Row Icon={CircleCheck} tone="mint" label={t('phoneApp.settings.done')} sub={stay ? t('phoneApp.settings.doneOnSub') : t('phoneApp.settings.doneOffSub')} right={toggle(p.done, () => {})} onPress={() => save({ ...p, done: !p.done })} chevron={false} />
                <Row Icon={AtSign} tone="sky" label={t('phoneApp.settings.mentions')} right={toggle(p.mentions, () => {})} onPress={() => save({ ...p, mentions: !p.mentions })} chevron={false} />
              </Card>
            </View>

            {link.mode === 'demo' ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                  {t('phoneApp.settings.demo')}
                </T>
                <Card>
                  <Row
                    first
                    Icon={MoonStar}
                    tone="sky"
                    label={t('phoneApp.settings.macAsleep')}
                    sub={t('phoneApp.settings.macAsleepSub')}
                    right={toggle(asleep, () => {})}
                    chevron={false}
                    onPress={() => {
                      setAsleep(!asleep);
                      store.setDemoAsleep(!asleep);
                    }}
                  />
                </Card>
              </View>
            ) : null}

            {updatesAvailable() ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                  {t('phoneApp.settings.updates')}
                </T>
                <Card>
                  <Row
                    first
                    Icon={ArrowDownToLine}
                    tone="mint"
                    label={t('phoneApp.settings.updateAuto')}
                    sub={autoOn() ? t('phoneApp.settings.autoOnSub') : t('phoneApp.settings.autoOffSub')}
                    right={toggle(autoOn(), () => {})}
                    onPress={() => {
                      haptic.tap();
                      setAuto(!autoOn());
                    }}
                    chevron={false}
                  />
                  {autoOn() && !canInstall ? (
                    <Row Icon={ShieldCheck} tone="butter" label={t('phoneApp.settings.allowInstalls')} sub={t('phoneApp.settings.allowInstallsSub')} onPress={appUpdate.allowInstalls} />
                  ) : null}
                  <Row
                    Icon={Search}
                    tone="sky"
                    label={t('phoneApp.settings.checkUpdates')}
                    sub={checkOn() ? t('phoneApp.settings.checkOnSub') : t('phoneApp.settings.checkOffSub')}
                    right={toggle(checkOn(), () => {})}
                    onPress={() => {
                      haptic.tap();
                      setCheck(!checkOn());
                    }}
                    chevron={false}
                  />
                  <Row
                    Icon={RefreshCw}
                    tone="plain"
                    label={update.phase === 'checking' ? t('phoneApp.settings.checking') : t('phoneApp.settings.checkNow')}
                    sub={update.checkedAt ? t(update.phase === 'current' ? 'phoneApp.settings.lastLookedCurrent' : 'phoneApp.settings.lastLooked', { when: new Date(update.checkedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) : undefined}
                    onPress={() => void checkForUpdate(true)}
                    chevron={false}
                  />
                </Card>
              </View>
            ) : null}

            <Card>
              <Row first Icon={Info} tone="plain" label={t('phoneApp.settings.about')} sub={link.mac ? t('phoneApp.settings.aboutSubMac', { app: appVersion() ?? (Constants.expoConfig?.version ?? ''), link: `${COMPANION_PROTO.major}.${COMPANION_PROTO.minor}`, mac: link.mac.version }) : t('phoneApp.settings.aboutSub', { app: appVersion() ?? (Constants.expoConfig?.version ?? ''), link: `${COMPANION_PROTO.major}.${COMPANION_PROTO.minor}` })} />
            </Card>
          </Animated.View>
        ) : null}
      </ScrollView>
      <UpdateSheet visible={updateOpen} onClose={() => setUpdateOpen(false)} />
    </Screen>
  );
}

/** Settings' Voice row: what the microphone does now (it changes on the Voice page). */
function VoiceRow() {
  useSupports('voice');
  // Back from the Voice page: what was chosen there.
  const [, again] = useState(0);
  useFocusEffect(useCallback(() => again((n) => n + 1), []));
  const c = voiceChoice();
  const suggested = voiceSetting().preset === 'suggested';
  const t = useT();
  const where = c.where === 'mac' ? t('phoneApp.settings.voiceOnMac') : t('phoneApp.settings.voiceOnPhone');
  return <Row Icon={Mic} tone="peach" label={t('phoneApp.settings.voice')} sub={t(suggested ? 'phoneApp.settings.voiceSubSuggested' : 'phoneApp.settings.voiceSub', { where, model: VOICE_MODELS[c.model].label })} onPress={() => router.push('/voice')} />;
}
