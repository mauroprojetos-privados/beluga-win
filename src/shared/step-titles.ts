import { editDiff } from './line-diff.js';
import { type Key, type Params, t, translator } from './i18n/index.js';
import { underPart } from './path-inside.js';

/**
 * A step in words people use, never a tool's name or an id: "Read src/auth.ts", "Ran npm test",
 * "Asked bob's Claude: run the tests", "Edited src/auth.ts (+12 −3)". `done` is how it reads once
 * it's finished, `doing` while it's the step Claude is on. Steps that involve someone say who
 * (`person`, for their avatar) and, for Beluga's tasks between Claudes, which task (`task`).
 * Browser-safe: the core names steps with it, and the Mac app names the one-line steps it
 * gets from someone else's Claude.
 */

export interface HumanStep {
  readonly done: string;
  readonly doing: string;
  /** Someone else involved (their name): their avatar shows. */
  readonly person?: string;
  /** A task between Claudes (Beluga's gateway): its live state can be shown. */
  readonly task?: string;
  /** Claude waits on someone (the waiting row). */
  readonly wait?: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, max = 72): string => {
  const t = oneLine(s);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const firstLine = (s: string, max = 72): string => clip(s.split('\n').find((l) => l.trim()) ?? '', max);
const base = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const rel = (p: string, cwd?: string): string => (cwd ? underPart(cwd, p) : undefined) ?? p;
const both = (done: string, doing: string, extra: Omit<HumanStep, 'done' | 'doing'> = {}): HumanStep => ({ done, doing, ...extra });
const same = (text: string, extra: Omit<HumanStep, 'done' | 'doing'> = {}): HumanStep => both(text, text, extra);

/** "+12 −3" for an edit (from the text it replaced), or "" when it can't tell. */
function editCounts(tool: string, input: Readonly<Record<string, unknown>>): string {
  const lines = (s: string): number => (s ? s.replace(/\n$/, '').split('\n').length : 0);
  if (tool === 'Write') return input.content !== undefined ? `+${lines(str(input.content))}` : '';
  const edits = tool === 'MultiEdit' && Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [input];
  let add = 0;
  let del = 0;
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return '';
    for (const l of editDiff(e.old_string, e.new_string)) {
      if (l.kind === 'add') add++;
      if (l.kind === 'del') del++;
    }
  }
  return add || del ? `+${add} −${del}` : '';
}

/** A short, readable command: its first line, else what Claude said it does. */
function commandOf(input: Readonly<Record<string, unknown>>): string {
  const cmd = str(input.command);
  const desc = str(input.description);
  if (!cmd) return desc;
  const line = cmd.split('\n')[0]!.trim();
  return line.length > 72 && desc ? desc : clip(line);
}

/** The words for an MCP tool's name: "query_docs" → "query docs". */
const spaced = (name: string): string => name.replace(/[_-]+/g, ' ').trim();

/** Words by key: English for the step records the core keeps (humanizeTool), the app's language on a screen (humanizeLine). */
type Say = (key: Key, params?: Params) => string;
const english: Say = translator('en');
const pair = (w: Say, key: string, params?: Params, extra: Omit<HumanStep, 'done' | 'doing'> = {}): HumanStep => both(w(`shared.steps.${key}.done` as Key, params), w(`shared.steps.${key}.doing` as Key, params), extra);
const one = (w: Say, key: string, params?: Params, extra: Omit<HumanStep, 'done' | 'doing'> = {}): HumanStep => same(w(`shared.steps.${key}` as Key, params), extra);

/** Beluga's own tools (the room, and asking other people's Claudes). */
function belugaTool(name: string, input: Readonly<Record<string, unknown>>, w: Say): HumanStep | undefined {
  const person = str(input.person) || str(input.peer);
  const who = person || w('shared.steps.someone');
  const them = person ? { person } : {};
  const task = str(input.task) ? { task: str(input.task) } : {};
  switch (name) {
    case 'who_can':
      return pair(w, 'whoCan');
    case 'ask_person':
    case 'ask_agent': {
      const ask = firstLine(str(input.ask) || str(input.prompt), 64);
      return pair(w, 'ask', { who, rest: ask ? `: ${ask}` : '' }, them);
    }
    case 'wait_for':
      return pair(w, 'waitFor', undefined, { wait: true, ...task });
    case 'check':
      return one(w, 'check', undefined, task);
    case 'cancel':
      return one(w, 'cancel', undefined, task);
    case 'answer_question':
      return both(w(input.skip === true ? 'shared.steps.answerSkip' : 'shared.steps.answer.done'), w('shared.steps.answer.doing'), task);
    case 'run_on':
    case 'run_on_peer': {
      const cmd = clip(str(input.command), 56);
      return pair(w, 'runOn', { who, rest: cmd ? `: ${cmd}` : '' }, them);
    }
    case 'get_file':
    case 'get_peer_file':
      return pair(w, 'getFile', { file: base(str(input.path)) || w('shared.steps.aFile'), who }, them);
    case 'send_file':
      return pair(w, 'sendFile', { file: base(str(input.path)) || w('shared.steps.aFile'), who }, them);
    case 'list_peers':
      return pair(w, 'listPeers');
    case 'list_peer_files':
      return pair(w, 'listPeerFiles', { who }, them);
    case 'read_peer_file':
      return pair(w, 'readPeerFile', { file: base(str(input.path)), who }, them);
    case 'send_chat':
      return one(w, 'sendChat', { rest: str(input.text) ? `: ${firstLine(str(input.text), 60)}` : '' });
    case 'write_report':
      return both(w('shared.steps.writeReport.done', { rest: str(input.title) ? ` “${clip(str(input.title), 60)}”` : '' }), w('shared.steps.writeReport.doing'));
    case 'continue_in_worktree':
      return pair(w, 'continueWorktree');
    case 'screenshot':
      return both(str(input.app) ? w('shared.steps.screenshotApp', { app: str(input.app) }) : w('shared.steps.screenshot.done'), w('shared.steps.screenshot.doing'));
    case 'device_info':
      return pair(w, 'deviceInfo');
    default:
      return undefined;
  }
}

