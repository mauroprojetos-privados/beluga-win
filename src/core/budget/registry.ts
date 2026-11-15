import type { BudgetGuard } from './guard.js';

/** Which budget guard serves a session (the daemon's), so its runs pass the gate (core/budget/guard.ts). */
const all = new WeakMap<object, BudgetGuard>();

export const attachBudget = (session: object, guard: BudgetGuard): void => void all.set(session, guard);
export const detachBudget = (session: object): void => void all.delete(session);
export const budgetOf = (session: object): BudgetGuard | undefined => all.get(session);
