import { t } from './i18n/index.js';

/**
 * How many conversations your Claude works in at once (Settings › Claude › Working at once). A
 * message past the limit waits for one of them to finish, and its card says so (see slotWait).
 */
export const PARALLEL_RUNS_DEFAULT = 10;
export const PARALLEL_RUNS_MIN = 1;
export const PARALLEL_RUNS_MAX = 30;

export const clampParallelRuns = (n: number | undefined): number =>
  Math.min(PARALLEL_RUNS_MAX, Math.max(PARALLEL_RUNS_MIN, Math.round(Number.isFinite(n) ? (n as number) : PARALLEL_RUNS_DEFAULT)));

/** A message waiting for a free Claude: how many conversations it works in now, and the limit. */
export interface SlotWait {
  readonly running: number;
  readonly limit: number;
}

/** English: the terminal's chat reads it (ui/format.ts); a screen says slotWaitTitle(). */
export const SLOT_WAIT_TITLE = 'Waiting for a free agent';

/** SLOT_WAIT_TITLE in the app's language. */
export const slotWaitTitle = (): string => t('shared.slots.title');

/** The queue's one line: "waiting for a free Claude: 10 other conversations are working". */
export function slotWaitNote(wait: SlotWait): string {
  const n = Math.max(wait.running, wait.limit);
  return t('shared.slots.note', { count: n });
}

/** "Your Claude is working in 10 other conversations (your limit). This one starts as soon as one finishes." English: the terminal and the phone's view read it; a screen says slotWaitLine(). */
export function slotWaitDetail(wait: SlotWait): string {
  const n = Math.max(wait.running, wait.limit);
  return `Your agent is working in ${n} other conversation${n === 1 ? '' : 's'}, your limit at once. This one starts as soon as one of them finishes.`;
}

/** slotWaitDetail in the app's language. */
export function slotWaitLine(wait: SlotWait): string {
  return t('shared.slots.detail', { count: Math.max(wait.running, wait.limit) });
}
