import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { Button, cx } from '../components/ui.js';
import s from './showcase.module.css';
import { yourComputer } from '../lib/os-words.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';

/**
 * What Sentinel can do, shown before it's explained (BLG-334): a few short scenes that play like a
 * film, with made-up data. The night shift: your site goes down at 3 a.m., Claude finds why, opens
 * a task and a pull request, and it's morning. The board: your numbers on a board and on your
 * Mac's desktop as widgets. Failing tests that Claude fixes, and a pull request Claude has read.
 * One line each, and Set This Up hands its words to Ask Sentinel. It moves on when a scene has
 * played, holds while you point at it, and goes by the dots or the arrow keys; with reduced motion
 * each scene shows its last frame and stays where you put it.
 */

type IconName = Parameters<typeof Icon>[0]['name'];

export interface Slide {
  readonly id: string;
  readonly icon: IconName;
  /** One line: what you get, never how. */
  readonly line: string;
  /** What Set This Up asks Ask Sentinel. */
  readonly prompt: string;
  /** How long it plays before the next. */
  readonly ms: number;
  readonly scene: () => React.ReactNode;
}

/** A number counting up to its value as the scene starts. */
function Count({ to, prefix = '', decimals = 0, delay = 0 }: { to: number; prefix?: string; decimals?: number; delay?: number }) {
  const [n, setN] = useState(() => (still() ? to : 0));
  useEffect(() => {
    if (still()) return;
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number): void => {
      const k = Math.min(1, Math.max(0, (now - start) / 1100));
      setN(to * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay]);
  return (
    <>
      {prefix}
      {n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </>
  );
}

/** A line that draws itself, left to right. */
function Spark({ points, delay = 0 }: { points: readonly number[]; delay?: number }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * 100},${28 - ((p - min) / (max - min || 1)) * 24}`).join(' ');
  return (
    <svg className={s.spark} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" style={{ animationDelay: `${delay}ms` }}>
      <path d={`${d} L100,30 L0,30 Z`} className={s.sparkFill} />
      <path d={d} className={s.sparkLine} />
    </svg>
  );
}

/** Code as soft bars (what it says doesn't matter; that a line is the one that does). */
function Code({ widths, mark, from = 0 }: { widths: readonly number[]; mark?: number; from?: number }) {
  return (
    <div className={s.code} aria-hidden="true">
      {widths.map((w, i) => (
        <div key={i} className={s.codeLine} data-mark={i === mark || undefined}>
          <span className={s.codeNum}>{from + i}</span>
          <i style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

const ms = (n: number): React.CSSProperties => ({ animationDelay: `${n}ms` });

export const SLIDES: readonly Slide[] = [
  {
    id: 'sleep',
    icon: 'pulse',
    get line() {
      return t('sentinel.showcase.sleep');
    },
    get prompt() {
      return t('sentinel.showcase.sleepPrompt');
    },
    ms: 8200,
    scene: () => (
      <div className={s.night}>
        <span className={s.dawn} />
        <span className={s.stars} />
        <span className={s.moon} />
        <span className={s.sun} />
        <div className={s.clock}>
          <span className={s.clockNight}>3:12</span>
          <span className={s.clockDay}>7:00</span>
        </div>
        <div className={s.browser}>
          <div className={s.browserBar}>
            <i />
            <i />
            <i />
            <span>example.com</span>
          </div>
          <div className={s.browserBody}>
            <div className={s.siteDown}>
              <Icon name="alert" size={16} />
              {t('sentinel.showcase.unreachable')}
            </div>
            <div className={s.siteUp}>
              <Icon name="check" size={16} />
              {t('sentinel.showcase.backUp')}
            </div>
          </div>
        </div>
        <div className={s.story}>
          <div className={s.agent} style={ms(900)}>
            <span className={s.agentMark}>
              <Icon name="claude" size={13} />
            </span>
            <span className={s.agentText}>
              <span className={s.typing}>
                <i />
                <i />
                <i />
              </span>
              <span className={s.agentSaid}>{t('sentinel.showcase.deployBroke')}</span>
            </span>
          </div>
          <div className={s.pop} style={ms(3300)}>
            <Icon name="task" size={13} />
            <strong>{t('sentinel.showcase.openedTask')}</strong>
            <span>{t('sentinel.showcase.rollBack')}</span>
          </div>
          <div className={cx(s.pop, s.popMint)} style={ms(4300)}>
            <Icon name="merge" size={13} />
            <strong>{t('sentinel.showcase.readyMerge')}</strong>
            <span>#63</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'board',
    icon: 'gauge',
    get line() {
      return t('sentinel.showcase.board', { computer: yourComputer() });
    },
    get prompt() {
      return t('sentinel.showcase.boardPrompt');
    },
    ms: 7000,
    scene: () => (
      <div className={s.desktop}>
        <div className={s.menubar}>
          <Icon name="sentinel" size={10} />
          <span className={s.grow} />
          {/* i18n-ignore: a made-up clock in the picture */}
          Tue 7:00
        </div>
        <div className={s.window}>
          <div className={s.windowBar}>
            <i />
            <i />
            <i />
            <span>{t('sentinel.dash.atAGlance')}</span>
          </div>
          <div className={s.tiles}>
            <div className={s.tile} style={ms(200)}>
              <span className={s.tileLabel}>{t('sentinel.showcase.revenue')}</span>
              <strong>
                <Count to={3412} prefix="$" delay={300} />
              </strong>
              <span className={s.up}>↑ 7.3%</span>
              <Spark points={[2.6, 2.9, 2.7, 3.0, 3.1, 2.9, 3.2, 3.4]} delay={400} />
            </div>
            <div className={s.tile} style={ms(350)}>
              <span className={s.tileLabel}>{t('sentinel.showcase.signUps')}</span>
              <strong>
                <Count to={35} delay={450} />
              </strong>
              <span className={s.up}>↑ 21%</span>
              <div className={s.bars}>
                {[18, 22, 19, 25, 31, 24, 29, 35].map((v, i) => (
                  <i key={i} style={{ height: `${(v / 35) * 100}%`, ...ms(600 + i * 60) }} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className={s.widgets}>
          <div className={s.widget} style={ms(1500)} data-testid="showcase-widget">
            <span className={s.widgetHead}>
              <Icon name="sentinel" size={10} />
              {/* i18n-ignore: the product's name */}
              Beluga
            </span>
            <span className={s.tileLabel}>{t('sentinel.showcase.revenue')}</span>
            <strong>
              <Count to={3412} prefix="$" delay={1700} />
            </strong>
            <Spark points={[2.6, 2.9, 2.7, 3.0, 3.1, 2.9, 3.2, 3.4]} delay={1900} />
          </div>
          <div className={cx(s.widget, s.widgetSmall)} style={ms(2100)}>
            <span className={s.widgetHead}>
              <Icon name="pulse" size={10} />
              {t('sentinel.showcase.siteSpeed')}
            </span>
            <strong>
              <Count to={372} delay={2300} />
              <small>ms</small>
            </strong>
            {/* i18n-ignore: a made-up number with its unit */}
            <span className={s.up}>↓ 30 ms</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'fix',
    icon: 'wrench',
    get line() {
      return t('sentinel.showcase.fix');
    },
    get prompt() {
      return t('sentinel.showcase.fixPrompt');
    },
    ms: 7000,
    scene: () => (
      <div className={s.fix}>
        <div className={s.checks}>
          <div className={s.checksHead}>{t('sentinel.showcase.checks')}</div>
          <div className={s.check}>
            <Icon name="check" size={12} />
            build
          </div>
          <div className={s.check}>
            <Icon name="check" size={12} />
            lint
          </div>
          <div className={cx(s.check, s.checkFlip)}>
            <span className={s.checkBad}>
              <Icon name="x" size={12} />
            </span>
            <span className={s.checkGood}>
              <Icon name="check" size={12} />
            </span>
            {t('sentinel.showcase.checkoutTests')}
          </div>
        </div>
        <div className={s.diff}>
          <div className={s.diffHead}>
            <Icon name="claude" size={12} />
            {t('sentinel.showcase.agentFile')}
          </div>
          <div className={s.diffLine} data-kind="del" style={ms(1600)}>
            {/* i18n-ignore: code */}
            <b>−</b> timeout: 2000
          </div>
          <div className={s.diffLine} data-kind="add" style={ms(2300)}>
            {/* i18n-ignore: code */}
            <b>+</b> timeout: 10000
          </div>
          <div className={cx(s.pop, s.popMint, s.diffPop)} style={ms(4200)}>
            <Icon name="merge" size={13} />
            <strong>{t('sentinel.showcase.readyMerge')}</strong>
            <span>#52</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'review',
    icon: 'review',
    get line() {
      return t('sentinel.showcase.review');
    },
    get prompt() {
      return t('sentinel.showcase.reviewPrompt');
    },
    ms: 6000,
    scene: () => (
      <div className={s.review}>
        <div className={s.pr}>
          <div className={s.prHead}>
            <Icon name="pr" size={13} />
            <strong>{t('sentinel.showcase.prTitle')}</strong>
            <span>#61</span>
          </div>
          <Code widths={[62, 48, 74, 36, 58, 44]} mark={3} from={45} />
        </div>
        <div className={s.comment} style={ms(1800)}>
          <span className={s.commentWho}>
            <Icon name="claude" size={12} />
            {t('sentinel.showcase.agentLine')}
          </span>
          {t('sentinel.showcase.comment')}
        </div>
      </div>
    ),
  },
];

const still = (): boolean => document.documentElement.dataset.motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Showcase({ onPick }: { onPick: (slide: Slide) => void }) {
  const t = useT();
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const go = (i: number): void => setAt((i + SLIDES.length) % SLIDES.length);
  const slide = SLIDES[at]!;
  useEffect(() => {
    if (held || still()) return;
    const timer = setTimeout(() => go(at + 1), slide.ms);
    return () => clearTimeout(timer);
  }, [at, held]);
  return (
    <div
      ref={root}
      className={s.show}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('sentinel.showcase.what')}
      tabIndex={0}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !root.current?.contains(e.relatedTarget as Node | null) && setHeld(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(at + 1);
        else if (e.key === 'ArrowLeft') go(at - 1);
        else return;
        e.preventDefault();
      }}
    >
      <div className={s.screen} data-slide={slide.id}>
        {/* Keyed: each scene plays from its start when it comes in. */}
        <div key={slide.id} className={s.scene} role="group" aria-roledescription="slide" aria-label={t('sentinel.showcase.slideAria', { n: at + 1, total: SLIDES.length, line: slide.line })}>
          {slide.scene()}
        </div>
      </div>
      <div className={s.foot}>
        <span key={slide.id} className={s.line}>
          <Icon name={slide.icon} size={14} />
          {slide.line}
        </span>
        <Button size="small" variant="primary" onClick={() => onPick(slide)}>
          {t('sentinel.showcase.setUp')}
        </Button>
      </div>
      <div className={s.dots} role="tablist" aria-label={t('sentinel.showcase.scenes')}>
        {SLIDES.map((x, i) => (
          <button key={x.id} type="button" role="tab" aria-selected={i === at} aria-label={x.line} className={cx(s.dot, i === at && s.dotOn)} data-held={held || undefined} onClick={() => go(i)}>
            <span key={i === at ? `${x.id}-on` : x.id} style={i === at ? { animationDuration: `${x.ms}ms` } : undefined} />
          </button>
        ))}
      </div>
    </div>
  );
}
