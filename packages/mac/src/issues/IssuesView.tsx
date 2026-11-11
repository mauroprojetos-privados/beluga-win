import { useEffect, useMemo, useRef, useState } from 'react';
import type { GhIssueState } from '@beluga/core/issues/model.js';
import { repoSlug } from '@beluga/core/issues/model.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { Button, Empty, EmptyActions, IconButton, Segmented, Tip, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { currentSheet } from '../lib/sheets.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { ago } from '../tasks/tasks-model.js';
import { useTasksPrefs } from '../tasks/use-tasks.js';
import { ConnectGitHub } from '../views/project/GitHubRow.js';
import { issuesProject, searchWords } from './issues-model.js';
import { IssueRow } from './parts.js';
import { setIssuesPrefs, useIssueActions, useIssueList, useIssuesPrefs } from './use-issues.js';
import ts from '../tasks/tasks.module.css';
import s from './issues.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { NoProjects } from '../work/NoProjects.js';
import { primaryKey } from '../lib/shortcuts-model.js';
import { useT } from '../lib/i18n.js';

const STATES = (t: ReturnType<typeof useT>): ReadonlyArray<{ readonly value: GhIssueState; readonly label: string; readonly hint: string }> => [
  { value: 'open', label: t('github.issues.open'), hint: t('github.issues.openHint') },
  { value: 'closed', label: t('github.issues.closed'), hint: t('github.issues.closedHint') },
];

/**
 * Issues: one project's GitHub issues at a time (the one you're in; the switcher changes it),
 * open or closed, newest activity first; the search box asks GitHub ("login 500", "label:bug").
 * Each shows what Beluga is doing about it. An issue opens into its page, where Claude can
 * investigate it, fix it, or put it on the board; right-click does the same from here.
 */
