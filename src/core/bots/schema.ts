import { z } from 'zod';
import { COMBO_ID, DIFFICULTIES, type Difficulty, DifficultyCombos } from '../routing/model.js';
import { ASSISTANT_CHANNEL, CHAT_ID } from '../../shared/assistant.js';
import { TriggerSchema } from '../sentinel/schema.js';
import type { Trigger } from '../sentinel/model.js';

/**
 * Bots (docs/bots.md, routing Phases 6, 6b and 6c): persistent, named conversations that plan and
 * dispatch work instead of doing it. Your Mac is the first one (`mac`); the others are folders in
 * ~/.beluga/bots/<id>/. A bot's folder is the source of truth: `bot.json` (this schema) holds what
 * has no natural place in Claude Code's own files (`CLAUDE.md`, `.mcp.json`, `.claude/skills`,
 * `.claude/agents`), so the folder still works outside Beluga.
 *
 * Browser-safe: zod, routing's model and shared/ only. The daemon, the Mac, the web and the phone
 * read the same shapes.
 */

/** bot.json's format. A newer Beluga's file is read for what this one knows, and said so. */
export const BOT_FILE_VERSION = 1;

/** Your Mac's id as a bot: always there, never deleted, its folder is ~/.beluga/assistant/work. */
export const MAC_BOT = 'mac';

/** A bot's id: its folder's name, safe in a channel (`bot:<id>`) and a value (`bot:<id>`). */
export const BOT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** The most bots Beluga keeps (Your Mac included). */
export const MAX_BOTS = 40;

/**
 * How far a bot goes on its own with a plan it dispatches (the modes plans already have):
 * - `ask`: it drafts the plan and waits for your approval (the plan's own Approve);
 * - `run-stop-on-fail`: it approves and runs it, stopping at each milestone check that fails;
 * - `autopilot`: it approves and runs it through to the end.
 */
export const BOT_AUTONOMIES = ['ask', 'run-stop-on-fail', 'autopilot'] as const;
export type BotAutonomy = (typeof BOT_AUTONOMIES)[number];

export const BOT_AUTONOMY_INFO: Readonly<Record<BotAutonomy, { readonly label: string; readonly hint: string }>> = {
  ask: { label: 'Ask First', hint: 'It drafts the plan and waits for your Approve' },
  'run-stop-on-fail': { label: 'Run, Stop on Failure', hint: 'It approves and runs the plan, and stops where a check fails' },
  autopilot: { label: 'Autopilot', hint: 'It runs the plan through to the end on its own' },
};

/**
 * A kind of work a bot dispatches (`quick`, `deep`, `visual`, `review`, `supabase`…): lowercase,
 * free-form, so a category routing Phase 3 adds by name and one you make up both fit.
 */
export const CATEGORY = /^[a-z][a-z0-9-]{0,31}$/;

/** Categories the Model tab suggests (oh-my-hermes' own): any other name works too. */
export const SUGGESTED_CATEGORIES = ['quick', 'deep', 'ultrabrain', 'visual', 'review', 'docs'] as const;

/** Where a category's work goes: a combo (`combo:<id>`) or another bot (`bot:<id>`). */
export const BotTarget = z.string().regex(/^(combo|bot):[a-z0-9][a-z0-9-]{0,31}$/);
export type BotTarget = z.infer<typeof BotTarget>;

export const targetOf = (t: string): { readonly kind: 'combo' | 'bot'; readonly id: string } | undefined => {
  const m = /^(combo|bot):([a-z0-9][a-z0-9-]{0,31})$/.exec(t);
  return m ? { kind: m[1] as 'combo' | 'bot', id: m[2]! } : undefined;
};

// ---------------------------------------------------------------- triggers

/**
 * The Sentinel triggers a bot can act on by itself (docs/bots.md, Triggers): a schedule, Run Now
 * only, or an event Sentinels already watch. Not `after` (that's a sentinel's run) nor `webhook` (its
 * address and secret are a sentinel's): a sentinel with a "Message" step covers those.
 */
export const BOT_TRIGGER_KINDS = ['schedule', 'manual', 'beluga', 'github', 'stripe', 'uptime', 'sentry'] as const;
export type BotTriggerKind = (typeof BOT_TRIGGER_KINDS)[number];

