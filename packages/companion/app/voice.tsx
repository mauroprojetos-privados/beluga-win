import { Check, ChevronDown, ChevronUp, Download, Gauge, Languages, Laptop, SlidersHorizontal, Smartphone, Trash2, Zap } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Options, type Option } from '../components/Options';
import { Header, Screen, useScrolled } from '../components/Screen';
import { Segments } from '../components/Segments';
import { Card, haptic, Pill, Row, T, type Tone } from '../components/ui';
import { useLink, useSupports } from '../lib/hooks';
import { calls } from '../lib/link/calls';
import type { VoiceMacView } from '../lib/link/protocol';
import { store } from '../lib/store';
import { color } from '../lib/theme';
import { useT } from '../lib/language';
import { getPhoneModel, phoneGB, phoneModelReady, removePhoneModel, setVoiceSetting, voiceChoice, voiceSetting } from '../lib/voice';
import { suggestVoice, VOICE_LANGUAGES, VOICE_MODEL_IDS, VOICE_MODELS, VOICE_PRESETS, type VoiceModelId, type VoicePresetId, type VoiceSetting, type VoiceWhere, voiceKnows, voiceSize } from '../../../src/shared/voice-models';

/**
 * Settings › Voice (BLG-142): how the Ask sheet's microphone writes down what you say. Presets
 * first, the one Beluga suggests for this phone and Mac marked (and chosen until you pick another);
 * the language; then, one tap away, your own where and model, and the models on the phone and on
 * the Mac (get one now, or take one off the phone).
 */
const PRESET_LOOK: Record<VoicePresetId, { Icon: typeof Zap; tone: Tone }> = {
  quick: { Icon: Smartphone, tone: 'mint' },
  'best-phone': { Icon: Gauge, tone: 'peach' },
  mac: { Icon: Laptop, tone: 'sky' },
  'mac-fast': { Icon: Zap, tone: 'lavender' },
};

