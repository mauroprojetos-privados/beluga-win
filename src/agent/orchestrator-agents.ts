import type { RunExecutor, RunOrchestrator } from './types.js';

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
function rules(can: RunExecutor['can']): string {
  const may = can === 'read' ? 'Read only: never change a file, never run commands.' : can === 'run' ? 'You may run commands to check (typecheck, tests, builds, git status), never to change files: no edits, no installs, no commits.' : 'You may edit files, only the ones the request names.';
  return (
    `${may}\n` +
    'Answer briefly: what you found, each point with file:line, and what you could not confirm, said plainly as "not confirmed". ' +
    'No long quotes of code: the agent that sent you reads what it needs. Stop as soon as you have the answer.'
  );
}

/** One executor as the SDK's agent: a short, fixed prompt per role. */
export function executorDefinition(e: RunExecutor): ExecutorDefinition {
  const role = ROLE[e.name] ?? GENERIC;
  return {
    description: e.description ?? role.description,
    prompt: `${role.job}\n${rules(e.can)}`,
    tools: executorTools(e.can),
    ...(e.model ? { model: e.model } : {}),
    maxTurns: EXECUTOR_MAX_TURNS,
  };
}

/** The `agents` option for a run: one per executor, leaving out the names `taken` (a bot's own agents). */
export function orchestratorAgents(o: RunOrchestrator | undefined, taken: ReadonlySet<string> = new Set()): Record<string, ExecutorDefinition> | undefined {
  const kept = (o?.executors ?? []).filter((e) => !taken.has(e.name));
  return kept.length ? Object.fromEntries(kept.map((e) => [e.name, executorDefinition(e)])) : undefined;
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