/** The most triggers a bot keeps. */
export const MAX_BOT_TRIGGERS = 20;

/** A trigger's id: short, a slug (bot.json's key for it, and its state's). */
export const TRIGGER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * One of a bot's triggers: the same shape a sentinel's trigger has (`trigger`), plus what the bot is
 * told when it fires (`message`), the project its event is watched in (GitHub, Stripe, Sentry), and
 * whether it's off. A run is a turn in the bot's chat, within its autonomy.
 */
export const BotTrigger = z.object({
  id: z.string().regex(TRIGGER_ID),
  /** Its name in the Triggers tab ("Nightly deploy"); the trigger's own sentence when unset. */
  name: z.string().trim().min(1).max(80).optional(),
  trigger: TriggerSchema.refine((t) => (BOT_TRIGGER_KINDS as readonly string[]).includes(t.kind), { message: 'a bot’s trigger is a schedule, Run Now or an event (not after a sentinel or a webhook)' }),
  /** What the bot gets when it fires ("check staging and deploy if green"). */
  message: z.string().trim().min(1).max(4000),
  /** The project whose events it watches (GitHub, Stripe, Sentry); none: the bot's first project. */
  projectId: z.string().min(1).max(200).optional(),
  /** Off: kept, never fires. */
  off: z.boolean().optional(),
});
export type BotTrigger = z.infer<typeof BotTrigger>;

/** What a trigger is doing, as the Triggers tab and the phone show it. */
export interface BotTriggerInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: BotTriggerKind;
  readonly off: boolean;
  /** The next scheduled run (schedules only). */
  readonly next?: number;
  /** When it last fired, and what it said. */
  readonly last?: number;
  readonly lastWhat?: string;
  /** Why it can't watch (no gh, no key), in words. */
  readonly trouble?: string;
}

/** The soonest run of a bot's triggers that are on (the phone's "Next run"). */
export const nextRunOf = (triggers: readonly BotTriggerInfo[]): number | undefined =>
  triggers.reduce<number | undefined>((soonest, t) => (!t.off && t.next !== undefined && (soonest === undefined || t.next < soonest) ? t.next : soonest), undefined);

export type { Trigger };

/** A colour of the phone's and the Mac's soft palette (`#rrggbb`). */
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** bot.json, as written. Every field but `version` is optional: an empty file is "not set up". */
export const BotFile = z.object({
  version: z.number().int().min(1),
  /** Its name in the sidebar ("Supa"); Your Mac's is the computer's own when unset. */
  name: z.string().trim().min(1).max(40).optional(),
  /** One of the app's icon names ("bot", "database"); the bot's own default when unset. */
  icon: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).optional(),
  color: z.string().regex(COLOR).optional(),
  /** What it's for, in a line: the sidebar's hint, and how Your Mac knows what to hand it. */
  description: z.string().trim().max(300).optional(),
  /** The combo it thinks and talks with (unset: your agent). */
  combo: z.string().regex(COMBO_ID).optional(),
  /** Category → where its tasks go (a combo, or another bot). */
  categories: z.record(z.string().regex(CATEGORY), BotTarget).optional(),
  /** How hard → combo, for tasks it dispatches without a category (unset: Settings' own map). */
  difficulty: DifficultyCombos.optional(),
  autonomy: z.enum(BOT_AUTONOMIES).optional(),
  /** Projects it may act in (ids); empty: any, as Your Mac. */
  projects: z.array(z.string().min(1).max(200)).max(50).optional(),
  /** What it does on its own: on a schedule or an event (Sentinels' triggers), each with its message. */
  triggers: z.array(BotTrigger).max(MAX_BOT_TRIGGERS).optional(),
});
export type BotFile = z.infer<typeof BotFile>;

/** A bot.json with nothing set. */
export const EMPTY_BOT: BotFile = { version: BOT_FILE_VERSION };

/** What reading a bot.json gives: the file (bad fields dropped, each said), and what was wrong. */
export interface ParsedBot {
  readonly bot: BotFile;
  readonly problems: readonly string[];
}

