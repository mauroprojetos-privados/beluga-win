import type { AgentRef } from '../../protocol.js';
import type { BoardState } from '../board/model.js';
import { type Plan, planTitle } from '../plans/model.js';
import { type Live, planView } from '../plans/progress.js';
import { type Combo, type Difficulty, type DifficultyCombos, comboAgent, comboForDifficulty, combosIn } from '../routing/model.js';
import type { RuntimeChoice } from '../../shared/agent-runtimes.js';
import { type BotFile, type BotStatus, targetOf } from './schema.js';

/**
 * Where a bot's dispatched work goes, and what the bot is doing (docs/bots.md). Pure: the daemon's
 * pilot asks it when a task of a bot's plan starts, and the sidebar's line is worked out from the
 * same plan view the plan's page draws.
 */

type RoutingIn = { readonly runtimes: readonly RuntimeChoice[]; readonly prefs: { readonly combos?: readonly Combo[]; readonly difficultyCombos?: DifficultyCombos } };

/** What a task of a bot's plan runs on: an agent (a combo's), and the bot it was handed to, if any. */
export interface TaskRoute {
  readonly agent?: AgentRef;
  /** A category pointing to another bot (`supabase` → Supa): its folder's tools, skills and persona go with the run. */
  readonly bot?: string;
  /** In words, for the plan's history: "deep → Strong", "supabase → Supa". */
  readonly why?: string;
}

/**
 * A task's route: its category in the bot's map (a combo, or another bot and that bot's combo),
 * else its difficulty in the bot's own map, else in Settings' (Combos › By how hard a task is).
 * Nothing set: no route (the plan's agent, as before).
 */
export function routeTask(st: RoutingIn, bot: BotFile, task: { readonly category?: string; readonly difficulty?: Difficulty }, botOf: (id: string) => { readonly name: string; readonly file: BotFile } | undefined): TaskRoute {
  const combos = combosIn(st);
  const comboRef = (id: string | undefined): { agent: AgentRef; name: string } | undefined => {
    const c = id ? combos.find((x) => x.id === id) : undefined;
    return c ? { agent: comboAgent(c), name: c.name } : undefined;
  };
  const target = task.category ? bot.categories?.[task.category] : undefined;
  const t = target ? targetOf(target) : undefined;
  if (t?.kind === 'combo') {
    const c = comboRef(t.id);
    if (c) return { agent: c.agent, why: `${task.category} → ${c.name}` };
  }
  if (t?.kind === 'bot') {
    const other = botOf(t.id);
    if (other) {
      const c = comboRef(other.file.combo);
      return { ...(c ? { agent: c.agent } : {}), bot: t.id, why: `${task.category} → ${other.name}` };
    }
  }
  if (task.difficulty) {
    const own = comboRef(bot.difficulty?.[task.difficulty]);
    if (own) return { agent: own.agent, why: `${task.difficulty} → ${own.name}` };
    const settings = comboForDifficulty(st, task.difficulty);
    if (settings) return { agent: settings, why: `${task.difficulty} → ${settings.comboName ?? settings.label}` };
  }
  return {};
}

/** The bot's own agent: its combo (unset or gone: undefined, your agent). */
export function botAgent(st: RoutingIn, bot: BotFile): AgentRef | undefined {
  const c = bot.combo ? combosIn(st).find((x) => x.id === bot.combo) : undefined;
  return c ? comboAgent(c) : undefined;
}

/**
 * What a plan a bot dispatched says about the bot now: how many of its tasks are done, and what it
 * waits on (a task asking you, a milestone's check, a task of yours). A plan that's done says nothing.
 */
export function planStatus(plan: Plan, board: BoardState, live: Live): BotStatus | undefined {
  if (plan.status === 'done' || plan.movedTo) return undefined;
  const title = planTitle(plan);
  if (plan.status === 'draft') return { planId: plan.id, planTitle: title, done: 0, total: 0, draft: true };
  const view = planView(plan, board, live);
  const tasks = view.milestones.flatMap((m) => m.tasks);
  const asking = tasks.find((t) => t.state === 'asking' || t.state === 'stalled');
  const gate = view.milestones.find((m) => m.state === 'gate' || m.state === 'failed');
  const yours = tasks.find((t) => t.forYou && t.state === 'ready');
  const waiting = asking?.task.title ?? (gate ? `${gate.milestone.title} check` : yours?.task.title) ?? (plan.draft ? 'your Approve of the changes' : undefined);
  return { planId: plan.id, planTitle: title, done: view.done, total: view.total, ...(waiting ? { waiting } : {}) };
}
