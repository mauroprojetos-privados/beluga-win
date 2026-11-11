import { useRef, useState } from 'react';
import type { Issue } from '@beluga/core/board/model.js';
import { type GhIssueFull, type IssueStage, repoSlug } from '@beluga/core/issues/model.js';
import type { GitHubRepo } from '@beluga/workspaces/github.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Markdown } from '../chat/Markdown.js';
import { Icon } from '../components/Icon.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { Avatar, Button, Empty, EmptyActions, IconButton, Tip, cx } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import { LiveDot } from '../plans/marks.js';
import { PrChip, StatusIcon } from '../tasks/marks.js';
import { issueWayBack } from '../tasks/use-tasks.js';
import { useSwipeBack } from '../tasks/use-swipe-back.js';
import { SwipeBackEdge } from '../tasks/SwipeBackEdge.js';
import { agoWords, comments, lastReport, stateOf } from './issues-model.js';
import { GhLabelChip, IssueStateIcon, useIssueMenu } from './parts.js';
import { IssueComposer } from './IssueComposer.js';
import { IssueReply } from './IssueReply.js';
import { useIssue, useIssueActions, useIssueStage } from './use-issues.js';
import { useActions } from '../lib/actions.js';
import ts from '../tasks/tasks.module.css';
import s from './issues.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { useT } from '../lib/i18n.js';

/**
 * One GitHub issue: what it says and what people said since, and what Claude should do about it.
 * Nothing done yet: a composer like a project's home (Investigate, Fix It or Make a Task, and
 * anything Claude should know). Once Claude is on it, the same place shows how it's going:
 * investigating, what it found (with Fix It, in the same worktree), fixing, its pull request,
 * done. Everything goes through the issue's task.
 */
export function IssuePage({ projectId, number }: { projectId: string; number: number }) {
  const { data, error, loading, refresh } = useIssue(projectId, number);
  const actions = useActions();
  const t = useT();
  const late = useLateArrival(`${projectId}#${number}`, data !== undefined);
  if (!data) {
    if (error) {
      return (
        <Empty
          icon="alert"
          title={t('github.issue.cantRead', { number })}
          detail={error}
          action={
            <EmptyActions>
              <Button onClick={refresh}>{t('common.retry')}</Button>
              <Button variant="quiet" onClick={() => actions.run({ type: 'view', view: issueWayBack(projectId) })}>
                {t('common.back')}
              </Button>
            </EmptyActions>
          }
        />
      );
    }
    return <Empty icon="issue" title={t('github.askingGitHub')} detail={t('github.issue.forIssue', { number })} />;
  }
  return <Page projectId={projectId} repo={data.repo} issue={data.issue} loading={loading} refresh={refresh} late={late} />;
}

