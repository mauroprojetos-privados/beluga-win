import { useMemo } from 'react';
import { planForHome, planTitle, planTaskOfIssue, reviewState } from '@beluga/core/plans/model.js';
import { issueForWorkspace } from '@beluga/core/board/model.js';
import { Icon } from '../components/Icon.js';
import { Button, Tip } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { PlanPrChip, Said } from './marks.js';
import { headline, taskHeadline } from './plans-model.js';
import { usePlanActions, usePlanView } from './use-plans.js';
import { useStartWith } from '../components/agent-options.js';
import { SplitButton } from '../components/SplitButton.js';
import type { AgentRef } from '@beluga/protocol.js';
import p from './plans.module.css';
import { useT } from '../lib/i18n.js';

/**
 * Above a conversation that plans (a plan's home): the plan, its one sentence (who it waits
 * for) and its pull request. In a worktree doing a plan's task: which plan, and the same sentence from the task's side
 * (“Done. Claude is checking “API”; Beluga merges this into the plan”).
 */
export function PlanStrip({ workspaceId }: { workspaceId: string }) {
  const home = useApp((s) => planForHome(s.plans, `ws:${workspaceId}`));
  // (Selected as plain values: a new object each time would redraw forever.)
  const issueId = useApp((s) => issueForWorkspace(s.board, workspaceId)?.id);
  const plans = useApp((s) => s.plans);
  const part = useMemo(() => (issueId && !home ? planTaskOfIssue(plans, issueId) : undefined), [plans, issueId, home]);
  const view = usePlanView(home ?? part?.plan);
  const { api, act, open } = usePlanActions();
  const startWith = useStartWith();
  const t = useT();
  // An empty draft has nothing to show yet (the box below says what this mode does).
  if (home && view && (home.body || view.milestones.length)) {
    const canApprove = (view.next.kind === 'approve' && view.milestones.length > 0) || view.next.kind === 'review_changes';
    const review = reviewState(home);
    /** Approve (with `agent`: worked by that one from now on; null: your default), then on to the plan, where it runs. */
    const approve = (agent?: AgentRef | null): void =>
      void act(
        async () => {
          if (agent !== undefined) await api.setWorkAgent(home.id, agent);
          await api.approve(home.id);
          return true;
        },
        home.body ? t('plans.changesApplied') : t('plans.approved'),
      ).then((ok) => {
        if (ok && !home.body) open(home.id);
      });
    return (
      <div className={p.strip}>
        <Tip label={t('plans.st.openPlan')}>
          <button type="button" className={p.stripMain} onClick={() => open(home.id)}>
            <Icon name="flag" size={12} />
            <span className={p.stripTitle}>{planTitle(home)}</span>
            <Said line={headline(view)} className={p.stripNext} />
          </button>
        </Tip>
        {/* Its pull request, as on the plan's page: the conversation opened whole still says where the work stands. */}
        {home.pr ? <PlanPrChip pr={home.pr} /> : null}
        {canApprove ? (
          <>
            {/* The plan beside this same conversation: read it, ask about it, have it changed, then approve there. */}
            <Tip label={t('plans.st.reviewTip')}>
              <Button size="small" onClick={() => open(home.id)}>
                {t('plans.st.review')}
              </Button>
            </Tip>
            {home.body ? (
              <Button size="small" variant="primary" onClick={() => approve()}>
                {t('plans.applyChanges')}
              </Button>
            ) : review === 'reviewing' ? (
              // A fresh agent verifies the draft, as you asked (BLG-772): its findings show on the plan.
              <Button size="small" variant="primary" disabled>
                {t('plans.st.verifying')}
              </Button>
            ) : review === 'findings' && !home.review?.fixAsked ? (
              <Tip label={t('plans.st.foundTip')}>
                <Button size="small" variant="primary" icon="wand" onClick={() => open(home.id)}>
                  {t('plans.st.seeFound')}
                </Button>
              </Tip>
            ) : (
              // Approve, worked by ▸ (BLG-506): who works its milestones and tasks, set as it's approved.
              <SplitButton
                label={t('plans.moreWaysToApprove')}
                items={[
                  // Verify, Then Approve (BLG-772): a fresh agent checks it holds together first.
                  {
                    label: t('plans.verifyThenApprove'),
                    icon: 'eye',
                    onSelect: () => undefined,
                    submenu: startWith(home.agent, (a) => void act(async () => (await api.setWorkAgent(home.id, a ?? null), api.verify(home.id, { thenApprove: true })), t('plans.verifyingThenApprove')), ''),
                  },
                  ...startWith(home.agent, (a) => approve(a ?? null), t('plans.approveWorkedBy')).map((item, i) => (i === 0 ? { ...item, separate: true } : item)),
                ]}
              >
                <Button size="small" variant="primary" onClick={() => approve()}>
                  {t('plans.approvePlan')}
                </Button>
              </SplitButton>
            )}
          </>
        ) : null}
      </div>
    );
  }
  if (!part || home) return null;
  const line = view ? taskHeadline(view, part.task.id) : undefined;
  return (
    <div className={p.strip}>
      <Tip label={t('plans.st.openPlan')}>
        <button type="button" className={p.stripMain} onClick={() => open(part.plan.id)}>
          <Icon name="flag" size={12} />
          <span className={p.stripTitle}>{planTitle(part.plan)}</span>
          <span className={p.stripMilestone}>{part.milestone.title}</span>
          {line ? <Said line={line} className={p.stripNext} /> : null}
        </button>
      </Tip>
    </div>
  );
}
