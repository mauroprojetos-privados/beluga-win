import { type ReactNode, useState } from 'react';
import type { PlanReview, SharedPlan } from '@beluga/core/team/model.js';
import { teammatesOf } from '@beluga/core/team/model.js';
import { Icon } from '../components/Icon.js';
import { ActionsDropdown, type ActionItem } from '../components/SpecMenu.js';
import { Avatar, Button, Empty, IconButton, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { ago } from '../tasks/tasks-model.js';
import p from '../plans/plans.module.css';
import s from './shared-plans.module.css';
import { primaryKey } from '../lib/shortcuts-model.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';

/**
 * Plans shared within a team (BLG-225). Yours: Share Plan with Team in the plan's •••, and Team
 * Reviews on its page (comments, approvals, suggested changes with Apply). A teammate's: listed in
 * Plans under "Shared by your team", and its own page, read-only, where you approve (the one main
 * action), comment, or suggest a change to a task.
 */

function useSay(): <T>(p: Promise<T>, done?: string) => Promise<T | undefined> {
  const { client } = useBeluga();
  return async (pr, done) => {
    try {
      const r = await pr;
      if (done) toast(client, done, 'success');
      return r;
    } catch (err) {
      toast(client, err instanceof Error ? err.message : String(err), 'error');
      return undefined;
    }
  };
}

/** The plan's ••• items: Share Plan with Team / Stop Sharing with Team (only when the project is a team's). */
export function usePlanTeamItems(planId: string, projectId: string): readonly ActionItem[] {
  useT();
  const mates = useApp((st) => teammatesOf(st.team, projectId), sameDeep);
  const shared = useApp((st) => Boolean(st.team.planShares[planId]));
  const api = useApi();
  const say = useSay();
  if (!mates.length && !shared) return [];
  return [shared ? { label: t('network.splans.stopSharing'), icon: 'people', separate: true, onSelect: () => void say(api.team.sharePlan(planId, false)) } : { label: t('network.splans.share'), icon: 'people', separate: true, onSelect: () => void say(api.team.sharePlan(planId, true)) }];
}

const reviewWords = (r: PlanReview): string => (r.kind === 'approve' ? t('network.splans.approvedIt') : r.kind === 'suggest' ? t('network.splans.suggests', { count: r.ops?.length ?? 0 }) : t('network.splans.commented'));

/** What one suggested op changes, in words. */
function opWords(op: unknown): string {
  const o = op as { op?: string; id?: string; patch?: { title?: string; goal?: string }; title?: string; milestone?: unknown };
  switch (o.op) {
    case 'update_task':
      return `${o.patch?.title ? t('network.splans.changeTo', { id: o.id ?? '', title: o.patch.title }) : t('network.splans.change', { id: o.id ?? '' })}${o.patch?.goal ? `: ${o.patch.goal}` : ''}`;
    case 'add_task':
      return t('network.splans.addTask');
    case 'remove_task':
      return t('network.splans.takeOut', { id: o.id ?? '' });
    case 'retitle':
      return o.title ? t('network.splans.renameTo', { title: o.title }) : t('network.splans.rename');
    default:
      return o.op ? o.op.replace(/_/g, ' ') : t('network.splans.aChange');
  }
}

function ReviewRow({ r, trailing }: { r: PlanReview; trailing?: ReactNode }) {
  const t = useT();
  return (
    <li className={s.review}>
      <Avatar name={r.name} id={r.by} size={22} />
      <div className={s.reviewMain}>
        <div className={s.reviewHead}>
          <strong>{r.name}</strong> {reviewWords(r)}
          {r.kind === 'approve' ? <Icon name="check" size={12} /> : null}
          <span className={s.when}>{ago(r.at)}</span>
          {r.settled ? <span className={s.settled}>{r.settled === 'applied' ? t('network.splans.applied') : t('network.splans.setAside')}</span> : null}
        </div>
        {r.text ? <div className={s.reviewText}>{r.text}</div> : null}
        {r.ops?.length ? (
          <ul className={s.ops}>
            {r.ops.map((op, i) => (
              <li key={i}>{opWords(op)}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {trailing ? <span className={s.reviewButtons}>{trailing}</span> : null}
    </li>
  );
}

/** Your plan's reviews from the team: Apply on a suggestion (Set Aside in its •••). */
export function TeamReviews({ planId }: { planId: string }) {
  const t = useT();
  const share = useApp((st) => st.team.planShares[planId], sameDeep);
  const api = useApi();
  const say = useSay();
  if (!share) return null;
  const names = share.peers.length ? t('network.splans.sharedWithTeam') : t('network.splans.sharedNobody');
  return (
    <section className={s.panel} aria-label={t('network.splans.teamReviews')}>
      <div className={s.panelHead}>
        <Icon name="people" size={13} />
        <span>{names}</span>
        <span className={s.when}>{share.reviews.length ? t('network.splans.reviews', { count: share.reviews.length }) : t('network.splans.noReviews')}</span>
      </div>
      {share.reviews.length ? (
        <ul className={s.reviews}>
          {share.reviews.map((r) => (
            <ReviewRow
              key={r.id}
              r={r}
              trailing={
                r.kind === 'suggest' && !r.settled ? (
                  <>
                    <Button size="small" variant="primary" onClick={() => void say(api.team.applySuggestion(planId, r.id), t('network.splans.appliedSuggestion'))}>
                      {t('network.splans.apply')}
                    </Button>
                    <ActionsDropdown items={[{ label: t('network.splans.setAsideMenu'), onSelect: () => void say(api.team.dismissSuggestion(planId, r.id)) }]}>
                      <IconButton icon="more" label={t('common.more')} />
                    </ActionsDropdown>
                  </>
                ) : undefined
              }
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** "Shared by your team" in Plans: teammates' plans for this project. */
export function SharedPlansList({ projectId }: { projectId: string }) {
  const t = useT();
  const plans = useApp((st) => st.team.plans.filter((x) => x.projectId === projectId), sameDeep);
  const actions = useActions();
  if (!plans.length) return null;
  return (
    <>
      <div className={s.caption}>{t('network.splans.sharedByTeam')}</div>
      <ul className={p.rows} aria-label={t('network.splans.plansSharedByTeam')}>
        {plans.map((plan) => (
          <li key={`${plan.owner}/${plan.id}`}>
            <button type="button" className={p.row} onClick={() => actions.run({ type: 'view', view: { kind: 'team_plan', owner: plan.owner, id: plan.id } })} aria-label={t('network.splans.rowAria', { title: plan.title, name: plan.ownerName })}>
              <Avatar name={plan.ownerName} id={plan.owner} size={20} />
              <span className={p.rowMain}>
                <span className={p.rowTitle}>{plan.title}</span>
                <span className={p.rowSub}>
                  {t('network.splans.rowSub', { name: plan.ownerName, milestones: plan.body.milestones.length, tasks: plan.body.milestones.reduce((n, m) => n + m.tasks.length, 0), status: plan.status === 'draft' ? t('network.splans.draft') : plan.status === 'active' ? t('network.splans.running') : t('network.splans.done') })}
                </span>
              </span>
              <span className={p.rowWhen}>{ago(plan.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A teammate's plan, read-only: Approve (the main action), a comment, a change suggested on a task. */
export function SharedPlanPage({ owner, id }: { owner: string; id: string }) {
  const t = useT();
  const plan = useApp((st) => st.team.plans.find((x) => x.owner === owner && x.id === id), sameDeep);
  const self = useApp((st) => st.selfId);
  const actions = useActions();
  const api = useApi();
  const say = useSay();
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState<string | undefined>();
  if (!plan) return <Empty icon="flag" title={t('network.splans.goneTitle')} detail={t('network.splans.goneDetail')} />;
  const approved = plan.reviews.some((r) => r.by === self && r.kind === 'approve' && r.rev === plan.rev);
  const send = (): void => {
    if (!comment.trim()) return;
    void say(api.team.reviewPlan(owner, id, { kind: 'comment', text: comment.trim() })).then((r) => r && setComment(''));
  };
  const back = (): void => actions.run({ type: 'view', view: { kind: 'plans', projectId: plan.projectId } });
  return (
    <div className={s.page}>
      <header className={s.head}>
        <IconButton icon="back" label={t('network.splans.allPlans')} onClick={back} />
        <div className={s.headMain}>
          <h1 className={s.title}>{plan.title}</h1>
          <div className={s.meta}>
            <Avatar name={plan.ownerName} id={plan.owner} size={14} />
            {t('network.splans.meta', { name: plan.ownerName, status: plan.status === 'draft' ? t('network.splans.aDraft') : plan.status === 'active' ? t('network.splans.approvedRunning') : t('network.splans.done') })}
          </div>
        </div>
        <Button variant="primary" size="small" icon="check" disabled={approved} onClick={() => void say(api.team.reviewPlan(owner, id, { kind: 'approve' }), t('network.splans.told', { name: plan.ownerName }))}>
          {approved ? t('network.splans.approved') : t('network.splans.approve')}
        </Button>
      </header>
      {plan.body.goal ? <p className={s.goal}>{plan.body.goal}</p> : null}
      <ol className={s.milestones}>
        {plan.body.milestones.map((m) => (
          <li key={m.id} className={s.milestone}>
            <div className={s.mTitle}>
              <Icon name="flag" size={13} />
              {m.title}
            </div>
            {m.goal ? <div className={s.mGoal}>{m.goal}</div> : null}
            {m.criteria.length ? (
              <ul className={s.criteria}>
                {m.criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : null}
            <ul className={s.tasks}>
              {m.tasks.map((task) => (
                <li key={task.id} className={cx(s.task, editing === task.id && s.taskEditing)}>
                  <div className={s.taskLine}>
                    <Icon name="task" size={12} />
                    <span className={s.taskTitle}>{task.title}</span>
                    {task.assignee === 'me' ? <span className={s.when}>{t('network.splans.forName', { name: plan.ownerName })}</span> : null}
                    <ActionsDropdown items={[{ label: t('network.splans.suggestChange'), icon: 'pencil', onSelect: () => setEditing(task.id) }]}>
                      <IconButton icon="more" label={t('network.splans.moreFor', { title: task.title })} />
                    </ActionsDropdown>
                  </div>
                  {task.goal ? <div className={s.taskGoal}>{task.goal}</div> : null}
                  {editing === task.id ? <Suggest plan={plan} task={task} onDone={() => setEditing(undefined)} /> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <section className={s.panel} aria-label={t('network.splans.reviewsAria')}>
        <div className={s.panelHead}>
          <Icon name="chat" size={13} />
          <span>{t('network.splans.teamSaid')}</span>
        </div>
        {plan.reviews.length ? (
          <ul className={s.reviews}>
            {plan.reviews.map((r) => (
              <ReviewRow key={r.id} r={r} />
            ))}
          </ul>
        ) : null}
        <div className={s.compose}>
          <textarea
            className={s.input}
            value={comment}
            placeholder={t('network.splans.commentFor', { name: plan.ownerName })}
            rows={2}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && primaryKey(e)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button size="small" disabled={!comment.trim()} onClick={send}>
            {t('network.splans.comment')}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** A change to one task, suggested: its title and goal as you'd have them. */
function Suggest({ plan, task, onDone }: { plan: SharedPlan; task: SharedPlan['body']['milestones'][number]['tasks'][number]; onDone: () => void }) {
  const t = useT();
  const api = useApi();
  const say = useSay();
  const [title, setTitle] = useState(task.title);
  const [goal, setGoal] = useState(task.goal ?? '');
  const [why, setWhy] = useState('');
  const changed = title.trim() !== task.title || goal.trim() !== (task.goal ?? '');
  const go = (): void => {
    const patch = { ...(title.trim() !== task.title ? { title: title.trim() } : {}), ...(goal.trim() !== (task.goal ?? '') ? { goal: goal.trim() } : {}) };
    void say(api.team.reviewPlan(plan.owner, plan.id, { kind: 'suggest', ops: [{ op: 'update_task', id: task.id, patch }], ...(why.trim() ? { text: why.trim() } : {}) }), t('network.splans.suggestedTo', { name: plan.ownerName })).then((r) => r && onDone());
  };
  return (
    <div className={s.suggest}>
      <input className={s.input} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('network.splans.title')} />
      <textarea className={s.input} value={goal} rows={3} onChange={(e) => setGoal(e.target.value)} aria-label={t('network.splans.goal')} placeholder={t('network.splans.whatFor')} />
      <input className={s.input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('network.splans.whyOptional')} aria-label={t('network.splans.why')} />
      <div className={s.suggestBar}>
        <Button size="small" variant="quiet" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button size="small" variant="primary" disabled={!changed || !title.trim()} onClick={go}>
          {t('network.splans.suggest')}
        </Button>
      </div>
    </div>
  );
}
