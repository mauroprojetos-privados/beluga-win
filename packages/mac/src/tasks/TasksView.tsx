import { RemoteList } from '../machines/RemoteList.js';
import { remoteTasks } from '../machines/remote-work.js';
import { useRemoteSources } from '../machines/use-remote.js';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDER_INFO, type ProjectSync, isOpen, showsOn, worksOn, worktreeOf } from '@beluga/core/board/model.js';
import { Icon } from '../components/Icon.js';
import { Select } from '../components/Select.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { Button, Empty, EmptyActions, IconButton, Segmented, cx } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { currentSheet, openSheet } from '../lib/sheets.js';
import { TaskBoard } from './TaskBoard.js';
import { TaskList } from './TaskList.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { PickMenu } from './PickMenu.js';
import { type Display, SCOPES, ago, type Scope, assigneesIn, boardChoices, boardRepos, boardToShow, connected, doneCount, pickedRepos, reposLabel, scopeCounts, scoped, statusesFor, taskGraph, untucked, workGoingOn } from './tasks-model.js';
import { BoardMark, RepoStack, ShowingBoardProvider, useDeleteBoard } from './boards.js';
import { useTaskFileDrop } from './use-task-drop.js';
import { revealSubTasks, setTasksPrefs, useBoard, useSelfId, useSolo, useTaskActions, useTasksPrefs } from './use-tasks.js';
import t from './tasks.module.css';
import g from '../components/graph/graph.module.css';
import { TeamOffers } from '../team/Team.js';
import { NoProjects } from '../work/NoProjects.js';
import { isShortcut } from '../lib/shortcuts.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { useT } from '../lib/i18n.js';
import { t as tx } from '@beluga/shared/i18n/index.js';

const FlowGraph = lazy(() => import('../components/graph/FlowGraph.js'));

/**
 * Tasks: one board at a time (the one covering the project you're in; the switcher at the top
 * changes it, and makes new boards). A board covers one repo or several: with several, a filter
 * picks which repos' tasks show, and each card says which repo it runs in. A repo's own board also
 * shows what runs in its repo from other boards, a shade back with that board's name (BLG-559).
 * Active, Backlog or All, for everyone or one person when you work with others, as a list grouped
 * by status, a board to drag cards across, or a graph of what waits on what. A task opens into
 * its page. ⌘N (or C) makes a new one, ⌘F finds. The Archive (finished tasks put away) is a list,
 * emptied for good from here.
 */
