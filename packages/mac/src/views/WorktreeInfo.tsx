import { baseName } from '@beluga/shared/os-path.js';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { AgentOrigin } from '@beluga/core/claude-code/model.js';
import type { WorktreeInfo } from '@beluga/core/other-worktrees.js';
import { formatBytes } from '@beluga/shared/format.js';
import { type WorktreeSource, sourceFromPath } from '@beluga/workspaces/origin.js';
import type { Workspace } from '@beluga/workspaces/types.js';
import { Alert } from '../components/Alert.js';
import { Icon, type IconName } from '../components/Icon.js';
import { Button, Tip } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga, useMachine } from '../lib/beluga.js';
import { showWorktreeFolder } from '../lib/remote-open.js';
import { revealThereLabel } from '@beluga/machines/open.js';
import { setWorktreeFlag, useWorktreeInfo } from './worktree-info-state.js';
import s from './worktree-info.module.css';
import { LivePanel } from '../claude-code/Live.js';
import { openFolderLabel } from '../lib/os-words.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';

/**
 * What a worktree made outside Beluga is (another app's, Claude Code's, a script's): where it
 * is, its branch and state, the Claude Code conversations that ran in it, and what you can do
 * with it. Shown instead of an empty chat, and from "About This Worktree" over one with a
 * conversation. Another app is never named: the worktree's name and location say enough.
 */

/** Claude's mark for one Claude made; a branch for the rest. */
const iconOf = (source: WorktreeSource): IconName => (source === 'claude' ? 'claude' : 'branch');
const MADE_OUTSIDE = (): string => t('views.wtInfo.madeOutside');
const MADE_OUTSIDE_DETAIL = (): string => t('views.wtInfo.madeOutsideDetail');

const day = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return t('views.wtInfo.today');
  if (d === 1) return t('views.wtInfo.yesterday');
  if (d < 45) return t('views.wtInfo.daysAgo', { count: d });
  const m = Math.round(d / 30);
  return m < 18 ? t('views.wtInfo.monthsAgo', { count: m }) : t('views.wtInfo.yearsAgo', { count: Math.round(d / 365) });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.field}>
      <dt>{label}</dt>
      <dd className="selectable">{children}</dd>
    </div>
  );
}

/**
 * Asks before removing a worktree made outside Beluga; with uncommitted changes the button says what's lost.
 * Confirming closes it at once: the removal carries on in the background and says how it went in a toast.
 */
export function RemoveWorktreeAlert({ ws, info, onDone, onCancel }: { ws: Workspace; info?: WorktreeInfo; onDone: (removed: boolean) => void; onCancel: () => void }) {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const changed = info?.changed ?? ws.status?.changed ?? 0;
  const branch = info?.branch ?? ws.branch;
  // Another app made it and may still use it.
  const anotherApp = (info?.origin.source ?? sourceFromPath(ws.path)) === 'conductor';
  const go = (): void => {
    void api.workspaces.removeOther(ws.id, changed > 0).catch((err: unknown) => toast(client, t('views.wtInfo.removeFailed', { name: ws.name, error: err instanceof Error ? err.message : String(err) }), 'error'));
    onDone(true);
  };
  return (
    <Alert
      icon="archive"
      tone={changed > 0 ? 'danger' : 'caution'}
      title={t('views.wtInfo.removeTitle', { name: ws.name })}
      message={
        <>
          <p>
            {t('views.wtInfo.removeDeletes')}{' '}
            {branch ? (
              <>
                {t('views.wtInfo.branchStaysBefore')} <strong>{branch}</strong> {t('views.wtInfo.branchStaysAfter')}
              </>
            ) : (
              t('views.wtInfo.noBranch')
            )}
          </p>
          {changed > 0 ? (
            <p>
              <strong>{t('views.wtInfo.hasChanges', { count: changed })}</strong> {t('views.wtInfo.theyllBeLost')}
            </p>
          ) : null}
          {anotherApp ? <p>{t('views.wtInfo.anotherApp')}</p> : null}
        </>
      }
      confirm={{ label: changed > 0 ? t('views.wtInfo.removeAnyway') : t('views.wtInfo.remove'), destructive: true, onClick: go }}
      onCancel={onCancel}
    />
  );
}

