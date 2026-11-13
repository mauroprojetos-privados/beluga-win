import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dueNow, nextRunAt } from '../sentinel/clock.js';
import { type Sentinel, scheduleSentence } from '../sentinel/model.js';
import { Triggers, isEventTrigger } from '../sentinel/triggers/index.js';
import type { TriggerDeps, TriggerEvent } from '../sentinel/triggers/types.js';
import type { Store } from '../store.js';
import { BOT_AUTONOMY_INFO, type BotAutonomy, type BotTrigger, type BotTriggerInfo, type BotTriggerKind } from './schema.js';

/**
 * A bot acting on its own (docs/bots.md, Triggers): on a schedule or an event, with Sentinels' own
 * triggers rather than a scheduler of its own. Schedules are worked out by Sentinels' clock
 * (`dueNow`: a missed slot runs once, or is skipped, as the trigger says), and events are watched by
 * Sentinels' coordinator (`Triggers`: GitHub, Stripe, Sentry, uptime, Beluga's own events), each
 * bot trigger standing in as a sentinel of its own (`bot~<bot>~<trigger>`).
 *
 * A run is a turn in the bot's chat: its message, said to have come from the trigger, so the bot
 * works within its autonomy (Ask First drafts and waits for your Approve). What each trigger saw
 * last and when it ran is kept in ~/.beluga/bot-chats/triggers.json, so a restart neither runs a
 * slot twice nor loses an event watcher's place.
 */

export interface BotTriggersDeps {
  readonly store: Store;
  readonly selfId: () => string;
  /** ~/.beluga/bot-chats: where their state is kept. */
  readonly dir: string;
  /** The bots' triggers now (each bot's bot.json), with what a run needs. */
  readonly bots: () => ReadonlyArray<{ readonly id: string; readonly name: string; readonly autonomy: BotAutonomy; readonly triggers: readonly BotTrigger[]; readonly projectId?: string }>;
  /** Say the message in the bot's chat as you would (`session.submit`) → whether it went. */
  readonly submit: (botId: string, text: string) => boolean;
  /** Where Sentinels' event triggers look (none: only schedules and Run Now; the demo and tests). */
  readonly events?: Omit<TriggerDeps, 'store' | 'selfId'>;
  readonly now?: () => number;
  readonly tz?: string;
  /** How often schedules are looked at (0: never by itself; the tests tick by hand). */
  readonly tickMs?: number;
  /** Something changed that the screens show (a run, trouble). */
  readonly changed?: () => void;
}

interface TriggerState {
  /** The schedule's last slot that ran or was skipped (or when it was turned on). */
  readonly slot?: number;
  /** An event watcher's cursor (Sentinels' own). */
  readonly cursor?: unknown;
  readonly last?: number;
  readonly lastWhat?: string;
  readonly trouble?: string;
}

/** Events closer than this to the trigger's last run are left out (a burst of pushes is one run). */
export const MIN_GAP_MS = 60_000;

const TICK_MS = 30_000;

const keyOf = (bot: string, trigger: string): string => `bot~${bot}~${trigger}`;
const partsOf = (key: string): { bot: string; trigger: string } | undefined => {
  const m = /^bot~([^~]+)~([^~]+)$/.exec(key);
  return m ? { bot: m[1]!, trigger: m[2]! } : undefined;
};

/** A trigger's name: its own, or its trigger in a sentence ("Every day at 7:00"). */
export const triggerName = (t: BotTrigger): string => t.name ?? scheduleSentence(t.trigger);

/** What a bot is told when one of its triggers fires: who started it, what happened, then the message. */
export function triggerMessage(t: BotTrigger, autonomy: BotAutonomy, what: string): string {
  const info = BOT_AUTONOMY_INFO[autonomy];
  return [
    `[Started by your trigger “${triggerName(t)}”: ${what}. The owner isn’t here: work within your autonomy, ${info.label} (${info.hint.toLowerCase()}).]`,
    '',
    t.message,
  ].join('\n');
}

export class BotTriggers {
  private state: Record<string, TriggerState>;
  private readonly events: Triggers | undefined;
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(private readonly deps: BotTriggersDeps) {
    this.state = readJson<Record<string, TriggerState>>(this.file, {});
    this.events = deps.events
      ? new Triggers({
          deps: { ...deps.events, store: deps.store, selfId: deps.selfId, ...(deps.now ? { now: deps.now } : {}) },
          cursor: (key) => this.state[key]?.cursor,
          saveCursor: (key, cursor) => this.put(key, { cursor }),
          fire: (key, e) => this.fireEvent(key, e),
          trouble: (key, words) => {
            if (this.state[key]?.trouble === words) return;
            this.put(key, { trouble: words });
            deps.changed?.();
          },
          webhookState: () => undefined,
          // A bot has no webhook trigger (BOT_TRIGGER_KINDS).
          hook: () => undefined,
        })
      : undefined;
    const every = deps.tickMs ?? TICK_MS;
    if (every > 0) {
      this.timer = setInterval(() => this.tick(), every);
      this.timer.unref?.();
    }
  }

  stop(): void {
    this.closed = true;
    clearInterval(this.timer);
    this.events?.stopAll();
  }

