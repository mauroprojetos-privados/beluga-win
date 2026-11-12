import type { PhoneArgs, PhoneMethod } from '../../../../src/companion/calls';
import { t } from '../../../../src/shared/i18n/index';
import type { ThreadChildren } from '../../../../src/shared/threads';
import type { NeedsYou, PhoneBranchStep, Topic, VoiceModelId } from './protocol';

/**
 * Every call the phone makes, typed through the Mac's own list (src/companion/calls.ts:
 * `PhoneCalls`, the `phone` methods of coverage.ts with the very argument tuples the daemon
 * checks). A method renamed or an argument changed on the Mac fails `npm run typecheck` here.
 * Type-only import: nothing of the daemon's API is bundled into the app.
 *
 * Needs-you items carry their own calls (`actions`, and `answer` for picks and words), made as the
 * Mac wrote them.
 */
export interface Call<M extends PhoneMethod = PhoneMethod> {
  readonly method: M;
  readonly args: PhoneArgs<M>;
  /** How the outbox names it while your Mac is asleep ("Send 'Run the tests'"). */
  readonly label: string;
}

const make = <M extends PhoneMethod>(method: M, args: PhoneArgs<M>, label: string): Call => ({ method, args, label }) as unknown as Call;

/** One of Your Mac's chats' topics → its id (`main` is the first, `conv:mac:assistant`). */
const macChatOf = (topic: Topic): string => (topic === 'conv:mac:assistant' ? 'main' : topic.slice('conv:mac:assistant:'.length));
/** One of a bot's chats' topics → its id (`main` is its first, `conv:bot:<id>`). */
const botChatOf = (topic: Topic): string => topic.split(':')[3] ?? 'main';
/** `conv:<channel>` → the channel the daemon's session methods take. */
export const channelOf = (topic: Topic): string => topic.replace(/^conv:/, '');
/** `chat:dm:<peerId>` → `dm:<peerId>` (what the network methods call a conversation). */
export const conversationOf = (topic: Topic): string => topic.replace(/^chat:/, '');

const short = (text: string): string => (text.length > 32 ? `${text.slice(0, 31)}…` : text);
/** `up:` refs of files the phone `put` (store.put), to send along. */
type Files = readonly string[] | undefined;
/** An agent as the calls send it (src/protocol.ts AgentRef). */
type PickedRef = { runtime: string; label: string; model?: string };
const withFiles = (files: Files) => (files?.length ? { files: [...files] } : {});

/** One task's draft as the phone sends it back to be added. */
type PhoneDraft = { title: string; goal: string; acceptance: string[]; labels: string[]; priority?: 'urgent' | 'high' | 'medium' | 'low'; for?: string };

