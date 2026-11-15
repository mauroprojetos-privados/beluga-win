import type { RunExecutor, RunOrchestrator, RunStack } from './types.js';

/**
 * Orchestrator mode in a Claude run (roadmap/modo-orquestrador.md, phase 2; docs/routing.md): the
 * executors become the SDK's own sub-agents (`agents`), each on its own model, so the lead hands a
 * search or a test run to Haiku instead of paying its own model for it. Pure: no SDK, no files.
 *
 * Names: an executor is the sub-agent of its name for Beluga's runs. It replaces one of yours of the
 * same name in ~/.claude/agents (the SDK's `agents` rank above user agents), so to keep yours, name the
 * executor differently, or name it the same to have Beluga's definition used in its runs. A bot's own
 * `.claude/agents/<name>.md` wins: the executor of that name is left out of that bot's runs.
 * The built-in `Explore` (capital E) is a different agent from `explore`.
 */

/** What the SDK takes per agent (AgentDefinition, SDK 0.3.301), the part Beluga sets. */
export interface ExecutorDefinition {
  readonly description: string;
  readonly prompt: string;
  readonly tools: string[];
  readonly model?: string;
  readonly maxTurns: number;
  /** The run's MCP servers it may use, by name (the parent's connection, shared): only what its role needs. */
  readonly mcpServers?: string[];
  /** Without your CLAUDE.md (Stack rules: only the executors): its prompt carries what it needs. */
  readonly omitClaudeMd?: boolean;
}

/** What else an executor's definition depends on: the run's MCP servers (names) and the stack. */
export interface ExecutorContext {
  readonly servers?: ReadonlySet<string>;
  readonly stack?: RunStack;
}

/** Beluga's own tools that only read (the board's task, the plan, the computer): an executor may call them. */
export const BELUGA_READ_TOOLS = ['mcp__beluga_board__task_get', 'mcp__beluga_plan__plan_get', 'mcp__beluga_mac__device_info'] as const;

const READ = ['Glob', 'Grep', 'Read', ...BELUGA_READ_TOOLS];

/** The tools `can` allows: read; run adds Bash (typecheck, tests), never Edit or Write; edit adds those. */
export function executorTools(can: RunExecutor['can']): string[] {
  if (can === 'read') return [...READ];
  if (can === 'run') return [...READ, 'Bash'];
  return [...READ, 'Bash', 'Edit', 'Write', 'MultiEdit'];
}

/** Turns an executor gets: enough to search or run and diagnose, never a whole task. */
export const EXECUTOR_MAX_TURNS = 30;

const ROLE: Readonly<Record<string, { readonly description: string; readonly job: string }>> = {
  explore: {
    description: 'Cheap, fast searcher: finds where something is defined or used across many files, reads long files, maps code, and answers with a short summary citing file:line.',
    job: 'You search and read code for the agent that sent you. Find what it asked for (definitions, uses, call paths), reading only the parts you need.',
  },
  test: {
    description: 'Cheap test runner: runs typecheck, tests or a build, and diagnoses failures in a short report citing file:line.',
    job: 'You run checks for the agent that sent you: the typecheck, the tests or the build it named (or the project’s usual ones), and diagnose each failure from its output and the code.',
  },
  docs: {
    description: 'Cheap reader of documentation: finds and summarizes what the docs, READMEs and comments say on a subject.',
    job: 'You read documentation for the agent that sent you: docs, READMEs, roadmaps and comments, and summarize what they say on its question.',
  },
};

const GENERIC = {
  description: 'Cheap helper for searching, reading and checking: answers with a short summary citing file:line.',
  job: 'You do one bounded piece of searching, reading or checking for the agent that sent you.',
};

