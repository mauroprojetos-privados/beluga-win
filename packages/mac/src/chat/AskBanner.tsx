import { activityOf, findWorkspace } from '@beluga/ui/workspace-models.js';
import { Icon } from '../components/Icon.js';
import { Button, Dot, Tip } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import { useT } from '../lib/i18n.js';
import s from './ask.module.css';

/** "Continue in New Worktree…": the way out of a questions-only chat (opens its sheet). */
export function ContinueButton({ wsId, className, variant = 'primary' }: { wsId: string; className?: string; variant?: 'primary' | 'plain' }) {
  const t = useT();
  return (
    <Tip label={t('chat.ask.continueHint')}>
      <Button variant={variant} icon="branch" className={className} onClick={() => openSheet({ kind: 'continue_worktree', wsId })}>
        {t('chat.ask.continue')}
      </Button>
    </Tip>
  );
}

/**
 * Above the message box of a chat in a project's main folder: it's for questions, and the
 * button moves the conversation somewhere Claude can work. (Asking Claude for a change there
 * moves it too.)
 */
export function AskBanner({ wsId }: { wsId: string }) {
  const sync = useApp((st) => findWorkspace(st.projects, wsId)?.purpose === 'sync_main');
  const running = useApp((st) => activityOf(st.log, `ws:${wsId}`).running);
  const t = useT();
  if (sync) return <SyncBanner running={running} />;
  return (
    <div className={s.wrap}>
      <div className={s.banner} role="note" aria-label={t('chat.ask.questionsOnly')}>
        <Icon name="eye" size={13} className={s.icon} />
        <span className={s.text}>
          <span className={s.lead}>{t('chat.ask.questionsOnly')}</span>
          {t('chat.ask.questionsOnlyRest')}
        </span>
        <ContinueButton wsId={wsId} variant="plain" className={s.button} />
      </div>
    </div>
  );
}

/**
 * A conversation where Claude brings main up to date ("Let Claude handle it" on the project
 * home): that one run may sync git in the main folder; afterwards it's questions only again.
 */
function SyncBanner({ running }: { running: boolean }) {
  const t = useT();
  return (
    <div className={s.wrap}>
      <div className={s.banner} role="note" aria-label={running ? t('chat.ask.syncing') : t('chat.ask.updatingMain')}>
        {running ? <Dot tone="claude" live /> : <Icon name="download" size={13} className={s.icon} />}
        <span className={s.text}>
          {running ? (
            <>
              <span className={s.lead}>{t('chat.ask.syncing')}</span>
              {t('chat.ask.syncingRest')}
            </>
          ) : (
            <>
              <span className={s.lead}>{t('chat.ask.updatingMain')}</span>
              {t('chat.ask.syncOverRest')}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
