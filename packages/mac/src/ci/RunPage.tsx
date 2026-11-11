import { useEffect, useRef, useState } from 'react';
import type { GhJob, GhRunFull } from '@beluga/core/ci/model.js';
import { durationWords, eventWords, fileName, isLive, jobsSummary, runDuration, runTone, shortSha, sortJobs, spanOf, statusWords } from '@beluga/core/ci/model.js';
import { repoSlug } from '@beluga/core/issues/model.js';
import type { GitHubRepo } from '@beluga/workspaces/github.js';
import { Icon } from '../components/Icon.js';
import { CodeLines } from '../components/markdown/CodeLines.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { Button, Empty, EmptyActions, IconButton, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp } from '../lib/beluga.js';
import { runWayBack } from '../tasks/use-tasks.js';
import { useSwipeBack } from '../tasks/use-swipe-back.js';
import { SwipeBackEdge } from '../tasks/SwipeBackEdge.js';
import { agoWords } from '../issues/issues-model.js';
import { RunMark, useRunMenu } from './parts.js';
import { useCiActions, useRun } from './use-ci.js';
import { NowText, Ticking } from './now.js';
import { WorkflowGraph } from './WorkflowGraph.js';
import ts from '../tasks/tasks.module.css';
import s from './ci.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { useT } from '../lib/i18n.js';

/**
 * One workflow run, to watch: its workflow drawn as a graph with each job coloured by how it's
 * going, then every job and its steps with their times (the failed and running ones open, and a
 * failed job's log a click away), asked for again every few seconds while it runs. Re-run the
 * failed jobs, cancel it, or open it on GitHub.
 */
export function RunPage({ projectId, runId }: { projectId: string; runId: number }) {
  const { data, error, loading, refresh } = useRun(projectId, runId);
  const actions = useActions();
  const t = useT();
  const late = useLateArrival(`${projectId}#${runId}`, data !== undefined);
  if (!data) {
    if (error) {
      return (
        <Empty
          icon="alert"
          title={t('github.run.cantRead')}
          detail={error}
          action={
            <EmptyActions>
              <Button onClick={refresh}>{t('common.retry')}</Button>
              <Button variant="quiet" onClick={() => actions.run({ type: 'view', view: runWayBack(projectId) })}>
                {t('common.back')}
              </Button>
            </EmptyActions>
          }
        />
      );
    }
    return <Empty icon="pulse" title={t('github.askingGitHub')} detail={t('github.run.forJobs')} />;
  }
  return <Page projectId={projectId} repo={data.repo} run={data.run} loading={loading} refresh={refresh} late={late} />;
}