/**
 * bot.json's text → the bot. Never throws: an unreadable file is an empty bot with the reason, a
 * field that doesn't fit is dropped alone (a hand edit's typo loses that field, not the bot), and a
 * newer Beluga's file keeps what this one knows.
 */
export function parseBotFile(text: string | undefined): ParsedBot {
  if (text === undefined || !text.trim()) return { bot: EMPTY_BOT, problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { bot: EMPTY_BOT, problems: [`bot.json isn’t valid JSON (${err instanceof Error ? err.message : String(err)})`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { bot: EMPTY_BOT, problems: ['bot.json should be an object'] };
  const obj = raw as Record<string, unknown>;
  const problems: string[] = [];
  const version = typeof obj.version === 'number' && Number.isInteger(obj.version) && obj.version >= 1 ? obj.version : BOT_FILE_VERSION;
  if (version > BOT_FILE_VERSION) problems.push(`bot.json is version ${version}, from a newer Beluga: only what this one knows is used`);
  const out: Record<string, unknown> = { version: BOT_FILE_VERSION };
  const shape = BotFile.shape;
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (key === 'version' || obj[key] === undefined) continue;
    const field = shape[key].safeParse(obj[key]);
    if (field.success) out[key] = field.data;
    else if (key === 'categories' && obj.categories && typeof obj.categories === 'object') {
      // One bad category is dropped alone.
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj.categories as Record<string, unknown>)) {
        if (CATEGORY.test(k) && typeof v === 'string' && BotTarget.safeParse(v).success) kept[k] = v;
        else problems.push(`bot.json: category “${k}” was left out (its target should be combo:<id> or bot:<id>)`);
      }
      if (Object.keys(kept).length) out.categories = kept;
    } else if (key === 'triggers' && Array.isArray(obj.triggers)) {
      // One bad trigger is dropped alone (and two with one id keep the first).
      const kept: BotTrigger[] = [];
      for (const [i, raw] of obj.triggers.slice(0, MAX_BOT_TRIGGERS).entries()) {
        const t = BotTrigger.safeParse(raw);
        const label = raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : `#${i + 1}`;
        if (t.success && !kept.some((k) => k.id === t.data.id)) kept.push(t.data);
        else problems.push(`bot.json: trigger “${label}” was left out (${t.success ? 'another has its id' : (t.error.issues[0]?.message ?? 'it doesn’t fit')})`);
      }
      if (kept.length) out.triggers = kept;
    } else problems.push(`bot.json: “${key}” was left out (${field.error.issues[0]?.message ?? 'it doesn’t fit'})`);
  }
  return { bot: out as BotFile, problems };
}

