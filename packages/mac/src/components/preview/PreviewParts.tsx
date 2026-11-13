import type { PreviewProblem } from '@beluga/shared/preview/opened.js';
import { openExternal } from '../../lib/system.js';
import { Icon } from '../Icon.js';
import { Button, IconButton, cx } from '../ui.js';
import { useT } from '../../lib/i18n.js';
import { type FiredEvent, floatsOverFrame } from './preview-model.js';
import type { AuditIssue } from './use-preview.js';
import s from './preview.module.css';

/** The pieces of a live preview around its frame (PreviewBlock.tsx): why it isn't drawing, what fired, what the check found. */

/** Why it isn't drawing, in plain words, with the one thing to do about it. */
export function ProblemCard({ problem, touched, onReset, onAsk, onRetry, onTurnOn, url }: { problem: PreviewProblem; touched: boolean; onReset: () => void; onAsk: () => void; onRetry: () => void; onTurnOn: () => void; url: string | undefined }) {
  const t = useT();
  const action =
    problem.kind === 'off'
      ? { label: t('components.preview.turnOn'), run: onTurnOn }
      : problem.kind === 'not-running'
        ? { label: t('common.retry'), run: onRetry }
        : (problem.kind === 'no-frames' || problem.kind === 'elsewhere') && url
          ? { label: t('components.preview.openInBrowser'), run: () => void openExternal(url) }
          : problem.kind === 'render' && touched
            ? { label: t('components.preview.resetProps'), run: onReset }
            : problem.kind === 'provider'
              ? { label: t('components.preview.askSetUp'), run: onAsk }
              : { label: t('components.preview.askFix'), run: onAsk };
  return (
    <div className={cx(s.problem, floatsOverFrame(problem) && s.problemOver)} role="status">
      <Icon name="info" size={14} className={s.problemIcon} />
      <div className={s.problemText}>
        <strong>{problem.title}</strong>
        <span>{problem.detail}</span>
      </div>
      <Button size="small" onClick={action.run}>
        {action.label}
      </Button>
    </div>
  );
}

/** What the callbacks (and links, a router) did, newest first. */
export function EventsStrip({ events }: { events: readonly FiredEvent[] }) {
  if (!events.length) return null;
  return (
    <div className={s.events} aria-live="polite">
      {events.map((e) => (
        <span key={e.id} className={s.event}>
          <Icon name="bolt" size={10} />
          <code>{e.name}</code>
          {e.detail ? <span className={s.eventDetail}>{e.detail}</span> : null}
        </span>
      ))}
    </div>
  );
}

/** What the accessibility check found, in plain words; each shows its element in the drawing. */
export function AuditPanel({ issues, onShow, onAgain, onClose }: { issues: readonly AuditIssue[]; onShow: (id: string) => void; onAgain: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <div className={s.audit}>
      <div className={s.panelHead}>
        <span className={s.panelTitle}>{t('components.preview.accessibility')}</span>
        <span className={s.panelHint}>{issues.length ? t('components.preview.auditFound', { count: issues.length }) : t('components.preview.auditClean')}</span>
        <span className={s.grow} />
        <Button size="small" variant="quiet" onClick={onAgain}>
          {t('components.preview.checkAgain')}
        </Button>
        <IconButton icon="x" label={t('common.close')} onClick={onClose} />
      </div>
      {issues.length ? (
        <ul className={s.issues}>
          {issues.map((i) => (
            <li key={i.id}>
              <button type="button" className={s.issue} onClick={() => onShow(i.id)}>
                <strong>{i.title}</strong>
                <span>{i.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