/** The rules every executor works by: what it may do, and the answer's shape. */
function rules(can: RunExecutor['can'], readCmds: readonly { readonly say: string }[] = []): string {
  const reading = readCmds.length
    ? `Read only: never change a file. The only commands you run (Bash) are the stack's reading ones, for just one symbol and its callers instead of a whole long file: ${readCmds.map((c) => c.say).join(' or ')}.`
    : 'Read only: never change a file, never run commands.';
  const may = can === 'read' ? reading : can === 'run' ? 'You may run commands to check (typecheck, tests, builds, git status), never to change files: no edits, no installs, no commits.' : 'You may edit files, only the ones the request names.';
  return (
    `${may}\n` +
    'Answer briefly: what you found, each point with file:line, and what you could not confirm, said plainly as "not confirmed". ' +
    'No long quotes of code: the agent that sent you reads what it needs. Stop as soon as you have the answer.'
  );
}

// ---- the stack each executor works with (roadmap/modo-orquestrador.md, phase 2b; docs/stack.md) ----

/**
 * Each role's own MCP servers, by the name you gave them in Claude Code (only those the run has):
 * `explore` gets GitNexus (who calls what); `test` and `docs` none. A sub-agent with a `tools` list
 * sees no other server's tools, so every other MCP of yours stays out of the executors' context.
 */
export const ROLE_MCP: Readonly<Record<string, readonly string[]>> = { explore: ['gitnexus'] };

/** The stack's commands a read-only executor may run through Bash: one symbol and its callers, nothing that writes or rebuilds. */
const READ_COMMANDS: ReadonlyArray<{ readonly tool: 'token-goat' | 'gls'; readonly re: RegExp; readonly say: string }> = [
  { tool: 'token-goat', re: /^token-goat\s+symbol\s/, say: '`token-goat symbol <name>`' },
  { tool: 'gls', re: /^gls\s+symbol\s/, say: '`gls symbol <file> <name>`' },
];

/** The read-only commands this stack has (token-goat, gls installed). */
const readCommands = (stack: RunStack | undefined): typeof READ_COMMANDS => READ_COMMANDS.filter((c) => stack?.tools.includes(c.tool));

/** An executor that reads code: `explore`, or another read-only one that isn't `docs`. */
const readsCode = (e: RunExecutor): boolean => e.name === 'explore' || (e.can === 'read' && e.name !== 'docs');

/** A role's lines of the stack's rules (docs/stack.md), for its prompt when the rules live only in the executors. */
function stackRules(e: RunExecutor, mcp: readonly string[], stack: RunStack): string {
  const lines: string[] = [];
  if (mcp.includes('gitnexus')) lines.push('- GitNexus (mcp__gitnexus__*) first: who calls what and where something is defined, before opening files.');
  if (readsCode(e)) lines.push('- Never a whole long file: Grep for what you need and Read it with offset and limit.');
  if (e.can !== 'read' && stack.tools.includes('rtk')) lines.push('- RTK shrinks shell output by itself (its hook): run commands normally, and trust the condensed output.');
  return lines.length ? `\nThe stack on this computer (read less, find more):\n${lines.join('\n')}` : '';
}

/** One executor as the SDK's agent: a short, fixed prompt per role, and only the tools and servers its role needs. */
export function executorDefinition(e: RunExecutor, ctx: ExecutorContext = {}): ExecutorDefinition {
  const role = ROLE[e.name] ?? GENERIC;
  const mcp = (ROLE_MCP[e.name] ?? []).filter((name) => ctx.servers?.has(name));
  const tools = executorTools(e.can);
  // A read-only executor that reads code runs the stack's reading commands (the PreToolUse gate lets only those through: executorBashRefusal).
  const readCmds = e.can === 'read' && readsCode(e) ? readCommands(ctx.stack) : [];
  if (readCmds.length) tools.push('Bash');
  tools.push(...mcp.map((name) => `mcp__${name}__*`));
  const inPrompt = ctx.stack?.rulesInPrompt ? stackRules(e, mcp, ctx.stack) : '';
  return {
    description: e.description ?? role.description,
    prompt: `${role.job}\n${rules(e.can, readCmds)}${inPrompt}`,
    tools,
    ...(e.model ? { model: e.model } : {}),
    maxTurns: EXECUTOR_MAX_TURNS,
    ...(mcp.length ? { mcpServers: mcp } : {}),
    ...(ctx.stack?.rulesInPrompt ? { omitClaudeMd: true } : {}),
  };
}

