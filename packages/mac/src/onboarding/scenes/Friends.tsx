import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';
import { SPRING } from '../fx.js';
import { useBeats } from './use-beats.js';
import s from './scenes.module.css';
import { upFirst, yourComputer } from '../../lib/os-words.js';

/**
 * Claudes that work together: yours is in the middle of something and needs a hand from a
 * friend's Mac. It asks Ada's Claude, Ada allows it, her Claude does the errand on her Mac (the
 * steps show as it goes), the result comes back over the encrypted line, and yours carries on
 * with it. Three errands take turns: a report from a file only Ada has, an admin role only
 * Ada can grant, a screenshot only Ada's session can take.
 */

interface Errand {
  /** What your Claude is doing when it needs help, and after. */
  readonly before: string;
  readonly after: string;
  /** What it asks Ada's Claude. */
  readonly ask: string;
  /** What Ada's Claude does on her Mac. */
  readonly steps: ReadonlyArray<{ icon: IconName; text: string; code?: string }>;
  /** What comes back. */
  readonly result: { icon: IconName; label: string; detail: string };
}

const ERRANDS = (): readonly Errand[] => [
  {
    before: t('components.onboarding.scene.friends.q3Before'),
    ask: t('components.onboarding.scene.friends.q3Ask'),
    steps: [
      { icon: 'search', text: t('components.onboarding.scene.friends.searched'), code: '~/Desktop' },
      { icon: 'file', text: t('components.onboarding.scene.friends.found'), code: 'Balance-Sheet-Q3.xlsx' },
      { icon: 'pencil', text: t('components.onboarding.scene.friends.summarised') },
    ],
    result: { icon: 'file', label: 'q3-summary.md', detail: t('components.onboarding.scene.friends.q3Result') },
    after: t('components.onboarding.scene.friends.q3After'),
  },
  {
    before: t('components.onboarding.scene.friends.ciBefore'),
    ask: t('components.onboarding.scene.friends.ciAsk'),
    steps: [
      { icon: 'person', text: t('components.onboarding.scene.friends.owner'), code: 'acme' },
      { icon: 'terminal', text: t('components.onboarding.scene.friends.ran'), code: 'gh api …/memberships' },
      { icon: 'check', text: t('components.onboarding.scene.friends.roleChanged') },
    ],
    result: { icon: 'check', label: t('components.onboarding.scene.friends.ciResult'), detail: t('components.onboarding.scene.friends.ciGranted') },
    after: t('components.onboarding.scene.friends.ciAfter'),
  },
  {
    before: t('components.onboarding.scene.friends.chartBefore'),
    ask: t('components.onboarding.scene.friends.chartAsk'),
    steps: [
      { icon: 'globe', text: t('components.onboarding.scene.friends.opened'), code: 'staging.acme.dev' },
      { icon: 'eye', text: t('components.onboarding.scene.friends.waitedCharts') },
      { icon: 'image', text: t('components.onboarding.scene.friends.tookShot') },
    ],
    result: { icon: 'image', label: 'staging-dashboard.png', detail: '1440 × 900' },
    after: t('components.onboarding.scene.friends.chartAfter'),
  },
];

// Beats: yours at work · the ask travels · it waits for Ada · allowed · her Claude's three steps ·
// the result travels back · yours carries on.
const BEATS = [1300, 1000, 1500, 500, 750, 750, 900, 1000, 2400] as const;
const ASKING = 1;
const WAITING = 2;
const ALLOWED = 3;
const WORKING = 4;
const RETURNING = 7;
const DONE = 8;

function Window({ who, hue, you, children }: { readonly who: string; readonly hue: number; readonly you?: boolean; readonly children: ReactNode }) {
  const t = useT();
  return (
    <div className={s.mac}>
      <div className={s.macHead}>
        <span className={s.macAvatar} style={{ background: `oklch(0.7 0.11 ${hue})` }}>
          {who[0]}
        </span>
        <div>
          <strong>{you ? upFirst(yourComputer()) : t('components.onboarding.scene.friends.theirComputer', { who })}</strong>
          <span className={s.macClaude}>
            <Icon name="claude" size={10} /> {you ? t('components.onboarding.scene.friends.yourAgent') : t('components.onboarding.scene.friends.theirAgent', { who })}
          </span>
        </div>
      </div>
      <div className={s.macBody}>{children}</div>
    </div>
  );
}

const Line = ({ icon, text, code, live }: { readonly icon: IconName; readonly text: string; readonly code?: string; readonly live?: boolean }) => (
  <motion.div className={s.step} initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} transition={SPRING}>
    <Icon name={live ? 'refresh' : icon} size={12} className={live ? s.spin : s.done} />
    <span>{text}</span>
    {code ? <code>{code}</code> : null}
  </motion.div>
);

