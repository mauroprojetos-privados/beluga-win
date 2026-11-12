import { existsSync, mkdirSync, promises as fs, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentPlace, DispatchInput, MacTools } from '../../agent/types.js';
import { dropAgentSession } from '../../agent/runtime/drop-session.js';
import { type AgentRef, CLAUDE_AGENT } from '../../protocol.js';
import type { BodyInput } from '../plans/edit.js';
import { ASSISTANT_CHANNEL, ASSISTANT_TITLE, activeAssistantChannel } from '../../shared/assistant.js';
import { chatFits, chatLimitMessage } from '../../shared/chat-limit.js';
import { randomBytes } from 'node:crypto';
import type { TriggerDeps } from '../sentinel/triggers/types.js';
import { BotTriggers } from './triggers.js';
import { issueForWorkspace } from '../board/model.js';
import { HistorySaver } from '../history-saver.js';
import { tilde } from '../paths.js';
import { type Autonomy, planTaskOfIssue } from '../plans/model.js';
import { liveFrom } from '../plans/progress.js';
import { combosIn } from '../routing/model.js';
import { chosenAgent } from '../settings.js';
import { type LogItem, type Store, settleRun } from '../store.js';
import { type TaskRoute, botAgent, planStatus, routeTask } from './dispatch.js';
import { BOT_JSON, BotFolder, KNOWLEDGE_JSON, MCP_JSON, MEMORY, PERSONA, fingerprint, mcpKindsOf, mcpServersOf } from './folder.js';
import { RUNTIME_NAMES } from '../../shared/agent-label.js';
import { Knowledge, passagesText } from './knowledge.js';
import {
  BOT_AUTONOMY_INFO,
  BOT_ID,
  type BotAutonomy,
  type BotChat,
  type BotDispatch,
  type BotFile,
  type BotInfo,
  type BotStatus,
  type KnowledgeBackend,
  MAC_BOT,
  MAIN_CHAT,
  MAX_BOTS,
  MAX_BOT_CHATS,
  TEST_CHAT,
  botChannel,
  botOfChannel,
  botTestChannel,
  mcpReach,
  nextRunOf,
  orchestrates,
  targetOf,
} from './schema.js';

/**
 * Bots (docs/bots.md): Your Mac, and the bots you make, each a folder whose files say who it is,
 * what it runs on, its tools, skills, knowledge and memory. This is the daemon's side:
 *
 * - **Its conversation.** Your Mac's is the assistant's own (core/assistant); this adds what its
 *   folder sets (persona, combo, plan_dispatch, its MCPs). Another bot's is `bot:<id>`, kept here
 *   (`~/.beluga/bot-chats/<id>/`), and its Test chat `bot:<id>:test`. A bot's run works in its
 *   folder (cwd), with `--add-dir` for the projects it acts in, and only its own MCPs.
 * - **Dispatching.** plan_dispatch writes a whole Plan; each task's category or difficulty picks a
 *   combo or another bot (dispatch.ts). The record of which bot made which plan is
 *   `bot-chats/dispatch.json`: the pilot routes by it, the sidebar's line reads it, and a Needs You
 *   of that plan's work names the bot.
 * - **The screens.** The shared state's `bots`: every bot with what it's doing now and what's wrong
 *   with its files. A watcher keeps it true when a file changes outside Beluga.
 */

export interface BotsDeps {
  readonly store: Store;
  /** ~/.beluga (a temporary folder in the demo and the tests): bots in `bots/`, their chats in `bot-chats/`. */
  readonly home: string;
  /** Your Mac's folder: ~/.beluga/assistant/work. */
  readonly macDir: string;
  readonly selfId: () => string;
  /** Your secrets (env.json's own variables): `${env:NAME}` in a .mcp.json is filled from them. */
  readonly secrets: { readonly values: () => Readonly<Record<string, string>>; readonly set: (name: string, value: string | undefined) => void };
  /** Your Mac's tools (list_work, start_worktree…), which every bot shares. */
  readonly macTools?: () => MacTools | undefined;
  /** Write a plan whole and, when `approve`, run it (PlansWork.createWritten). */
  readonly createPlan?: (input: { readonly projectId: string; readonly body: BodyInput; readonly autonomy: Autonomy; readonly approve: boolean; readonly by: string }) => Promise<{ readonly id: string }>;
  readonly claudeDir?: string;
  readonly codexDir?: string;
  readonly now?: () => number;
  /** Watch the folders for edits made outside Beluga (default on; the tests refresh by hand). */
  readonly watch?: boolean;
  /** Where knowledge is searched (OpenViking or the local index); the tests pass the local one. */
  readonly knowledge?: (dir: string, id: string) => Knowledge;
  /** Say a trigger’s message in a bot’s chat as you would (session.submit): without it, triggers never fire. */
  readonly submit?: (channel: string, text: string) => boolean;
  /** Where Sentinels’ event triggers look (none: a bot’s triggers are schedules and Run Now only). */
  readonly triggerEvents?: Omit<TriggerDeps, 'store' | 'selfId'>;
  /** How often schedules are looked at (0: by hand, the tests). */
  readonly triggerTickMs?: number;
  readonly tz?: string;
}

/** A bot’s chats as kept in bot-chats/<id>/chats.json: in tab order, and the one open. */
interface ChatList {
  readonly chats: ReadonlyArray<{ readonly id: string; readonly createdAt: number }>;
  readonly active: string;
}

interface ChatState {
  readonly sessionId?: string;
  readonly runtime?: string;
}

/** A chat of a bot (not Your Mac's): its first (`main`), another of its chats, or its Test chat (`test`). */
type ChatKey = string;

const KEEP = 500;

/** What a bot's run gets, as Your Mac's runs get theirs from the assistant. */
export interface BotRun {
  readonly place: AgentPlace;
  readonly tools: MacTools;
  readonly brief: string;
}