/** The `agents` option for a run: one per executor, leaving out the names `taken` (a bot's own agents). `servers`: the run's MCP servers. */
export function orchestratorAgents(o: RunOrchestrator | undefined, taken: ReadonlySet<string> = new Set(), servers?: ReadonlySet<string>): Record<string, ExecutorDefinition> | undefined {
  const kept = (o?.executors ?? []).filter((e) => !taken.has(e.name));
  const ctx: ExecutorContext = { ...(servers ? { servers } : {}), ...(o?.stack ? { stack: o.stack } : {}) };
  return kept.length ? Object.fromEntries(kept.map((e) => [e.name, executorDefinition(e, ctx)])) : undefined;
}

/** What a shell chains, redirects or substitutes with: a read-only executor's command has none. */
const SHELL_META = /[;&|<>`$(){}\n\\]/;

/**
 * A read-only executor's Bash (it has Bash only for the stack's reading commands): why it may not run
 * this; undefined: it may. Another executor's (can run or edit) is never refused here.
 */
export function executorBashRefusal(o: RunOrchestrator | undefined, agent: string | undefined, command: string): string | undefined {
  const e = agent ? o?.executors.find((x) => x.name === agent) : undefined;
  if (!e || e.can !== 'read') return undefined;
  const cmds = readCommands(o?.stack);
  const line = command.trim().replace(/^rtk\s+/, '');
  if (!SHELL_META.test(line) && cmds.some((c) => c.re.test(line))) return undefined;
  return `You only read: Bash is for ${cmds.map((c) => c.say).join(' and ') || 'nothing'} here, one command without pipes or redirects. Use Glob, Grep and Read for the rest.`;
}

/** A file this long, read whole by an executor, is refused with the stack's way to read part of it. */
export const BIG_READ_LINES = 1000;

/**
 * The token-goat gate (phase 2b): an executor that Reads a long file whole (no offset or limit) is
 * told to read only what it needs. Only executors, and only when token-goat or gls is installed;
 * `lines` counts the file's lines (undefined: unreadable, let it through).
 */
export function bigReadRefusal(o: RunOrchestrator | undefined, agent: string | undefined, tool: string, input: Record<string, unknown>, lines: (file: string) => number | undefined): string | undefined {
  if (tool !== 'Read' || !agent || !o?.executors.some((x) => x.name === agent)) return undefined;
  const cmds = readCommands(o.stack);
  if (!cmds.length || input.offset !== undefined || input.limit !== undefined || typeof input.file_path !== 'string') return undefined;
  const n = lines(input.file_path);
  if (n === undefined || n <= BIG_READ_LINES) return undefined;
  return `This file has ${n} lines: read only what you need. Find the symbol with ${cmds.map((c) => c.say).join(' or ')} (Bash), or Grep for it and Read with offset and limit.`;
}

/** The model built-in sub-agents (Explore, general-purpose) run on: the explore executor's, else the first read-only one's. */
export function subagentModel(o: RunOrchestrator | undefined): string | undefined {
  const all = o?.executors ?? [];
  return (all.find((e) => e.name === 'explore') ?? all.find((e) => e.can === 'read'))?.model;
}

/** What the run's environment gains: CLAUDE_CODE_SUBAGENT_MODEL, so no sub-agent inherits the lead's model. */
export function orchestratorEnv(o: RunOrchestrator | undefined): Record<string, string> {
  const model = subagentModel(o);
  return model ? { CLAUDE_CODE_SUBAGENT_MODEL: model } : {};
}

/**
 * The lead's paragraph (the run's instructions): the text proven in the user's own projects with
 * Claude Code's /modo-orquestrador, where the lead delegated the search and read no code itself.
 */
export function buildOrchestratorAppend(o: RunOrchestrator | undefined, taken: ReadonlySet<string> = new Set()): string {
  const kept = (o?.executors ?? []).filter((e) => !taken.has(e.name));
  if (!o || !kept.length) return '';
  const list = kept.map((e) => `\`${e.name}\` (${e.can === 'read' ? 'reads' : e.can === 'run' ? 'reads and runs checks' : 'reads, runs and edits'})`).join(', ');
  const always = o.delegate === 'always' ? ' Broad searches (Grep/Glob across the project) and test or typecheck runs are refused to you here: send them to an executor.' : '';
  return (
    '\n\nYou are the orchestrator of this conversation. You think, decide and make the edits; the legwork goes to cheap sub-agents, ' +
    `your executors: ${list}. Use the Agent tool with one of these names.\n` +
    '- Delegate searches that sweep many files ("where is X used", "which screens show Y"), long reads you only need summarized, and typecheck or test runs with their diagnosis.\n' +
    '- Do yourself what takes one or two calls, and every edit: delegating those costs more.\n' +
    '- Write the request in full: the executor does not see this conversation. Say the goal, the files or areas, and the shape of the answer.\n' +
    '- Distrust the summary: check the critical lines yourself before editing on its word.\n' +
    `- Independent pieces go to executors in parallel, in one message.${always}`
  );
}