export function TasksView() {
  // Files dropped on a card or a row are added to its task.
  const dropping = useTaskFileDrop();
  const tr = useT();
  const board = useBoard();
  const selfId = useSelfId();
  const prefs = useTasksPrefs();
  const view = useApp((s) => s.view);
  const allProjects = useApp((s) => s.projects);
  const projects = useMemo(() => allProjects.filter((p) => p.root && !p.error), [allProjects]);
  const [query, setQuery] = useState('');
  const find = useRef<HTMLInputElement>(null);
  const { api, act, open, openList, openWorktreeTasks } = useTaskActions();
  const deleteBoard = useDeleteBoard();
  const asked0 = view.kind === 'tasks' ? view.projectId : undefined;
  const boards = useMemo(() => boardChoices(board, projects), [board, projects]);
  // `project` is the board shown: a repo's own board has the repo's id, so most of what follows reads the same.
  const project = boardToShow(board, boards, asked0, prefs.project, prefs.board);
  const here = boards.find((b) => b.id === project);
  // A board of several repos: the ones its tasks run in, and the ones you picked to see (none: all).
  const repos = useMemo(() => boardRepos(board, project, projects), [board, project, projects]);
  const several = repos.length > 1;
  const picked = useMemo(() => (several ? pickedRepos(prefs.repos, repos) : []), [several, prefs.repos, repos]);
  const repoName = (id: string): string | undefined => projects.find((p) => p.id === id)?.name;
  useEffect(() => {
    if (project && project !== prefs.board) setTasksPrefs({ board: project });
  }, [project, prefs.board]);
  const solo = useSolo(project);
  const people = useMemo(() => (solo ? [] : assigneesIn(board, project, selfId)), [solo, board, project, selfId]);
  // A filter for someone who has no tasks here any more shows everyone's.
  const hasPrivate = useMemo(() => board.issues.some((i) => project !== undefined && showsOn(i, project) && i.private && !i.archivedAt), [board, project]);
  const who = !solo && (prefs.who === 'nobody' || (prefs.who === 'private' && hasPrivate) || people.some((p) => p.key === prefs.who)) ? prefs.who : '';
  // The worktrees doing or carrying this board's tasks, in any of its repos, to filter by (one asked for that's gone: every task).
  const worktrees = useMemo(() => {
    const ids = new Set(board.issues.filter((i) => project !== undefined && showsOn(i, project) && !i.archivedAt).flatMap((i) => [worktreeOf(i), i.worktrees.at(-1)]).filter((w): w is string => Boolean(w)));
    return allProjects.filter((p) => repos.includes(p.id)).flatMap((p) => p.workspaces).filter((w) => ids.has(w.id) && !w.archived).map((w) => ({ id: w.id, name: w.name }));
  }, [board, project, allProjects, repos]);
  const asked = view.kind === 'tasks' ? view.worktree : undefined;
  const worktree = asked && worktrees.some((w) => w.id === asked) ? asked : '';
  const found = useMemo(() => {
    const all = project ? scoped(board, { scope: prefs.scope, project, who, repos: picked }, selfId, query) : [];
    return worktree ? all.filter((i) => worksOn(i, worktree)) : all;
  }, [board, prefs.scope, project, who, selfId, query, worktree, picked]);
  // Sub-tasks stay tucked under their epics until you open one out (the eye on it); the graph shows them all.
  const tuck = useMemo(() => (prefs.display === 'graph' ? { shown: found, hidden: 0, tucked: [] } : untucked(found, prefs.opened, query)), [found, prefs.display, prefs.opened, query]);
  const issues = tuck.shown;
  const counts = useMemo(() => (project ? scopeCounts(board, project, who, selfId, Date.now(), picked) : { active: 0, backlog: 0, all: 0, archived: 0 }), [board, project, who, selfId, picked]);
  const statuses = statusesFor(prefs.scope);
  const archive = prefs.scope === 'archived';
  // The Archive is a list: nothing in it moves or waits on anything.
  const display = archive ? 'list' : prefs.display;
  // Only tasks tied to others: the rest have nothing to show there.
  // It opens on the work going on (a busy board too big to read whole), else what's next.
  const { graph, going } = useMemo(() => {
    if (display !== 'graph') return { graph: undefined, going: [] };
    const tied = connected(board, issues);
    return tied.length ? { graph: taskGraph(board, tied), going: workGoingOn(tied) } : { graph: undefined, going: [] };
  }, [display, board, issues]);
  // Linear sync and teams are a repo's: a board of its own has neither.
  const sync = project && here && !here.own ? board.sync?.[project] : undefined;
  // A new task goes on this board, in the one repo you're looking at (when you picked one).
  const newTask = { boardId: project, ...(picked.length === 1 ? { projectId: picked[0] } : {}) };

  // ⌘F finds, ⌘N or C (outside a field) makes a task (or your keys for them: Settings › Keyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Not while typing, in a menu, a pop-up or a sheet (a sheet's own keys stay its own).
      if (e.defaultPrevented || currentSheet()) return;
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"], [role="dialog"]');
      if (isShortcut('page-filter', e) && !typing) {
        e.preventDefault();
        find.current?.focus();
        find.current?.select();
      } else if (isShortcut('page-new', e) && (!typing || e.metaKey || e.ctrlKey || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        openSheet({ kind: 'new_task', ...newTask });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [project, newTask.projectId]);

  if (!board.enabled) return <Empty icon="task" title={tr('tasks.needsApp')} detail={tr('tasks.v.needsAppDetail')} />;
  if (!projects.length || !here) return <NoProjects icon="task" detail={tr('tasks.v.noProjects')} />;

  const none = !board.issues.some((i) => showsOn(i, here.id));
  return (
    <div className={t.view}>
      {dropping}
      <div className={t.bar}>
        <div className={cx(t.barGroup, t.barFilters)}>
        <PickMenu<string>
          label={tr('tasks.board')}
          choices={boards.map((b) => ({ value: b.id, label: b.name, mark: <BoardMark repos={b.repos} names={repoName} size={16} fit />, ...(boards.some((x) => x.own) ? { section: b.own ? tr('tasks.v.boards') : tr('tasks.v.projects') } : {}), hint: boardHint(board, b.id, b.repos.length) }))}
          chosen={[here.id]}
          onPick={(id) => openList(id)}
          actions={[
            { label: tr('tasks.v.newBoard'), icon: 'plus', onSelect: () => openSheet({ kind: 'task_board', repos: here.repos }) },
            { label: tr('tasks.v.boardSettings'), icon: 'gear', onSelect: () => openSheet({ kind: 'task_board', boardId: here.id }) },
          ]}
        >
          <button type="button" className={t.projectSwitch} aria-label={tr('tasks.v.boardAria', { name: here.name })}>
            <BoardMark repos={here.repos} names={repoName} size={18} />
            <span className={t.projectName}>{here.name}</span>
            <Icon name="chevronDown" size={11} />
          </button>
        </PickMenu>
        {/* A board of several repos: whose tasks show (all, or the ones you tick). */}
        {several ? (
          <PickMenu<string>
            label={tr('tasks.v.repos')}
            multiple
            choices={repos.map((r) => ({ value: r, label: repoName(r) ?? r, mark: <ProjectIcon id={r} name={repoName(r) ?? r} size={16} /> }))}
            chosen={picked}
            onPick={(r) => setTasksPrefs({ repos: picked.includes(r) ? picked.filter((x) => x !== r) : [...picked, r] })}
            actions={[
              ...(picked.length ? [{ label: tr('tasks.v.showAllRepos'), icon: 'eye' as const, onSelect: () => setTasksPrefs({ repos: [] }) }] : []),
              { label: tr('tasks.v.reposOnBoard'), icon: 'gear', onSelect: () => openSheet({ kind: 'task_board', boardId: here.id }) },
            ]}
          >
            <button type="button" className={cx(t.repoFilter, picked.length > 0 && t.repoFilterOn)} aria-label={tr('tasks.v.reposAria', { repos: reposLabel(picked, repoName) })}>
              <RepoStack repos={picked.length ? picked : repos} names={repoName} size={14} />
              <span>{reposLabel(picked, repoName)}</span>
              <Icon name="chevronDown" size={9} />
            </button>
          </PickMenu>
        ) : null}
        <Segmented<Scope>
          label={tr('tasks.v.show')}
          value={prefs.scope}
          onChange={(scope) => setTasksPrefs({ scope })}
          options={SCOPES.map((s) => ({ value: s.value, label: s.label, count: counts[s.value], hint: s.hint }))}
        />
        {/* Whose tasks: only when you work with others (alone, every task is yours and your Claude's). */}
        {people.length > 1 || (people.length === 1 && people[0]!.key !== `person:${selfId}` && people[0]!.key !== `claude:${selfId}`) ? (
          <Select
            label={tr('tasks.v.whoseTasks')}
            size="small"
            value={who}
            onChange={(w) => setTasksPrefs({ who: w })}
            options={[{ value: '', label: tr('tasks.v.everyone') }, ...people.map((p) => ({ value: p.key, label: p.label })), { value: 'nobody', label: tr('tasks.v.noOneYet') }, ...(hasPrivate ? [{ value: 'private', label: tr('tasks.v.privateOnlyYou') }] : [])]}
          />
        ) : null}
        {/* Which worktree works on what: only its tasks. */}
        {project && worktrees.length ? (
          <Select
            label={tr('tasks.v.worktree')}
            size="small"
            value={worktree}
            onChange={(w) => openWorktreeTasks(project, w || undefined)}
            options={[{ value: '', label: tr('tasks.v.everyWorktree'), short: tr('tasks.v.worktrees') }, ...worktrees.map((w) => ({ value: w.id, label: w.name }))]}
          />
        ) : null}
        </div>
        <div className={cx(t.barGroup, t.barActions)}>
        <label className={t.find}>
          <Icon name="search" size={12} />
          <input ref={find} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('tasks.v.filter')} aria-label={tr('tasks.v.filterTasks')} onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), (e.target as HTMLInputElement).blur())} />
          {query ? (
            <button type="button" className={t.findClear} aria-label={tr('tasks.v.clearFilter')} onClick={() => setQuery('')}>
              <Icon name="x" size={10} />
            </button>
          ) : null}
        </label>
        {archive ? (
          counts.archived ? (
            <Button
              size="small"
              variant="quiet"
              onClick={() =>
                openSheet({
                  kind: 'confirm',
                  title: tr('tasks.v.emptyTitle', { count: counts.archived }),
                  message: tr('tasks.v.emptyMessage'),
                  confirm: tr('tasks.v.emptyArchive'),
                  destructive: true,
                  run: () => void act(() => api.emptyArchive(project), tr('tasks.v.archiveEmpty')),
                })
              }
            >
              {tr('tasks.v.emptyArchive')}
            </Button>
          ) : null
        ) : (
          <Segmented<Display>
            label={tr('tasks.v.display')}
            iconOnly
            value={prefs.display}
            onChange={(display) => setTasksPrefs({ display })}
            options={[
              { value: 'list', label: tr('plans.list'), icon: 'rows' },
              { value: 'board', label: tr('tasks.board'), icon: 'columns' },
              { value: 'graph', label: tr('tasks.v.whatWaits'), icon: 'graph' },
            ]}
          />
        )}
        {sync ? <SyncPill sync={sync} onClick={() => openSheet({ kind: 'task_sync', projectId: here.id })} /> : null}
        <ActionsDropdown
          items={[
            { label: several ? tr('tasks.v.reposOnBoard') : tr('tasks.v.boardSettings'), icon: 'gear', onSelect: () => openSheet({ kind: 'task_board', boardId: here.id }) },
            { label: here.own ? tr('tasks.v.aboutBoard') : tr('tasks.v.aboutProject'), icon: 'book', onSelect: () => openSheet({ kind: 'project_context', projectId: here.id }) },
            ...(here.own ? [] : [{ label: sync ? tr('tasks.v.linearSync') : tr('tasks.v.syncWithLinear'), icon: 'refresh' as const, onSelect: () => openSheet({ kind: 'task_sync', projectId: here.id }) }]),
            ...(sync ? [{ label: tr('tasks.v.syncNow'), disabled: Boolean(sync.syncing), onSelect: () => void act(() => api.syncNow(project)) }] : []),
            { label: tr('tasks.v.autoTasks'), separate: true, checked: board.autoTasks, onSelect: () => void act(() => api.setAutoTasks(!board.autoTasks)) },
            { label: tr('tasks.v.archiveDone'), icon: 'archive', separate: true, disabled: !doneCount(board, project), onSelect: () => void act(() => api.archiveDone(project), tr('tasks.v.archivedDone')) },
            { label: tr('tasks.v.showCanceled'), separate: true, checked: !prefs.folded.includes('canceled'), onSelect: () => setTasksPrefs({ folded: prefs.folded.includes('canceled') ? prefs.folded.filter((s) => s !== 'canceled') : [...prefs.folded, 'canceled'] }) },
            ...(here.own ? [{ label: tr('tasks.v.deleteBoard'), icon: 'trash' as const, separate: true, danger: true, onSelect: () => deleteBoard(here.id) }] : []),
          ]}
        >
          <IconButton icon="more" label={tr('tasks.v.options')} />
        </ActionsDropdown>
        <Button variant="primary" size="small" icon="plus" className={t.newTask} aria-label={tr('tasks.v.newTask')} onClick={() => openSheet({ kind: 'new_task', ...newTask })} title={shortcutKeys('page-new') ? tr('tasks.v.newTaskKeys', { keys: shortcutKeys('page-new') ?? '' }) : tr('tasks.v.newTask')}>
          {tr('tasks.v.newTask')}
        </Button>
        </div>
      </div>
      <ShowingBoardProvider value={here.id}>
      <div className={cx(t.body, display === 'board' && t.bodyBoard, display === 'graph' && t.bodyGraph)}>
        {project && !here.own ? <TeamOffers projectId={project} /> : null}
        {none ? (
          <Empty
            icon="task"
            title={tr('tasks.v.planWork')}
            detail={several ? tr('tasks.v.planWorkSeveral', { repos: repos.map((r) => repoName(r)).join(', ') }) : tr('tasks.v.planWorkDetail')}
            action={
              <EmptyActions>
                <Button variant="primary" icon="plus" onClick={() => openSheet({ kind: 'new_task', ...newTask })}>
                  {tr('tasks.v.newTask')}
                </Button>
              </EmptyActions>
            }
          />
        ) : !issues.length ? (
          archive && !query ? (
            <Empty icon="archive" title={tr('tasks.v.archiveEmpty')} detail={tr('tasks.v.archiveEmptyDetail')} />
          ) : (
            <Empty icon="task" title={query ? tr('tasks.v.nothingMatches') : worktree ? tr('tasks.v.nothingWorktree') : who ? tr('tasks.v.nothingForThem') : tr('tasks.v.nothingHere')} detail={query ? tr('tasks.v.fewerWords') : SCOPES.find((s) => s.value === prefs.scope)?.hint} />
          )
        ) : display === 'board' ? (
          <TaskBoard issues={issues} statuses={statuses} projectId={project} {...(newTask.projectId ? { repo: newTask.projectId } : {})} />
        ) : display === 'graph' && !graph ? (
          <Empty icon="graph" title={tr('tasks.v.nothingWaits')} detail={tr('tasks.v.nothingWaitsDetail')} />
        ) : display === 'graph' && graph ? (
          <div className={cx(t.graph, g.palette)}>
            <Suspense fallback={<div className={t.graphNote}>{tr('plans.layingOut')}</div>}>
              <FlowGraph key={`${project}:${prefs.scope}:${who}:${worktree}:${picked.join(',')}`} graph={graph} mode="full" localImages={false} openLabel={tr('plans.d.openTask')} onOpen={(id) => open({ id })} live pack startAt={going} />
            </Suspense>
          </div>
        ) : (
          <TaskList issues={issues} statuses={statuses} emptyGroups={prefs.scope === 'active' || prefs.scope === 'backlog'} projectId={project} {...(newTask.projectId ? { repo: newTask.projectId } : {})} archived={archive} />
        )}
      </div>
      </ShowingBoardProvider>
      {issues.length && display !== 'graph' ? (
        <div className={t.foot}>
          {archive ? tr('tasks.v.nArchived', { n: issues.length }) : tr('tasks.v.openShown', { open: issues.filter((i) => isOpen(i.status)).length, shown: issues.length })}
          {tuck.hidden ? (
            <>
              {tr('tasks.v.tucked', { count: tuck.hidden })}
              <button type="button" className={t.footLink} onClick={() => (revealSubTasks(tuck.tucked), setTasksPrefs({ opened: [...new Set([...prefs.opened, ...tuck.tucked])] }))}>
                {tr('tasks.v.showAll')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {/* The board's projects' tasks on your computers (BLG-785). */}
      {here ? <RemoteTasks projects={here.repos.map(repoName).filter((n): n is string => Boolean(n))} /> : null}
    </div>
  );
}

/** Tasks of these projects (by name) on your computers, tagged. */
function RemoteTasks({ projects }: { projects: readonly string[] }) {
  const sources = useRemoteSources();
  const tr = useT();
  const names = projects.join('\n');
  const rows = useMemo(() => remoteTasks(sources).filter((t) => t.item.project !== undefined && names.split('\n').includes(t.item.project)).map((t) => ({ ...t, item: { id: t.item.id, title: t.item.title, sub: `${t.item.key} · ${t.item.status.replace('_', ' ')}`, page: { kind: 'task' as const, id: t.item.id } } })), [sources, names]);
  return <RemoteList title={tr('tasks.v.onYourComputers')} rows={rows} />;
}

/** How the project syncs with Linear, in the bar: syncing, when it last did, or that it needs you. */
function SyncPill({ sync, onClick }: { sync: ProjectSync; onClick: () => void }) {
  const tr = useT();
  const name = PROVIDER_INFO[sync.provider].label;
  const text = sync.error?.code === 'auth' ? tr('tasks.v.needsKey', { name }) : sync.syncing ? tr('tasks.v.syncing', { name }) : sync.syncedAt ? `${name} · ${ago(sync.syncedAt)}` : name;
  return (
    <button type="button" className={cx(t.syncPill, sync.error && t.syncPillProblem)} onClick={onClick} title={sync.error?.message ?? (sync.auto ? tr('tasks.v.syncedWithAuto', { team: sync.team, name }) : tr('tasks.v.syncedWith', { team: sync.team, name }))}>
      <Icon name={sync.error ? 'alert' : 'refresh'} size={11} className={sync.syncing ? t.syncSpin : undefined} />
      {text}
    </button>
  );
}

/** "3 repos · 4 open" (or less), beside each board in the switcher: what it shows, visitors too. */
function boardHint(board: ReturnType<typeof useBoard>, boardId: string, repos: number): string | undefined {
  const n = board.issues.filter((i) => showsOn(i, boardId) && isOpen(i.status) && !i.archivedAt).length;
  return [repos > 1 ? tx('tasks.m.repos', { count: repos }) : '', n ? tx('tasks.v.nOpen', { n }) : ''].filter(Boolean).join(' · ') || undefined;
}