function Conversations({ ws, info }: { ws: Workspace; info: WorktreeInfo }) {
  const t = useT();
  const api = useApi();
  const talked = useApp((st) => st.log.some((l) => l.channel === `ws:${ws.id}` && !/^(t-\d+|import-)/.test(l.id)));
  if (!info.conversations.length) {
    return (
      <p className={s.quiet}>
        {t('views.wtInfo.noConversations')}
        {info.creator?.cwd ? t('views.wtInfo.creatorRanIn', { cwd: info.creator.cwd }) : ''}
      </p>
    );
  }
  return (
    <ul className={s.convos} aria-label={t('views.wtInfo.ccConversations')}>
      {info.conversations.map((c) => (
        <li key={c.sessionId} className={s.convo}>
          <Icon name="chat" size={14} className={s.convoIcon} />
          <span className={s.convoText}>
            <span className={s.convoTitle}>{c.title}</span>
            <span className={s.convoWhen}>{t('views.wtInfo.lastActive', { when: when(c.lastModified) })}</span>
          </span>
          <Button
            size="small"
            disabled={talked || Boolean(ws.sessionId)}
            onClick={() => {
              setWorktreeFlag('about', ws.id, false);
              void api.workspaces.showConversation(ws.id, c.sessionId);
            }}
          >
            {t('views.wtInfo.show')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Size on disk: measured on request (it walks every worktree's folder). */
function useSize(id: string): number | undefined {
  const api = useApi();
  const size = useApp((st) => st.disk[id]);
  const asked = useRef(false);
  useEffect(() => {
    if (size !== undefined || asked.current) return;
    asked.current = true;
    void api.workbench.measureDisk().catch(() => undefined);
  }, [api, size]);
  return size;
}

/**
 * `agent`: a sub-agent's own worktree whose agent Claude Code no longer has (no conversation to
 * start in it); `origin`, who started it, when Claude Code's files still say.
 */
export function WorktreeInfoPage({ ws, agent, origin }: { ws: Workspace; agent?: boolean; origin?: AgentOrigin }) {
  const t = useT();
  const actions = useActions();
  const api = useApi();
  const { client } = useBeluga();
  // On a computer's page, its folder's path is copied instead (BLG-794).
  const machine = useMachine();
  const statusKey = `${ws.status?.changed ?? '-'}:${ws.status?.ahead ?? '-'}:${ws.status?.behind ?? '-'}:${ws.branch ?? ''}`;
  const { info, loading, error } = useWorktreeInfo(ws.id, statusKey);
  const hasChat = useApp((st) => st.log.some((l) => l.channel === `ws:${ws.id}`));
  const size = useSize(ws.id);
  const [removing, setRemoving] = useState(false);
  const source = info?.origin.source ?? sourceFromPath(ws.path);
  const start = (): void => {
    setWorktreeFlag('started', ws.id, true);
    setWorktreeFlag('about', ws.id, false);
    setTimeout(() => document.dispatchEvent(new CustomEvent('beluga:focus-composer')), 30);
  };
  return (
    <div className={s.page} data-testid="worktree-info">
      <div className={s.inner}>
        <header className={s.head}>
          <span className={s.badge} aria-hidden="true">
            <Icon name={agent ? 'bot' : iconOf(source)} size={22} />
          </span>
          <div className={s.headText}>
            <h1 className={s.title}>{origin?.description ?? ws.name}</h1>
            <p className={s.origin}>{origin ? (origin.sessionCwd ? t('views.wtInfo.subAgentByIn', { session: origin.sessionTitle ?? t('views.wtInfo.aCcSession'), folder: baseName(origin.sessionCwd) }) : t('views.wtInfo.subAgentBy', { session: origin.sessionTitle ?? t('views.wtInfo.aCcSession') })) : (info?.origin.label ?? MADE_OUTSIDE())}</p>
          </div>
          {hasChat ? (
            <Button size="small" variant="quiet" icon="back" onClick={() => setWorktreeFlag('about', ws.id, false)}>
              {t('views.wtInfo.backToConversation')}
            </Button>
          ) : null}
        </header>
        <p className={s.lead}>{agent ? t('views.wtInfo.subAgentLead') : (info?.origin.detail ?? MADE_OUTSIDE_DETAIL())}</p>
        <LivePanel workspaceId={ws.id} />
        {info?.stale ? (
          <p className={s.stale}>
            <Icon name="check" size={13} /> {t('views.wtInfo.safeToRemove', { why: info.staleText?.toLowerCase() ?? '' })}
          </p>
        ) : null}
        {info?.missing ? (
          <p className={s.warn}>
            <Icon name="alert" size={13} /> {t('views.wtInfo.folderGone')}
          </p>
        ) : null}

        <div className={s.actions}>
          {!info?.missing && !agent ? (
            <Button variant="primary" icon="chat" onClick={start}>
              {t('views.wtInfo.startHere')}
            </Button>
          ) : null}
          {!info?.missing ? (
            <Button icon="folder" onClick={() => void showWorktreeFolder(client, ws.id)}>
              {machine ? revealThereLabel('folder') : openFolderLabel()}
            </Button>
          ) : null}
          {!info?.missing ? (
            <Button icon="terminal" onClick={() => actions.run({ type: 'open_ws', id: ws.id, tab: 'terminal' })}>
              {t('views.wtInfo.openInTerminal')}
            </Button>
          ) : null}
          <span className={s.flex} />
          <Button variant="danger" icon="archive" onClick={() => setRemoving(true)}>
            {t('views.wtInfo.removeWorktree')}
          </Button>
        </div>

        <section className={s.card} aria-label={t('views.wtInfo.aboutLabel')}>
          <dl className={s.fields}>
            <Field label={t('views.wtInfo.branch')}>{info ? (info.branch ?? t('views.wtInfo.detached')) : (ws.branch ?? '…')}</Field>
            <Field label={t('views.home.basedOn')}>{info?.base ?? ws.base ?? '…'}</Field>
            <Field label={t('views.wtInfo.made')}>{info?.createdAt ? t('views.wtInfo.madeWhen', { day: day(info.createdAt), ago: ago(info.createdAt) }) : loading ? '…' : t('views.wtInfo.unknown')}</Field>
            <Field label={t('views.wtInfo.lastCommit')}>
              {info?.lastCommit ? (
                <>
                  {ago(info.lastCommit.at)} · <span className={s.subject}>{info.lastCommit.subject}</span>
                </>
              ) : loading ? (
                '…'
              ) : (
                t('views.wtInfo.none')
              )}
            </Field>
            <Field label={t('views.wtInfo.comparedWithBase')}>{info ? `${t('views.wtInfo.aheadBehind', { count: info.ahead, behind: info.behind })}${info.merged ? t('views.wtInfo.allMerged') : ''}` : '…'}</Field>
            <Field label={t('views.wtInfo.uncommitted')}>{info ? (info.changed ? t('views.wtInfo.files', { count: info.changed }) : t('views.wtInfo.nothing')) : '…'}</Field>
            <Field label={t('views.wtInfo.sizeOnDisk')}>{size !== undefined ? formatBytes(size) : t('views.wtInfo.measuring')}</Field>
            {info?.conductor?.prTitle ? <Field label={t('views.wtInfo.pullRequest')}>{info.conductor.prTitle}</Field> : null}
            {info?.creator ? (
              <Field label={t('views.wtInfo.madeBy')}>
                {t('views.wtInfo.madeByCc', { title: info.creator.title ?? info.creator.sessionId.slice(0, 8) })}{info.creator.at ? t('views.wtInfo.madeByAt', { day: day(info.creator.at) }) : ''}
                {info.creator.cwd ? t('views.wtInfo.ranIn', { cwd: info.creator.cwd }) : ''}
              </Field>
            ) : null}
            <Field label={t('views.wtInfo.folder')}>
              <Tip label={t('views.wtInfo.copyPath')}>
                <button type="button" className={s.path} onClick={() => void navigator.clipboard?.writeText(ws.path).then(() => toast(client, t('views.wtInfo.copiedPath'), 'success'))}>
                  {ws.path}
                </button>
              </Tip>
            </Field>
          </dl>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>{info?.conversations.length ? t('views.wtInfo.ccConversationsCount', { count: info.conversations.length }) : t('views.wtInfo.ccConversations')}</h2>
          {info ? <Conversations ws={ws} info={info} /> : error ? <p className={s.quiet}>{t('views.wtInfo.couldntLook', { error })}</p> : <p className={s.quiet}>{t('views.wtInfo.looking')}</p>}
        </section>
      </div>
      {removing ? (
        <RemoveWorktreeAlert
          ws={ws}
          {...(info ? { info } : {})}
          onCancel={() => setRemoving(false)}
          onDone={(removed) => {
            setRemoving(false);
            if (removed) actions.run({ type: 'close_tab', id: ws.id });
          }}
        />
      ) : null}
    </div>
  );
}

/** Above a conversation shown from a worktree made outside Beluga: what it is, and its info page. */
export function OtherWorktreeBanner({ ws }: { ws: Workspace }) {
  const t = useT();
  return (
    <div className={s.banner}>
      <Icon name={iconOf(sourceFromPath(ws.path))} size={13} />
      <span className={s.bannerText}>{t('views.wtInfo.banner')}</span>
      <Button size="small" variant="quiet" onClick={() => setWorktreeFlag('about', ws.id, true)}>
        {t('views.wtInfo.aboutThis')}
      </Button>
    </div>
  );
}
