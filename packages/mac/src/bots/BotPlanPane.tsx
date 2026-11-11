import { Suspense, lazy, useMemo, useState } from 'react';
import { planTitle } from '@beluga/core/plans/model.js';
import { MAC_BOT, botStatusLine } from '@beluga/core/bots/schema.js';
import { Button } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { useT } from '../lib/i18n.js';
import { usePlanActions, usePlanView, usePlans } from '../plans/use-plans.js';
import b from './bots.module.css';

const PlanCanvas = lazy(() => import('../plans/PlanCanvas.js'));

/** The plan a bot is on now (its newest that isn't done), from the shared state's `bots`. */
export function useBotPlan(botId: string | undefined): { readonly planId: string; readonly line?: string } | undefined {
  return useApp((st) => {
    const info = botId ? st.bots.bots.find((x) => x.id === botId) : undefined;
    if (!info?.status) return undefined;
    const line = botStatusLine(info.status);
    return { planId: info.status.planId, ...(line ? { line } : {}) };
  }, (a, c) => a?.planId === c?.planId && a?.line === c?.line);
}

/** Which bot a chat view is: Your Mac's chats are Your Mac's, a bot's view its own. */
export function useBotOfView(): string | undefined {
  return useApp((st) => (st.view.kind === 'assistant' ? MAC_BOT : st.view.kind === 'bot' ? st.view.id : undefined));
}

/**
 * A bot's plan beside its chat (docs/bots.md, Phase 6): the same canvas as the plan's page, with
 * Approve when it waits for you and Open Plan for everything else. Hidden for the session with ×.
 */
export function BotPlanPane({ planId, line, onHide }: { planId: string; line?: string; onHide: () => void }) {
  const plan = usePlans().plans.find((p) => p.id === planId);
  const view = usePlanView(plan);
  const { api, act, open } = usePlanActions();
  const [picked, setPicked] = useState<string>();
  const t = useT();
  const keys = useMemo(() => new Map((view?.milestones ?? []).flatMap((m) => m.tasks.flatMap((t) => (t.issue ? [[t.task.id, t.issue.key] as const] : [])))), [view]);
  // Step by step, you start each ready task from here too; otherwise Beluga starts them.
  const startable = useMemo(() => new Set(plan?.autonomy === 'step' ? (view?.ready ?? []).filter((t) => !t.forYou).map((t) => t.task.id) : []), [view, plan]);
  if (!plan || !view) return null;
  const waiting = Boolean(plan.draft) || plan.status === 'draft';
  return (
    <aside className={b.planPane} aria-label={t('bots.plan.aria')}>
      <div className={b.planHead}>
        <div className={b.planTitle}>
          <strong>{planTitle(plan)}</strong>
          <span>{line ?? t('bots.plan.progress', { done: view.done, total: view.total })}</span>
        </div>
        {waiting ? (
          <Button size="small" variant="primary" icon="check" onClick={() => void act(() => api.approve(plan.id), t('bots.plan.approved'))}>
            {t('bots.plan.approve')}
          </Button>
        ) : null}
        <Button size="small" variant="quiet" icon="external" onClick={() => open(plan.id)}>
          {t('bots.plan.open')}
        </Button>
        <Button size="small" variant="quiet" icon="x" aria-label={t('bots.plan.hide')} onClick={onHide} />
      </div>
      <div className={b.planBody}>
        {view.milestones.length ? (
          <Suspense fallback={<div className={b.planNote}>{t('bots.plan.layingOut')}</div>}>
            <PlanCanvas view={view} keys={keys} selected={picked} onSelect={setPicked} onStart={(taskId) => void act(() => api.startTask(plan.id, taskId))} startable={startable} />
          </Suspense>
        ) : (
          <div className={b.planNote}>{t('bots.plan.writing')}</div>
        )}
      </div>
    </aside>
  );
}

/** A bot's chat, with its plan beside it while it has one (and you didn't hide it). */
export function WithBotPlan({ children }: { children: React.ReactNode }) {
  const bot = useBotOfView();
  const plan = useBotPlan(bot);
  const [hidden, setHidden] = useState<string>();
  const t = useT();
  if (!plan) return <>{children}</>;
  if (hidden === plan.planId)
    return (
      <div className={b.withPlan} style={{ gridTemplateColumns: 'minmax(0, 1fr)', position: 'relative' }}>
        {children}
        <span className={b.showPlan}>
          <Button size="small" variant="quiet" icon="graph" onClick={() => setHidden(undefined)}>
            {t('bots.plan.show')}
          </Button>
        </span>
      </div>
    );
  return (
    <div className={b.withPlan}>
      {children}
      <BotPlanPane planId={plan.planId} {...(plan.line ? { line: plan.line } : {})} onHide={() => setHidden(plan.planId)} />
    </div>
  );
}
