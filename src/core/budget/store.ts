import { budgetDay } from '../../shared/budget.js';

/**
 * What your runs spent outside a workspace (a bot's chats, Your Mac's, the Sentinel chat's), for the
 * budgets (shared/budget.ts). A workspace's conversation keeps its own usage (workspaces/types.ts
 * WorkspaceUsage, with its days), so it isn't counted here twice. Kept in the state so the screens
 * read the same numbers, and saved in ~/.beluga/spend.json (core/budget/guard.ts). Pure.
 */
export interface SpendLedger {
  /** The local day `today` counts ("2026-11-15"). */
  readonly day: string;
  /** Tokens each conversation spent today. */
  readonly today: Readonly<Record<string, number>>;
  /** Tokens each conversation spent, over its life. */
  readonly total: Readonly<Record<string, number>>;
}

/** Conversations the ledger keeps, at most (the oldest go first). */
export const SPEND_CHANNELS_MAX = 400;

export interface SpendSlice {
  readonly spend: SpendLedger;
}

export const EMPTY_SPEND: SpendLedger = { day: '', today: {}, total: {} };

export const initialSpend: SpendSlice = { spend: EMPTY_SPEND };

/** The ledger as saved (spend.json), or set back to it. */
export type SpendAction = { type: 'spend'; spend: SpendLedger };

/** Whether a channel's usage goes in the ledger: your runs outside a workspace. */
export const ledgerCounts = (channel: string): boolean => !channel.startsWith('ws:') && channel !== 'room';

const keepLast = (rec: Readonly<Record<string, number>>, channel: string, value: number): Record<string, number> => {
  const { [channel]: _old, ...rest } = rec;
  const entries = [...Object.entries(rest), [channel, value] as const];
  return Object.fromEntries(entries.slice(-SPEND_CHANNELS_MAX));
};

/** `tokens` spent in `channel` at `at`: today's (a new day starts empty) and its total. */
export function addSpend(ledger: SpendLedger, channel: string, tokens: number, at: number): SpendLedger {
  if (!(tokens > 0) || !ledgerCounts(channel)) return ledger;
  const day = budgetDay(at);
  const today = ledger.day === day ? ledger.today : {};
  return { day, today: keepLast(today, channel, (today[channel] ?? 0) + tokens), total: keepLast(ledger.total, channel, (ledger.total[channel] ?? 0) + tokens) };
}

/** A saved ledger read back: anything that isn't one reads as empty. */
export function readSpend(raw: unknown): SpendLedger {
  if (!raw || typeof raw !== 'object') return EMPTY_SPEND;
  const r = raw as Partial<SpendLedger>;
  const nums = (v: unknown): Record<string, number> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] >= 0).slice(-SPEND_CHANNELS_MAX)) : {});
  return { day: typeof r.day === 'string' ? r.day : '', today: nums(r.today), total: nums(r.total) };
}