export function Friends() {
  const t = useT();
  const [round, setRound] = useState(0);
  const beat = useBeats(BEATS, DONE, () => setRound((r) => r + 1));
  const errands = ERRANDS();
  const errand = errands[round % errands.length]!;
  const shown = beat >= WORKING ? Math.min(errand.steps.length, beat - WORKING + 1) : 0;
  return (
    <div className={s.stage}>
      <div className={s.friends}>
        <Window who={t('components.onboarding.scene.friends.you')} hue={40} you>
          <AnimatePresence mode="popLayout">
            <motion.div key={`${round}-${beat >= DONE}`} className={s.task} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={SPRING}>
              <Icon name={beat >= ASKING && beat < DONE ? 'clock' : 'refresh'} size={12} className={beat >= ASKING && beat < DONE ? s.waitIcon : s.spin} />
              {beat >= DONE ? errand.after : beat >= ASKING ? t('components.onboarding.scene.friends.waiting') : errand.before}
            </motion.div>
          </AnimatePresence>
          <AnimatePresence>
            {beat >= ASKING ? (
              <motion.div key={`ask-${round}`} className={s.errandAsk} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING}>
                <span className={s.askTag}>
                  <Icon name="share" size={10} /> {t('components.onboarding.scene.friends.toAda')}
                </span>
                {errand.ask}
              </motion.div>
            ) : null}
            {beat >= DONE ? (
              <motion.div key={`got-${round}`} className={s.result} initial={{ opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={SPRING}>
                <span className={s.resultIcon}>
                  <Icon name={errand.result.icon} size={13} />
                </span>
                <div>
                  <strong>{errand.result.label}</strong>
                  <span className={s.dim}>{errand.result.detail}</span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Window>

        <div className={s.wire}>
          <svg className={s.wireSvg} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="beam" x1="0" x2="1">
                <stop offset="0" stopColor="var(--claude)" stopOpacity="0" />
                <stop offset="0.5" stopColor="var(--claude)" stopOpacity="1" />
                <stop offset="1" stopColor="var(--claude)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 20 C 35 4, 65 36, 100 20" className={s.wireBase} />
            {beat === ASKING || beat === RETURNING ? (
              <motion.path
                key={`${round}-${beat}`}
                d={beat === ASKING ? 'M0 20 C 35 4, 65 36, 100 20' : 'M100 20 C 65 36, 35 4, 0 20'}
                stroke="url(#beam)"
                strokeWidth="2.5"
                fill="none"
                initial={{ pathLength: 0.3, pathOffset: 0 }}
                animate={{ pathOffset: 1 }}
                transition={{ duration: 0.9, ease: [0.45, 0, 0.2, 1] }}
              />
            ) : null}
          </svg>
          <AnimatePresence>
            {beat === ASKING || beat === RETURNING ? (
              <motion.span
                key={`p-${round}-${beat}`}
                className={s.packet}
                data-tone={beat === RETURNING ? 'ok' : undefined}
                initial={{ left: beat === ASKING ? '0%' : '100%', opacity: 0 }}
                animate={{ left: beat === ASKING ? '100%' : '0%', opacity: [0, 1, 1, 0] }}
                transition={{ duration: 0.9, ease: [0.45, 0, 0.2, 1] }}
              >
                <Icon name={beat === ASKING ? 'claude' : errand.result.icon} size={11} />
              </motion.span>
            ) : null}
          </AnimatePresence>
          <span className={s.lock}>
            <Icon name="lock" size={10} /> {t('components.onboarding.scene.friends.encrypted')}
          </span>
        </div>

        <Window who="Ada" hue={300}>{/* i18n-ignore */}
          <AnimatePresence mode="popLayout">
            {beat === WAITING || beat === ALLOWED ? (
              <motion.div key={`req-${round}`} className={s.request} initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={SPRING}>
                <span className={s.dim}>{t('components.onboarding.scene.friends.friendAsks')}</span>
                <span className={s.requestText}>{errand.ask}</span>
                <div className={s.requestButtons}>
                  <span className={s.btn}>{t('components.onboarding.scene.friends.decline')}</span>
                  <motion.span className={s.btnPrimary} animate={beat === ALLOWED ? { scale: [1, 0.9, 1] } : {}} transition={{ duration: 0.3 }}>
                    {beat === ALLOWED ? <Icon name="check" size={11} /> : null} {t('common.allow')}
                  </motion.span>
                </div>
              </motion.div>
            ) : beat >= WORKING ? (
              <motion.div key={`work-${round}`} className={s.steps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {errand.steps.slice(0, shown).map((st, i) => (
                  <Line key={st.text} {...st} live={i === shown - 1 && beat < RETURNING} />
                ))}
              </motion.div>
            ) : (
              <motion.div key="idle" className={s.idle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Icon name="claude" size={12} /> {t('components.onboarding.scene.friends.readyToHelp')}
              </motion.div>
            )}
          </AnimatePresence>
        </Window>
      </div>
    </div>
  );
}
