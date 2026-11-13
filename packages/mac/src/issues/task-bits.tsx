import { useState } from 'react';
import { type Issue, isArchived } from '@beluga/core/board/model.js';
import { issueStage } from '@beluga/core/issues/model.js';
import { activityOf } from '@beluga/ui/workspace-models.js';
import { Icon } from '../components/Icon.js';
import { Button, Tip, cx } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { useIssueActions } from './use-issues.js';
import { useT } from '../lib/i18n.js';
import s from './issues.module.css';

/**
 * A task's GitHub issue where the task shows (its page, its row, the strip above its conversation):
 * a mark that opens the issue in Beluga, and Fix It once Claude has investigated it.
 */

/** "◉ #48": the issue a task is for; it opens the issue's page. */
export function IssueMark({ issue, compact }: { issue: Issue; compact?: boolean }) {
  const { openIssue } = useIssueActions();
  const t = useT();
  if (!issue.github) return null;
  const gh = issue.github;
  return (
    <Tip label={t('github.bits.forIssue', { repo: gh.repo, number: gh.number })}>
      <button
        type="button"
        className={cx(s.ghMark, compact && s.ghMarkCompact)}
        onClick={(e) => {
          e.stopPropagation();
          openIssue(issue.projectId, gh.number);
        }}
      >
        <Icon name="issue" size={11} />#{gh.number}
      </button>
    </Tip>
  );
}

/** Whether the task's Claude has investigated its issue and stopped (Fix It continues there): then Fix It is the one main action. */
export function useInvestigated(issue: Issue): boolean {
  const places = [issue.carriedBy, issue.worktrees.at(-1)].filter((w): w is string => Boolean(w));
  const live = useApp((st) => places.filter((id) => st.projects.some((p) => p.workspaces.some((w) => w.id === id && !w.archived))).join(' '));
  const working = useApp((st) => places.filter((id) => activityOf(st.log, `ws:${id}`).running).join(' '));
  if (!issue.github || isArchived(issue)) return false;
  return issueStage(issue, (id) => live.split(' ').includes(id), (id) => working.split(' ').includes(id)).kind === 'investigated';
}

/** Fix It, where Claude investigated: shown only then. */
export function FixItButton({ issue, size = 'small' }: { issue: Issue; size?: 'small' | 'regular' }) {
  const investigated = useInvestigated(issue);
  const { fix } = useIssueActions();
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (!investigated || !issue.github) return null;
  const n = issue.github.number;
  return (
    <Tip label={t('github.bits.fixHere', { number: n })}>
      <Button
        variant="primary"
        size={size}
        icon="wrench"
        disabled={busy}
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          await fix(issue.projectId, n);
          setBusy(false);
        }}
      >
        {busy ? t('github.askingTheAgent') : t('github.fixIt')}
      </Button>
    </Tip>
  );
}

/** The task page's GitHub row: the issue in Beluga, and on GitHub. */
export function GitHubIssueProp({ issue, Prop }: { issue: Issue; Prop: (p: { label: string; quiet?: boolean; children: React.ReactNode }) => React.ReactNode }) {
  const { openIssue, openOnGitHub } = useIssueActions();
  const t = useT();
  if (!issue.github) return null;
  const gh = issue.github;
  return (
    // i18n-ignore
    <Prop label="GitHub" quiet>
      <span className={s.propIssue}>
        <Tip label={t('github.bits.openInBeluga', { number: gh.number })}>
          <button type="button" className={s.propIssueOpen} onClick={() => openIssue(issue.projectId, gh.number)}>
            <Icon name="issue" size={12} />
            <span>
              {gh.repo}#{gh.number}
            </span>
          </button>
        </Tip>
        <Tip label={t('github.openOnGitHub')}>
          <button type="button" className={s.propIssueOut} aria-label={t('github.openNumberOnGitHub', { number: gh.number })}
 onClick={() => openOnGitHub(gh.url)}>
            <Icon name="external" size={11} />
          </button>
        </Tip>
      </span>
    </Prop>
  );
}
