import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, EmptyActions } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { ActivityCard } from './usage/ActivityCard.js';
import { Breakdown } from './usage/Breakdown.js';
import { CleanupCard } from './usage/CleanupCard.js';
import { EarningsSummaryCard } from './usage/EarningsSummaryCard.js';
import { PlanCard } from './usage/PlanCard.js';
import { type PlanLimit, SessionsCard } from './usage/SessionsCard.js';
import { usagesOf } from '@beluga/agent/usage.js';
import type { AppState } from '@beluga/core/store.js';
import { StatsSection } from './usage/StatsSection.js';
import { CombosCard } from './usage/CombosCard.js';
import { YourCard } from './usage/YourCard.js';
import { Chapter } from './usage/parts.js';
import { useStats } from './usage/use-stats.js';
import { StorageCard } from './usage/StorageCard.js';
import { type SortKey, cleanups, projectRows } from './usage/usage-model.js';
import s from './usage/usage.module.css';
import { useT } from '../lib/i18n.js';

const SORT_KEY = 'beluga.usage.sort';
const isSort = (v: unknown): v is SortKey => v === 'size' || v === 'tokens' || v === 'recent';

/** The breakdown's order, remembered in this window between visits. */
function useSort(): [SortKey, (s: SortKey) => void] {
  const [sort, setSort] = useState<SortKey>(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      return isSort(saved) ? saved : 'size';
    } catch {
      return 'size';
    }
  });
  const choose = useCallback((next: SortKey) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // Private mode: it's only remembered until the window closes.
    }
  }, []);
  return [sort, choose];
}

/** Measures every folder when the view opens (and on request); `measuring` while it runs. */
function useMeasure(): { measuring: boolean; measure: () => void } {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const [measuring, setMeasuring] = useState(true);
  const measure = useCallback(() => {
    setMeasuring(true);
    api.workbench
      .measureDisk()
      .catch((err: unknown) => toast(client, t('views.usage.measureFailed', { error: err instanceof Error ? err.message : String(err) }), 'warn'))
      .finally(() => setMeasuring(false));
  }, [api, client, t]);
  useEffect(measure, [measure]);
  return { measuring, measure };
}

/** The windows your plans report now: a 5-hour session, a week (an API key or a plan without limits: none). */
function planLimits(state: AppState): PlanLimit[] {
  const me = state.peers.find((p) => p.peerId === (state.self?.peerId ?? state.selfId)) ?? state.self;
  return usagesOf(me).flatMap((u) => [...(u.fiveHour ? [{ runtime: u.agent.runtime, kind: 'session' as const }] : []), ...(u.week ? [{ runtime: u.agent.runtime, kind: 'week' as const }] : [])]);
}

/**
 * Usage: your Claude plan's limits (and friends'), what Claude used this week, what connected
 * projects earned (Stripe), your stats (prompts, agent time, worktrees, PRs, by project or agent), and the disk your worktrees take, by project; then every project and worktree side by side, with what
 * can be put away to free space.
 */
export function UsageView() {
  const t = useT();
  const actions = useActions();
  const state = useApp((st) => st);
  const [sort, setSort] = useSort();
  const { measuring, measure } = useMeasure();
  const got = useStats();
  const now = Date.now();
  const rows = projectRows(state, sort);
  // Sizes known: the first measurement came back (or there was one from before).
  const measured = !measuring || rows.some((p) => p.rows.some((r) => r.disk !== undefined));
  if (!state.projects.some((p) => p.root) && !rows.length) {
    return (
      <Empty
        icon="gauge"
        title={t('views.usage.nothing')}
        detail={t('views.usage.nothingDetail')}
        action={
          <EmptyActions>
            <Button variant="primary" icon="plus" onClick={() => actions.run({ type: 'add_project' })}>
              {t('views.usage.addProjects')}
            </Button>
          </EmptyActions>
        }
      />
    );
  }
  return (
    <div className={s.page}>
      <div className={s.inner}>
        {got.stats ? <YourCard state={state} stats={got.stats} now={got.at} /> : <div className={s.heroWait} aria-hidden />}
        <Chapter title={t('views.usage.rightNow')} sub={t('views.usage.rightNowSub')}>
          <div className={s.summaryFit}>
            <div className={s.summary}>
              <PlanCard state={state} now={now} />
              <ActivityCard state={state} now={now} />
              <SessionsCard windows={got.stats?.plan ?? []} limits={planLimits(state)} now={got.at} />
              <EarningsSummaryCard />
            </div>
          </div>
        </Chapter>
        <StatsSection state={state} got={got} />
        {/* Combos (docs/routing.md): what each spent, by the agent each run went to. */}
        <CombosCard />
        <Chapter title={t('views.usage.disk')} sub={t('views.usage.diskSub')}>
          <StorageCard rows={rows} measuring={measuring} measured={measured} onMeasure={measure} />
          {measured ? <CleanupCard items={cleanups(state, rows, now)} state={state} onDone={measure} /> : null}
          <Breakdown state={state} rows={rows} sort={sort} onSort={setSort} measured={measured} now={now} />
        </Chapter>
      </div>
    </div>
  );
}
