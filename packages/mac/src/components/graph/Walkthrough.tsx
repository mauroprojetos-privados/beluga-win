import type { GraphStep } from '@beluga/shared/graph-spec.js';
import { IconButton } from '../ui.js';
import { useT } from '../../lib/i18n.js';
import g from './graph.module.css';

/** The walkthrough's caption: which step, what it shows, and Back / Next (← →, Esc to leave). */
export function Walkthrough({ steps, index, onGo }: { steps: readonly GraphStep[]; index: number; onGo: (i: number) => void }) {
  const t = useT();
  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;
  return (
    <div className={g.walk} role="region" aria-label={t('components.graph.walkthrough')} aria-live="polite">
      <div className={g.walkDots} aria-hidden="true">
        {steps.map((s, i) => (
          <button key={`${i}:${s.title}`} type="button" tabIndex={-1} className={g.walkDot} data-on={i === index ? 'true' : i < index ? 'past' : 'false'} onClick={() => onGo(i)} />
        ))}
      </div>
      <div className={g.walkMain}>
        <div className={g.walkText}>
          <span className={g.walkCount}>
            {t('components.graph.stepOf', { n: index + 1, total: steps.length })}
          </span>
          <span className={g.walkTitle}>{step.title}</span>
          {step.text ? <span className={g.walkBody}>{step.text}</span> : null}
        </div>
        <div className={g.walkNav}>
          <IconButton icon="back" label={t('components.graph.previousStep')} keys="←" disabled={index === 0} onClick={() => onGo(index - 1)} />
          {last ? (
            <button type="button" className={g.walkDone} onClick={() => onGo(-1)}>
              {t('common.done')}
            </button>
          ) : (
            <button type="button" className={g.walkNext} onClick={() => onGo(index + 1)}>
              {t('components.graph.next')}
            </button>
          )}
          <IconButton icon="x" label={t('components.graph.leaveWalkthrough')} keys="esc" onClick={() => onGo(-1)} />
        </div>
      </div>
    </div>
  );
}
