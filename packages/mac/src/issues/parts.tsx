import { memo } from 'react';
import { type GhIssue, type GhLabel, type IssueStage, stageWords } from '@beluga/core/issues/model.js';
import type { GitHubRepo } from '@beluga/workspaces/github.js';
import { Icon } from '../components/Icon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../components/SpecMenu.js';
import { IconButton, Tip, cx } from '../components/ui.js';
import { copyText } from '../lib/copy.js';
import { toast, useBeluga } from '../lib/beluga.js';
import { TonePill } from '../plans/marks.js';
import { ago } from '../tasks/tasks-model.js';
import { agoWords, comments, labelColor, stateOf } from './issues-model.js';
import { useIssueActions, useIssueStage } from './use-issues.js';
import s from './issues.module.css';
import { TeammateOnIssue } from '../team/Team.js';
import { useT } from '../lib/i18n.js';

/** An issue's state as GitHub draws it: a ring with a dot while open, with a check once done, grey when closed otherwise. */
export function IssueStateIcon({ issue, size = 15 }: { issue: Pick<GhIssue, 'state' | 'reason'>; size?: number }) {
  const state = stateOf(issue);
  return (
    <span className={cx(s.state, s[`state_${state.tone}`])} role="img" aria-label={state.label}>
      <Icon name={state.tone === 'done' ? 'task' : 'issue'} size={size} />
    </span>
  );
}

/** A GitHub label in a soft tint of its own color. */
export function GhLabelChip({ label }: { label: GhLabel }) {
  const color = labelColor(label.color);
  return (
    <span className={s.label} style={color ? ({ '--label': color } as React.CSSProperties) : undefined}>
      {label.name}
    </span>
  );
}

/** Where Beluga is with an issue, as a pill (nothing when it's untouched). */
export function StagePill({ stage }: { stage: IssueStage }) {
  const words = stageWords(stage);
  if (!words) return null;
  const live = stage.kind === 'investigating' || (stage.kind === 'fixing' && stage.working);
  return (
    <TonePill tone={words.tone} live={live}>
      {words.label}
    </TonePill>
  );
}

/** What to do with an issue (right-click and ⋯): depends on how far Beluga got with it. */
export function useIssueMenu(projectId: string): (issue: Pick<GhIssue, 'number' | 'title' | 'url'>, stage: IssueStage, opts?: { readonly open?: boolean }) => ActionItem[] {
  const a = useIssueActions();
  const { client } = useBeluga();
  const t = useT();
  return (issue, stage, opts = {}) => {
    const n = issue.number;
    const ws = stage.kind === 'investigating' || stage.kind === 'investigated' || stage.kind === 'fixing' ? stage.ws : undefined;
    const task = stage.kind === 'new' ? undefined : stage.task;
    // Claude still writing the task: working on it waits for its words.
    const writing = Boolean(task?.drafting);
    const work: ActionItem[] =
      stage.kind === 'new' || stage.kind === 'task'
        ? [
            { label: t('github.menu.investigate'), icon: 'search', disabled: writing, hint: writing ? t('github.menu.onceWritten') : t('github.menu.investigateHint'), onSelect: () => void a.investigate(projectId, n) },
            { label: t('github.fixIt'), icon: 'wrench', disabled: writing, hint: writing ? t('github.menu.onceWritten') : t('github.menu.fixHint', { number: n }), onSelect: () => void a.fix(projectId, n) },
            ...(stage.kind === 'new'
              ? [
                  { label: t('github.menu.makeTask'), icon: 'task' as const, hint: t('github.menu.makeTaskHint'), onSelect: () => void a.toTask(projectId, n) },
                  { label: t('github.menu.makeTaskLook'), hint: t('github.menu.makeTaskLookHint'), onSelect: () => void a.toTask(projectId, n, true) },
                ]
              : []),
          ]
        : stage.kind === 'investigated'
          ? [{ label: t('github.fixIt'), icon: 'wrench', hint: t('github.menu.fixWhereInvestigated'), onSelect: () => void a.fix(projectId, n) }]
          : [];
    return [
      ...(opts.open === false ? [] : [{ label: t('github.menu.open'), icon: 'issue' as const, onSelect: () => a.openIssue(projectId, n) }]),
      ...work.map((w, i) => (i === 0 && opts.open !== false ? { ...w, separate: true } : w)),
      ...(ws ? [{ label: t('github.openTheConversation'), icon: 'chat' as const, separate: !work.length, onSelect: () => a.openWorktree(ws) }] : []),
      ...(task ? [{ label: t('github.openKey', { key: task.key }), icon: 'task' as const, separate: !work.length && !ws, onSelect: () => a.openTask(task.id) }] : []),
      { label: t('github.openOnGitHub'), icon: 'external', separate: true, onSelect: () => a.openOnGitHub(issue.url) },
      { label: t('github.menu.copyLink'), icon: 'copy', onSelect: () => void copyText(issue.url).then(() => toast(client, t('github.menu.copied', { number: n }), 'success')) },
    ];
  };
}

/** One issue in a list: its state, number and title, labels, what Beluga is doing about it, comments, when. Click opens it. */
export const IssueRow = memo(function IssueRow({ projectId, repo, issue, compact }: { projectId: string; repo: GitHubRepo; issue: GhIssue; compact?: boolean }) {
  const stage = useIssueStage(projectId, repo, issue.number);
  const menu = useIssueMenu(projectId);
  const { openIssue } = useIssueActions();
  const t = useT();
  const closed = issue.state === 'closed';
  return (
    <ActionsContext items={() => menu(issue, stage)}>
      <div
        role="row"
        tabIndex={0}
        className={cx(s.row, compact && s.rowCompact)}
        onClick={() => openIssue(projectId, issue.number)}
        onKeyDown={(e) => e.key === 'Enter' && openIssue(projectId, issue.number)}
        aria-label={t('github.row.label', { number: issue.number, title: issue.title, state: stateOf(issue).label })}
        data-issue={issue.number}
      >
        <IssueStateIcon issue={issue} />
        <span className={s.rowMain}>
          <span className={s.rowTop}>
            <span className={cx(s.rowTitle, closed && s.rowTitleClosed)}>{issue.title}</span>
            {compact ? null : issue.labels.slice(0, 4).map((l) => <GhLabelChip key={l.name} label={l} />)}
          </span>
          <span className={s.rowSub}>
            #{issue.number} · {issue.author ? `${issue.author} · ` : ''}
            {closed && issue.closedAt ? t('github.row.closed', { when: agoWords(issue.closedAt) }) : t('github.row.opened', { when: agoWords(issue.createdAt) })}
          </span>
        </span>
        <TeammateOnIssue projectId={projectId} number={issue.number} />
        <StagePill stage={stage} />
        {issue.comments ? (
          <Tip label={comments(issue.comments)}>
            <span className={s.comments}>
              <Icon name="chat" size={12} />
              {issue.comments}
            </span>
          </Tip>
        ) : (
          <span className={s.comments} />
        )}
        <span className={s.when}>{ago(issue.updatedAt)}</span>
        <span className={s.rowMore} onClick={(e) => e.stopPropagation()}>
          <ActionsDropdown items={menu(issue, stage)}>
            <IconButton icon="more" label={t('github.row.whatToDo', { number: issue.number })} />

          </ActionsDropdown>
        </span>
      </div>
    </ActionsContext>
  );
});
