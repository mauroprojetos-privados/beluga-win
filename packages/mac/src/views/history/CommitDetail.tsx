import { useEffect, useMemo, useState } from 'react';
import { parseDiff } from '@beluga/shared/diff-lines.js';
import type { CommitDetail as Detail, CommitFile } from '@beluga/workspaces/history.js';
import { Icon } from '../../components/Icon.js';
import { Button, Empty, IconButton, Tip, cx } from '../../components/ui.js';
import { quoteInBox } from '../../chat/message-menu.js';
import { useActions } from '../../lib/actions.js';
import { copyText } from '../../lib/copy.js';
import { toast, useApi, useBeluga } from '../../lib/beluga.js';
import { useMyAgentName } from '../../lib/agent-words.js';
import { openExternal } from '../../lib/system.js';
import { STATE, UnifiedDiff } from '../DiffView.js';
import { AuthorAvatar, type RefContext, RefPill } from './HistoryList.js';
import { commitPage, fullDate, pillsOf, timeAgo } from './history-model.js';
import { useT } from '../../lib/i18n.js';
import { useGitHub } from './use-history.js';
import d from '../diff.module.css';
import s from './history.module.css';

/** Diffs this small show opened; bigger commits list their files to open one by one. */
const OPEN_ALL_LINES = 600;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function useCommit(target: string, hash: string): { detail?: Detail; error?: string } {
  const api = useApi();
  const [state, setState] = useState<{ hash: string; detail?: Detail; error?: string }>({ hash });
  useEffect(() => {
    let alive = true;
    setState({ hash });
    api.git.commit(target, hash).then(
      (detail) => alive && setState({ hash, detail }),
      (err: unknown) => alive && setState({ hash, error: errorText(err) }),
    );
    return () => {
      alive = false;
    };
  }, [target, hash]);
  return state.hash === hash ? state : {};
}

function FileDiff({ file, open, onToggle }: { file: CommitFile; open: boolean; onToggle: () => void }) {
  const t = useT();
  const st = STATE[file.state];
  const lines = useMemo(() => (open && file.diff ? parseDiff(file.diff) : []), [open, file.diff]);
  const name = file.path.split('/').pop() ?? file.path;
  const dir = file.path.slice(0, file.path.length - name.length).replace(/\/$/, '');
  return (
    <div className={s.file}>
      <button type="button" className={s.fileHead} aria-expanded={open} onClick={onToggle} title={file.from ? `${file.from} → ${file.path}` : file.path}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} className={s.fileChevron} />
        <span className={cx(d.letter, st.tone)}>{st.letter}</span>
        <span className={s.fileName}>
          {name}
          {dir ? <span className={s.fileDir}>{dir}</span> : null}
          {file.from ? <span className={s.fileDir}>{t('views.commit.from', { path: file.from })}</span> : null}
        </span>
        <span className={s.fileCounts}>
          {file.binary ? <span className={s.dim}>{t('views.commit.binary')}</span> : null}
          {file.added ? <span className={d.add}>+{file.added}</span> : null}
          {file.removed ? <span className={d.del}>−{file.removed}</span> : null}
        </span>
      </button>
      {open ? (
        <div className={cx(s.fileBody, d.code, 'selectable')}>
          {file.binary ? <div className={s.dimPad}>{t('views.commit.binaryFile')}</div> : file.diff ? lines.length ? <UnifiedDiff lines={lines} compact /> : <div className={s.dimPad}>{t('views.commit.modeOnly')}</div> : <div className={s.dimPad}>{t('views.commit.tooBig')}</div>}
        </div>
      ) : null}
    </div>
  );
}

export interface CommitDetailProps {
  /** A project id or worktree id (whose history this is). */
  readonly target: string;
  readonly projectId: string;
  readonly hash: string;
  readonly refs: RefContext;
  /** Go to another commit (a parent). */
  readonly onSelect: (hash: string) => void;
  /** The panel: back to the list. The page: close the detail. */
  readonly onClose: () => void;
  readonly compact?: boolean;
}

