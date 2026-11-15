/**
 * Your sub-agents and the stack (docs/stack.md › Checklist, items 15–18): the `.claude/agents/*.md`
 * files of yours (~/.claude/agents), of a project and of each bot. A sub-agent with a `tools:` line
 * gets only those tools, so without Bash (RTK, token-goat, gls, GitNexus's CLI) or the stack's MCPs it
 * reads whole files again; without `model:` it runs on the main model. Read here, and fixed only on
 * your yes (core/stack/checklist.ts keeps a backup first). Every touch of the disk goes through the deps.
 */

export interface AgentDeps {
  readonly readFile: (file: string) => string | undefined;
  /** A folder's file names (none when it isn't there). */
  readonly listDir: (dir: string) => readonly string[];
}

/** Whose agent it is. */
export type AgentOwner = 'user' | 'project' | 'bot';

export interface AgentFile {
  readonly file: string;
  /** Its `name:`, else its file name. */
  readonly name: string;
  readonly owner: AgentOwner;
  /** Its `tools:` list; unset when it has none (it gets every tool). */
  readonly tools?: readonly string[];
  /** Its `model:`; unset when it has none (it runs on the main model). */
  readonly model?: string;
  readonly text: string;
}

/** The stack's MCPs, as a `tools:` line names them. */
export const STACK_MCP_TOOLS = ['mcp__gitnexus__*', 'mcp__openviking__*'] as const;

/** The tool the Fix adds to an agent that has no stack. */
export const STACK_TOOL_FIX = 'mcp__gitnexus__*';

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/** A `tools:` value: `Read, Grep`, `[Read, Grep]` or a YAML list below it. */
function toolsOf(front: string): string[] | undefined {
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((l) => /^tools:/.test(l));
  if (at < 0) return undefined;
  const inline = lines[at]!.replace(/^tools:\s*/, '').trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
  const list: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^\s+-\s*(.+)$/.exec(l);
    if (!m) break;
    list.push(m[1]!.trim().replace(/^(['"])(.*)\1$/, '$2'));
  }
  return list;
}

/** One agent file read (name, tools, model). */
export function parseAgent(file: string, text: string, owner: AgentOwner): AgentFile {
  const front = FRONT.exec(text)?.[1] ?? '';
  const field = (key: string): string | undefined => {
    const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(front);
    const v = m?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
    return v || undefined;
  };
  const base = file.split(/[\\/]/).pop()!.replace(/\.md$/i, '');
  const tools = toolsOf(front);
  const model = field('model');
  return { file, name: field('name') ?? base, owner, text, ...(tools ? { tools } : {}), ...(model ? { model } : {}) };
}

/** The agents in a `.claude/agents` folder (its `*.md`, in name order). */
export function readAgents(dir: string, owner: AgentOwner, deps: AgentDeps): AgentFile[] {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return [...deps.listDir(dir)]
    .filter((f) => /\.md$/i.test(f))
    .sort()
    .flatMap((f) => {
      const file = `${dir.replace(/[\\/]+$/, '')}${sep}${f}`;
      const text = deps.readFile(file);
      return text === undefined ? [] : [parseAgent(file, text, owner)];
    });
}

const isStackMcp = (tool: string): boolean => /^mcp__(gitnexus|openviking)__/.test(tool);

/** No stack at all: a `tools:` list with neither Bash nor the stack's MCPs. */
export const stackless = (a: AgentFile): boolean => Boolean(a.tools) && !a.tools!.some((t) => t === 'Bash' || t.startsWith('Bash(') || isStackMcp(t));

/** The stack only through Bash (the CLIs), without GitNexus's MCP (no `impact`, no `detect_changes`). */
export const cliOnly = (a: AgentFile): boolean => Boolean(a.tools) && !stackless(a) && !a.tools!.some(isStackMcp);

const WRITES = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/** An agent that only reads and runs (explore, executor, tester…): the kind a cheap model serves. */
export const readsOnly = (a: AgentFile): boolean =>
  a.tools ? !a.tools.some((t) => WRITES.includes(t)) : /explor|executor|search|tester|testador|reader|scout|finder/i.test(a.name);

/** Whether an agent mentions the stack's rules in its own prompt. */
export const mentionsStack = (a: AgentFile): boolean => /token-goat|gitnexus|\bgls\b|\brtk\b|## Stack/i.test(a.text.replace(FRONT, ''));

/** The file with `add` appended to its `tools:` (inline or a YAML list); unchanged when it's there or has no `tools:`. */
export function withTool(text: string, add: string): string {
  const m = FRONT.exec(text);
  if (!m) return text;
  const front = m[1]!;
  const tools = toolsOf(front);
  if (!tools || tools.includes(add)) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((l) => /^tools:/.test(l));
  const inline = lines[at]!.replace(/^tools:\s*/, '').trim();
  if (inline) {
    lines[at] = inline.startsWith('[') ? `tools: ${inline.replace(/\]\s*$/, `, ${add}]`)}` : `tools: ${inline}, ${add}`;
  } else {
    let end = at + 1;
    while (end < lines.length && /^\s+-/.test(lines[end]!)) end++;
    const indent = /^(\s+)-/.exec(lines[at + 1] ?? '')?.[1] ?? '  ';
    lines.splice(end, 0, `${indent}- ${add}`);
  }
  return text.replace(m[0], `---${eol}${lines.join(eol)}${eol}---${m[2]}`);
}

/** The file with `model:` set (added after `name:`, or replacing the one there). */
export function withModel(text: string, model: string): string {
  const m = FRONT.exec(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (!m) return `---${eol}model: ${model}${eol}---${eol}${text}`;
  const lines = m[1]!.split(/\r?\n/);
  const at = lines.findIndex((l) => /^model:/.test(l));
  if (at >= 0) lines[at] = `model: ${model}`;
  else {
    const name = lines.findIndex((l) => /^name:/.test(l));
    lines.splice(name >= 0 ? name + 1 : lines.length, 0, `model: ${model}`);
  }
  return text.replace(m[0], `---${eol}${lines.join(eol)}${eol}---${m[2]}`);
}