export const calls = {
  /** Since 1.13 (BLG-127): keep the Mac awake for the phone, never, on power or always. */
  keepAwake: (mode: 'off' | 'power' | 'always'): Call => make('companion.keepAwake', [mode], t('shared.outbox.keepAwake')),
  /** Since 1.32 (BLG-459): one of your providers (by its runtime) becomes your default agent. */
  defaultAgent: (runtime: string): Call => make('companion.defaultAgent', [runtime], t('shared.outbox.defaultAgent')),
  /** 1.14: a new empty chat on Your Mac (open on the Mac now) → its id; one deleted for good. */
  newMacChat: (): Call => make('assistant.newChat', [], t('shared.outbox.newMacChat')),
  deleteMacChat: (topic: Topic): Call => make('assistant.deleteChat', [macChatOf(topic)], t('shared.outbox.deleteMacChat')),
  /** 1.55 (docs/bots.md): a new chat of a bot (open on the Mac now) → its id; one deleted for good. */
  newBotChat: (bot: string): Call => make('bots.newChat', [bot], t('shared.outbox.newMacChat')),
  deleteBotChat: (bot: string, topic: Topic): Call => make('bots.deleteChat', [bot, botChatOf(topic)], t('shared.outbox.deleteMacChat')),
  /** A bot's chat id → its topic: its first (`main`) is `conv:bot:<id>`. */
  botChatTopic: (bot: string, id: string): Topic => (id === 'main' ? `conv:bot:${bot}` : `conv:bot:${bot}:${id}`) as Topic,
  /** A chat's id → its topic: the first (`main`) keeps `conv:mac:assistant`. */
  macChatTopic: (id: string): Topic => (id === 'main' ? 'conv:mac:assistant' : `conv:mac:assistant:${id}`) as Topic,
  /** 1.44 (BLG-74): a chat's category, as its sheet in Work changes it. The setting itself stays the Mac's. */
  settle: (topic: Topic): Call => make('triage.settle', [channelOf(topic)], t('shared.outbox.settle')),
  unsettle: (topic: Topic): Call => make('triage.unsettle', [channelOf(topic)], t('shared.outbox.unsettle')),
  snooze: (topic: Topic, until: number): Call => make('triage.snooze', [channelOf(topic), until], t('shared.outbox.snooze')),
  wake: (topic: Topic): Call => make('triage.wake', [channelOf(topic)], t('shared.outbox.wake')),
  /** A message in a conversation (yours, or shared with you to work in), with photos. */
  send: (topic: Topic, text: string, files?: Files): Call => make('companion.ask', [{ target: { topic }, text, ...withFiles(files) }], t('shared.outbox.sendText', { text: short(text) })),
  /** Ask your Mac in a project: a new conversation there (its topic comes back). */
  ask: (project: string, text: string, files?: Files): Call => make('companion.ask', [{ target: { project }, text, ...withFiles(files) }], t('shared.outbox.askText', { text: short(text) })),
  /**
   * Since 1.5, in a project, what the Mac's project home offers besides a question: a new worktree
   * with Claude on your words (`plan`: it plans first, as the Mac's Plan mode), → its id; or a plan
   * Claude drafts for you to approve, → the plan.
   */
  // `agent` (1.35, BLG-506): who works it; only to a Mac with SINCE.workAgents (the caller checks).
  startWorktree: (project: string, text: string, plan = false, agent?: PickedRef): Call => make('workspaces.startWorktree', [project, text, { quiet: true, ...(plan ? { plan: true } : {}), ...(agent ? { agent } : {}) }], t('shared.outbox.startText', { text: short(text) })),
  /** 1.12: a new worktree with photos: its words and photos go the way a question's do → its topic. */
  startWorktreeWith: (project: string, text: string, plan: boolean, files: Files, agent?: PickedRef): Call => make('companion.ask', [{ target: { project, worktree: true, ...(plan ? { plan: true } : {}), ...(agent ? { agent } : {}) }, text, ...withFiles(files) }], t('shared.outbox.startText', { text: short(text) })),
  createPlan: (project: string, goal: string): Call => make('plans.create', [{ projectId: project, goal }], t('shared.outbox.planText', { text: short(goal) })),
  /** How a plan runs (1.5): Step by Step, Check-ins or Autopilot. */
  setAutonomy: (plan: string, autonomy: 'step' | 'gated' | 'autopilot', label: string): Call => make('plans.setAutonomy', [plan, autonomy], t('shared.outbox.runAs', { label })),
  /** 1.32 (BLG-446): a model of this conversation's runtime, or another runtime's agent (null: your default again). */
  setModel: (topic: Topic, value: string, label: string): Call => make('workbench.setModel', [channelOf(topic), value], t('shared.outbox.use', { label })),
  setAgent: (topic: Topic, agent: { runtime: string; label: string; model?: string } | null, label: string): Call => make('workbench.setAgent', [channelOf(topic), agent], t('shared.outbox.use', { label })),
  stop: (topic: Topic): Call => make('host.stopRun', [channelOf(topic)], t('shared.outbox.stop')),
  /** 1.38 (BLG-122): external agents: who holds a grant, what they did, and stopping them. */
  externalAgents: (): Call => make('external.agents', [], t('shared.outbox.externalAgents')),
  // 1.52 (docs/routing.md): your runs through combos, how tasks went, savings and suggestions (read-only).
  routingUsage: (): Call => make('routing.usage', [], t('shared.outbox.routingUsage')),
  externalActivity: (kind?: 'allowed' | 'asked' | 'refused'): Call => make('external.activity', [kind ? { kind } : {}], t('shared.outbox.externalActivity')),
  externalStop: (agent: string, name: string): Call => make('external.stopAgent', [agent], t('shared.outbox.stopName', { name: short(name) })),
  externalStopAll: (): Call => make('external.stopAll', [], t('shared.outbox.externalStopAll')),
  externalRevoke: (agent: string, name: string): Call => make('external.revoke', [agent], t('shared.outbox.revokeName', { name: short(name) })),
  /** Give a conversation the Mac's terminal drives back to the chat (1.36, BLG-534). */
  takeOver: (topic: Topic): Call => make('agentTerm.takeOver', [channelOf(topic).replace(/^ws:/, '')], t('shared.outbox.takeOver')),
  /** A request you asked of a friend's Claude (a `conv:task:<id>`): stop it, or (1.27) remove it from your lists. */
  /** 1.27: take a needs-you item off every list (here and the Mac's) without answering it. */
  dismissNeed: (id: string): Call => make('needs.dismiss', [id], t('shared.outbox.dismissNeed')),
  cancelTask: (id: string): Call => make('gateway.cancel', [id], t('shared.outbox.cancelTask')),
  forgetTask: (id: string): Call => make('gateway.forget', [id], t('shared.outbox.forgetTask')),
  /**
   * While Claude works, as the Mac's composer: Steer gives it your words at its next step (never
   * stopping it), Queue lets it finish first. The same `session.submit` the
   * Mac sends (`urgent` for Steer).
   */
  steer: (topic: Topic, text: string): Call => make('session.submit', [text, { channel: channelOf(topic), urgent: true }], t('shared.outbox.steerText', { text: short(text) })),
  queue: (topic: Topic, text: string): Call => make('session.submit', [text, { channel: channelOf(topic) }], t('shared.outbox.queueText', { text: short(text) })),
  /** A queued message of yours: steer with it now, or take it out of the queue. */
  steerQueued: (id: string): Call => make('host.promote', [id], t('shared.outbox.steerQueued')),
  unqueue: (id: string): Call => make('host.cancelQueued', [id], t('shared.outbox.unqueue')),
  /** Bring Beluga on your Mac to the front on this (a topic, or a needs-you item without one). */
  openOnMac: (target: { topic?: Topic; need?: string }): Call => make('companion.openOnMac', [{ ...(target.topic ? { topic: target.topic } : {}), ...(target.need ? { need: target.need } : {}) }], t('shared.outbox.openOnMac')),
  /** A project's icon, by the checksum its views carry. */
  icon: (sum: string): Call => make('companion.icon', [sum], t('shared.outbox.icon')),
  /** A task: a comment, or a new status (as dragging it on the Mac's board). */
  comment: (key: string, text: string): Call => make('board.comment', [key, text], t('shared.outbox.commentOn', { key })),
  move: (key: string, status: string, label: string): Call => make('board.move', [key, status as never], t('shared.outbox.moveTo', { key, label })),
  /** Start a task in a new worktree with Claude on it (the Mac's Start with Claude) → the worktree's id. */
  // `agent` (1.35, BLG-506, Start with…): who works this start; only to a Mac with SINCE.workAgents (the caller checks).
  start: (key: string, agent?: PickedRef): Call => make('board.start', [key, { claude: true, ...(agent ? { agent } : {}) }], agent ? t('shared.outbox.startWith', { key, agent: agent.label }) : t('shared.outbox.startKey', { key })),
  /** 1.35 (BLG-498): who works a task from its next start (null: your default) → what happened, in words. */
  setTaskAgent: (key: string, agent: { runtime: string; label: string; model?: string } | null, label: string): Call => make('board.setAgent', [key, agent], `${key}: ${label}`),
  /** 1.35 (BLG-498): who works a plan's milestones and tasks from here on (null: your default) → in words. */
  setPlanAgent: (planId: string, agent: { runtime: string; label: string; model?: string } | null, label: string): Call => make('plans.setWorkAgent', [planId, agent], t('shared.outbox.planAgent', { label })),
  /** A task described in words: Claude's draft first, then it's added. */
  // 1.24 (BLG-322) `several`: only to a Mac that has it (SINCE.severalTasks); an older one drafts one task.
  draftTask: (projectId: string, text: string, several = false): Call => make('companion.draftTask', [{ projectId, text, ...(several ? { several } : {}) }], t('shared.outbox.draftTask')),
  // A draft with `more` (1.24) adds them all: what the Mac drafted with `several`, as it came.
  addTask: (projectId: string, d: PhoneDraft & { more?: PhoneDraft[]; epic?: boolean }): Call =>
    make('companion.addTask', [{ projectId, ...d }], d.more?.length ? t('shared.outbox.addTasks', { count: d.more.length + 1 }) : t('shared.outbox.addText', { text: short(d.title) })),
  /** A live view's rows: the Mac runs its source (one your own Claude's view names) and sends the page. */
  viewFetch: (a: { topic: Topic; turn: string; block: number; query: object; source?: object; confirm?: boolean; fresh?: boolean; text?: boolean }): Call => make('companion.viewFetch', [a as never], t('shared.outbox.viewFetch')),
  /** Merging a worktree (its conversation): look first, merge, Claude resolves the conflicts. */
  mergeCheck: (topic: Topic): Call => make('companion.mergeCheck', [topic], t('shared.outbox.mergeCheck')),
  merge: (topic: Topic): Call => make('companion.merge', [topic], t('shared.outbox.merge')),
  resolve: (topic: Topic): Call => make('companion.resolve', [topic], t('shared.outbox.resolve')),
  /** 1.8: one of a worktree's branch steps (Archive, Squash and Merge, Fix with Claude…), as the Mac's toolbar does it. */
  branchStep: (topic: Topic, step: PhoneBranchStep, label: string, children?: ThreadChildren): Call => make('companion.branchStep', children ? [topic, step, children] : [topic, step], label),
  /** 1.47: one child thread and those under it stop, as the Mac's Threads panel does it. */
  stopThread: (id: string): Call => make('threads.stop', [id], t('shared.outbox.stopThread')),
  stopThreads: (id: string): Call => make('threads.stopAll', [id], t('shared.outbox.stopThreads')),
  /** Your steered message Claude hasn't read yet, now: its step stops and it reads it next. */
  steerNow: (request: string): Call => make('host.steerNow', [request], t('shared.outbox.steerNow')),
  /** 1.43: your steered message Claude hasn't read yet, taken back → { cancelled, prompt: its words, for the box }. */
  cancelSteer: (request: string): Call => make('host.cancelSteer', [request], t('shared.outbox.cancelSteer')),
  /** 1.28 (BLG-387): a message you sent, edited: the conversation rewinds to it ('here') or goes on in a new fork → where it went on. */
  editPrompt: (ws: string, turn: string, text: string, mode: 'here' | 'fork'): Call => make('workspaces.editPrompt', [ws, turn, text, mode], t(mode === 'here' ? 'shared.outbox.rewindSend' : 'shared.outbox.forkSend')),
  /** 1.7: a worktree's files, read-only: a folder ('' is the top), names that match, a page of a file. */
  filesList: (topic: Topic, path: string): Call => make('companion.files.list', [topic, path], t('shared.outbox.filesList')),
  filesFind: (topic: Topic, query: string): Call => make('companion.files.find', [topic, query], t('shared.outbox.filesFind')),
  filesRead: (topic: Topic, path: string, off = 0): Call => make('companion.files.read', [topic, path, ...(off ? [{ off }] : [])] as never, t('shared.outbox.filesRead')),
  /** 1.7: a worktree's terminals, shared with the Mac: list, open (its shell, one of them, or a new one), close for everyone. */
  terminals: (topic: Topic): Call => make('companion.terminals', [topic], t('shared.outbox.terminals')),
  termOpen: (topic: Topic, opts: { key?: string; fresh?: boolean } = {}): Call => make('companion.termOpen', [topic, opts], t('shared.outbox.termOpen')),
  termClose: (key: string): Call => make('companion.termClose', [key], t('shared.outbox.termClose')),
  older: (topic: Topic, before: string): Call => make('companion.older', [topic, { before }], t('shared.outbox.older')),
  /** 1.10: one sub-agent of a turn, opened: its activity in words and the report it gave back. */
  subAgent: (topic: Topic, turn: string, id: string): Call => make('companion.subAgent', [topic, turn, id], t('shared.outbox.subAgent')),
  /** 1.11: which conversations files were saved from are archived or deleted on the Mac. */
  gone: (topics: readonly string[]): Call => make('companion.gone', [[...topics]], t('shared.outbox.gone')),
  /** 1.16 (BLG-140): the Mac's voice models, getting one there now, and a recording it writes down. */
  voice: (): Call => make('companion.voice', [], t('shared.outbox.voice')),
  voicePrepare: (model: VoiceModelId): Call => make('companion.voicePrepare', [model], t('shared.outbox.voicePrepare')),
  transcribe: (audio: string, model: VoiceModelId, language: string, prompt?: string): Call => make('companion.transcribe', [{ audio, model, language, ...(prompt ? { prompt } : {}) }], t('shared.outbox.transcribe')),
  /** Write in a friends' chat (with photos, or asking Claude). */
  /** Ask a friend's Claude to do it on their Mac (their chat answer offered it): a request, as from their card. */
  request: (to: string, ask: string, needs?: readonly ('project' | 'shell' | 'files' | 'screen' | 'device')[]): Call => make('gateway.ask', [to, ask, needs?.length ? { needs: [...needs] } : undefined], t('shared.outbox.askText', { text: short(ask) })),
  /** `ask`: whose Claude answers too: everyone's ('all') or the chosen people's (peer ids, you included). */
  chat: (topic: Topic, text: string, opts: { files?: Files; ask?: 'all' | readonly string[] } = {}): Call =>
    make('companion.post', [{ conversation: conversationOf(topic), text, ...withFiles(opts.files), ...(opts.ask ? { ask: opts.ask === 'all' ? ('all' as const) : [...opts.ask] } : {}) }], opts.files?.length ? t('shared.outbox.sendPhoto') : t('shared.outbox.messageText', { text: short(text) })),
  read: (topic: Topic): Call => make('network.read', [conversationOf(topic)], t('shared.outbox.read')),
  /** 1.30 (BLG-429): delete a direct message (`everyone`: yours, from their Mac too), edit your own, clear the chat on the Mac. */
  deleteMessage: (topic: Topic, id: string, everyone: boolean): Call => make('network.messages.delete', [conversationOf(topic), id, everyone ? { everyone: true } : {}], t('shared.outbox.deleteMessage')),
  editMessage: (topic: Topic, id: string, text: string): Call => make('network.messages.edit', [conversationOf(topic), id, text], t('shared.outbox.editTo', { text: short(text) })),
  clearChat: (topic: Topic): Call => make('network.clear', [conversationOf(topic)], t('shared.outbox.clearChat')),
  /** 1.41 (BLG-702): an emoji on a person's message in the room's or a workspace's chat (`on`), or yours taken off. */
  reactTurn: (topic: Topic, id: string, emoji: string, on: boolean): Call => make('session.react', [channelOf(topic), id, emoji, on], on ? t('shared.outbox.react', { emoji }) : t('shared.outbox.takeBack', { emoji })),
  /** 1.41 (BLG-702): put an emoji on a message (`on`) or take yours off. */
  react: (topic: Topic, id: string, emoji: string, on: boolean): Call => make('network.messages.react', [conversationOf(topic), id, emoji, on], on ? t('shared.outbox.react', { emoji }) : t('shared.outbox.takeBack', { emoji })),
  /** 1.34 (BLG-466): a dialogue between agents: Stop it, or Continue? → yes. */
  dialogueStop: (id: string): Call => make('dialogues.stop', [id], t('shared.outbox.dialogueStop')),
  dialogueContinue: (id: string): Call => make('dialogues.continue', [id], t('shared.outbox.dialogueContinue')),
  dialogueConfirm: (id: string): Call => make('dialogues.confirm', [id], t('shared.outbox.dialogueConfirm')),
  /** Ask a friend's Claude yourself; the answer (and files) come back in the topic it returns. */
  askPerson: (peerId: string, name: string, text: string): Call => make('companion.askPerson', [{ peerId, text }], t('shared.outbox.askPerson', { name })),
  screenshot: (peerId: string, name: string): Call => make('companion.askPerson', [{ peerId, text: 'Take a screenshot of your desktop and send it to me.', needs: ['screen'] }], t('shared.outbox.screenshotOf', { name })),
  // Sentinel (1.21, docs/sentinel.md): Run Now, Pause / Turn On, one run with its report's text.
  sentinelRun: (id: string, name: string): Call => make('sentinel.run', [id], t('shared.outbox.runName', { name: short(name) })),
  sentinelPause: (id: string, paused: boolean, name: string): Call => make('sentinel.pause', [id, paused], t(paused ? 'shared.outbox.pauseName' : 'shared.outbox.turnOnName', { name: short(name) })),
  sentinelRunGet: (runId: string): Call => make('sentinel.runGet', [runId], t('shared.outbox.sentinelRunGet')),
  /** 1.22 (BLG-244): Refresh a dashboard (Run Now on each sentinel it draws from, one at a time) → { total }; a number over time. */
  dashboardRefresh: (id: string, name: string): Call => make('dashboard.refresh', [id], t('shared.outbox.refreshName', { name: short(name) })),
  metricRead: (sentinelId: string, name: string, since?: number): Call => make('sentinel.metricRead', since === undefined ? [sentinelId, name] : [sentinelId, name, since], t('shared.outbox.metricRead')),
  /** 1.29 (BLG-386): a table's action button runs its sentinel with the row; a document the phone doesn't show opens on the Mac. */
  sentinelRunRow: (sentinelId: string, metric: string, column: string, row: Record<string, string | number | boolean | null>, words: string): Call => make('sentinel.runRow', [sentinelId, metric, column, row], short(words)),
  /** 1.29 (BLG-392): what a sentinel keeps (its metrics' histories and runs' files, as refs), and a run's file opened on the Mac. */
  dataList: (sentinelId: string): Call => make('sentinel.dataList', [sentinelId], t('shared.outbox.dataList')),
  runFileOpen: (runId: string, name: string, label: string): Call => make('sentinel.runFileOpen', [runId, name], t('shared.outbox.openOnMacName', { name: short(label) })),
  documentOpen: (sentinelId: string, metric: string, column: string, value: string, storage: boolean, name: string): Call => make(storage ? 'sentinel.storageOpen' : 'sentinel.documentOpen', [sentinelId, metric, column, value], t('shared.outbox.openOnMacName', { name: short(name) })),
  /** This phone signs out on the Mac (its certificate goes). */
  signOut: (): Call => make('companion.signOut', [], t('shared.outbox.signOut')),

  /** One of a needs-you item's buttons, as the Mac wrote it. */
  action: (item: NeedsYou, action: NeedsYou['actions'][number]): Call => ({ method: action.method as PhoneMethod, args: action.args as never, label: `${action.label}: ${short(item.title)}` }),
  /**
   * Your own answer (picked options, or words) through the item's `answer` template: the value goes
   * at `slot` inside a copy of `args` (several picks joined with `join`, or as a list with `list`).
   */
  answer(item: NeedsYou, value: string | readonly string[]): Call | undefined {
    const t = item.answer;
    if (!t) return undefined;
    const filled = Array.isArray(value) ? (t.list ? [...value] : value.join(t.join ?? ', ')) : value;
    const args = structuredCloneish(t.args);
    let at: unknown = args;
    t.slot.forEach((key, i) => {
      const box = at as Record<string | number, unknown>;
      if (i === t.slot.length - 1) box[key] = filled;
      else {
        if (box[key] === undefined || box[key] === null) box[key] = typeof t.slot[i + 1] === 'number' ? [] : {};
        at = box[key];
      }
    });
    const shown = Array.isArray(filled) ? filled.join(', ') : String(filled);
    return { method: t.method as PhoneMethod, args: args as never, label: `${t.label ?? 'Answer'}: ${short(shown)}` };
  },
};

/** A deep copy of JSON-shaped args (the template is the view's; it must stay untouched). */
const structuredCloneish = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