/** A tool call in words, from its name and input. Paths read relative to `cwd`. English: the core keeps these on its step records. */
export function humanizeTool(tool: string, input: Readonly<Record<string, unknown>> = {}, cwd?: string): HumanStep {
  return toolWords(tool, input, cwd, english);
}

function toolWords(tool: string, input: Readonly<Record<string, unknown>>, cwd: string | undefined, w: Say): HumanStep {
  const file = rel(str(input.file_path) || str(input.notebook_path) || str(input.path), cwd);
  const aFile = file || w('shared.steps.aFile');
  switch (tool) {
    case 'Read':
      return pair(w, 'read', { file: aFile });
    case 'Write':
    case 'Edit':
    case 'MultiEdit': {
      const n = editCounts(tool, input);
      return pair(w, tool === 'Write' ? 'write' : 'edit', { file: aFile, rest: n ? ` (${n})` : '' });
    }
    case 'NotebookEdit':
      return pair(w, 'edit', { file: file || w('shared.steps.aNotebook'), rest: '' });
    case 'Bash': {
      const cmd = commandOf(input);
      return cmd ? pair(w, 'ran', { cmd }) : pair(w, 'ranAny');
    }
    case 'BashOutput':
      return pair(w, 'bashOutput');
    case 'KillShell':
    case 'KillBash':
      return one(w, 'killShell');
    case 'Grep': {
      const pattern = clip(str(input.pattern), 48);
      return file ? pair(w, 'grepIn', { pattern, file }) : pair(w, 'grep', { pattern });
    }
    case 'Glob':
      return pair(w, 'glob', { pattern: clip(str(input.pattern), 48) });
    case 'LS':
      return pair(w, 'ls', { file: file || w('shared.steps.aFolder') });
    case 'WebFetch': {
      const url = str(input.url).replace(/^https?:\/\//, '').replace(/\/$/, '');
      return pair(w, 'read', { file: clip(url, 60) || w('shared.steps.aWebPage') });
    }
    case 'WebSearch':
      return pair(w, 'webSearch', { query: clip(str(input.query), 56) });
    case 'Task':
    case 'Agent':
      return pair(w, 'subAgent', { what: clip(str(input.description) || str(input.subagent_type) || w('shared.steps.aTask'), 60) });
    case 'SendMessage': {
      const to = str(input.to) || str(input.recipient) || w('shared.steps.anAgent');
      const about = firstLine(str(input.summary) || str(input.message), 56);
      return pair(w, 'message', { to, rest: about ? `: ${about}` : '' });
    }
    case 'TodoWrite':
      return pair(w, 'todo');
    case 'ToolSearch':
      return pair(w, 'toolSearch');
    case 'Skill':
      return str(input.skill) ? pair(w, 'skill', { skill: str(input.skill) }) : pair(w, 'skillAny');
    case 'AskUserQuestion':
      return pair(w, 'askUser');
    case 'ExitPlanMode':
      return pair(w, 'exitPlan');
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
      if (mcp) {
        // Steps kept from before the rename name the servers klaud, klaud_task, klaud_board…
        const server = mcp[1]!.replace(/^klaud(?=_|$)/, 'beluga');
        const own = belugaTool(mcp[2]!, input, w);
        if (own && (server === 'beluga' || server === 'beluga_task')) return own;
        return pair(w, 'mcp', { tool: spaced(mcp[2]!), server: spaced(server) });
      }
      return belugaTool(tool, input, w) ?? pair(w, 'used', { tool: spaced(tool) });
    }
  }
}

/** Which input a one-line step's words stand for (summarizeTool's "Bash npm test", "Read src/a.ts"). */
const LINE_ARG: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  LS: 'path',
  WebFetch: 'url',
  WebSearch: 'query',
  ask_person: 'person',
  ask_agent: 'peer',
  run_on: 'command',
  run_on_peer: 'command',
  get_file: 'path',
  get_peer_file: 'path',
  read_peer_file: 'path',
  send_file: 'path',
  wait_for: 'task',
  check: 'task',
  cancel: 'task',
  write_report: 'title',
};

/** Tools a one-line step may start with (anything else is said as it was: "24 passed"). */
const KNOWN = new Set([
  ...Object.keys(LINE_ARG),
  'BashOutput', 'KillShell', 'KillBash', 'Task', 'Agent', 'SendMessage', 'TodoWrite', 'ToolSearch', 'Skill', 'AskUserQuestion', 'ExitPlanMode',
  'who_can', 'answer_question', 'list_peers', 'list_peer_files', 'send_chat', 'continue_in_worktree', 'screenshot', 'device_info',
]);

/** A one-line step ("Bash npm test", "ask_person bob", "wait_for t_123") in words, in the app's language (the screens read it). */
export function humanizeLine(line: string): HumanStep {
  const m = /^((?:mcp__)?[A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(line.trim());
  const name = m?.[1] ?? '';
  if (!m || (!KNOWN.has(name) && !name.startsWith('mcp__'))) return same(line);
  const rest = (m[2] ?? '').trim().replace(/^"(.*)"$/, '$1');
  const key = LINE_ARG[name];
  // Grep's line is the pattern (quoted) and then where.
  const value = name === 'Grep' ? (/^"([^"]*)"/.exec(m[2] ?? '')?.[1] ?? rest.split(' ')[0] ?? '') : rest;
  return toolWords(name, key && value ? { [key]: value } : {}, undefined, t);
}
