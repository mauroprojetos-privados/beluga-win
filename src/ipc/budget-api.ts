import { z } from 'zod';
import { BUDGET_ANSWERS } from '../shared/budget.js';

/**
 * Token budgets (shared/budget.ts, docs/budget.md): how far each one has got, for a conversation and
 * for the day, and answering a budget's Needs You. Reading and answering are the phone's too;
 * setting budgets is Settings › Agent › Budget on the Mac (`session.setPrefs`), a project's
 * beluga.json and a bot's bot.json. Browser-safe: zod only.
 */

const channel = z.string().min(1).max(200);

export const BUDGET_API = {
  // The day's budgets (yours, each project's and bot's that has one, and your plan's 5-hour window),
  // and, given a conversation, its own. → { day: DayBudgets, conversation?: BudgetView }
  'budget.status': { args: z.tuple([channel.optional()]) },
  // A budget's Needs You answered: `continue` (half the budget again, then on as it was), `cheaper`
  // (on, past the budget, on a cheaper target) or `stop` (it stays stopped; the card goes). → what it did, in words
  'budget.answer': { args: z.tuple([channel, z.enum(BUDGET_ANSWERS)]) },
} as const;