/** Test commands and typechecks a lead hands to `test` when delegating always. */
const CHECK_RUN = /(^|[\s;&|(])((npm|pnpm|yarn|bun)\s+(run\s+)?(test|typecheck|check|lint)\b|npx\s+(vitest|jest|tsc|playwright|mocha)\b|(vitest|jest|pytest|tsc|mocha)\b|go\s+test\b|cargo\s+(test|check|clippy)\b|dotnet\s+test\b|mvn\s+(test|verify)\b|gradle(w)?\s+test\b|make\s+(test|check)\b)/;

/** A Grep or Glob over the whole project (no folder named, or a recursive pattern from the top). */
function broad(tool: string, input: Record<string, unknown>): boolean {
  const where = typeof input.path === 'string' ? input.path.trim() : '';
  const top = !where || where === '.' || where === './';
  if (tool === 'Grep') return top && !(typeof input.glob === 'string' && !input.glob.includes('**') && !input.glob.startsWith('*'));
  if (tool === 'Glob') return top && typeof input.pattern === 'string' && input.pattern.startsWith('**');
  return false;
}

/**
 * With `delegate: "always"`, why the lead may not run this itself (the PreToolUse gate refuses it and
 * names the executor); undefined: it may. Sub-agents' own calls never come here (their hook carries `agent_id`).
 */
export function delegateRefusal(o: RunOrchestrator | undefined, tool: string, input: Record<string, unknown>, taken: ReadonlySet<string> = new Set()): string | undefined {
  if (o?.delegate !== 'always') return undefined;
  const kept = o.executors.filter((e) => !taken.has(e.name));
  if ((tool === 'Grep' || tool === 'Glob') && broad(tool, input)) {
    const to = kept.find((e) => e.name === 'explore') ?? kept.find((e) => e.can === 'read');
    if (to) return `Orchestrator mode: broad searches go to an executor. Hand this to \`${to.name}\` with the Agent tool (say what you are looking for and the answer you need), or search one folder or file yourself.`;
  }
  if (tool === 'Bash' && typeof input.command === 'string' && CHECK_RUN.test(input.command)) {
    const to = kept.find((e) => e.name === 'test') ?? kept.find((e) => e.can === 'run' || e.can === 'edit');
    if (to) return `Orchestrator mode: tests and typechecks go to an executor. Hand this to \`${to.name}\` with the Agent tool (the command, and that you want the failures diagnosed with file:line).`;
  }
  return undefined;
}
