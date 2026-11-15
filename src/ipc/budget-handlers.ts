import type { Session } from '../core/session.js';
import { budgetReached, budgetView, channelBudget, dayBudgets } from '../core/budget/model.js';
import { sendAutomatic } from '../core/triage/launch.js';
import { waitingNeeds } from '../companion/needs-you.js';
import { saveDismissedNeeds, withDismissed } from '../core/dismissed-needs.js';
import { allowMore, budgetDay, cheaperChats, keptAllowances } from '../shared/budget.js';
import { CONTINUE_PROMPT } from '../shared/run-failure.js';
import type { Args, Method } from './api.js';

/** What each `budget.*` method does (see budget-api.ts). */

type BudgetMethod = Extract<Method, `budget.${string}`>;
type BudgetHandlers = { readonly [M in BudgetMethod]: (s: Session, ...args: Args<M>) => unknown };

/** The Needs You item a budget that asks raises in `channel` (companion/needs-you.ts), by the run it stopped. */
export const budgetNeedId = (channel: string, requestId: string): string => `budget:${channel}:${requestId}`;

export const BUDGET_HANDLERS = {
  'budget.status': (s, channel) => {
    const st = s.store.getState();
    const now = Date.now();
    const conversation = channel ? budgetView(st, channel, now) : undefined;
    return { day: dayBudgets(st, now), ...(conversation ? { conversation } : {}) };
  },
  'budget.answer': (s, channel, answer) => {
    const st = s.store.getState();
    const now = Date.now();
    if (answer === 'stop') {
      // It stays stopped: the card goes (the next message there asks again while the budget is reached).
      const live = waitingNeeds(st);
      const ids = live.filter((n) => n.id.startsWith(`budget:${channel}:`)).reduce((acc, n) => withDismissed(acc, n.id, new Set(live.map((x) => x.id))), st.dismissedNeeds);
      s.store.dispatch({ type: 'needs_dismissed', ids });
      saveDismissedNeeds(ids);
      return 'Stopped';
    }
    if (answer === 'continue') {
      // Every budget reached here grows by half of itself (past what's spent), then the run goes on.
      const reached = channelBudget(st, channel, now).lines.filter((l) => l.level === 'over');
      if (!reached.length) throw new Error('No budget is reached in this conversation');
      const allow = { ...st.prefs.budgetAllow };
      for (const line of reached) allow[line.key] = allowMore(line);
      s.setPrefs({ budgetAllow: keptAllowances(allow, budgetDay(now)) });
    } else {
      if (!budgetReached(st, channel, now)) throw new Error('No budget is reached in this conversation');
      s.setPrefs({ budgetCheaper: cheaperChats(st.prefs.budgetCheaper, channel) });
    }
    sendAutomatic(s, () => s.askOwnClaude(CONTINUE_PROMPT, channel, true));
    return answer === 'continue' ? 'Continuing' : 'Continuing cheaper';
  },
} satisfies BudgetHandlers;
