import { RemoteList } from '../machines/RemoteList.js';
import { remotePlans } from '../machines/remote-work.js';
import { useRemoteSources } from '../machines/use-remote.js';
import { useEffect, useMemo } from 'react';
import type { Plan } from '@beluga/core/plans/model.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { Button, Empty, EmptyActions, IconButton, cx } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { currentSheet, openSheet } from '../lib/sheets.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { ago, projectToShow } from '../tasks/tasks-model.js';
import { useBoard, useTasksPrefs } from '../tasks/use-tasks.js';
import { MilestoneBar, TonePill } from './marks.js';
import { bars, nextWords, planStatus, plansOf, titleOf } from './plans-model.js';
import { usePlanActions, usePlanView, usePlans } from './use-plans.js';
import p from './plans.module.css';
import v from './PlansView.module.css';
import { SharedPlansList } from '../team/SharedPlans.js';
import { isShortcut } from '../lib/shortcuts.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { NoProjects } from '../work/NoProjects.js';
import { useT } from '../lib/i18n.js';

/**
 * Plans: one project's at a time (the one you're in, like Tasks). Each is a row with how far it
 * got and what it waits for; New Plan (⌘N) starts one with Claude.
 */
export function PlansView() {
  const state = usePlans();
  const t = useT();
  const board = useBoard();
  const prefs = useTasksPrefs();
  const view = useApp((s) => s.view);
  const all = useApp((s) => s.projects);
  const projects = useMemo(() => all.filter((x) => x.root && !x.error), [all]);
  const { openList } = usePlanActions();
  const project = projectToShow(board, projects, view.kind === 'plans' ? view.projectId : undefined, prefs.project);
  const here = projects.find((x) => x.id === project);
  const plans = plansOf(state, project);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || currentSheet()) return;
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]');
      if (!typing && isShortcut('page-new', e)) {
        e.preventDefault();
        e.stopPropagation();
        openSheet({ kind: 'new_plan', ...(project ? { projectId: project } : {}) });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [project]);

  if (!state.enabled) return <Empty icon="flag" title={t('plans.v.needsApp')} detail={t('plans.v.needsAppDetail')} />;
  if (!here) return <NoProjects icon="flag" detail={t('plans.v.noProjects')} />;
  return (
    <div className={p.list}>
      <div className={p.listBar}>
        <span className={v.caption}>{t('plans.v.plansIn')}</span>
        <PickMenu<string> label={t('tasks.project')} choices={projects.map((x) => ({ value: x.id, label: x.name, mark: <ProjectIcon id={x.id} name={x.name} size={16} /> }))} chosen={[here.id]} onPick={(id) => openList(id)}>
          <button type="button" className={cx(p.projectSwitch, v.switch)} aria-label={t('plans.v.projectAria', { name: here.name })} title={t('plans.v.switchProject')}>
            <ProjectIcon id={here.id} name={here.name} size={18} />
            <span>{here.name}</span>
            <Icon name="chevronDown" size={11} />
          </button>
        </PickMenu>
        <span className={p.grow} />
        <ActionsDropdown items={[{ label: t('plans.planningStyle'), onSelect: () => openSheet({ kind: 'plan_style' }) }]}>
          <IconButton icon="more" label={t('plans.v.options')} />
        </ActionsDropdown>
        <Button variant="primary" size="small" icon="plus" onClick={() => openSheet({ kind: 'new_plan', projectId: here.id })} title={shortcutKeys('page-new') ? t('plans.v.newPlanKeys', { keys: shortcutKeys('page-new') ?? '' }) : t('plans.s.newPlan')}>
          {t('plans.s.newPlan')}
        </Button>
      </div>
      {plans.length ? (
        <ul className={p.rows} aria-label={t('plans.v.plans')}>
          {plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} />
          ))}
        </ul>
      ) : (
        <Empty
          icon="flag"
          mark={<ProjectIcon id={here.id} name={here.name} size={28} />}
          title={t('plans.v.noPlans', { name: here.name })}
          detail={t('plans.v.noPlansDetail')}
          action={
            <EmptyActions>
              <Button variant="primary" icon="plus" onClick={() => openSheet({ kind: 'new_plan', projectId: here.id })}>
                {t('plans.s.planIn', { name: here.name })}
              </Button>
            </EmptyActions>
          }
        />
      )}
      <SharedPlansList projectId={here.id} />
      {/* The same project's plans on your computers (BLG-785). */}
      <RemotePlans project={here.name} />
    </div>
  );
}

function PlanRow({ plan }: { plan: Plan }) {
  const view = usePlanView(plan)!;
  const { open } = usePlanActions();
  const t = useT();
  const status = planStatus(view);
  const next = nextWords(view.next);
  return (
    <li>
      <button type="button" className={p.row} onClick={() => open(plan.id)} aria-label={t('plans.o.taskAria', { title: titleOf(plan), state: status.label })}>
        <span className={p.rowMain}>
          <span className={p.rowTitle}>{titleOf(plan)}</span>
          <span className={p.rowSub}>{plan.body ? (next.detail ? `${next.title} · ${next.detail}` : next.title) : t('plans.v.draftLine', { milestones: view.milestones.length, tasks: view.total })}</span>
        </span>
        {view.milestones.length && plan.body ? <MilestoneBar items={bars(view)} /> : null}
        <TonePill tone={status.tone} live={status.tone === 'claude'}>
          {status.label}
        </TonePill>
        <span className={p.rowWhen}>{ago(plan.updatedAt)}</span>
      </button>
    </li>
  );
}

/** The plans of the project of this name on your computers, tagged. */
function RemotePlans({ project }: { project: string }) {
  const sources = useRemoteSources();
  const t = useT();
  const rows = useMemo(() => remotePlans(sources).filter((t) => t.item.project === project).map((t) => ({ ...t, item: { id: t.item.id, title: t.item.title, sub: t.item.status, page: { kind: 'plan' as const, id: t.item.id } } })), [sources, project]);
  return <RemoteList title={t('plans.v.onYourComputers')} rows={rows} />;
}