export function IssuesView() {
  const view = useApp((st) => st.view);
  const t = useT();
  const allProjects = useApp((st) => st.projects);
  const projects = useMemo(() => allProjects.filter((p) => p.root && !p.error), [allProjects]);
  const tasksPrefs = useTasksPrefs();
  const prefs = useIssuesPrefs();
  const { openList, openOnGitHub } = useIssueActions();
  const api = useApi();
  const projectId = issuesProject(projects, view.kind === 'issues' ? view.projectId : undefined, tasksPrefs.project);
  const here = projects.find((p) => p.id === projectId);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [connect, setConnect] = useState(false);
  const find = useRef<HTMLInputElement>(null);
  const { list, loading, error, refresh } = useIssueList(projectId, prefs.state, search);
  // Nothing kept from last time: the list settles in once GitHub answers.
  const late = useLateArrival(projectId ?? '', list !== undefined);

  // GitHub is asked once typing pauses.
  useEffect(() => {
    const words = searchWords(typed);
    if (words === search) return;
    const timer = setTimeout(() => setSearch(words), 450);
    return () => clearTimeout(timer);
  }, [typed, search]);
  // Another project: a fresh search.
  useEffect(() => {
    setTyped('');
    setSearch('');
  }, [projectId]);
  // ⌘F searches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || currentSheet() || !primaryKey(e) || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      find.current?.focus();
      find.current?.select();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!projects.length || !here || !projectId) return <NoProjects icon="issue" detail={t('github.issues.noProjects')} />;

  const repo = list && list.kind !== 'none' ? list.repo : undefined;
  return (
    <div className={ts.view}>
      <div className={ts.bar}>
        <div className={ts.barGroup}>
          <PickMenu<string>
            label={t('github.project')}
            choices={projects.map((p) => ({ value: p.id, label: p.name, mark: <ProjectIcon id={p.id} name={p.name} size={16} /> }))}
            chosen={[here.id]}
            onPick={(id) => openList(id)}
          >
            <button type="button" className={ts.projectSwitch} aria-label={t('github.projectNamed', { name: here.name })}>
              <ProjectIcon id={here.id} name={here.name} size={18} />
              <span className={ts.projectName}>{here.name}</span>
              <Icon name="chevronDown" size={11} />
            </button>
          </PickMenu>
          <Segmented<GhIssueState> label={t('github.issues.show')} value={prefs.state} onChange={(state) => setIssuesPrefs({ state })} options={STATES(t)} />
        </div>
        <div className={cx(ts.barGroup, ts.barActions)}>
          <label className={cx(ts.find, s.find)}>
            <Icon name="search" size={12} />
            <input
              ref={find}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t('github.issues.search')}
              aria-label={t('github.issues.searchLabel')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(searchWords(typed));
                if (e.key === 'Escape') (setTyped(''), setSearch(''), (e.target as HTMLInputElement).blur());
              }}
            />
            {typed ? (
              <button type="button" className={ts.findClear} aria-label={t('github.issues.clearSearch')} onClick={() => (setTyped(''), setSearch(''))}>
                <Icon name="x" size={10} />
              </button>
            ) : null}
          </label>
          <IconButton icon="refresh" label={loading ? t('github.askingGitHub') : t('github.askAgain')} className={cx(loading && s.spinning)} onClick={refresh} disabled={!repo} />
          {repo ? ( // i18n-ignore
            <Tip label={`${repo.url}/issues`}>
              <Button size="small" icon="external" onClick={() => openOnGitHub(`${repo.url}/issues`)}>
                {/* i18n-ignore */}
                GitHub
              </Button>
            </Tip>
          ) : null}
        </div>
      </div>
      <div className={ts.body}>
        {error ? (
          <Empty icon="alert" title={t('github.issues.cantRead')} detail={error} action={<Button onClick={refresh}>{t('common.retry')}</Button>} />
        ) : !list ? (
          <Empty icon="issue" title={t('github.askingGitHub')} detail={t('github.issues.forProject', { project: here.name })} />
        ) : list.kind === 'none' ? (
          <Empty icon="issue" title={t('github.notOnGitHub')} detail={t('github.issues.notOnGitHubDetail')} />
        ) : list.kind === 'no_gh' ? (
          <Empty
            icon="issue"
            title={t('github.connectGitHub')}
            detail={t('github.issues.connectDetail', { repo: repoSlug(list.repo) })}
            action={
              <EmptyActions>
                <Button variant="primary" onClick={() => setConnect(true)}>
                  {t('github.connectGitHubDots')}
                </Button>
              </EmptyActions>
            }
          />
        ) : list.kind === 'error' ? (
          <Empty icon="alert" title={t('github.issues.cantRead')} detail={list.message} action={<Button onClick={refresh}>{t('common.retry')}</Button>} />
        ) : !list.issues.length ? (
          <Empty
            icon={prefs.state === 'open' && !search ? 'task' : 'issue'}
            title={search ? t('github.issues.nothingMatches') : prefs.state === 'open' ? t('github.issues.noOpen') : t('github.issues.noClosed')}
            detail={search ? t('github.issues.tryOtherWords') : prefs.state === 'open' ? t('github.issues.nothingWaiting', { repo: repoSlug(list.repo) }) : t('github.issues.nothingClosed', { repo: repoSlug(list.repo) })}
          />
        ) : (
          <div className={cx(s.list, late && arr.arrive)} role="table" aria-label={prefs.state === 'open' ? t('github.issues.openList', { project: here.name }) : t('github.issues.closedList', { project: here.name })}>
            {list.issues.map((issue) => (
              <IssueRow key={issue.number} projectId={projectId} repo={list.repo} issue={issue} />
            ))}
          </div>
        )}
      </div>
      {list?.kind === 'github' && list.issues.length ? (
        <div className={ts.foot}>
          {t(prefs.state === 'open' ? 'github.issues.footOpen' : 'github.issues.footClosed', { shown: `${list.issues.length}${list.more ? '+' : ''}`, repo: repoSlug(list.repo), when: ago(list.fetchedAt) })}
          {list.more ? t('github.issues.footMore') : ''}

        </div>
      ) : null}
      {connect ? (
        <ConnectGitHub
          onClose={() => setConnect(false)}
          onCheck={async () => {
            const now = await api.issues.list(projectId, { state: prefs.state, force: true }).catch(() => undefined);
            refresh();
            return now?.kind === 'github';
          }}
        />
      ) : null}
    </div>
  );
}
