import { Icon } from '../components/Icon.js';
import { Segmented } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp } from '../lib/beluga.js';
import { useT } from '../lib/i18n.js';
import type { View } from '@beluga/core/store.js';
import { Row } from '../layout/sidebar-parts.js';
import { PlanSideRows } from '../plans/PlansNav.js';
import { projectOfView } from '../tasks/use-tasks.js';
import w from './work.module.css';

/**
 * Work: Tasks, Issues, Pull Requests, Actions and Plans behind one sidebar row (BLG-197), so the sidebar stays short.
 * The row opens the one you used last; a switch over each list moves between them. Running plans
 * still show under the row.
 */

export type WorkPage = 'tasks' | 'issues' | 'pulls' | 'actions' | 'plans';

const KEY = 'beluga.work.last';
const lastPage = (): WorkPage => {
  const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  return v === 'issues' || v === 'pulls' || v === 'actions' || v === 'plans' ? v : 'tasks';
};
const remember = (p: WorkPage): void => {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    // Private storage: it just opens Tasks next time.
  }
};

/** Which of Work's pages a view belongs to (a task, an issue or a plan counts as its list). */
export function workPageOf(view: View): WorkPage | undefined {
  if (view.kind === 'tasks' || view.kind === 'task') return 'tasks';
  if (view.kind === 'issues' || view.kind === 'gh_issue') return 'issues';
  if (view.kind === 'pulls') return 'pulls';
  if (view.kind === 'actions' || view.kind === 'gh_run') return 'actions';
  if (view.kind === 'plans' || view.kind === 'plan') return 'plans';
  return undefined;
}

function useOpenWork(): (page: WorkPage) => void {
  const actions = useActions();
  const here = useApp(projectOfView);
  return (page) => {
    remember(page);
    const at = page !== 'tasks' && here ? { projectId: here } : {};
    actions.run({ type: 'view', view: { kind: page, ...at } as View });
  };
}

export function WorkNav() {
  const t = useT();
  const open = useOpenWork();
  const board = useApp((s) => s.board.enabled);
  const plans = useApp((s) => s.plans.enabled);
  const page = useApp((s) => workPageOf(s.view));
  const running = useApp((s) => s.plans.plans.filter((x) => x.status === 'active').length);
  if (!board && !plans) return null;
  const pick = (): WorkPage => {
    const last = lastPage();
    return (last === 'plans' ? plans : board) ? last : board ? 'tasks' : 'plans';
  };
  return (
    <>
      <Row
        icon={<Icon name="task" size={14} />}
        label={t('components.work.work')}
        detail={running ? t('components.work.detailRunning', { count: running }) : t('components.work.detail')}
        selected={page !== undefined}
        onClick={() => open(pick())}
      />
      {plans ? <PlanSideRows /> : null}
    </>
  );
}

/** The switch over Tasks, Issues, Pull Requests, Actions and Plans: the lists of Work. */
export function WorkSwitch({ page }: { page: WorkPage }) {
  const t = useT();
  const open = useOpenWork();
  const board = useApp((s) => s.board.enabled);
  const plans = useApp((s) => s.plans.enabled);
  const options = [
    ...(board ? [{ value: 'tasks' as const, label: t('components.work.tasks'), icon: 'task' as const }, { value: 'issues' as const, label: t('components.work.issues'), icon: 'issue' as const }, { value: 'pulls' as const, label: t('components.work.pulls'), icon: 'pr' as const }, { value: 'actions' as const, label: t('components.work.actions'), icon: 'pulse' as const }] : []),
    ...(plans ? [{ value: 'plans' as const, label: t('components.work.plans'), icon: 'flag' as const }] : []),
  ];
  if (options.length < 2) return null;
  return (
    <div className={w.switch}>
      <Segmented<WorkPage> label={t('components.work.work')} value={page} onChange={open} options={options} />
    </div>
  );
}

/** A Work list with its switch above it. */
export function WorkFrame({ page, children }: { page: WorkPage; children: React.ReactNode }) {
  return (
    <div className={w.frame}>
      <WorkSwitch page={page} />
      <div className={w.page}>{children}</div>
    </div>
  );
}