/** bot.json as Beluga writes it: stable key order, two-space indent, a newline at the end. */
export function botFileText(bot: BotFile): string {
  const order: Array<keyof BotFile> = ['version', 'name', 'icon', 'color', 'description', 'combo', 'categories', 'difficulty', 'autonomy', 'projects', 'triggers'];
  const out: Record<string, unknown> = {};
  for (const k of order) if (bot[k] !== undefined && !(Array.isArray(bot[k]) && !(bot[k] as unknown[]).length) && !(k === 'categories' && !Object.keys(bot.categories ?? {}).length)) out[k] = bot[k];
  out.version = BOT_FILE_VERSION;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Whether a bot plans and dispatches (anything of Phase 6 set): Your Mac with none of it is Your Mac as it always was. */
export const orchestrates = (bot: BotFile, persona: string): boolean =>
  Boolean(persona.trim() || bot.combo || Object.keys(bot.categories ?? {}).length || Object.values(bot.difficulty ?? {}).some(Boolean) || bot.autonomy);

// ---------------------------------------------------------------- channels

const BOT_PREFIX = 'bot:';

/** A bot's first chat (the conversation it had before it had several), and its Test chat's key. */
export const MAIN_CHAT = 'main';
export const TEST_CHAT = 'test';

/** The most chats a bot keeps open (its Test chat aside); Settings' Open chats limit counts them too. */
export const MAX_BOT_CHATS = 40;

/**
 * A bot's conversation: Your Mac's is its own (`mac:assistant`); another's first chat is `bot:<id>`,
 * its others `bot:<id>:<chat>` (like Your Mac's tabs), and its Test chat `bot:<id>:test`.
 */
export const botChannel = (id: string, chat: string = MAIN_CHAT): string => (id === MAC_BOT && chat === MAIN_CHAT ? ASSISTANT_CHANNEL : chat === MAIN_CHAT ? `${BOT_PREFIX}${id}` : `${BOT_PREFIX}${id}:${chat}`);

/** Bot Studio's Test chat for a bot: a conversation of its own that touches no project. */
export const botTestChannel = (id: string): string => `${BOT_PREFIX}${id}:${TEST_CHAT}`;

/** The bot a `bot:` channel is (one of its chats or its Test chat); Your Mac's channels are the assistant's. */
export function botOfChannel(channel: string | undefined): { readonly id: string; readonly test: boolean; readonly chat: string } | undefined {
  if (!channel?.startsWith(BOT_PREFIX)) return undefined;
  const parts = channel.slice(BOT_PREFIX.length).split(':');
  const [id, rest] = parts;
  if (parts.length > 2 || !id || !BOT_ID.test(id) || (rest !== undefined && (!CHAT_ID.test(rest) || rest === MAIN_CHAT))) return undefined;
  return { id, test: rest === TEST_CHAT, chat: rest ?? MAIN_CHAT };
}

/** One of a bot's chats (not its Test chat), as the screens list them. */
export interface BotChat {
  readonly id: string;
  readonly channel: string;
  readonly createdAt: number;
}

export const isBotChannel = (channel: string | undefined): boolean => botOfChannel(channel) !== undefined;

// ---------------------------------------------------------------- what the screens see

/** What a bot is doing now, from the plan it dispatched last (still running or waiting). */
export interface BotStatus {
  readonly planId: string;
  readonly planTitle: string;
  readonly done: number;
  readonly total: number;
  /** The task (or the plan) waiting: on you, on a check. */
  readonly waiting?: string;
  /** The plan is a draft waiting for your Approve. */
  readonly draft?: true;
}

/** "2 of 6 done · waiting on Contrast check": the sidebar's line. */
export function botStatusLine(st: BotStatus | undefined): string | undefined {
  if (!st) return undefined;
  if (st.draft) return `Plan ready: ${st.planTitle.slice(0, 60)} · waiting for your Approve`;
  const head = st.total ? `${st.done} of ${st.total} done` : st.planTitle.slice(0, 60);
  return st.waiting ? `${head} · waiting on ${st.waiting.slice(0, 60)}` : head;
}

/** How a bot's knowledge is searched: OpenViking when it runs here, else a plain local full-text index. */
export type KnowledgeBackend = 'openviking' | 'local';

/** One bot, as the sidebar, Settings › Bots and the phone see it. */
export interface BotInfo {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color?: string;
  readonly description?: string;
  /** Its conversation: the chat open now (Your Mac: its first chat's). */
  readonly channel: string;
  /** Its chats in tab order (another bot's; Your Mac's are the assistant's own). */
  readonly chats?: readonly BotChat[];
  /** What it does on its own, and when it runs next. */
  readonly triggers?: readonly BotTriggerInfo[];
  readonly nextRun?: number;
  /** Its folder, `~`-shortened. */
  readonly dir: string;
  readonly mac: boolean;
  /** It plans and dispatches (something of its setup is set). */
  readonly orchestrates: boolean;
  readonly autonomy: BotAutonomy;
  readonly combo?: string;
  readonly status?: BotStatus;
  /** What's wrong with its files, each with the reason (an MCP missing a secret, a skill's header). */
  readonly problems: readonly string[];
  readonly knowledge: KnowledgeBackend;
  /** Its files' revision: bumped by every change, here or outside (the watcher). */
  readonly rev: number;
  /** The conversations of work it dispatched (its plans' own and their tasks' worktrees): a Needs You there names it. */
  readonly behind: readonly string[];
}

/** The bot behind a conversation: its own chat, or work it dispatched there. */
export function botBehind(bots: readonly BotInfo[], channel: string | undefined): BotInfo | undefined {
  if (!channel) return undefined;
  return bots.find((b) => b.channel === channel || botOfChannel(channel)?.id === b.id) ?? bots.find((b) => b.behind.includes(channel));
}

// ---------------------------------------------------------------- its tools on other runtimes

/**
 * Which of a bot's MCP servers each runtime takes for one run (docs/bots.md): Claude Code
 * (`--mcp-config`, strictly), Codex (`mcp_servers.<name>` overrides, your own turned off) and
 * OpenCode (ACP's session/new) take started and HTTP servers; Copilot only HTTP ones (it turns a
 * client's started servers down). Any other runtime (a local model) takes none.
 */
export const MCP_REACH: Readonly<Record<string, 'all' | 'http'>> = { claude: 'all', codex: 'all', opencode: 'all', copilot: 'http' };

/** A server of .mcp.json: its name and whether it's reached over HTTP (`url`) rather than started (`command`). */
export interface McpServerKind {
  readonly name: string;
  readonly http: boolean;
}

/** What one runtime gets of a bot's servers: all, some (the rest named) or none. */
export interface McpReach {
  readonly runtime: string;
  readonly gets: 'all' | 'some' | 'none';
  readonly missing: readonly string[];
}

export function mcpReach(runtime: string, servers: readonly McpServerKind[]): McpReach {
  const takes = MCP_REACH[runtime];
  const missing = servers.filter((s) => !takes || (takes === 'http' && !s.http)).map((s) => s.name);
  return { runtime, gets: !missing.length ? 'all' : missing.length === servers.length ? 'none' : 'some', missing };
}

export interface BotsState {
  readonly bots: readonly BotInfo[];
}

export const NO_BOTS: BotsState = { bots: [] };

/** The bot that made a plan, by id, as the phone and the Mac name it on a Needs You. */
export interface BotDispatch {
  readonly bot: string;
  readonly planId: string;
  /** Each plan task's category or difficulty, by its id in the plan. */
  readonly tasks: Readonly<Record<string, { readonly category?: string; readonly difficulty?: Difficulty }>>;
  readonly at: number;
}

export { DIFFICULTIES };

// ---------------------------------------------------------------- secrets and skills (pure checks)

/** A secret in .mcp.json: `${env:NAME}`, its value kept in ~/.beluga/env.json, never in the folder. */
export const ENV_REF = /\$\{env:([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;

/** The secrets a .mcp.json names (`${env:NAME}`), each once, in order. */
export function secretsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ENV_REF)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** What looks like a secret written right into .mcp.json (a token, not a `${env:}`): refused on save. */
export function plainSecretsIn(text: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const found: string[] = [];
  const walk = (v: unknown, key: string): void => {
    if (typeof v === 'string') {
      if (/(token|secret|password|api[_-]?key|auth)/i.test(key) && v.trim() && !/^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim()) && !v.includes('${env:')) found.push(key);
      else if (/^(sk-|ghp_|gho_|xox[bap]-|eyJ[\w-]{10,}\.)/.test(v)) found.push(key);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(raw, '');
  return [...new Set(found)];
}

/** A skill's or a sub-agent's header (the `---` front matter of SKILL.md / <agent>.md). */
export interface SkillHeader {
  readonly name: string;
  readonly description: string;
}

/** SKILL.md's text → its header, or why it can't be read (Claude Code needs `name` and `description`). */
export function parseSkillHeader(text: string): { readonly ok: true; readonly header: SkillHeader } | { readonly ok: false; readonly why: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return { ok: false, why: 'it has no header: start with --- lines holding name: and description:' };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const f = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (f) fields[f[1]!.toLowerCase()] = f[2]!.trim().replace(/^["']|["']$/g, '');
  }
  if (!fields.name) return { ok: false, why: 'its header has no name:' };
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(fields.name)) return { ok: false, why: `its name “${fields.name}” should be lowercase letters, digits and dashes` };
  if (!fields.description) return { ok: false, why: 'its header has no description: (Claude reads it to know when to use it)' };
  return { ok: true, header: { name: fields.name, description: fields.description.slice(0, 1024) } };
}

/** A skill's or a sub-agent's folder or file name. */
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
