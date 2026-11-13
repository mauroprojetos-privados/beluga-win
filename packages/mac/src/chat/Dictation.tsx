import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon.js';
import { Kbd, Tip, cx } from '../components/ui.js';
import { accelLabel } from '../lib/dictation-model.js';
import { cancelDictation, dictatingInto, dictationWave, errorIn, finishDictation, gettingLine, type Phrase, toggleDictation, useDictation } from '../lib/dictation.js';
import { usePrefs } from '../lib/prefs.js';
import { chordLabel } from '../lib/shortcuts-model.js';
import { useClock } from '../lib/window-active.js';
import { useT } from '../lib/i18n.js';
import s from './dictation.module.css';

/**
 * The composer's voice (BLG-145, BLG-162): the microphone beside Send, and over the box while it
 * listens a strip that's alive: your voice as a waveform drawn as it comes (each pause marked where
 * it cut a phrase), and the words arriving phrase by phrase as the Mac writes them down, while you
 * keep talking. Pastel, no glow; still for reduced motion.
 */

const FRAME_MS = 30;
/** Plain colours for the canvas (it can't read colour-mix): soft rose speech, quiet pauses, lavender cuts. */
const WAVE_COLORS = {
  light: { speech: '#e7a0ab', pause: 'rgba(60, 60, 67, 0.16)', mark: '#a596e6' },
  dark: { speech: '#c97b88', pause: 'rgba(235, 235, 245, 0.18)', mark: '#9a89dc' },
} as const;
const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function MicButton({ box }: { readonly box: React.RefObject<HTMLTextAreaElement | null> }) {
  const d = useDictation();
  const t = useT();
  const prefs = usePrefs();
  const here = dictatingInto(box.current);
  const listening = here && d.kind === 'listening';
  const busy = here && (d.kind === 'getting' || d.kind === 'writing');
  const ring = useRef<HTMLSpanElement>(null);
  // The ring breathes with your voice: read from the waveform each frame, not through React.
  useEffect(() => {
    if (!listening || reduced()) return;
    let raf = 0;
    let shown = 0;
    const tick = (): void => {
      const w = dictationWave();
      const level = w.length ? Math.max(...w.slice(-4).map((f) => f.level)) : 0;
      shown += (level - shown) * 0.25;
      ring.current?.style.setProperty('--level', shown.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [listening]);
  const keys = prefs.voiceShortcut ? accelLabel(prefs.voiceShortcut) : undefined;
  return (
    <Tip label={listening ? t('chat.dictation.writeInTip') : busy ? (d.kind === 'writing' ? t('chat.dictation.writingLast') : t('chat.dictation.gettingReady')) : keys ? t('chat.dictation.speakHold', { keys }) : t('chat.dictation.speak')} {...(listening ? { keys: '↩' } : keys ? { keys } : {})}>
      <button
        type="button"
        className={cx(s.mic, listening && s.micOn, busy && s.micBusy)}
        aria-label={listening ? t('chat.dictation.writeIn') : t('chat.dictation.speak')}
        aria-pressed={listening}
        disabled={(d.kind === 'writing' && here) || (d.kind !== 'off' && !here)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => toggleDictation(box.current)}
      >
        <span ref={ring} className={s.ring} aria-hidden="true" />
        <span className={s.micFace}>{busy ? <span className={s.dots}><i /><i /><i /></span> : listening ? <span className={s.stopMark} /> : <Icon name="mic" size={14} />}</span>
      </button>
    </Tip>
  );
}

/** Your voice as it comes: bars sliding left (one every 30 ms), speech in rose, pauses quiet, a dot where a phrase was cut. */
function Waveform({ live }: { readonly live: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let lastLen = -1;
    let lastAt = performance.now();
    const still = reduced();
    const draw = (now: number): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { speech, pause, mark } = WAVE_COLORS[document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'];
      const frames = dictationWave();
      if (frames.length !== lastLen) {
        lastLen = frames.length;
        lastAt = now;
      }
      // Between frames the bars glide, so it moves like a stream, not in steps.
      const glide = live && !still ? Math.min(1, (now - lastAt) / FRAME_MS) : 0;
      const step = 5;
      const bar = 3;
      const mid = h / 2;
      const count = Math.ceil(w / step) + 1;
      const from = Math.max(0, frames.length - count);
      for (let i = from; i < frames.length; i++) {
        const f = frames[i]!;
        const x = w - (frames.length - i) * step - glide * step + step - bar;
        if (x < -bar) continue;
        // The oldest bars fade out at the left edge.
        const fade = Math.min(1, (x + bar) / 48);
        const height = Math.max(2, f.level * (h - 6));
        ctx.globalAlpha = fade * (live ? 1 : 0.55);
        ctx.fillStyle = f.speaking ? speech : pause;
        ctx.beginPath();
        ctx.roundRect(x, mid - height / 2, bar, height, 1.5);
        ctx.fill();
        if (f.cut) {
          ctx.fillStyle = mark;
          ctx.beginPath();
          ctx.arc(x + bar / 2, h - 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (live) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [live]);
  return <canvas ref={canvas} className={s.wave} aria-hidden="true" />;
}

/** The words so far: written phrases arrive word by word; one being written shimmers where it will go. */
function Transcript({ phrases, listening }: { readonly phrases: readonly Phrase[]; readonly listening: boolean }) {
  const t = useT();
  if (!phrases.length) return listening ? <div className={s.transcript}><span className={s.hint}>{t('chat.dictation.hint')}</span></div> : null;
  return (
    <div className={s.transcript} aria-live="polite">
      {phrases.map((p) =>
        p.status === 'writing' ? (
          <span key={p.id} className={s.pending} aria-label={t('chat.dictation.beingWritten')} />
        ) : p.status === 'failed' ? (
          <span key={p.id} className={s.missed} title={t('chat.dictation.partFailed')}>…</span>
        ) : (
          <span key={p.id} className={s.phrase}>
            {(p.text ?? '').split(/(\s+)/).map((w, i) =>
              /^\s+$/.test(w) ? (
                w
              ) : (
                <span key={i} className={s.word} style={{ animationDelay: `${Math.min(i, 40) * 22}ms` }}>
                  {w}
                </span>
              ),
            )}{' '}
          </span>
        ),
      )}
      {listening ? <span className={s.caret} aria-hidden="true" /> : null}
    </div>
  );
}

/** Over the box while it listens, writes, or gets its model ready. */
export function DictationStrip({ box }: { readonly box: React.RefObject<HTMLTextAreaElement | null> }) {
  const d = useDictation();
  const t = useT();
  const prefs = usePrefs();
  const here = dictatingInto(box.current);
  const now = useClock(here && d.kind === 'listening', 500);
  if (d.kind === 'off') {
    const error = errorIn(box.current);
    if (!error) return null;
    return (
      <div className={cx(s.strip, s.error)} role="status">
        <div className={s.row}>
          <Icon name="mic" size={12} />
          <span className={s.text}>{error}</span>
        </div>
      </div>
    );
  }
  if (!here) return null;
  if (d.kind === 'getting') {
    return (
      <div className={s.strip} role="status">
        <div className={s.row}>
          <span className={s.dotsInline}><i /><i /><i /></span>
          <span className={s.text}>{gettingLine(d)}</span>
          <span className={s.flex} />
          <button type="button" className={s.done} onClick={cancelDictation}>
            {t('common.cancel')}
          </button>
        </div>
        {d.progress > 0 ? <div className={s.progress} style={{ ['--p' as string]: d.progress }} /> : null}
      </div>
    );
  }
  const listening = d.kind === 'listening';
  const secs = listening ? Math.max(0, Math.floor((now - d.since) / 1000)) : 0;
  const send = d.kind === 'writing' ? d.send : prefs.voiceSend;
  return (
    <div className={cx(s.strip, s.voice, listening && s.live)} role="status">
      <div className={s.row}>
        <Waveform live={listening} />
        {listening ? (
          <span className={s.time}>
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
          </span>
        ) : (
          <span className={s.time}>{send ? t('chat.dictation.sendingWhenWritten') : t('chat.dictation.writingLastPlain')}</span>
        )}
        <span className={s.keys}>
          {listening ? (
            <>
              <Kbd>↩</Kbd> {prefs.voiceSend ? t('chat.dictation.keySend') : t('chat.dictation.keyWriteIn')} ·{' '}
              {prefs.voiceSend ? null : (
                <>
                  <Kbd>{chordLabel('Cmd+Enter')}</Kbd> {t('chat.dictation.keySend')} ·{' '}
                </>
              )}
              <Kbd>esc</Kbd>
            </>
          ) : send ? null : (
            <>
              <Kbd>{chordLabel('Cmd+Enter')}</Kbd> {t('chat.dictation.sendItToo')}
            </>
          )}
        </span>
        {listening ? (
          <button type="button" className={s.done} onMouseDown={(e) => e.preventDefault()} onClick={() => void finishDictation()}>
            {t('common.done')}
          </button>
        ) : null}
      </div>
      <Transcript phrases={d.phrases} listening={listening} />
    </div>
  );
}