function Page({ projectId, repo, issue, loading, refresh, late }: { projectId: string; repo: GitHubRepo; issue: GhIssueFull; loading: boolean; refresh: () => void; late: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const actions = useActions();
  const t = useT();
  const back = (): void => actions.run({ type: 'view', view: issueWayBack(projectId) });
  const swipe = useSwipeBack(wrap, back);
  const stage = useIssueStage(projectId, repo, issue.number);
  const project = useApp((st) => st.projects.find((p) => p.id === projectId));
  const menu = useIssueMenu(projectId);
  const a = useIssueActions();
  const state = stateOf(issue);
  // What Claude found can go on GitHub as your comment (⋯), after you've seen what it says.
  const found = useFindings(stage);
  const post: ActionItem[] = found
    ? [
        {
          label: t('github.issue.postFindings'),
          icon: 'send',
          hint: t('github.issue.postFindingsHint', { number: issue.number }),
          onSelect: () =>
            openSheet({
              kind: 'confirm',
              title: t('github.issue.postFindingsTitle', { number: issue.number }),
              message: t('github.issue.postFindingsMessage', { found: found.length > 600 ? `${found.slice(0, 600)}…` : found }),
              confirm: t('github.issue.postComment'),
              run: () => void a.comment(projectId, issue.number, `**Findings**\n\n${found}`).then((url) => url && refresh()),
            }),
        },
      ]
    : [];
  return (
    <div ref={wrap} className={cx(ts.pageWrap, late && arr.arrive)}>
      <SwipeBackEdge progress={swipe} />
      <div className={ts.page}>
        <div className={ts.pageMain}>
          <nav className={ts.crumbs} aria-label={t('github.issue.where')}>
            <IconButton icon="back" label={t('common.back')} keys={shortcutKeys('page-back')} className={ts.crumbBack} onClick={back} />
            <button type="button" className={ts.crumb} onClick={() => a.openList(projectId)}>
              {t('github.issue.issues')}
            </button>
            <Icon name="chevronRight" size={10} />
            <span className={ts.crumbPlain}>{project?.name ?? repoSlug(repo)}</span>
            <span className={ts.grow} />
            <span className={ts.pageKey}>#{issue.number}</span>
            <IconButton icon="refresh" label={loading ? t('github.askingGitHub') : t('github.askAgain')} className={cx(loading && s.spinning)} onClick={refresh} />
            <ActionsDropdown items={[...post, ...menu(issue, stage, { open: false })]}>
              <IconButton icon="more" label={t('common.more')} />
            </ActionsDropdown>
          </nav>
          <header className={ts.pageHead}>
            <h1 className={s.pageTitle}>{issue.title}</h1>
            <div className={s.byline}>
              <span className={cx(s.statePill, s[`statePill_${state.tone}`])}>
                <IssueStateIcon issue={issue} size={13} />
                {state.label}
              </span>
              <span>
                {issue.author ? <strong>{issue.author}</strong> : t('github.someone')} {t('github.issue.openedThisWhen', { when: agoWords(issue.createdAt) })}
                {issue.comments ? ` · ${comments(issue.comments)}` : ''}
              </span>
            </div>
            <NextStep projectId={projectId} issue={issue} stage={stage} />
          </header>
          <section className={s.thread} aria-label={t('github.issue.thread')}>
            <Post author={issue.author} at={issue.createdAt} what={t('github.issue.openedThis')} body={issue.body} url={issue.url} />
            {issue.thread.map((c, i) => (
              <Post key={`${c.url}-${i}`} author={c.author} at={c.createdAt} what={t('github.issue.commented')} body={c.body} url={c.url} />
            ))}
            {issue.moreComments || issue.thread.length < issue.comments ? (
              <button type="button" className={s.moreComments} onClick={() => actions.openLink({ kind: 'url', url: issue.url })}>
                {t('github.moreOnGitHub', { count: issue.comments - issue.thread.length })}
                <Icon name="external" size={11} />
              </button>
            ) : null}
          </section>
          <IssueReply projectId={projectId} number={issue.number} posted={refresh} />
        </div>
        <Properties repo={repo} issue={issue} stage={stage} />
      </div>
    </div>
  );
}

/**
 * What Claude found: the task's context, once Claude was asked to investigate and wrote it (not the
 * report the task started from, nor what a quick look noted while writing the task).
 */
function findingsOf(task: Issue): string | undefined {
  const context = task.brief.context?.trim();
  if (!context || !task.github?.investigated) return undefined;
  return task.revisions.some((r) => r.section === 'context' && r.by.kind === 'claude') ? context : undefined;
}

/**
 * What Claude found, to show and to post: its report in the conversation (what happens, why, how
 * to fix it, a verdict), else what it wrote in the task's brief. Only once it has investigated.
 */
function useFindings(stage: IssueStage): string | undefined {
  const ws = stage.kind === 'investigated' || stage.kind === 'investigating' || stage.kind === 'fixing' ? stage.ws : undefined;
  const report = useApp((st) => (ws && stage.kind === 'investigated' ? lastReport(st.log, `ws:${ws}`) : undefined));
  if (stage.kind === 'new' || stage.kind === 'investigating') return undefined;
  return report ?? findingsOf(stage.task);
}

/** What to do next, or how it's going: the one place on the page that changes as Claude works. */
function NextStep({ projectId, issue, stage }: { projectId: string; issue: GhIssueFull; stage: IssueStage }) {
  const a = useIssueActions();
  const t = useT();
  const [fixing, setFixing] = useState(false);
  const fix = async (): Promise<void> => {
    setFixing(true);
    await a.fix(projectId, n);
    setFixing(false);
  };
  const n = issue.number;
  const ws = useApp((st) => (stage.kind === 'investigating' || stage.kind === 'investigated' || stage.kind === 'fixing' ? findWorkspace(st.projects, stage.ws) : undefined));
  const found = useFindings(stage);
  // Stopped while fixing: what it said (why there's no pull request).
  const said = useApp((st) => (stage.kind === 'fixing' && !stage.working ? lastReport(st.log, `ws:${stage.ws}`) : undefined));

  // Nothing under way yet: hand it to Claude (the composer), the way a project's home starts work.
  if (stage.kind === 'new' || stage.kind === 'task') return <IssueComposer projectId={projectId} number={n} {...(stage.kind === 'task' ? { task: stage.task } : {})} />;

  const task = stage.task;
  const taskButton = (
    <Button size="small" icon="task" onClick={() => a.openTask(task.id)}>
      {t('github.openKey', { key: task.key })}
    </Button>
  );
  const chatButton = (primary: boolean) =>
    ws ? (
      <Button size="small" variant={primary ? 'primary' : 'plain'} icon="chat" onClick={() => a.openWorktree(ws.id)}>
        {t('github.openTheConversation')}
      </Button>
    ) : null;
  const where = ws ? (
    <span className={ts.nextInfo}>
      {t('github.issue.in')} <span className={ts.mono}>{ws.name}</span>
    </span>
  ) : null;

  if (stage.kind === 'investigating') {
    return (
      <Status icon={<LiveDot />} title={t('github.issue.investigating')} where={where} tone="claude" text={t('github.issue.investigatingText', { key: task.key })}>
        <div className={s.statusActions}>
          {chatButton(true)}
          {taskButton}
        </div>
      </Status>
    );
  }

  if (stage.kind === 'investigated') {
    return (
      <Status icon={<Icon name="search" size={13} />} title={t('github.issue.investigated')} where={where} tone="info" text={found ? undefined : t('github.issue.reportInConversation')}>
        {found ? <Report text={found} /> : null}
        <div className={s.statusActions}>
          <Button variant="primary" size="small" icon="wrench" disabled={fixing} onClick={() => void fix()}>
            {fixing ? t('github.askingTheAgent') : t('github.fixIt')}
          </Button>
          <Tip label={t('github.issue.sameWorktree', { number: n })}>
            <span className={s.statusHint}>{t('github.issue.sameWorktree', { number: n })}</span>
          </Tip>
          {chatButton(false)}
          {taskButton}
        </div>
      </Status>
    );
  }

  if (stage.kind === 'fixing') {
    return (
      <Status
        icon={stage.working ? <LiveDot /> : <Icon name="wrench" size={13} />}
        title={stage.working ? t('github.issue.fixing') : t('github.issue.stoppedBeforePr')}
        where={where}
        tone="claude"
        text={stage.working ? t('github.issue.fixingText', { number: n }) : said ? undefined : t('github.issue.stoppedText')}
      >
        {said ? <Report text={said} /> : null}
        <div className={s.statusActions}>
          {chatButton(true)}
          {taskButton}
        </div>
      </Status>
    );
  }

  if (stage.kind === 'review') {
    const pr = task.pr;
    return (
      <Status icon={<StatusIcon status="in_review" size={13} />} title={pr ? t('github.issue.prOpen') : t('github.issue.inReview')} tone="info" text={t('github.issue.reviewText', { number: n, key: task.key })}>
        <div className={s.statusActions}>
          {pr ? (
            <Button variant="primary" size="small" icon="pr" onClick={() => a.openOnGitHub(pr.url)}>
              {t('github.issue.openPr', { number: pr.number })}
            </Button>
          ) : null}
          {pr ? <PrChip pr={pr} /> : null}
          <span className={ts.grow} />
          {taskButton}
        </div>
      </Status>
    );
  }

  return (
    <Status icon={<StatusIcon status={task.status} size={13} />} title={task.status === 'done' ? t('github.issue.doneIn', { key: task.key }) : t('github.issue.canceled', { key: task.key })} tone={task.status === 'done' ? 'ok' : 'muted'} text={task.status === 'done' ? (issue.state === 'open' ? t('github.issue.doneText') : undefined) : t('github.issue.canceledText')}>
      <div className={s.statusActions}>
        {task.pr ? <PrChip pr={task.pr} /> : null}
        <span className={ts.grow} />
        {taskButton}
      </div>
    </Status>
  );
}

/** How it's going, in a soft card: what Claude is at, where, and what you can do. */
function Status({ icon, title, where, tone, text, children }: { icon: React.ReactNode; title: string; where?: React.ReactNode; tone: 'claude' | 'info' | 'ok' | 'muted'; text?: string; children: React.ReactNode }) {
  return (
    <section className={cx(s.status, s[`tone_${tone}`])} aria-label={title} data-testid="issue-status">
      <div className={s.statusHead}>
        <span className={s.statusIcon}>{icon}</span>
        <strong>{title}</strong>
        {where}
      </div>
      {text ? <p className={s.statusText}>{text}</p> : null}
      {children}
    </section>
  );
}

/** What Claude said (its report, or the task's context), folded when it's long. */
function Report({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const long = text.length > 900 || text.split('\n').length > 16;
  return (
    <>
      <div className={cx(s.findings, long && !open && s.findingsFolded)}>
        <Markdown text={text} paths tasks />
      </div>
      {long ? (
        <button type="button" className={s.findingsMore} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('github.issue.showLess') : t('github.issue.showAll')}
        </button>
      ) : null}
    </>
  );
}

/** The issue's description or a comment: who, when, and what they wrote. */
function Post({ author, at, what, body, url }: { author: string | undefined; at: number; what: string; body: string; url: string }) {
  const actions = useActions();
  const t = useT();
  return (
    <article className={s.post}>
      <header className={s.postHead}>
        <Avatar name={author ?? '?'} id={`gh:${author ?? ''}`} size={20} />
        <strong>{author ?? t('github.someone')}</strong>
        <span>
          {what} {agoWords(at)}
        </span>
        <span className={ts.grow} />
        <Tip label={t('github.openOnGitHub')}>
          <button type="button" className={s.postLink} aria-label={t('github.openOnGitHub')} onClick={() => actions.openLink({ kind: 'url', url })}>
            <Icon name="external" size={11} />
          </button>
        </Tip>
      </header>
      <div className={s.postBody}>{body.trim() ? <Markdown text={body} html /> : <p className={s.none}>{t('github.issue.noDescription')}</p>}</div>
    </article>
  );
}

/** The right column: the issue's facts, and its task. */
function Properties({ repo, issue, stage }: { repo: GitHubRepo; issue: GhIssueFull; stage: IssueStage }) {
  const a = useIssueActions();
  const task = stage.kind === 'new' ? undefined : stage.task;
  const state = stateOf(issue);
  const t = useT();
  return (
    <aside className={ts.props} aria-label={t('github.issue.properties')}>
      <Prop label={t('github.issue.state')}>
        <span className={cx(ts.propStatic, s.propState, s[`propState_${state.tone}`])}>
          <IssueStateIcon issue={issue} size={13} />
          {state.label}
        </span>
      </Prop>
      <Prop label={t('github.issue.task')}>
        {task ? (
          <button type="button" className={ts.propValue} onClick={() => a.openTask(task.id)}>
            <StatusIcon status={task.status} />
            <span className={ts.ellipsis}>{task.key}</span>
          </button>
        ) : (
          <span className={ts.propStatic}>{t('github.issue.noneYet')}</span>
        )}
      </Prop>
      <Prop label={t('github.issue.labels')}>
        <div className={ts.propLabels}>{issue.labels.length ? issue.labels.map((l) => <GhLabelChip key={l.name} label={l} />) : <span className={ts.propStatic}>{t('github.issue.none')}</span>}</div>
      </Prop>
      <Prop label={t('github.issue.assignees')}>
        <span className={ts.propStatic}>{issue.assignees.length ? issue.assignees.join(', ') : t('github.issue.noOne')}</span>
      </Prop>
      <div className={ts.propsRule} />
      <Prop label={t('github.issue.opened')} quiet>
        <span className={ts.propStatic}>{agoWords(issue.createdAt)}</span>
      </Prop>
      <Prop label={t('github.issue.updated')} quiet>
        <span className={ts.propStatic}>{agoWords(issue.updatedAt)}</span>
      </Prop>
      {issue.closedAt ? (
        <Prop label={t('github.issue.closed')} quiet>
          <span className={ts.propStatic}>{agoWords(issue.closedAt)}</span>
        </Prop>
      ) : null}
      {/* i18n-ignore */}
      <Prop label="GitHub" quiet>
        <Tip label={t('github.openNumberOnGitHub', { number: issue.number })}>

          <button type="button" className={ts.propValue} onClick={() => a.openOnGitHub(issue.url)}>
            <span className={cx(ts.mono, ts.ellipsis)}>
              {repoSlug(repo)}#{issue.number}
            </span>
            <Icon name="external" size={11} />
          </button>
        </Tip>
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