/** What a bot's folder adds to Your Mac's own runs (nothing when it isn't set up). */
export interface MacExtras {
  readonly agent?: AgentRef;
  readonly brief: string;
  readonly mcp?: AgentPlace['mcp'];
  readonly tools: Pick<MacTools, 'dispatchPlan' | 'knowledgeSearch'>;
}

/** What a worktree doing a task handed to a bot gets from that bot: its tools, persona and skills folder. */
export interface BotWork {
  readonly bot: string;
  readonly name: string;
  readonly mcp?: AgentPlace['mcp'];
  readonly dir: string;
  readonly brief: string;
}

export class Bots {
  private readonly saver: HistorySaver;
  private dispatches: BotDispatch[];
  private readonly revs = new Map<string, { print: string; rev: number }>();
  private readonly unsubscribe: () => void;
  private lastLog: readonly LogItem[] | undefined;
  private lastKey = '';
  private lastCombos: unknown;
  private lastRuntimes: unknown;
  private watcher: { close: () => Promise<void> | void } | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private backends = new Map<string, KnowledgeBackend>();
  private readonly chatLists = new Map<string, ChatList>();
  private readonly triggers: BotTriggers | undefined;

  constructor(private readonly deps: BotsDeps) {
    mkdirSync(this.botsDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.chatsDir, { recursive: true, mode: 0o700 });
    this.dispatches = readJson<BotDispatch[]>(path.join(this.chatsDir, 'dispatch.json'), []).filter((d) => d && typeof d.planId === 'string' && typeof d.bot === 'string');
    this.saver = new HistorySaver({
      log: () => deps.store.getState().log,
      channels: () => new Set(this.ids().filter((id) => id !== MAC_BOT).flatMap((id) => [...this.chatList(id).chats.map((c) => botChannel(id, c.id)), botTestChannel(id)]).concat(botTestChannel(MAC_BOT))),
      idOf: (channel) => {
        const b = botOfChannel(channel);
        return b && this.has(b.id) && (b.test || this.chatList(b.id).chats.some((c) => c.id === b.chat)) ? `${b.id}~${b.chat}` : undefined;
      },
      write: async (key, items, current) => {
        const file = this.historyFile(key);
        const tmp = `${file}.${process.pid}.tmp`;
        mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        await fs.writeFile(tmp, `${JSON.stringify(items)}\n`, { mode: 0o600 });
        if (current()) renameSync(tmp, file);
        else await fs.rm(tmp, { force: true });
      },
      writeSync: (key, items) => writeJson(this.historyFile(key), items),
      keep: KEEP,
    });
    for (const id of this.ids()) this.loadChats(id);
    this.triggers = deps.submit
      ? new BotTriggers({
          store: deps.store,
          selfId: deps.selfId,
          dir: this.chatsDir,
          bots: () => this.triggered(),
          submit: (id, text) => this.submitTo(id, text),
          ...(deps.triggerEvents ? { events: deps.triggerEvents } : {}),
          ...(deps.now ? { now: deps.now } : {}),
          ...(deps.tz ? { tz: deps.tz } : {}),
          ...(deps.triggerTickMs !== undefined ? { tickMs: deps.triggerTickMs } : {}),
          changed: () => this.statusSoon(),
        })
      : undefined;
    this.triggers?.sync();
    this.publish();
    this.lastLog = deps.store.getState().log;
    this.unsubscribe = deps.store.subscribe(() => {
      const st = deps.store.getState();
      if (st.log !== this.lastLog) {
        this.lastLog = st.log;
        this.saver.changed();
      }
      // Your combos and runtimes changed: a bot's problems (a combo deleted) are worked out again.
      if (st.prefs.combos !== this.lastCombos || st.runtimes !== this.lastRuntimes) {
        this.lastCombos = st.prefs.combos;
        this.lastRuntimes = st.runtimes;
        this.fileInfo = undefined;
      }
      this.statusSoon();
    });
    if (deps.watch !== false) void this.startWatch();
  }

