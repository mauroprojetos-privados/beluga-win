import { useEffect, useState } from 'react';
import type { VoiceMacView } from '@beluga/companion/protocol.js';
import { VOICE_LANGUAGES, VOICE_MODELS, voiceKnows, voiceSize } from '@beluga/shared/voice-models.js';
import { Button, Kbd } from '../components/ui.js';
import { useApi } from '../lib/beluga.js';
import { accelLabel, accelOf, DEFAULT_SHORTCUT, microphonesOf, parseAccel, type Microphone } from '../lib/dictation-model.js';
import { voiceModelOf } from '../lib/dictation.js';
import { inApp } from '../lib/boot.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { chordLabel, keyPlatform } from '../lib/shortcuts-model.js';
import { microphoneSettings, osName, systemSettingsName, thisComputer, yourComputer } from '../lib/os-words.js';
import { say, useT } from '../lib/i18n.js';
import { rich } from './native/parts.js';

/**
 * Settings › Voice (BLG-146): speaking instead of typing. The microphone it listens to (BLG-766),
 * which model writes it down (the one Beluga suggests for your language, or yours), the language, the talk shortcut (recorded by
 * pressing it), whether it works from any app, whether it's sent at once, and the models on this Mac.
 */
export function VoiceSettings() {
  const t = useT();
  const api = useApi();
  const prefs = usePrefs();
  const [models, setModels] = useState<VoiceMacView | undefined>();
  const [recording, setRecording] = useState(false);
  const [bad, setBad] = useState<string | undefined>();
  const using = voiceModelOf(prefs);
  const suggested = voiceModelOf({ voiceModel: 'suggested', voiceLanguage: prefs.voiceLanguage });
  const mics = useMicrophones();

  // The models here, and how far one coming is (every 1.5 s while one comes).
  const coming = models?.models.some((m) => m.progress !== undefined) ?? false;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = (): void =>
      void api.voice.models().then(
        (v) => {
          if (!alive) return;
          setModels(v as VoiceMacView);
          // While one comes, look again in a moment (the pane is open, so you're looking).
          if (coming) timer = setTimeout(look, 1500);
        },
        () => undefined,
      );
    look();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [coming]);

  // The recorder: the next keys pressed (with at least one of ⌘⌃⌥ for a letter, digit or Space) become the shortcut.
  useEffect(() => {
    if (!recording) return;
    const down = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(false);
      const accel = accelOf(e);
      if (!accel) return;
      if (!parseAccel(accel)) return setBad(t('prefs.voice.badKeys', { keys: accelLabel(accel), mods: keyPlatform() === 'mac' ? t('prefs.voice.macMods') : t('prefs.voice.ctrlOrAlt') }));
      setBad(undefined);
      setPrefs({ voiceShortcut: accel });
      setRecording(false);
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [recording]);

  const label = (id: 'whisper-turbo' | 'parakeet'): string => (id === 'parakeet' ? t('prefs.voice.parakeet') : t('prefs.voice.whisper'));
  const keys = prefs.voiceShortcut ? accelLabel(prefs.voiceShortcut) : undefined;
  return (
    <>
      <Group title={say('Writing it down')}>
        <MicrophoneRow mics={mics} />
        <Row
          label={say('Model')}
          detail={
            prefs.voiceModel === 'suggested'
              ? t(prefs.voiceLanguage === 'en' ? 'prefs.voice.suggestedEnglish' : 'prefs.voice.suggestedYours', { model: VOICE_MODELS[suggested].label, why: suggested === 'parakeet' ? t('prefs.voice.whyParakeet') : t('prefs.voice.whyWhisper') })
              : using !== prefs.voiceModel
                ? t('prefs.voice.notParakeet')
                : using === 'parakeet'
                  ? t('prefs.voice.parakeetDetail')
                  : t('prefs.voice.whisperDetail')
          }
        >
          <Select
            label={t('prefs.voice.model')}
            value={prefs.voiceModel}
            onChange={(v) => setPrefs({ voiceModel: v })}
            options={[
              { value: 'suggested', label: t('prefs.voice.suggested', { model: VOICE_MODELS[suggested].label }) },
              { value: 'whisper-turbo', label: label('whisper-turbo') },
              { value: 'parakeet', label: label('parakeet') },
            ]}
          />
        </Row>
        <Row label={say('Language')} detail={prefs.voiceLanguage === 'auto' ? t('prefs.voice.languageAuto') : t('prefs.voice.languageOne')}>
          <Select label={t('prefs.voice.language')} value={prefs.voiceLanguage} onChange={(v) => setPrefs({ voiceLanguage: v })} options={VOICE_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
        </Row>
        {(models?.models ?? []).map((m) => (
          <Row
            key={m.model}
            label={VOICE_MODELS[m.model].label}
            detail={
              m.ready
                ? t(m.model === using ? 'prefs.voice.onComputerInUse' : 'prefs.voice.onComputer', { computer: thisComputer(), size: voiceSize(m.bytes) })
                : m.progress !== undefined
                  ? t('prefs.voice.getting', { percent: Math.round(m.progress * 100), size: voiceSize(m.bytes) })
                  : (m.error ?? t(m.model === using ? 'prefs.voice.once' : 'prefs.voice.onceWithIt', { size: voiceSize(m.bytes) }))
            }
          >
            {m.ready ? null : m.progress !== undefined ? null : (
              <Button disabled={!voiceKnows(m.model, prefs.voiceLanguage) && m.model === 'parakeet'} onClick={() => void api.voice.prepare(m.model).then((v) => setModels(v as VoiceMacView), () => undefined)}>
                {t('prefs.voice.getNow')}
              </Button>
            )}
          </Row>
        ))}
      </Group>

      <Group title={say('Talk shortcut')}>
        <Row
          label={say('Shortcut')}
          detail={
            bad ??
            (recording ? (
              t('prefs.voice.pressWanted')
            ) : keys ? (
              rich(t('prefs.voice.howTo'), { keys: <Kbd>{keys}</Kbd>, return: <Kbd>↩</Kbd>, esc: <Kbd>esc</Kbd> }) // i18n-ignore: key symbols
            ) : (
              t('prefs.voice.noShortcut')
            ))
          }
        >
          <Button onClick={() => (setBad(undefined), setRecording((r) => !r))}>{recording ? t('prefs.voice.pressKeys') : (keys ?? t('prefs.voice.set'))}</Button>
          {prefs.voiceShortcut && !recording ? (
            <Button variant="quiet" onClick={() => setPrefs({ voiceShortcut: '' })}>
              {t('prefs.voice.clear')}
            </Button>
          ) : null}
          {!prefs.voiceShortcut && !recording ? (
            <Button variant="quiet" onClick={() => setPrefs({ voiceShortcut: DEFAULT_SHORTCUT })}>
              {accelLabel(DEFAULT_SHORTCUT)}
            </Button>
          ) : null}
        </Row>
        {inApp() ? (
          <Row label={say('From any app')} detail={t('prefs.voice.fromAnyAppDetail')}>
            <Switch label={t('prefs.voice.fromAnyApp')} on={prefs.voiceAnyApp} onChange={(v) => setPrefs({ voiceAnyApp: v })} />
          </Row>
        ) : null}
        <Row label={say('Send right away')} detail={prefs.voiceSend ? t('prefs.voice.sentAtOnce') : t('prefs.voice.waits', { keys: chordLabel('Cmd+Enter') })}>
          <Switch label={t('prefs.voice.sendRightAway')} on={prefs.voiceSend} onChange={(v) => setPrefs({ voiceSend: v })} />
        </Row>
      </Group>
      <p className={s.note}>{t('prefs.voice.privacy', { computer: thisComputer(), yours: yourComputer() })}</p>
    </>
  );
}

interface Microphones {
  readonly list: readonly Microphone[];
  /** WebKit names them only once Beluga may use the microphone. */
  readonly named: boolean;
  /** Ask for the microphone once, so they show by name. */
  readonly reveal: () => Promise<void>;
  readonly error?: string;
}

/** The microphones on this computer, following ones plugged in or taken out while Settings is open. */
function useMicrophones(): Microphones {
  const t = useT();
  const [all, setAll] = useState<readonly MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | undefined>();
  const load = (): Promise<void> =>
    (navigator.mediaDevices?.enumerateDevices() ?? Promise.resolve([])).then(
      (d) => setAll(d),
      () => setAll([]),
    );
  useEffect(() => {
    void load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', load);
  }, []);
  const reveal = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setError(undefined);
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? t('prefs.voice.micDenied', { settings: microphoneSettings() }) : t('prefs.voice.micUnlisted'));
    }
    await load();
  };
  const list = microphonesOf(all);
  return { list, named: all.some((d) => d.kind === 'audioinput' && d.label), reveal, ...(error ? { error } : {}) };
}

/** Settings › Voice › Microphone: the one dictation listens to (calls keep their own, beside Mute). */
function MicrophoneRow({ mics }: { readonly mics: Microphones }) {
  const t = useT();
  const prefs = usePrefs();
  const picked = prefs.voiceMic;
  const gone = Boolean(picked) && mics.named && !mics.list.some((m) => m.id === picked);
  const detail =
    mics.error ??
    (!mics.named
      ? t('prefs.voice.micUnnamed', { os: osName() })
      : gone
        ? t('prefs.voice.micGone', { os: osName() })
        : picked
          ? t('prefs.voice.micPicked')
          : t('prefs.voice.micSystem', { settings: systemSettingsName() }));
  return (
    <Row label={say('Microphone')} detail={detail}>
      {mics.named ? (
        <Select
          label={t('prefs.voice.microphone')}
          value={gone ? '' : picked}
          onChange={(v) => setPrefs({ voiceMic: v })}
          options={[{ value: '', label: t('prefs.voice.sameAs', { os: osName() }) }, ...mics.list.map((m) => ({ value: m.id, label: m.label }))]}
        />
      ) : (
        <Button onClick={() => void mics.reveal()}>{t('prefs.voice.showMics')}</Button>
      )}
    </Row>
  );
}
