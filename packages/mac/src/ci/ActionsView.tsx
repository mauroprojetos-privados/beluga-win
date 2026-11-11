import { useEffect, useMemo, useState } from 'react';
import type { GhRun, GhWorkflow } from '@beluga/core/ci/model.js';
import { fileName, isLive, runTone, sortRuns, statusWords } from '@beluga/core/ci/model.js';
import { repoSlug } from '@beluga/core/issues/model.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { CodeLines } from '../components/markdown/CodeLines.js';
import { Button, Empty, EmptyActions, IconButton, Segmented, Tip, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { ago } from '../tasks/tasks-model.js';
import { useTasksPrefs } from '../tasks/use-tasks.js';
import { issuesProject } from '../issues/issues-model.js';
import { ConnectGitHub } from '../views/project/GitHubRow.js';
import { RunMark, RunRow } from './parts.js';
import { useCiActions, useRuns, useWorkflows } from './use-ci.js';
import { NowText, Ticking } from './now.js';
import { WorkflowGraph } from './WorkflowGraph.js';
import ts from '../tasks/tasks.module.css';
import s from './ci.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { NoProjects } from '../work/NoProjects.js';
import { useT } from '../lib/i18n.js';

type Page = 'runs' | 'workflows';

const PAGES = (t: ReturnType<typeof useT>): ReadonlyArray<{ readonly value: Page; readonly label: string; readonly hint: string; readonly icon: 'pulse' | 'graph' }> => [
  { value: 'runs', label: t('github.ci.runs'), hint: t('github.ci.runsHint'), icon: 'pulse' },
  { value: 'workflows', label: t('github.ci.workflows'), hint: t('github.ci.workflowsHint'), icon: 'graph' },
];

/**
 * Actions: one project's GitHub Actions at a time (the switcher changes it). Runs: the latest,
 * running ones on top, every few seconds while one runs; a workflow narrows them. Workflows: each
 * file drawn as a graph, with how its last run went. A run opens into its page.
 */
export function ActionsView() {
  const view = useApp((st) => st.view);
  const t = useT();
  const allProjects = useApp((st) => st.projects);
  const projects = useMemo(() => allProjects.filter((p) => p.root && !p.error), [allProjects]);
  const tasksPrefs = useTasksPrefs();
  const { openList, openOnGitHub } = useCiActions();
  const api = useApi();
  const projectId = issuesProject(projects, view.kind === 'actions' ? view.projectId : undefined, tasksPrefs.project);
  const page: Page = view.kind === 'actions' && view.page === 'workflows' ? 'workflows' : 'runs';
  const here = projects.find((p) => p.id === projectId);
  const [workflow, setWorkflow] = useState('');
  const [connect, setConnect] = useState(false);
  useEffect(() => setWorkflow(''), [projectId]);
  const { list, loading, error, refresh } = useRuns(projectId, workflow ? { workflow } : {});
  // Nothing kept from last time: the list settles in once GitHub answers.
  const late = useLateArrival(projectId ?? '', list !== undefined);
  // The workflows: the Workflows page, and the Runs page's filter.
  const flows = useWorkflows(projectId);
  const runs = useMemo(() => (list?.kind === 'github' ? sortRuns(list.runs) : []), [list]);
  const live = runs.some(isLive);

  // The clock sits in Ticking (in both returns, so it's the same one): only the time text is drawn again each second.
  if (!projects.length || !here || !projectId)
    return (
      <Ticking live={live}>
        <NoProjects icon="pulse" detail={t('github.ci.noProjects')} />
      </Ticking>
    );

  const repo = list && list.kind !== 'none' ? list.repo : undefined;
  const known = flows.data?.workflows ?? [];
  const named = (path: string): string => known.find((f) => f.path === path)?.name ?? fileName(path);
  return (
    <Ticking live={live}>
      <div className={ts.view}>
        <div className={ts.bar}>
          <div className={ts.barGroup}>
            <PickMenu<string>
              label={t('github.project')}
              choices={projects.map((p) => ({ value: p.id, label: p.name, mark: <ProjectIcon id={p.id} name={p.name} size={16} /> }))}
              chosen={[here.id]}
              onPick={(id) => openList(id, page === 'workflows' ? 'workflows' : undefined)}
            >
              <button type="button" className={ts.projectSwitch} aria-label={t('github.projectNamed', { name: here.name })}>
                <ProjectIcon id={here.id} name={here.name} size={18} />
                <span className={ts.projectName}>{here.name}</span>
                <Icon name="chevronDown" size={11} />
              </button>
            </PickMenu>
            <Segmented<Page> label={t('github.issues.show')} value={page} onChange={(p) => openList(projectId, p === 'workflows' ? 'workflows' : undefined)} options={PAGES(t)} />
            {page === 'runs' && known.length + (workflow ? 1 : 0) > 1 ? (
              <PickMenu<string>
                label={t('github.ci.workflow')}
                choices={[{ value: '', label: t('github.ci.allWorkflows') }, ...known.filter((f) => f.id).map((f) => ({ value: f.path, label: f.name, hint: fileName(f.path) }))]}
                chosen={[workflow]}
                onPick={setWorkflow}
              >
                <button type="button" className={s.filter} aria-label={t('github.ci.workflow')}>
                  <Icon name="graph" size={12} />
                  {workflow ? named(workflow) : t('github.ci.allWorkflows')}
                  <Icon name="chevronDown" size={10} />
                </button>
              </PickMenu>
            ) : null}
          </div>
          <div className={cx(ts.barGroup, ts.barActions)}>
            {live ? (
              <span className={s.liveTag}>
                <span className={s.liveDot} aria-hidden="true" />
                {t('github.ci.live')}
              </span>
            ) : null}
            <IconButton icon="refresh" label={loading || flows.loading ? t('github.askingGitHub') : t('github.askAgain')} className={cx((loading || flows.loading) && s.spinning)} onClick={() => (refresh(), flows.refresh())} disabled={!repo} />
            {repo ? ( // i18n-ignore
              <Tip label={`${repo.url}/actions`}>
                <Button size="small" icon="external" onClick={() => openOnGitHub(`${repo.url}/actions`)}>
                  {/* i18n-ignore */}
                  GitHub
                </Button>
              </Tip>
            ) : null}
          </div>
        </div>
        <div className={ts.body}>
          {error && !list ? (
            <Empty icon="alert" title={t('github.ci.cantReadRuns')} detail={error} action={<Button onClick={refresh}>{t('common.retry')}</Button>} />
          ) : !list ? (
            <Empty icon="pulse" title={t('github.askingGitHub')} detail={t('github.ci.forProject', { project: here.name })} />
          ) : list.kind === 'none' ? (
            <Empty icon="pulse" title={t('github.notOnGitHub')} detail={t('github.ci.notOnGitHubDetail')} />
          ) : list.kind === 'no_gh' ? (
            <Empty
              icon="pulse"
              title={t('github.connectGitHub')}
              detail={t('github.ci.connectDetail', { repo: repoSlug(list.repo) })}
              action={
                <EmptyActions>
                  <Button variant="primary" onClick={() => setConnect(true)}>
                    {t('github.connectGitHubDots')}
                  </Button>
                </EmptyActions>
              }
            />
          ) : list.kind === 'error' ? (
            <Empty icon="alert" title={t('github.ci.cantReadRuns')} detail={list.message} action={<Button onClick={refresh}>{t('common.retry')}</Button>} />
          ) : page === 'workflows' ? (
            <Workflows projectId={projectId} flows={flows} runs={runs} />
          ) : !runs.length ? (
            <Empty icon="pulse" title={workflow ? t('github.ci.noRunsOfWorkflow') : t('github.ci.noRuns')} detail={workflow ? t('github.ci.pickAnother') : t('github.ci.nothingRan', { repo: repoSlug(list.repo) })} />
          ) : (
            <div className={cx(s.list, late && arr.arrive)} role="table" aria-label={t('github.ci.listLabel', { project: here.name })}>
              {runs.map((run) => (
                <RunRow key={run.id} projectId={projectId} run={run} />
              ))}
            </div>
          )}
        </div>
        {list?.kind === 'github' && runs.length && page === 'runs' ? (
          <div className={ts.foot}>
            {runs.filter(isLive).length ? t('github.ci.footRunning', { count: runs.filter(isLive).length }) : ''}
            {t('github.ci.footRuns', { shown: `${runs.length}${list.more ? '+' : ''}`, repo: repoSlug(list.repo) })}
            <NowText>{(now) => ago(list.fetchedAt, now)}</NowText>
            {live ? t('github.ci.footWatching') : ''}
          </div>
        ) : null}
        {connect ? (
          <ConnectGitHub
            onClose={() => setConnect(false)}
            onCheck={async () => {
              const got = await api.ci.runs(projectId, { force: true }).catch(() => undefined);
              refresh();
              return got?.kind === 'github';
            }}
          />
        ) : null}
      </div>
    </Ticking>
  );
}

/** Each workflow as a card: its name and file, how its last run went, and its graph (or its YAML). */
function Workflows({ projectId, flows, runs }: { projectId: string; flows: ReturnType<typeof useWorkflows>; runs: readonly GhRun[] }) {
  const late = useLateArrival(projectId, flows.data !== undefined);
  const t = useT();
  if (flows.error && !flows.data) return <Empty icon="alert" title={t('github.ci.cantReadWorkflows')} detail={flows.error} action={<Button onClick={flows.refresh}>{t('common.retry')}</Button>} />;
  if (!flows.data) return <Empty icon="graph" title={t('github.ci.readingWorkflows')} detail={t('github.ci.readingWorkflowsDetail')} />;
  const list = flows.data.workflows;
  if (!list.length) return <Empty icon="graph" title={t('github.ci.noWorkflows')} detail={t('github.ci.noWorkflowsDetail')} />;
  return (
    <div className={cx(s.flows, late && arr.arrive)}>
      {list.map((f) => (
        <WorkflowCard key={f.path} projectId={projectId} flow={f} last={runs.find((r) => r.path === f.path)} />
      ))}
    </div>
  );
}

function WorkflowCard({ projectId, flow, last }: { projectId: string; flow: GhWorkflow; last?: GhRun }) {
  const { openRun, openOnGitHub } = useCiActions();
  const [yamlShown, setYamlShown] = useState(false);
  const t = useT();
  const off = flow.state !== 'active' && flow.state !== 'not_pushed';
  return (
    <section className={s.flow} aria-label={flow.name}>
      <header className={s.flowHead}>
        <span className={s.flowName}>{flow.name}</span>
        <span className={s.flowPath}>{flow.path}</span>
        {flow.state === 'not_pushed' ? <span className={s.badge}>{t('github.ci.notPushed')}</span> : off ? <span className={s.badge}>{t('github.ci.turnedOff')}</span> : null}
        <span className={ts.grow} />
        {last ? (
          <Tip label={t('github.ci.lastRun', { status: statusWords(last), when: ago(last.createdAt) })}>
            <button type="button" className={s.flowLast} onClick={() => openRun(projectId, last.id)}>
              <RunMark tone={runTone(last)} size={14} />
              <span className={s.flowLastTitle}>{last.title}</span>
              <span className={s.when}>{ago(last.createdAt)}</span>
            </button>
          </Tip>
        ) : null}
        <Segmented<'graph' | 'yaml'>
          label={t('github.ci.showAs')}
          iconOnly
          value={yamlShown ? 'yaml' : 'graph'}
          onChange={(v) => setYamlShown(v === 'yaml')}
          options={[
            { value: 'graph', label: t('github.ci.graph'), icon: 'graph' },
            { value: 'yaml', label: 'YAML', icon: 'file' }, // i18n-ignore
          ]}
        />
        {flow.url ? <IconButton icon="external" label={t('github.openOnGitHub')} onClick={() => openOnGitHub(flow.url)} /> : null}
      </header>
      {flow.file === undefined ? (
        <p className={s.graphNote}>{t('github.ci.noFile')}</p>

      ) : yamlShown ? (
        <div className={s.yaml}>
          <CodeLines text={flow.file} lang="yaml" />
        </div>
      ) : (
        <WorkflowGraph text={flow.file} path={flow.path} title={flow.name} />
      )}
    </section>
  );
}