  stop(): void {
    this.unsubscribe();
    this.saver.stop();
    this.triggers?.stop();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.statusTimer);
    void this.watcher?.close();
    this.watcher = undefined;
  }

  private get now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  get botsDir(): string {
    return path.join(this.deps.home, 'bots');
  }

  private get chatsDir(): string {
    return path.join(this.deps.home, 'bot-chats');
  }

  private historyFile(key: string): string {
    const [id, chat] = key.split('~');
    return path.join(this.chatsDir, id!, `history-${chat}.json`);
  }

  // ------------------------------------------------------------------ the bots there are

  /** Every bot's id: Your Mac first, then the folders in ~/.beluga/bots by name. */
  ids(): string[] {
    let names: string[] = [];
    try {
      names = readdirSync(this.botsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && BOT_ID.test(d.name) && d.name !== MAC_BOT && existsSync(path.join(this.botsDir, d.name, BOT_JSON)))
        .map((d) => d.name);
    } catch {
      // None yet.
    }
    return [MAC_BOT, ...names.sort().slice(0, MAX_BOTS - 1)];
  }

  has(id: string): boolean {
    return id === MAC_BOT || (BOT_ID.test(id) && existsSync(path.join(this.botsDir, id, BOT_JSON)));
  }

  dirOf(id: string): string {
    if (id === MAC_BOT) return this.deps.macDir;
    if (!BOT_ID.test(id)) throw new Error('That isn’t a bot');
    return path.join(this.botsDir, id);
  }

  folder(id: string): BotFolder {
    if (!this.has(id)) throw new Error('That bot was deleted');
    return new BotFolder(this.dirOf(id));
  }

  knowledge(id: string): Knowledge {
    const dir = this.dirOf(id);
    return this.deps.knowledge?.(dir, id) ?? new Knowledge(dir, id);
  }

  file(id: string): BotFile {
    return this.folder(id).bot().bot;
  }

  /** A bot's name: its own, Your Mac's the computer's. */
  nameOf(id: string): string {
    const f = this.has(id) ? this.folder(id).bot().bot : undefined;
    return f?.name ?? (id === MAC_BOT ? ASSISTANT_TITLE : id);
  }

  /** Your secrets' values (env.json), for filling a .mcp.json's ${env:NAME}: never sent to a screen. */
  secretValues(): Readonly<Record<string, string>> {
    return this.deps.secrets.values();
  }

  /** Set (or clear) a secret a bot's .mcp.json names: kept with your others in ~/.beluga/env.json. */
  setSecret(name: string, value: string | undefined): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error('A secret’s name is letters, digits and _');
    this.deps.secrets.set(name, value);
    this.refresh();
  }

  /** What each bot's files say (read again on refresh: a save here, the watcher), without what it's doing now. */
  private fileInfo: ReadonlyArray<Omit<BotInfo, 'status' | 'behind'>> | undefined;

  private readFiles(): ReadonlyArray<Omit<BotInfo, 'status' | 'behind'>> {
    const secrets = this.deps.secrets.values();
    return this.ids().map((id) => {
      const folder = new BotFolder(this.dirOf(id));
      const docs = folder.docs();
      const bot = docs.parsed.bot;
      const knowledgeText = folder.read(KNOWLEDGE_JSON);
      const print = [...Object.entries(docs.prints).map(([k, v]) => `${k}=${v}`), `k=${fingerprint(knowledgeText)}`].sort().join('|');
      const was = this.revs.get(id);
      const rev = !was ? 1 : was.print === print ? was.rev : was.rev + 1;
      this.revs.set(id, { print, rev });
      return {
        id,
        name: bot.name ?? (id === MAC_BOT ? ASSISTANT_TITLE : id),
        icon: bot.icon ?? (id === MAC_BOT ? 'laptop' : 'bot'),
        ...(bot.color ? { color: bot.color } : {}),
        ...(bot.description ? { description: bot.description } : {}),
        channel: botChannel(id),
        dir: tilde(this.dirOf(id)),
        mac: id === MAC_BOT,
        orchestrates: orchestrates(bot, docs.persona),
        autonomy: bot.autonomy ?? 'ask',
        ...(bot.combo ? { combo: bot.combo } : {}),
        problems: [...docs.parsed.problems, ...this.problemsOf(id, docs, secrets)],
        knowledge: this.backends.get(id) ?? (this.knowledge(id).read().indexed?.backend === 'openviking' ? 'openviking' : 'local'),
        rev,
      };
    });
  }

  /** The bots as the screens see them: their files (as last read) and what each is doing now. */
  list(): BotInfo[] {
    const st = this.deps.store.getState();
    const live = liveFrom(st);
    this.fileInfo ??= this.readFiles();
    return this.fileInfo.map((info): BotInfo => {
      const status = this.statusOf(info.id, st, live);
      const list = info.mac ? undefined : this.chatList(info.id);
      const chats: BotChat[] | undefined = list?.chats.map((c) => ({ id: c.id, channel: botChannel(info.id, c.id), createdAt: c.createdAt }));
      const file = this.has(info.id) ? new BotFolder(this.dirOf(info.id)).bot().bot : undefined;
      const triggers = this.triggers && file?.triggers?.length ? this.triggers.infoOf(info.id, file.triggers) : undefined;
      const nextRun = triggers ? nextRunOf(triggers) : undefined;
      return {
        ...info,
        ...(list ? { channel: botChannel(info.id, list.active), chats } : {}),
        ...(triggers ? { triggers } : {}),
        ...(nextRun !== undefined ? { nextRun } : {}),
        ...(status ? { status } : {}),
        behind: this.behindOf(info.id, st),
      };
    });
  }

  // ------------------------------------------------------------------ what it does on its own

  /** The bots' triggers for BotTriggers: each bot's bot.json, its autonomy and the project its events are watched in. */
  private triggered(): Array<{ id: string; name: string; autonomy: BotAutonomy; triggers: NonNullable<BotFile['triggers']>; projectId?: string }> {
    return this.ids().flatMap((id) => {
      const bot = new BotFolder(this.dirOf(id)).bot().bot;
      if (!bot.triggers?.length) return [];
      const projectId = bot.projects?.[0];
      return [{ id, name: bot.name ?? (id === MAC_BOT ? ASSISTANT_TITLE : id), autonomy: bot.autonomy ?? 'ask', triggers: bot.triggers, ...(projectId ? { projectId } : {}) }];
    });
  }

  /** A trigger's run: its message said in the bot's chat open now (Your Mac: its first chat, else the one open). */
  private submitTo(id: string, text: string): boolean {
    if (!this.deps.submit || !this.has(id)) return false;
    const st = this.deps.store.getState();
    const channel = id === MAC_BOT ? (st.assistant.chats.some((c) => c.channel === ASSISTANT_CHANNEL) || !st.assistant.chats.length ? ASSISTANT_CHANNEL : activeAssistantChannel(st.assistant)) : botChannel(id, this.chatList(id).active);
    return this.deps.submit(channel, text);
  }

  /** Run one of a bot's triggers now (Bot Studio's Run Now). */
  runTrigger(id: string, triggerId: string): boolean {
    if (!this.triggers) throw new Error('Triggers need the Beluga app');
    this.folder(id);
    return this.triggers.runNow(id, triggerId);
  }

  /** Look at the schedules now (the tests; the daemon ticks every 30 seconds). */
  tickTriggers(): void {
    this.triggers?.tick();
  }

  /** Which event watchers run now (the tests). */
  watchingTriggers(): string[] {
    return this.triggers?.watching() ?? [];
  }

  /** The conversations of a bot's dispatched work: each plan's own, and its tasks' worktrees (newest plans first). */
  private behindOf(id: string, st: ReturnType<Store['getState']>): string[] {
    const out: string[] = [];
    for (const d of this.dispatches.filter((x) => x.bot === id).sort((a, b) => b.at - a.at)) {
      const plan = st.plans.plans.find((p) => p.id === d.planId);
      if (!plan || plan.status === 'done') continue;
      out.push(plan.home);
      const issues = new Set([...(plan.body?.milestones ?? []), ...(plan.draft?.milestones ?? [])].flatMap((m) => m.tasks.flatMap((t) => (t.issueId ? [t.issueId] : []))));
      for (const issue of st.board.issues) if (issues.has(issue.id)) out.push(...issue.worktrees.map((w) => `ws:${w}`));
    }
    return [...new Set(out)].slice(0, 200);
  }

  /** What's wrong with a bot's files, each with the reason (the screens mark it; the bot warns before it runs). */
  private problemsOf(id: string, docs: ReturnType<BotFolder['docs']>, secrets: Readonly<Record<string, string>>): string[] {
    const out: string[] = [];
    for (const s of docs.skills) if (s.problem) out.push(`Skill “${s.name}”: ${s.problem}`);
    for (const a of docs.agents) if (a.problem) out.push(`Sub-agent “${a.name}”: ${a.problem}`);
    if (docs.mcp.trim()) {
      try {
        JSON.parse(docs.mcp);
      } catch (err) {
        out.push(`.mcp.json isn’t valid JSON (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    const missing = new BotFolder(this.dirOf(id)).missingSecrets(secrets);
    if (missing.length) out.push(`Missing secret${missing.length === 1 ? '' : 's'} ${missing.join(', ')}: set ${missing.length === 1 ? 'it' : 'them'} under Tools › Secrets`);
    const bot = docs.parsed.bot;
    const combos = combosIn(this.deps.store.getState());
    if (bot.combo && !combos.some((c) => c.id === bot.combo)) out.push(`Its combo “${bot.combo}” was deleted: it runs on your agent`);
    for (const [cat, target] of Object.entries(bot.categories ?? {})) {
      const t = targetOf(target);
      if (t?.kind === 'combo' && !combos.some((c) => c.id === t.id)) out.push(`Category “${cat}” points to a combo that was deleted`);
      if (t?.kind === 'bot' && (t.id === id || !this.has(t.id))) out.push(t.id === id ? `Category “${cat}” points to this bot itself` : `Category “${cat}” points to a bot that was deleted`);
    }
    for (const r of this.reachOf(id)) {
      if (r.gets === 'all') continue;
      out.push(r.gets === 'none' ? `Its combo can hand on to ${r.label}, which doesn’t load the bot’s MCPs` : `Its combo can hand on to ${r.label}, which loads only its HTTP servers: ${r.missing.join(', ')} don’t reach it there`);
    }
    return out;
  }

  /**
   * Which targets of a bot's combo get its MCP servers (Bot Studio's Tools tab): each target in
   * order, the runtime it runs on, and what of the bot's servers that runtime takes (MCP_REACH).
   * No combo: your agent, alone. No servers: nothing to say.
   */
  reachOf(id: string): Array<{ readonly label: string; readonly runtime: string; readonly gets: 'all' | 'some' | 'none'; readonly missing: readonly string[] }> {
    const folder = new BotFolder(this.dirOf(id));
    const servers = mcpKindsOf(folder.read(MCP_JSON));
    if (!servers.length) return [];
    const st = this.deps.store.getState();
    const bot = folder.bot().bot;
    const combo = bot.combo ? combosIn(st).find((c) => c.id === bot.combo) : undefined;
    const targets = combo ? combo.targets.map((t) => ({ runtime: t.runtime, model: t.model })) : [{ runtime: chosenAgent(st.prefs).runtime, model: chosenAgent(st.prefs).model }];
    return targets.map((t) => ({ label: `${RUNTIME_NAMES[t.runtime] ?? t.runtime}${t.model ? ` ${t.model}` : ''}`, ...mcpReach(t.runtime, servers) }));
  }

  /** What a bot is doing: its newest plan that isn't done. */
  private statusOf(id: string, st: ReturnType<Store['getState']>, live: ReturnType<typeof liveFrom>): BotStatus | undefined {
    const mine = this.dispatches.filter((d) => d.bot === id).sort((a, b) => b.at - a.at);
    for (const d of mine) {
      const plan = st.plans.plans.find((p) => p.id === d.planId);
      if (!plan) continue;
      const s = planStatus(plan, st.board, live);
      if (s) return s;
    }
    return undefined;
  }

  private publish(): void {
    const bots = this.list();
    const key = JSON.stringify(bots);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.deps.store.dispatch({ type: 'bots', bots });
  }

  /** The files changed (a save here, the watcher): the screens see them now. */
  refresh(): void {
    this.fileInfo = undefined;
    this.chatLists.clear();
    for (const id of this.ids()) this.loadChats(id);
    this.triggers?.sync();
    this.publish();
  }

  private statusSoon(): void {
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.publish();
    }, 500);
    this.statusTimer.unref?.();
  }

  private async startWatch(): Promise<void> {
    try {
      const { watch } = await import('chokidar');
      const ignored = (p: string): boolean => /[\\/](\.git|\.index|node_modules)([\\/]|$)/.test(p) || /[\\/]\.beluga[\\/]/.test(p.slice(this.deps.macDir.length));
      const w = watch([this.botsDir, ...[BOT_JSON, PERSONA, MCP_JSON, MEMORY, KNOWLEDGE_JSON, '.claude'].map((f) => path.join(this.deps.macDir, f))], { ignoreInitial: true, depth: 4, ignored });
      w.on('all', () => {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.refresh(), 300);
        this.refreshTimer.unref?.();
      });
      this.watcher = w;
    } catch {
      // No watcher: the screens see changes made here, and others when Beluga next looks.
    }
  }

  // ------------------------------------------------------------------ its chats (other bots)

  private loaded = new Set<string>();

  private loadChats(id: string): void {
    if (this.loaded.has(id)) return;
    this.loaded.add(id);
    for (const chat of id === MAC_BOT ? [TEST_CHAT] : [...this.chatList(id).chats.map((c) => c.id), TEST_CHAT]) this.loadChat(id, chat);
  }

  private loadChat(id: string, chat: ChatKey): void {
    const channel = chat === TEST_CHAT ? botTestChannel(id) : botChannel(id, chat);
    const saved = readJson<LogItem[]>(this.historyFile(`${id}~${chat}`), []);
    const live = this.deps.store.getState().log.filter((l) => l.channel === channel);
    const known = new Set(saved.map((l) => l.id));
    if (saved.length || live.length) this.deps.store.dispatch({ type: 'history', channel, items: [...saved.map(settleRun), ...live.filter((l) => !known.has(l.id))] });
    this.saver.loaded(channel);
  }

  /** A bot's chats (never empty: its first, `main`, until another takes its place) and the one open. */
  chatList(id: string): ChatList {
    const had = this.chatLists.get(id);
    if (had) return had;
    const raw = readJson<Partial<ChatList>>(path.join(this.chatsDir, id, 'chats.json'), {});
    const chats = (Array.isArray(raw.chats) ? raw.chats : []).filter((c) => c && typeof c.id === 'string' && /^[a-z0-9]{1,24}$/.test(c.id) && c.id !== TEST_CHAT).slice(0, MAX_BOT_CHATS);
    const list: ChatList = chats.length ? { chats, active: chats.some((c) => c.id === raw.active) ? raw.active! : chats[0]!.id } : { chats: [{ id: MAIN_CHAT, createdAt: 0 }], active: MAIN_CHAT };
    this.chatLists.set(id, list);
    return list;
  }

  private saveChats(id: string, list: ChatList): void {
    this.chatLists.set(id, list);
    writeJson(path.join(this.chatsDir, id, 'chats.json'), list);
  }

  /** Every conversation of a bot: its chats and its Test chat (stopping them all when it's deleted). */
  channelsOf(id: string): string[] {
    if (id === MAC_BOT) return [botTestChannel(id)];
    return [...this.chatList(id).chats.map((c) => botChannel(id, c.id)), botTestChannel(id)];
  }

  /**
   * A new, empty chat of a bot, after the others, open now → its id. Your Open chats limit
   * (Settings › Agent) counts a bot's chats as it counts Your Mac's. Your Mac's are its own tabs.
   */
  newChat(id: string): string {
    if (id === MAC_BOT) throw new Error(`${ASSISTANT_TITLE}’s chats are its own tabs`);
    this.folder(id);
    const list = this.chatList(id);
    const limit = this.deps.store.getState().prefs.chatLimit;
    if (!chatFits(list.chats.length, limit)) throw new Error(chatLimitMessage(list.chats.length, limit, `${this.nameOf(id)}’s chats`));
    if (list.chats.length >= MAX_BOT_CHATS) throw new Error(`A bot keeps up to ${MAX_BOT_CHATS} chats: delete one first`);
    let chat = '';
    do chat = randomBytes(5).toString('hex');
    while (list.chats.some((c) => c.id === chat) || chat === MAIN_CHAT || chat === TEST_CHAT);
    this.saveChats(id, { chats: [...list.chats, { id: chat, createdAt: this.now }], active: chat });
    this.saver.loaded(botChannel(id, chat));
    this.publish();
    return chat;
  }

  /** Open one of a bot's chats (which is open is kept across restarts). */
  openChat(id: string, chat: string): void {
    const list = this.chatList(id);
    if (!list.chats.some((c) => c.id === chat)) throw new Error('That chat was deleted');
    if (list.active !== chat) this.saveChats(id, { ...list, active: chat });
    this.publish();
  }

  /**
   * Delete one of a bot's chats for good: its messages, its history and its agent transcript. The one
   * beside it opens if it was open; the last one leaves a fresh first chat. Stopping its run is the caller's.
   */
  async deleteChat(id: string, chat: string): Promise<void> {
    const list = this.chatList(id);
    const at = list.chats.findIndex((c) => c.id === chat);
    if (at < 0) return;
    const channel = botChannel(id, chat);
    const { sessionId, runtime } = this.session(id, chat);
    const rest = list.chats.filter((c) => c.id !== chat);
    const chats = rest.length ? rest : [{ id: MAIN_CHAT, createdAt: this.now }];
    const active = list.active !== chat && rest.length ? list.active : chats[Math.min(at, chats.length - 1)]!.id;
    this.deps.store.dispatch({ type: 'clear', channel });
    this.deps.store.dispatch({ type: 'context_reset', channel });
    rmSync(this.historyFile(`${id}~${chat}`), { force: true });
    this.remember(id, chat, {});
    if (sessionId) await dropAgentSession(this.dirOf(id), sessionId, runtime, { ...(this.deps.claudeDir ? { claude: this.deps.claudeDir } : {}), ...(this.deps.codexDir ? { codex: this.deps.codexDir } : {}) }).catch(() => undefined);
    this.saveChats(id, { chats, active });
    for (const c of chats) this.saver.loaded(botChannel(id, c.id));
    this.publish();
  }

  private session(id: string, chat: ChatKey): ChatState {
    const all = readJson<Record<string, ChatState>>(path.join(this.chatsDir, id, 'state.json'), {});
    return all[chat] ?? {};
  }

  private remember(id: string, chat: ChatKey, state: ChatState): void {
    const file = path.join(this.chatsDir, id, 'state.json');
    const all = readJson<Record<string, ChatState>>(file, {});
    writeJson(file, { ...all, [chat]: state });
  }

  /** Start one of a bot's chats over: a fresh agent conversation next time (its messages cleared by the caller). */
  forget(channel: string): void {
    const b = botOfChannel(channel);
    if (b && this.has(b.id)) this.remember(b.id, b.chat, {});
  }

  // ------------------------------------------------------------------ runs

  /** Where a bot's agent runs, and on what. `test`: its Test chat, which touches no project. */
  private placeFor(id: string, chat: ChatKey): AgentPlace {
    const test = chat === TEST_CHAT;
    const folder = this.folder(id);
    const bot = folder.bot().bot;
    const st = this.deps.store.getState();
    const agent = botAgent(st, bot) ?? chosenAgent(st.prefs);
    const was = this.session(id, chat);
    const resume = (was.runtime ?? CLAUDE_AGENT.runtime) === agent.runtime ? was.sessionId : undefined;
    const roots = test ? [] : this.projectRoots(bot);
    const mcpText = folder.read(MCP_JSON);
    return {
      cwd: this.dirOf(id),
      additionalDirectories: roots,
      autoEdit: true,
      agent,
      ...(resume ? { resume } : {}),
      ...(mcpText?.trim() ? { mcp: { servers: mcpServersOf(mcpText, this.deps.secrets.values()), strict: true as const } } : {}),
      onSession: (next) => {
        if (!this.has(id)) return;
        this.remember(id, chat, { sessionId: next, runtime: agent.runtime });
      },
    };
  }

  /** The folders of the projects a bot may act in (none named: none added, as Your Mac). */
  private projectRoots(bot: BotFile): string[] {
    const projects = this.deps.store.getState().projects.filter((p) => p.root);
    return (bot.projects ?? []).flatMap((id) => projects.find((p) => p.id === id)?.root ?? []);
  }

  /** A run in one of a bot's chats (not Your Mac's own: the assistant has those). Only yours. */
  forRun(channel: string, from: string): BotRun | undefined {
    const b = botOfChannel(channel);
    if (!b || from !== this.deps.selfId() || !this.has(b.id)) return undefined;
    if (b.id === MAC_BOT && !b.test) return undefined;
    // A chat that was deleted (a stale screen) gets nothing: its run would land nowhere.
    if (!b.test && !this.chatList(b.id).chats.some((c) => c.id === b.chat)) return undefined;
    const tools = b.test ? this.testTools(b.id) : this.toolsFor(b.id);
    return { place: this.placeFor(b.id, b.chat), tools, brief: this.brief(b.id, { test: b.test, tools }) };
  }

  /** What Your Mac's own runs get from its folder; undefined when nothing is set (Your Mac as always). */
  macExtras(): MacExtras | undefined {
    const folder = new BotFolder(this.deps.macDir);
    const bot = folder.bot().bot;
    const persona = folder.persona();
    const knowledge = this.knowledge(MAC_BOT).read().sources.length > 0;
    const mcpText = folder.read(MCP_JSON);
    if (!orchestrates(bot, persona) && !knowledge && !mcpText?.trim()) return undefined;
    const st = this.deps.store.getState();
    const agent = botAgent(st, bot);
    const tools = this.extraTools(MAC_BOT);
    return {
      ...(agent ? { agent } : {}),
      brief: this.brief(MAC_BOT, { test: false, tools }),
      ...(mcpText?.trim() ? { mcp: { servers: mcpServersOf(mcpText, this.deps.secrets.values()), strict: true as const } } : {}),
      tools,
    };
  }

  /** plan_dispatch and knowledge_search, when the bot has a use for them. */
  private extraTools(id: string): Pick<MacTools, 'dispatchPlan' | 'knowledgeSearch'> {
    const folder = this.folder(id);
    const bot = folder.bot().bot;
    const k = this.knowledge(id);
    return {
      ...(orchestrates(bot, folder.persona()) ? { dispatchPlan: (input: DispatchInput) => this.dispatchPlan(id, input) } : {}),
      ...(k.read().sources.length
        ? {
            knowledgeSearch: async (query: string, limit?: number) => {
              const found = await k.search(query, limit ?? 6);
              this.backends.set(id, found.backend);
              return passagesText(found, query);
            },
          }
        : {}),
    };
  }

  private toolsFor(id: string): MacTools {
    const mac = this.deps.macTools?.();
    const none = (what: string) => async (): Promise<never> => {
      throw new Error(`${what} needs the Beluga app`);
    };
    const base: MacTools = mac ?? {
      screenshot: none('A screenshot'),
      deviceInfo: none('Device info'),
      listWork: () => 'Nothing is here yet.',
      startWorktree: none('A worktree'),
      startTask: none('A task'),
      startPlan: none('A plan'),
      archiveWorktree: none('Archiving'),
    };
    return { ...base, ...this.extraTools(id) };
  }

  /** The Test chat's: it looks and searches, and never starts anything in a project. */
  private testTools(id: string): MacTools {
    const base = this.toolsFor(id);
    const refuse = async (): Promise<never> => {
      throw new Error('This is the Test chat: it touches no project. Say what you would start instead.');
    };
    const { knowledgeSearch } = this.extraTools(id);
    return { ...base, startWorktree: refuse, startTask: refuse, startPlan: refuse, archiveWorktree: refuse, ...(knowledgeSearch ? { knowledgeSearch } : {}), dispatchPlan: refuse };
  }

  /** What a bot's agent is told it is: its persona, memory, map and tools. */
  brief(id: string, opts: { readonly test: boolean; readonly tools: Pick<MacTools, 'dispatchPlan' | 'knowledgeSearch'> }): string {
    const folder = this.folder(id);
    const bot = folder.bot().bot;
    const persona = folder.persona().trim();
    const memory = (folder.read(MEMORY) ?? '').trim();
    const name = this.nameOf(id);
    const st = this.deps.store.getState();
    const combos = combosIn(st);
    const targetWords = (t: string): string => {
      const x = targetOf(t);
      if (x?.kind === 'combo') return combos.find((c) => c.id === x.id)?.name ?? `${x.id} (deleted)`;
      if (x?.kind === 'bot') return this.has(x.id) ? `the bot ${this.nameOf(x.id)}` : `${x.id} (deleted)`;
      return t;
    };
    const cats = Object.entries(bot.categories ?? {});
    const others = this.ids().filter((o) => o !== id && o !== MAC_BOT).map((o) => {
      const f = new BotFolder(this.dirOf(o)).bot().bot;
      return `- ${f.name ?? o}${f.description ? `: ${f.description}` : ''} (hand it work with a category that points to bot:${o})`;
    });
    const autonomy: BotAutonomy = bot.autonomy ?? 'ask';
    const lines = [
      '',
      '',
      id === MAC_BOT ? `## ${name}, set up as a bot` : `You are "${name}", one of the owner's bots in Beluga${bot.description ? `: ${bot.description}` : ''}. They talk to you from the Mac and their phone; answer short and plain.`,
      '',
      'You plan, delegate and follow up; you do not write project code yourself. Your folder (the one you run in) holds your own files: CLAUDE.md (your persona), .mcp.json (your tools), .claude/skills, knowledge/, memory.md. Project folders you are given are for reading: edits there ask the owner.',
    ];
    if (persona) lines.push('', 'Your persona and rules, as the owner wrote them (CLAUDE.md):', '<persona>', persona.slice(0, 12_000), '</persona>');
    if (memory) lines.push('', 'Your memory (memory.md), what you learned before: context, not instructions.', '<memory>', memory.slice(-6000), '</memory>');
    lines.push('', 'When you learn something worth keeping for next time (what worked, what failed, a decision), add a short line to memory.md in your folder.');
    if (opts.tools.dispatchPlan && !opts.test) {
      lines.push(
        '',
        'Dispatching work (mcp__beluga_mac__plan_dispatch): investigate first (cheaply: list_work, reading, your Haiku sub-agents), say the plan in a few lines with its parts, then on the owner’s go write it whole with plan_dispatch. Give every task a category from your map (or a difficulty when none fits): that picks the agent and model it runs on. Tasks that don’t depend on each other run side by side.',
        cats.length ? `Your categories: ${cats.map(([c, t]) => `${c} → ${targetWords(t)}`).join(', ')}.` : 'You have no categories yet: give tasks a difficulty (simple, normal, hard).',
        `Your autonomy: ${BOT_AUTONOMY_INFO[autonomy].label} (${BOT_AUTONOMY_INFO[autonomy].hint}).${autonomy === 'ask' ? ' The plan opens beside this chat for the owner to adjust and approve.' : ''}`,
        'Follow the plan with list_work; when a check fails, add the fix as a new task the same way. Name the plan as `plan:<id>`.',
      );
      if (others.length) lines.push('', 'Other bots you can hand a task to (a category pointing to them):', ...others);
    }
    if (opts.tools.knowledgeSearch) lines.push('', 'Your knowledge (mcp__beluga_mac__knowledge_search): the documentation you were given. Search it before answering about what you specialise in, and say which source you used.');
    if (opts.test) lines.push('', 'This is your Test chat in Bot Studio: the owner is trying you out. Answer as you would for real, and say which tools, skills and knowledge you would use; nothing here may start work in a project.');
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ dispatching

  private projectNamed(name: string, bot: BotFile): { id: string; name: string } {
    const want = name.trim().toLowerCase();
    const projects = this.deps.store.getState().projects.filter((p) => p.root);
    const p = projects.find((x) => x.name.toLowerCase() === want || x.id === name) ?? projects.find((x) => x.name.toLowerCase().includes(want));
    if (!p) throw new Error(`There's no project called ${name} here. Projects: ${projects.map((x) => x.name).join(', ') || 'none yet'}`);
    if (bot.projects?.length && !bot.projects.includes(p.id)) throw new Error(`${p.name} isn’t one of the projects this bot works in (Settings › Bots › Identity)`);
    return p;
  }

  /** plan_dispatch: the plan written whole, run or waiting by the bot's autonomy → words for the bot. */
  async dispatchPlan(id: string, input: DispatchInput): Promise<string> {
    if (!this.deps.createPlan) throw new Error('Plans need the Beluga app');
    const bot = this.file(id);
    const project = this.projectNamed(input.project, bot);
    const tasks = input.milestones.flatMap((m) => m.tasks);
    const ids = new Set<string>();
    for (const t of tasks) {
      if (ids.has(t.id)) throw new Error(`Two tasks are called ${t.id}: give each its own id`);
      ids.add(t.id);
    }
    const unknown = [...new Set(tasks.flatMap((t) => (t.category && !bot.categories?.[t.category] ? [t.category] : [])))];
    const autonomy: BotAutonomy = bot.autonomy ?? 'ask';
    const body = {
      title: input.title,
      goal: input.goal,
      milestones: input.milestones.map((m) => ({
        ...(m.id ? { id: m.id } : {}),
        title: m.title,
        ...(m.criteria?.length ? { criteria: m.criteria } : {}),
        ...(m.dependsOn ? { dependsOn: m.dependsOn } : {}),
        tasks: m.tasks.map((t) => ({ id: t.id, title: t.title, ...(t.goal ? { goal: t.goal } : {}), ...(t.acceptance?.length ? { acceptance: t.acceptance } : {}), ...(t.blockedBy?.length ? { blockedBy: t.blockedBy } : {}), ...(t.touches?.length ? { touches: t.touches } : {}) })),
      })),
    };
    const plan = await this.deps.createPlan({ projectId: project.id, body, autonomy: autonomy === 'ask' ? 'gated' : 'autopilot', approve: autonomy !== 'ask', by: this.nameOf(id) });
    const record: BotDispatch = { bot: id, planId: plan.id, tasks: Object.fromEntries(tasks.map((t) => [t.id, { ...(t.category ? { category: t.category } : {}), ...(t.difficulty ? { difficulty: t.difficulty } : {}) }])), at: this.now };
    this.dispatches = [...this.dispatches.filter((d) => d.planId !== plan.id), record].slice(-200);
    writeJson(path.join(this.chatsDir, 'dispatch.json'), this.dispatches);
    this.publish();
    const route = this.router(plan.id);
    const routes = tasks.map((t) => `${t.title}: ${route?.(t.id)?.why ?? 'the plan’s agent'}`);
    return [
      `Planned “${input.title}” in ${project.name}: ${tasks.length} task${tasks.length === 1 ? '' : 's'} in ${input.milestones.length} milestone${input.milestones.length === 1 ? '' : 's'}.`,
      `Routes: ${routes.join('; ')}.`,
      ...(unknown.length ? [`Not in your map (they run on the plan’s agent): ${unknown.join(', ')}.`] : []),
      autonomy === 'ask' ? 'It waits for the owner’s Approve: it’s open beside this chat.' : 'It’s running now: tasks that can start have started.',
      `Name it as \`plan:${plan.id}\`.`,
    ].join(' ');
  }

  /** How a bot's plan routes its tasks (the pilot's PilotDeps.route); undefined: not a bot's plan. */
  router(planId: string): ((taskId: string) => TaskRoute | undefined) | undefined {
    const d = this.dispatches.find((x) => x.planId === planId);
    if (!d || !this.has(d.bot)) return undefined;
    const bot = this.file(d.bot);
    const st = this.deps.store.getState();
    const botOf = (other: string): { name: string; file: BotFile } | undefined => (this.has(other) ? { name: this.nameOf(other), file: this.file(other) } : undefined);
    return (taskId) => {
      const t = d.tasks[taskId];
      return t ? routeTask(st, bot, t, botOf) : undefined;
    };
  }

  /** The bot that dispatched a plan. */
  botOfPlan(planId: string): string | undefined {
    return this.dispatches.find((d) => d.planId === planId)?.bot;
  }

  /**
   * The bot behind a conversation, for a Needs You there: the bot's own chats, the conversation of a
   * plan it dispatched, and the worktree of one of that plan's tasks.
   */
  botOfConversation(channel: string | undefined): { readonly id: string; readonly name: string } | undefined {
    if (!channel) return undefined;
    const own = botOfChannel(channel);
    if (own && this.has(own.id)) return { id: own.id, name: this.nameOf(own.id) };
    const st = this.deps.store.getState();
    const home = st.plans.plans.find((p) => p.home === channel);
    const issue = channel.startsWith('ws:') ? issueForWorkspace(st.board, channel.slice(3)) : undefined;
    const plan = home ?? (issue ? planTaskOfIssue(st.plans, issue.id)?.plan : undefined);
    const bot = plan ? this.botOfPlan(plan.id) : undefined;
    return bot && this.has(bot) ? { id: bot, name: this.nameOf(bot) } : undefined;
  }

  /** A worktree doing a task its plan handed to a bot (a category → bot:<id>): that bot's tools, persona and skills. */
  workFor(channel: string): BotWork | undefined {
    if (!channel.startsWith('ws:')) return undefined;
    const st = this.deps.store.getState();
    const issue = issueForWorkspace(st.board, channel.slice(3));
    const hit = issue ? planTaskOfIssue(st.plans, issue.id) : undefined;
    const route = hit ? this.router(hit.plan.id)?.(hit.task.id) : undefined;
    if (!route?.bot || !this.has(route.bot)) return undefined;
    const folder = this.folder(route.bot);
    const persona = folder.persona().trim();
    const mcpText = folder.read(MCP_JSON);
    const name = this.nameOf(route.bot);
    const brief = [
      '',
      '',
      `## This task was handed to ${name}`,
      `You work it as ${name}, a specialist bot: its persona, skills and tools are yours here. Its folder (${folder.dir}) is added for reading its skills and knowledge; the work itself goes in this worktree.`,
      ...(persona ? ['<persona>', persona.slice(0, 12_000), '</persona>'] : []),
    ].join('\n');
    return { bot: route.bot, name, dir: folder.dir, brief, ...(mcpText?.trim() ? { mcp: { servers: mcpServersOf(mcpText, this.deps.secrets.values()), strict: true as const } } : {}) };
  }

  // ------------------------------------------------------------------ making and deleting

  /** New Bot: its folder with a bot.json naming it, saved as its first commit → its id. */
  async create(input: { readonly name: string; readonly icon?: string; readonly description?: string }): Promise<string> {
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new Error('Give the bot a name');
    if (this.ids().length >= MAX_BOTS) throw new Error(`Beluga keeps up to ${MAX_BOTS} bots`);
    const stem = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'bot';
    let id = stem === MAC_BOT ? 'mac-bot' : stem;
    for (let i = 2; this.has(id) || existsSync(path.join(this.botsDir, id)); i++) id = `${stem}-${i}`;
    const folder = new BotFolder(path.join(this.botsDir, id));
    folder.ensure();
    folder.writeBot({ version: 1, name, ...(input.icon ? { icon: input.icon } : {}), ...(input.description ? { description: input.description } : {}) });
    if (!folder.read(MEMORY)) folder.put(MEMORY, `# What ${name} learned\n\n`);
    await folder.commit(`New bot: ${name}`);
    this.refresh();
    return id;
  }

  /** Delete a bot for good: its folder, its chats and their agent transcripts. Your Mac can't be. */
  async remove(id: string): Promise<void> {
    if (id === MAC_BOT) throw new Error(`${ASSISTANT_TITLE} is the first bot: it can’t be deleted (clear its settings instead)`);
    if (!this.has(id)) return;
    for (const chat of [...this.chatList(id).chats.map((c) => c.id), TEST_CHAT]) {
      const channel = chat === TEST_CHAT ? botTestChannel(id) : botChannel(id, chat);
      const { sessionId, runtime } = this.session(id, chat);
      this.deps.store.dispatch({ type: 'clear', channel });
      if (sessionId) await dropAgentSession(this.dirOf(id), sessionId, runtime, { ...(this.deps.claudeDir ? { claude: this.deps.claudeDir } : {}), ...(this.deps.codexDir ? { codex: this.deps.codexDir } : {}) }).catch(() => undefined);
    }
    rmSync(this.dirOf(id), { recursive: true, force: true });
    rmSync(path.join(this.chatsDir, id), { recursive: true, force: true });
    this.loaded.delete(id);
    this.revs.delete(id);
    this.chatLists.delete(id);
    this.refresh();
  }

  /** Bring in a folder made elsewhere (an import): it's a bot once it has a bot.json. */
  adopt(id: string): void {
    this.loaded.delete(id);
    this.refresh();
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