export default function Voice() {
  const { scrolled, onScroll } = useScrolled();
  const insets = useSafeAreaInsets();
  const link = useLink();
  const t = useT();
  const macVoice = useSupports('voice');
  const [set, setSet] = useState<VoiceSetting>(voiceSetting());
  const [advanced, setAdvanced] = useState(set.preset === 'custom');
  const [langSheet, setLangSheet] = useState(false);
  const [mac, setMac] = useState<VoiceMacView | undefined>();
  const [getting, setGetting] = useState<Partial<Record<VoiceModelId, number>>>({});
  const [, redraw] = useState(0);

  const suggested = suggestVoice({ macVoice, phoneGB: phoneGB(), language: set.language });
  const choice = voiceChoice(set);
  const save = (next: VoiceSetting) => {
    haptic.tap();
    setSet(next);
    setVoiceSetting(next);
    // A Mac model starts coming now, so the first time you speak it's there.
    const c = voiceChoice(next);
    if (c.where === 'mac' && macVoice && link.phase === 'open') void store.call<VoiceMacView>(calls.voicePrepare(c.model), { queue: false }).then(setMac, () => {});
  };

  // The Mac's models, and how far one coming is (every 2 s while one comes).
  const coming = mac?.models.some((m) => m.progress !== undefined) ?? false;
  useEffect(() => {
    if (!macVoice || link.phase !== 'open') return;
    let alive = true;
    const look = () => void store.call<VoiceMacView>(calls.voice(), { queue: false }).then((v) => alive && v && setMac(v), () => {});
    look();
    const t = coming ? setInterval(look, 2000) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [macVoice, link.phase, coming]);

  const getHere = (id: VoiceModelId) => {
    haptic.tap();
    setGetting((g) => ({ ...g, [id]: 0 }));
    void getPhoneModel(id, (p) => setGetting((g) => ({ ...g, [id]: p })))
      .then(
        () => store.toast({ text: t('phoneApp.voice.onPhoneNow', { model: VOICE_MODELS[id].label }), tone: 'ok' }),
        (e: unknown) => store.toast({ text: e instanceof Error ? e.message : t('phoneApp.voice.couldntGet'), tone: 'warn' }),
      )
      .finally(() =>
        setGetting((g) => {
          const { [id]: _, ...rest } = g;
          return rest;
        }),
      );
  };
  const removeHere = (id: VoiceModelId) => {
    haptic.warn();
    void removePhoneModel(id).then(() => redraw((n) => n + 1));
  };

  const language = VOICE_LANGUAGES.find((l) => l.code === set.language)?.label ?? set.language;
  const languageOptions: Option[] = VOICE_LANGUAGES.map((l) => ({ Icon: l.code === set.language ? Check : Languages, label: l.label, tone: l.code === set.language ? 'mint' : 'plain', onPress: () => save({ ...set, language: l.code }) }));
  const selected: VoicePresetId | undefined = set.preset === 'custom' ? undefined : set.preset === 'suggested' ? suggested : set.preset;

  return (
    <Screen>
      <Header scrolled={scrolled} back title={t('phoneApp.settings.voice')} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 20 }}>
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: 8 }}>
          <T v="caption" c={color.text3} style={{ paddingHorizontal: 6 }}>
            {t('phoneApp.voice.intro')}
          </T>
          <Card>
            {VOICE_PRESETS.map((p, i) => {
              const off = p.where === 'mac' && !macVoice;
              const knows = voiceKnows(p.model, set.language);
              const on = selected === p.id;
              return (
                <Row
                  key={p.id}
                  first={i === 0}
                  Icon={PRESET_LOOK[p.id].Icon}
                  tone={off ? 'plain' : PRESET_LOOK[p.id].tone}
                  label={p.label}
                  sub={off ? t('phoneApp.voice.needsUpdate') : !knows ? t('phoneApp.voice.doesntKnowWhisper', { language }) : p.sub}
                  right={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {p.id === suggested ? <Pill label={t('phoneApp.voice.suggested')} tone="mint" /> : null}
                      {on ? <Check color={color.primary} size={20} strokeWidth={2} /> : null}
                    </View>
                  }
                  // The suggested one follows the suggestion (it may change with your Mac or language).
                  onPress={off ? undefined : () => save({ preset: p.id === suggested ? 'suggested' : p.id, language: set.language })}
                  chevron={false}
                />
              );
            })}
          </Card>
          <T v="caption" c={color.text3} style={{ paddingHorizontal: 6 }}>
            {macVoice ? t('phoneApp.voice.suggestMac') : (phoneGB() ?? 0) >= 8 ? t('phoneApp.voice.suggestLarge') : t('phoneApp.voice.suggestSmall')}
          </T>
        </Animated.View>

        <Card>
          <Row first Icon={Languages} tone="butter" label={t('phoneApp.voice.language')} sub={set.language === 'auto' ? t('phoneApp.voice.languageAuto') : t('phoneApp.voice.languageOne')} right={<T v="callout">{language}</T>} onPress={() => setLangSheet(true)} />
        </Card>

        <Card>
          <Row first Icon={SlidersHorizontal} tone="lavender" label={t('phoneApp.voice.custom')} sub={set.preset === 'custom' ? t('phoneApp.settings.voiceSub', { where: set.where === 'mac' ? t('phoneApp.settings.voiceOnMac') : t('phoneApp.settings.voiceOnPhone'), model: VOICE_MODELS[choice.model].label }) : t('phoneApp.voice.customSub')} onPress={() => setAdvanced((a) => !a)} chevron={false} right={advanced ? <ChevronUp color={color.text3} size={18} /> : <ChevronDown color={color.text3} size={18} />} />
        </Card>

        {advanced ? (
          <Animated.View entering={FadeIn.duration(250)} style={{ gap: 20 }}>
            <View style={{ gap: 8 }}>
              <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                {t('phoneApp.voice.where')}
              </T>
              <Segments<VoiceWhere>
                value={choice.where}
                onChange={(where) => save({ preset: 'custom', where, model: VOICE_MODELS[choice.model].files[where] ? choice.model : 'whisper-turbo', language: set.language })}
                options={[
                  { key: 'phone', label: t('phoneApp.voice.thisPhone'), Icon: Smartphone },
                  ...(macVoice ? [{ key: 'mac' as const, label: t('phone.home.yourMac'), Icon: Laptop }] : []),
                ]}
              />
            </View>
            <View style={{ gap: 8 }}>
              <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                {t('phoneApp.voice.model')}
              </T>
              <Card>
                {VOICE_MODEL_IDS.filter((id) => VOICE_MODELS[id].files[choice.where]).map((id, i) => {
                  const m = VOICE_MODELS[id];
                  const knows = voiceKnows(id, set.language);
                  return (
                    <Row
                      key={id}
                      first={i === 0}
                      Icon={m.kind === 'parakeet' ? Zap : Gauge}
                      tone={knows ? (m.kind === 'parakeet' ? 'lavender' : 'peach') : 'plain'}
                      label={m.label}
                      sub={!knows ? t('phoneApp.voice.doesntKnow', { language }) : t('phoneApp.voice.modelSub', { size: voiceSize(m.files[choice.where]!.bytes), languages: m.languages === 'all' ? t('phoneApp.voice.everyLanguage') : t('phoneApp.voice.european') })}
                      right={choice.model === id ? <Check color={color.primary} size={20} strokeWidth={2} /> : null}
                      onPress={knows ? () => save({ preset: 'custom', where: choice.where, model: id, language: set.language }) : undefined}
                      chevron={false}
                    />
                  );
                })}
              </Card>
            </View>

            <View style={{ gap: 8 }}>
              <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                {t('phoneApp.settings.voiceOnPhone')}
              </T>
              <Card>
                {VOICE_MODEL_IDS.filter((id) => VOICE_MODELS[id].files.phone).map((id, i) => {
                  const m = VOICE_MODELS[id];
                  const here = phoneModelReady(id);
                  const g = getting[id];
                  return (
                    <Row
                      key={id}
                      first={i === 0}
                      Icon={here ? Trash2 : Download}
                      tone={here ? 'rose' : 'sky'}
                      label={m.label}
                      sub={g !== undefined ? t('phoneApp.voice.getting', { percent: Math.round(g * 100) }) : here ? t('phoneApp.voice.here', { size: voiceSize(m.files.phone!.bytes) }) : t('phoneApp.voice.getNow', { size: voiceSize(m.files.phone!.bytes) })}
                      onPress={g !== undefined ? undefined : here ? () => removeHere(id) : () => getHere(id)}
                      chevron={false}
                    />
                  );
                })}
              </Card>
            </View>

            {macVoice ? (
              <View style={{ gap: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 6 }}>
                  {t('phoneApp.settings.voiceOnMac')}
                </T>
                <Card>
                  {link.phase !== 'open' ? (
                    <Row first Icon={Laptop} tone="plain" label={t('phoneApp.voice.macAway')} sub={t('phoneApp.voice.macAwaySub')} chevron={false} />
                  ) : (
                    !mac ? (
                    <Row first Icon={Laptop} tone="plain" label={t('phoneApp.voice.looking')} chevron={false} />
                  ) : (
                    mac.models.map((m, i) => (
                      <Row
                        key={m.model}
                        first={i === 0}
                        Icon={m.ready ? Check : Download}
                        tone={m.ready ? 'mint' : 'sky'}
                        label={VOICE_MODELS[m.model].label}
                        sub={m.ready ? t('phoneApp.voice.onMac', { size: voiceSize(m.bytes) }) : m.progress !== undefined ? t('phoneApp.voice.gettingMac', { percent: Math.round(m.progress * 100) }) : (m.error ?? t('phoneApp.voice.getMacNow', { size: voiceSize(m.bytes) }))}
                        onPress={m.ready || m.progress !== undefined ? undefined : () => (haptic.tap(), void store.call<VoiceMacView>(calls.voicePrepare(m.model), { queue: false }).then(setMac, () => {}))}
                        chevron={false}
                      />
                    ))
                  ))}
                </Card>
              </View>
            ) : null}
          </Animated.View>
        ) : null}
      </ScrollView>
      <Options visible={langSheet} onClose={() => setLangSheet(false)} title={t('phoneApp.voice.languageTitle')} options={languageOptions} />
    </Screen>
  );
}
