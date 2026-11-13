import type { RunState, StepKind, TriggerKind } from '@beluga/core/sentinel/model.js';
import { RUN_STATE_INFO, STEP_INFO, isLive, scheduleSentence } from '@beluga/core/sentinel/model.js';
import { Icon, type IconName } from '../components/Icon.js';
import { Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp } from '../lib/beluga.js';
import { useMyAgent } from '../lib/agent-words.js';
import { agentMark } from '@beluga/shared/agent-marks.js';
import { TonePill } from '../plans/marks.js';
import { STEP_ICON, TRIGGER_ICON, iconOf } from './sentinel-model.js';
import r from '../tasks/task-ref.module.css';
import s from './sentinel.module.css';
import { useT } from '../lib/i18n.js';

/** Sentinel's small marks: an icon in a tinted circle, the steps as chips, a run's state as a pill, and the inline pill. */

/** An icon in a soft circle, tinted by what it is (`data-tone`): a trigger, a sentinel, a recipe. */
export function Disc({ icon, tone = 'neutral', size = 30, label }: { icon: IconName; tone?: 'neutral' | 'clock' | 'hand' | 'event' | 'paused' | 'claude'; size?: number; label?: string }) {
  return (
    <span className={s.disc} data-tone={tone} style={{ width: size, height: size }} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** A trigger's mark: a clock for schedules, a hand for by hand, the service's mark for events. */
export function TriggerDisc({ kind, paused, size }: { kind: TriggerKind; paused?: boolean; size?: number }) {
  const tone = paused ? 'paused' : kind === 'schedule' ? 'clock' : kind === 'manual' ? 'hand' : 'event';
  return <Disc icon={paused ? 'pause' : TRIGGER_ICON[kind]} tone={tone} {...(size ? { size } : {})} />;
}

/** The steps, in order, as small icon chips (each named in its tooltip). */
export function StepChips({ steps }: { steps: ReadonlyArray<{ readonly kind: StepKind; readonly name: string }> }) {
  const t = useT();
  if (!steps.length) return <span className={s.noSteps}>{t('sentinel.model.noSteps')}</span>;
  return (
    <span className={s.chips} role="list" aria-label={t('sentinel.cards.steps')}>
      {steps.map((st, i) => (
        <Tip key={`${st.kind}:${i}`} label={`${i + 1}. ${st.name} · ${STEP_INFO[st.kind].label}`}>
          <span className={s.chip} role="listitem" aria-label={st.name} data-kind={st.kind}>
            <Icon name={STEP_ICON[st.kind]} size={11} />
          </span>
        </Tip>
      ))}
    </span>
  );
}

/** Your agent's mark (Claude Code, Codex, a local model) as the steps show it (a round copper chip): the page's ask box and its banner. */
export function ClaudeMark() {
  const agent = useMyAgent();
  return (
    <span className={s.chip} data-kind="claude" aria-hidden="true">
      <Icon name={agentMark(agent)} size={11} />
    </span>
  );
}

/** A run's state as a pill (Running breathes with the live clock). */
export function RunPill({ state }: { state: RunState }) {
  const info = RUN_STATE_INFO[state];
  return (
    <TonePill tone={info.tone} live={isLive(state) && state !== 'needs-you'}>
      {info.label}
    </TonePill>
  );
}

/** A sentinel Claude linked in an answer (`sentinel:<id>`): its name and sentence; a click opens its page. */
export function SentinelChip({ id }: { id: string }) {
  const t = useT();
  const item = useApp((st) => st.sentinel.items.find((x) => x.id === id));
  const actions = useActions();
  if (!item) {
    return (
      <Tip label={t('sentinel.marks.missing', { id })}>
        <span className={r.missing}>
          <span className={r.key}>{id}</span>
          <span>{t('sentinel.marks.notFound')}</span>
        </span>
      </Tip>
    );
  }
  const when = scheduleSentence(item.trigger);
  return (
    <Tip label={item.paused ? t('sentinel.marks.chipTipPaused', { when }) : t('sentinel.marks.chipTip', { when })}>
      <button type="button" className={r.chip} onClick={() => actions.run({ type: 'view', view: { kind: 'sentinel_page', id } })} aria-label={item.paused ? t('sentinel.marks.chipAriaPaused', { name: item.name }) : t('sentinel.marks.chipAria', { name: item.name })}>
        <Icon name={iconOf(item.icon)} size={12} />
        {/* i18n-ignore: the product's name */}
        <span className={r.key}>Sentinel</span>
        <span className={cx(r.chipTitle)}>{item.name}</span>
        <Icon name="arrowRight" size={10} className={r.chipGo} />
      </button>
    </Tip>
  );
}