  private get now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private get file(): string {
    return path.join(this.deps.dir, 'triggers.json');
  }

  private put(key: string, patch: Partial<TriggerState>): void {
    const next: TriggerState = { ...this.state[key], ...patch };
    this.state = { ...this.state, [key]: Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as TriggerState };
    writeJson(this.file, this.state);
  }

  private find(key: string): { bot: ReturnType<BotTriggersDeps['bots']>[number]; trigger: BotTrigger } | undefined {
    const p = partsOf(key);
    const bot = p ? this.deps.bots().find((b) => b.id === p.bot) : undefined;
    const trigger = bot?.triggers.find((t) => t.id === p!.trigger);
    return bot && trigger ? { bot, trigger } : undefined;
  }

  /**
   * The bots' triggers now: event watchers started, restarted (a trigger or its project changed) or
   * stopped; a schedule turned on starts counting from now, so it never runs for a slot before it.
   */
  sync(): void {
    if (this.closed) return;
    const now = this.now;
    const all = this.deps.bots().flatMap((b) => b.triggers.map((t) => ({ b, t, key: keyOf(b.id, t.id) })));
    for (const { t, key } of all) if (t.trigger.kind === 'schedule' && !t.off && this.state[key]?.slot === undefined) this.put(key, { slot: now });
    // A trigger turned off and on again counts from then.
    for (const { t, key } of all) if (t.off && this.state[key]?.slot !== undefined) this.put(key, { slot: undefined });
    const gone = Object.keys(this.state).filter((k) => !all.some((x) => x.key === k));
    if (gone.length) {
      this.state = Object.fromEntries(Object.entries(this.state).filter(([k]) => !gone.includes(k)));
      writeJson(this.file, this.state);
    }
    this.events?.sync(
      all
        .filter(({ t }) => isEventTrigger(t.trigger))
        .map(({ b, t, key }): Sentinel => {
          const projectId = t.projectId ?? b.projectId;
          return { id: key, name: triggerName(t), icon: 'bot', trigger: t.trigger, steps: [], access: 'look', limits: { minutes: 30, pauseAfter: 3 }, notify: 'off' as Sentinel['notify'], paused: Boolean(t.off), failures: 0, createdAt: 0, updatedAt: 0, ...(projectId ? { projectId } : {}) };
        }),
    );
  }

  /** The schedules that are due run now (each at most once, however many slots passed). */
  tick(): void {
    if (this.closed) return;
    const now = this.now;
    for (const b of this.deps.bots()) {
      for (const t of b.triggers) {
        if (t.off || t.trigger.kind !== 'schedule') continue;
        const key = keyOf(b.id, t.id);
        const due = dueNow(t.trigger, this.state[key]?.slot ?? now, now, { ...(this.deps.tz ? { tz: this.deps.tz } : {}) });
        if (due.kind === 'skip') this.put(key, { slot: due.slot });
        if (due.kind !== 'run') continue;
        this.put(key, { slot: due.slot });
        this.run(key, due.late ? `the schedule (${scheduleSentence(t.trigger).toLowerCase()}), caught up after it was missed` : `the schedule (${scheduleSentence(t.trigger).toLowerCase()})`);
      }
    }
  }

  private fireEvent(key: string, e: TriggerEvent): void {
    const last = this.state[key]?.last;
    if (last !== undefined && this.now - last < MIN_GAP_MS) return;
    this.run(key, e.summary);
  }

  /** Run Now (any trigger, on or off: you asked). → whether it went. */
  runNow(botId: string, triggerId: string): boolean {
    const key = keyOf(botId, triggerId);
    if (!this.find(key)) throw new Error('That trigger was deleted');
    return this.run(key, 'you, with Run Now');
  }

  private run(key: string, what: string): boolean {
    const hit = this.find(key);
    if (!hit) return false;
    const sent = this.deps.submit(hit.bot.id, triggerMessage(hit.trigger, hit.bot.autonomy, what));
    this.put(key, { last: this.now, lastWhat: what.slice(0, 200) });
    this.deps.changed?.();
    return sent;
  }

  /** A bot's triggers as the Triggers tab and the phone show them. */
  infoOf(botId: string, triggers: readonly BotTrigger[]): BotTriggerInfo[] {
    const now = this.now;
    return triggers.map((t): BotTriggerInfo => {
      const s = this.state[keyOf(botId, t.id)] ?? {};
      const next = !t.off && t.trigger.kind === 'schedule' ? nextRunAt(t.trigger, s.slot ?? now, now, this.deps.tz) : undefined;
      return {
        id: t.id,
        name: triggerName(t),
        kind: t.trigger.kind as BotTriggerKind,
        off: Boolean(t.off),
        ...(next !== undefined ? { next } : {}),
        ...(s.last !== undefined ? { last: s.last } : {}),
        ...(s.lastWhat ? { lastWhat: s.lastWhat } : {}),
        ...(s.trouble && !t.off ? { trouble: s.trouble } : {}),
      };
    });
  }

  /** Which watchers run now (the tests). */
  watching(): string[] {
    return this.events?.watching() ?? [];
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