function Page({ projectId, repo, run, loading, refresh, late }: { projectId: string; repo: GitHubRepo; run: GhRunFull; loading: boolean; refresh: () => void; late: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const actions = useActions();
  const t = useT();
  const back = (): void => actions.run({ type: 'view', view: runWayBack(projectId) });
  const swipe = useSwipeBack(wrap, back);
  const project = useApp((st) => st.projects.find((p) => p.id === projectId));
  const a = useCiActions();
  const menu = useRunMenu(projectId);
  const live = isLive(run);
  const tone = runTone(run);
  const failed = !live && (tone === 'failed' || tone === 'cancelled');
  // The clock sits in Ticking: only the time text is drawn again each second.
  return (
    <Ticking live={live}>
      <div ref={wrap} className={cx(ts.pageWrap, late && arr.arrive)}>
        <SwipeBackEdge progress={swipe} />
        <div className={ts.page}>
          <div className={ts.pageMain}>
            <nav className={ts.crumbs} aria-label={t('github.run.where')}>
              <IconButton icon="back" label={t('common.back')} keys={shortcutKeys('page-back')} className={ts.crumbBack} onClick={back} />
              <button type="button" className={ts.crumb} onClick={() => a.openList(projectId)}>
                {t('github.run.actions')}
              </button>
              <Icon name="chevronRight" size={10} />
              <span className={ts.crumbPlain}>{project?.name ?? repoSlug(repo)}</span>
              <span className={ts.grow} />
              <span className={ts.pageKey}>
                {run.workflow} #{run.number}
                {run.attempt > 1 ? t('github.run.attempt', { number: run.attempt }) : ''}
              </span>
              <IconButton icon="refresh" label={loading ? t('github.askingGitHub') : t('github.askAgain')} className={cx(loading && s.spinning)} onClick={refresh} />
              <ActionsDropdown items={menu(run, { open: false, then: refresh })}>
                <IconButton icon="more" label={t('common.more')} />
              </ActionsDropdown>
            </nav>
            <header className={ts.pageHead}>
              <h1 className={s.pageTitle}>{run.title}</h1>
              <div className={s.byline}>
                <span className={cx(s.statePill, s[`tone_${tone}`])}>
                  <RunMark tone={tone} size={14} />
                  {statusWords(run)}
                </span>
                <span>
                  <NowText>{(now) => durationWords(runDuration(run, now))}</NowText> · {jobsSummary(run.jobs)}
                </span>
                <span className={ts.grow} />
                {failed ? (
                  <Button size="small" icon="refresh" onClick={() => void a.rerun(projectId, run.id, true).then((ok) => ok && refresh())}>
                    {t('github.ci.rerunFailed')}
                  </Button>
                ) : null}
                {live ? (
                  <Button size="small" icon="stop" onClick={() => a.cancel(projectId, run.id, run.title, refresh)}>
                    {t('github.ci.cancelRun')}
                  </Button>
                ) : null}
                <Button size="small" variant="quiet" icon="external" onClick={() => a.openOnGitHub(run.url)}>
                  {/* i18n-ignore */}
                  GitHub
                </Button>
              </div>
            </header>
            {run.file !== undefined && run.path ? (
              <section className={s.runGraph} aria-label={t('github.run.workflow')}>
                <WorkflowGraph text={run.file} path={run.path} title={run.workflow} jobs={run.jobs} />
              </section>
            ) : null}
            <section className={s.jobs} aria-label={t('github.run.jobs')}>
              {run.jobs.length ? sortJobs(run.jobs).map((job) => <JobCard key={job.id} projectId={projectId} job={job} />) : <p className={s.graphNote}>{live ? t('github.run.waitingRunnerPickUp') : t('github.run.noJobs')}</p>}
            </section>
          </div>
          <Properties repo={repo} run={run} />
        </div>
      </div>
    </Ticking>
  );
}

/** A job: how it went and how long, its steps (open while it runs or once it fails), and its log when it failed. */
function JobCard({ projectId, job }: { projectId: string; job: GhJob }) {
  const tone = runTone(job);
  const [open, setOpen] = useState(tone === 'failed' || tone === 'running');
  const a = useCiActions();
  const t = useT();
  // A job that starts running, or fails, while you watch opens by itself.
  const was = useRef(tone);
  useEffect(() => {
    if (was.current !== tone && (tone === 'failed' || tone === 'running')) setOpen(true);
    was.current = tone;
  }, [tone]);
  return (
    <div className={cx(s.job, open && s.jobOpen)} data-job={job.name}>
      <button type="button" className={s.jobHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} className={s.jobChevron} />
        <RunMark tone={tone} size={15} label={statusWords(job)} />
        <span className={s.jobName}>{job.name}</span>
        {job.runner ? <span className={s.jobRunner}>{job.runner}</span> : null}
        <span className={ts.grow} />
        <NowText>
          {(now) => {
            const took = spanOf(job, now);
            return took !== undefined ? <span className={cx(s.took, isLive(job) && s.tookLive)}>{durationWords(took)}</span> : <span className={s.took}>{statusWords(job)}</span>;
          }}
        </NowText>
      </button>
      {open ? (
        <div className={s.jobBody}>
          {job.steps.length ? (
            <ol className={s.steps}>
              {job.steps.map((step) => {
                const st = runTone(step);
                return (
                  <li key={step.number} className={cx(s.step, s[`step_${st}`])}>
                    <RunMark tone={st} size={13} label={statusWords(step)} />
                    <span className={s.stepNo}>{step.number}</span>
                    <span className={s.stepName}>{step.name}</span>
                    <span className={s.took}>
                      <NowText>
                        {(now) => {
                          const span = spanOf(step, now);
                          return span !== undefined && st !== 'skipped' ? durationWords(span) : '';
                        }}
                      </NowText>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={s.graphNote}>{isLive(job) ? t('github.run.waitingRunner') : t('github.run.noSteps')}</p>
          )}
          <div className={s.jobFoot}>
            {tone === 'failed' ? <JobLog projectId={projectId} jobId={job.id} /> : null}
            <span className={ts.grow} />
            {job.url ? (
              <Button size="small" variant="quiet" icon="external" onClick={() => a.openOnGitHub(job.url)}>
                {t('github.run.fullLog')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The end of a failed job's log, asked for when you want it. */
function JobLog({ projectId, jobId }: { projectId: string; jobId: number }) {
  const a = useCiActions();
  const t = useT();
  const [log, setLog] = useState<{ readonly text?: string; readonly error?: string; readonly loading?: boolean }>();
  if (!log) {
    return (
      <Button
        size="small"
        icon="terminal"
        onClick={() => {
          setLog({ loading: true });
          a.log(projectId, jobId).then(
            (text) => setLog({ text }),
            (err: unknown) => setLog({ error: err instanceof Error ? err.message : String(err) }),
          );
        }}
      >
        {t('github.run.showFailed')}
      </Button>
    );
  }
  if (log.loading) return <span className={s.graphNote}>{t('github.run.readingLog')}</span>;
  if (log.error) return <span className={s.graphNote}>{log.error}</span>;
  return (
    <div className={s.log}>
      <CodeLines text={log.text ?? ''} numbers={false} wrap />
    </div>
  );
}

function Properties({ repo, run }: { repo: GitHubRepo; run: GhRunFull }) {
  const a = useCiActions();
  const commit = `${repo.url}/commit/${run.sha}`;
  const t = useT();
  return (
    <aside className={ts.props} aria-label={t('github.issue.properties')}>
      <Prop label={t('github.run.status')}>
        <span className={ts.propStatic}>{statusWords(run)}</span>
      </Prop>
      <Prop label={t('github.ci.workflow')}>
        <span className={ts.propStatic}>
          {run.workflow}
          {run.path ? <span className={s.propHint}> · {fileName(run.path)}</span> : null}
        </span>
      </Prop>
      <Prop label={t('github.run.startedBy')}>
        <span className={ts.propStatic}>
          {eventWords(run.event)}
          {run.actor ? ` · ${run.actor}` : ''}
        </span>
      </Prop>
      {run.branch ? (
        <Prop label={t('github.run.branch')}>
          <span className={cx(ts.propStatic, ts.mono, ts.ellipsis)}>{run.branch}</span>
        </Prop>
      ) : null}
      {run.prs.length ? (
        <Prop label={t('github.run.pullRequest')}>
          <button type="button" className={ts.propValue} onClick={() => a.openOnGitHub(`${repo.url}/pull/${run.prs[0]}`)}>
            <span className={ts.mono}>#{run.prs[0]}</span>
          </button>
        </Prop>
      ) : null}
      {run.sha ? (
        <Prop label={t('github.run.commit')}>
          <Tip label={t('github.run.openCommit')}>
            <button type="button" className={ts.propValue} onClick={() => a.openOnGitHub(commit)}>
              <span className={ts.mono}>{shortSha(run.sha)}</span>
            </button>
          </Tip>
        </Prop>
      ) : null}
      <div className={ts.propsRule} />
      <Prop label={t('github.run.started')} quiet>
        <span className={ts.propStatic}>{agoWords(run.startedAt)}</span>
      </Prop>
      <Prop label={isLive(run) ? t('github.run.runningFor') : t('github.run.tookLabel')} quiet>
        <span className={ts.propStatic}>
          <NowText>{(now) => durationWords(runDuration(run, now))}</NowText>
        </span>
      </Prop>
      {run.attempt > 1 ? (
        <Prop label={t('github.run.attemptLabel')} quiet>
          <span className={ts.propStatic}>{run.attempt}</span>
        </Prop>
      ) : null}
      {/* i18n-ignore */}
      <Prop label="GitHub" quiet>
        <button type="button" className={ts.propValue} onClick={() => a.openOnGitHub(run.url)}>

          <span className={cx(ts.mono, ts.ellipsis)}>
            {repoSlug(repo)} #{run.number}
          </span>
        </button>
      </Prop>
    </aside>
  );
}

function Prop({ label, children, quiet }: { label: string; children: React.ReactNode; quiet?: boolean }) {
  return (
    <div className={cx(ts.prop, quiet && ts.propStaticRow)}>
      <span className={ts.propLabel}>{label}</span>
      <div className={ts.propControl}>{children}</div>
    </div>
  );
}