/** One commit: its message, who and when, its parents, what it changed (with the diffs), and what to do with it. */
export function CommitDetail({ target, projectId, hash, refs, onSelect, onClose, compact }: CommitDetailProps) {
  const t = useT();
  const { detail, error } = useCommit(target, hash);
  const agent = useMyAgentName();
  const { client, ui } = useBeluga();
  const api = useApi();
  const actions = useActions();
  const { state: gh } = useGitHub(projectId);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [allOpen, setAllOpen] = useState<boolean>();
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    setOpened(new Set());
    setAllOpen(undefined);
  }, [hash]);

  if (error) return <Empty icon="alert" title={t('views.commit.couldntRead')} detail={error} />;
  if (!detail) return <div className={s.dimPad}>{t('views.commit.loading')}</div>;
  const c = detail.commit;
  const totals = detail.files.reduce((sum, f) => ({ add: sum.add + f.added, del: sum.del + f.removed }), { add: 0, del: 0 });
  const small = totals.add + totals.del <= OPEN_ALL_LINES && detail.files.length <= 12;
  const isOpen = (f: CommitFile): boolean => (opened.has(f.path) ? !(allOpen ?? small) : (allOpen ?? small));
  const toggle = (f: CommitFile): void => setOpened((set) => (set.has(f.path) ? new Set([...set].filter((p) => p !== f.path)) : new Set([...set, f.path])));
  const pills = pillsOf(c.refs, refs);
  const say = (text: string): void => toast(client, text, 'success');
  const ws = target !== projectId ? target : undefined;
  const askClaude = (): void => {
    if (ws) {
      actions.run({ type: 'open_ws', id: ws, tab: 'chat' });
      setTimeout(() => quoteInBox(ui, `${c.short} ${c.subject}`, t('views.commit.quotePrefix')), 60);
      return;
    }
    void api.workspaces.startChat(projectId, t('views.commit.explainPrompt', { short: c.short, subject: c.subject, author: c.author.name, date: fullDate(c.date) }));
  };
  const startHere = (): void => {
    if (starting) return;
    setStarting(true);
    void api.git
      .worktreeAt(projectId, c.hash)
      .catch((err: unknown) => toast(client, t('views.commit.worktreeFailed', { error: errorText(err) }), 'error'))
      .finally(() => setStarting(false));
  };
  const repo = gh?.kind === 'github' ? gh.repo : undefined;

  return (
    <article className={cx(s.detail, compact && s.detailCompact)} aria-label={t('views.commit.label', { short: c.short })}>
      <div className={s.detailBar}>
        {compact ? (
          <Button size="small" variant="quiet" icon="back" onClick={onClose}>
            {t('views.commit.allCommits')}
          </Button>
        ) : (
          <span className={s.detailKicker}>{t('views.commit.kicker')}</span>
        )}
        <span className={s.flex} />
        <Tip label={t('views.commit.copyFullHash')}>
          <button type="button" className={s.hashButton} onClick={() => void copyText(c.hash).then(() => say(t('views.commit.copied', { short: c.short })))}>
            {c.short}
            <Icon name="copy" size={11} />
          </button>
        </Tip>
        {compact ? null : <IconButton icon="x" label={t('common.close')} keys="Esc" onClick={onClose} />}
      </div>
      <div className={s.detailScroll}>
        <h2 className={cx(s.detailSubject, 'selectable')}>{c.subject}</h2>
        {pills.length ? (
          <div className={s.detailPills}>
            {pills.map((p) => (
              <RefPill key={`${p.tone}:${p.label}`} pill={p} />
            ))}
          </div>
        ) : null}
        {c.body ? <pre className={cx(s.body, 'selectable')}>{c.body}</pre> : null}
        <dl className={s.facts}>
          <dt>{t('views.commit.author')}</dt>
          <dd className={s.factAuthor}>
            <AuthorAvatar name={c.author.name} email={c.author.email} size={20} />
            <span className="selectable">
              {c.author.name} <span className={s.dim}>{c.author.email}</span>
            </span>
          </dd>
          <dt>{t('views.commit.date')}</dt>
          <dd>
            <time dateTime={new Date(c.date).toISOString()}>{fullDate(c.date)}</time> <span className={s.dim}>· {timeAgo(c.date)}</span>
          </dd>
          <dt>{c.parents.length > 1 ? t('views.commit.parents') : t('views.commit.parent')}</dt>
          <dd className={s.parents}>
            {c.parents.length ? (
              c.parents.map((p, i) => (
                <button key={p} type="button" className={s.parent} onClick={() => onSelect(p)} title={i === 0 ? t('views.commit.firstParent') : t('views.commit.mergedIn')}>
                  {p.slice(0, 7)}
                </button>
              ))
            ) : (
              <span className={s.dim}>{t('views.commit.noParent')}</span>
            )}
          </dd>
        </dl>
        <div className={s.detailActions}>
          <Button size="small" icon="copy" onClick={() => void copyText(c.hash).then(() => say(t('views.commit.copied', { short: c.short })))}>
            {t('views.commit.copyHash')}
          </Button>
          {repo ? (
            <Tip label={commitPage(repo.url, c.hash)}>
              <Button size="small" icon="external" onClick={() => void openExternal(commitPage(repo.url, c.hash))}>
                {t('views.commit.showOnGitHub')}
              </Button>
            </Tip>
          ) : null}
          <Tip label={ws ? t('views.commit.quoteTip') : t('views.commit.askTip')}>
            <Button size="small" icon="claude" onClick={askClaude}>
              {t('views.commit.ask', { agent })}
            </Button>
          </Tip>
          <Tip label={t('views.commit.startTip')}>
            <Button size="small" icon="branch" disabled={starting} onClick={startHere}>
              {starting ? t('views.commit.starting') : t('views.commit.startHere')}
            </Button>
          </Tip>
        </div>
        <div className={s.filesHead}>
          <span className={s.filesTitle}>{t('views.commit.filesChanged', { count: detail.files.length })}</span>
          <span className={d.add}>+{totals.add}</span>
          <span className={d.del}>−{totals.del}</span>
          {c.parents.length > 1 ? <span className={s.dim}>{t('views.commit.vsFirstParent')}</span> : null}
          <span className={s.flex} />
          {detail.files.length ? (
            <Button size="small" variant="quiet" onClick={() => (setAllOpen(!(allOpen ?? small)), setOpened(new Set()))}>
              {(allOpen ?? small) ? t('views.commit.collapseAll') : t('views.commit.expandAll')}
            </Button>
          ) : null}
        </div>
        {detail.truncated ? <div className={s.note}>{t('views.commit.truncated')}</div> : null}
        <div className={s.files}>
          {detail.files.map((f) => (
            <FileDiff key={f.path} file={f} open={isOpen(f)} onToggle={() => toggle(f)} />
          ))}
          {!detail.files.length ? <div className={s.dimPad}>{t('views.commit.empty')}</div> : null}
        </div>
      </div>
    </article>
  );
}
