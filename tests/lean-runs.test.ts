import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunInput, RoomBridge, RunOrchestrator } from '../src/agent/types.js';
import { BIG_READ_LINES, bigReadRefusal, executorBashRefusal, executorDefinition, orchestratorAgents } from '../src/agent/orchestrator-agents.js';
import { SKILL_NAME, SavedSkills, SkillList, parseSkillNames, resolveSkills, skillsForRun } from '../src/shared/run-skills.js';
import { skillsAt } from '../src/core/skills-at.js';
import { ProjectFile } from '../src/workspaces/scripts.js';
import { parseBotFile } from '../src/core/bots/schema.js';
import { type ChecklistDeps, STACK_RULES_BLOCK, askFix, claudeMdItem, withoutStackBlock } from '../src/core/stack/checklist.js';

/**
 * Leaner runs (roadmap/modo-orquestrador.md, phase 2b, and skills per project): what the SDK gets,
 * before and after. No token numbers here: what's measured is what reaches the context (the skills
 * listed, each executor's servers, tools and CLAUDE.md), the part a live run's `context` event prices.
 */
const seen: { options?: Options } = {};

vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Options }) =>
    Object.assign(
      (async function* () {
        seen.options = options;
        yield { type: 'system', subtype: 'init', session_id: 's1' };
        for await (const _ of prompt) {
          yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', modelUsage: {}, total_cost_usd: 0 };
          break;
        }
      })(),
      { interrupt: async () => undefined, setModel: async () => undefined },
    ),
}));

const { createClaudeBackend } = await import('../src/agent/runner.js');

const bridge = { selfName: () => 'kay', reportUsage: () => undefined } as unknown as RoomBridge;

/** A Claude Code config of yours in a temporary folder: GitNexus and two other MCP servers. */
function claudeConfig(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lean-claude-'));
  const server = (name: string) => ({ type: 'stdio', command: name, args: ['mcp'] });
  writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { gitnexus: server('gitnexus'), figma: server('figma'), linear: server('linear') } }));
  writeFileSync(path.join(dir, 'settings.json'), '{}');
  return dir;
}

const input = (over: Partial<AgentRunInput> = {}): AgentRunInput => ({
  prompt: 'find where the thing is used',
  requesterName: 'kay',
  viaAgent: false,
  context: [],
  scope: 'full',
  model: 'opus',
  signal: new AbortController().signal,
  onEvent: () => undefined,
  onFileTouched: () => undefined,
  canUseTool: async () => true,
  ...over,
});

async function optionsFor(over: Partial<AgentRunInput> = {}, cwd = os.tmpdir()): Promise<Options> {
  seen.options = undefined;
  await createClaudeBackend({ cwd, autoEdit: false, additionalDirectories: [], bridge }).run(input(over));
  return seen.options!;
}

const ORCHESTRATOR: RunOrchestrator = {
  delegate: 'suggest',
  executors: [
    { name: 'explore', can: 'read', model: 'haiku' },
    { name: 'test', can: 'run', model: 'haiku' },
    { name: 'docs', can: 'read', model: 'haiku' },
  ],
};

const STACK = { tools: ['rtk', 'token-goat', 'gitnexus', 'gls'] as const, rulesInPrompt: true };

describe('skills: the list a run gets', () => {
  it('takes the most specific place’s list, whole', () => {
    expect(resolveSkills({})).toEqual({ skills: 'all' });
    expect(resolveSkills({ settings: ['pdf'] })).toEqual({ skills: ['pdf'], from: 'settings' });
    expect(resolveSkills({ settings: ['pdf'], project: ['deploy', 'deploy'] })).toEqual({ skills: ['deploy'], from: 'project' });
    expect(resolveSkills({ settings: ['pdf'], project: ['deploy'], bot: 'all' })).toEqual({ skills: 'all', from: 'bot' });
    // An empty list is a list: no skills at all.
    expect(resolveSkills({ settings: 'all', project: [] })).toEqual({ skills: [], from: 'project' });
  });

  it('takes exact names only, the way the SDK does (a wildcard would fail the run)', () => {
    for (const ok of ['pdf', 'frontend-design', 'anthropic-skills:docx', 'gsap.core']) expect(SKILL_NAME.test(ok)).toBe(true);
    for (const bad of ['*', 'docs:*', 'pdf *', '/pdf', 'a b', 'x(y)', 'a,b', 'a\\b', ' pdf']) expect(SKILL_NAME.test(bad)).toBe(false);
    expect(SkillList.safeParse(['pdf', 'docs:*']).success).toBe(false);
    // Read from a file you edited by hand: a bad list is unset (every skill), not a failed run.
    expect(SavedSkills.parse(['pdf', '*'])).toBeUndefined();
    expect(ProjectFile.parse({ skills: ['docs:*'] }).skills).toBeUndefined();
    expect(ProjectFile.parse({ skills: ['deploy'] }).skills).toEqual(['deploy']);
    const bot = parseBotFile(JSON.stringify({ version: 1, skills: ['*'], name: 'Supa' }));
    expect(bot.bot.skills).toBeUndefined();
    expect(bot.bot.name).toBe('Supa');
    expect(bot.problems.length).toBeGreaterThan(0);
  });

  it('reads Settings’ text field into names, and says which aren’t one', () => {
    expect(parseSkillNames('pdf, docx\nproject:deploy  pdf')).toEqual({ names: ['pdf', 'docx', 'project:deploy'], bad: [] });
    expect(parseSkillNames('pdf docs:* /x')).toEqual({ names: ['pdf'], bad: ['docs:*', '/x'] });
  });

  it('also names the project’s own skills (Beluga’s plugin of them) for a bare name', () => {
    expect(skillsForRun(['deploy', 'anthropic-skills:pdf'], ['project'])).toEqual(['deploy', 'anthropic-skills:pdf', 'project:deploy']);
    expect(skillsForRun('all', ['project'])).toBe('all');
  });

  it('finds the list in beluga.json and bot.json, over Settings', () => {
    const project = mkdtempSync(path.join(os.tmpdir(), 'lean-project-'));
    writeFileSync(path.join(project, 'beluga.json'), JSON.stringify({ skills: ['deploy'] }));
    const bot = mkdtempSync(path.join(os.tmpdir(), 'lean-bot-'));
    writeFileSync(path.join(bot, 'bot.json'), JSON.stringify({ version: 1, skills: ['supabase'] }));
    expect(skillsAt(['pdf'], {})).toEqual({ skills: ['pdf'], from: 'settings' });
    expect(skillsAt(['pdf'], { cwd: project })).toEqual({ skills: ['deploy'], from: 'project' });
    expect(skillsAt(['pdf'], { cwd: project, botDir: bot })).toEqual({ skills: ['supabase'], from: 'bot' });
    expect(skillsAt(undefined, { cwd: bot })).toEqual({ skills: ['supabase'], from: 'bot' });
    expect(skillsAt(undefined, { cwd: os.tmpdir() })).toEqual({ skills: 'all' });
  });
});

describe('the SDK options, before and after', () => {
  it('a project with skills: [...] passes exactly that list; unset is every skill, as before', async () => {
    const env = { CLAUDE_CONFIG_DIR: claudeConfig() };
    const before = await optionsFor({ ownerMcp: true, env });
    expect(before.skills).toBe('all');
    const after = await optionsFor({ ownerMcp: true, env, skills: ['pdf', 'deploy'] });
    expect(after.skills).toEqual(['pdf', 'deploy']);
    // Nothing else changes.
    const { skills: _b, abortController: _ab, ...restBefore } = before;
    const { skills: _a, abortController: _aa, ...restAfter } = after;
    expect(Object.keys(restAfter).sort()).toEqual(Object.keys(restBefore).sort());
    // A friend's run loads nothing of yours, skills included.
    expect(await optionsFor({ skills: ['pdf'] })).not.toHaveProperty('skills');
  });

  it('a project’s own skills come in under their plugin’s name too', async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), 'lean-skills-'));
    mkdirSync(path.join(project, '.claude', 'skills', 'deploy'), { recursive: true });
    writeFileSync(path.join(project, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ship it\n---\nShip it.');
    const o = await optionsFor({ ownerMcp: true, env: { CLAUDE_CONFIG_DIR: claudeConfig() }, skills: ['deploy'] }, project);
    expect(o.plugins?.length).toBe(1);
    expect(o.skills).toEqual(['deploy', 'project:deploy']);
  });

  it('executors carry only their role’s MCP servers and tools', async () => {
    const env = { CLAUDE_CONFIG_DIR: claudeConfig() };
    const o = await optionsFor({ ownerMcp: true, env, orchestrator: ORCHESTRATOR });
    const lead = Object.keys(o.mcpServers ?? {});
    expect(lead).toEqual(expect.arrayContaining(['gitnexus', 'figma', 'linear']));
    const { explore, test, docs } = o.agents!;
    // explore: GitNexus, and nothing else of yours.
    expect(explore!.mcpServers).toEqual(['gitnexus']);
    expect(explore!.tools).toContain('mcp__gitnexus__*');
    expect(explore!.tools!.filter((t) => t.startsWith('mcp__') && !t.startsWith('mcp__beluga_'))).toEqual(['mcp__gitnexus__*']);
    // test and docs: none.
    for (const e of [test!, docs!]) {
      expect(e.mcpServers).toBeUndefined();
      expect(e.tools!.some((t) => t.startsWith('mcp__') && !t.startsWith('mcp__beluga_'))).toBe(false);
    }
    // No executor lists skills (no Skill tool, none preloaded).
    for (const e of Object.values(o.agents!)) {
      expect(e.tools).not.toContain('Skill');
      expect(e.skills).toBeUndefined();
    }
  });

  it('a bot’s run without GitNexus gives explore no server', async () => {
    const o = await optionsFor({ orchestrator: ORCHESTRATOR });
    expect(o.agents!.explore!.mcpServers).toBeUndefined();
    expect(o.agents!.explore!.tools).not.toContain('mcp__gitnexus__*');
  });

  it('Stack rules “only the executors”: each executor’s prompt carries its role’s rules, without your CLAUDE.md', async () => {
    const env = { CLAUDE_CONFIG_DIR: claudeConfig() };
    const global = await optionsFor({ ownerMcp: true, env, orchestrator: { ...ORCHESTRATOR, stack: { ...STACK, rulesInPrompt: false } } });
    expect(global.agents!.explore!.omitClaudeMd).toBeUndefined();
    expect(global.agents!.explore!.prompt).not.toMatch(/GitNexus/);
    const only = await optionsFor({ ownerMcp: true, env, orchestrator: { ...ORCHESTRATOR, stack: STACK } });
    const { explore, test, docs } = only.agents!;
    for (const e of [explore!, test!, docs!]) expect(e.omitClaudeMd).toBe(true);
    expect(explore!.prompt).toMatch(/GitNexus \(mcp__gitnexus__\*\) first/);
    expect(explore!.prompt).toMatch(/token-goat symbol/);
    expect(test!.prompt).toMatch(/RTK/);
    expect(test!.prompt).not.toMatch(/GitNexus/);
    expect(docs!.prompt).not.toMatch(/GitNexus|token-goat|RTK/);
    // The lead's own instructions don't get the stack's rules.
    expect((only.systemPrompt as { append: string }).append).not.toMatch(/token-goat/);
  });
});

describe('executors read little', () => {
  it('a read-only explore gets Bash only for the stack’s reading commands', () => {
    const def = executorDefinition({ name: 'explore', can: 'read' }, { stack: STACK });
    expect(def.tools).toContain('Bash');
    expect(executorDefinition({ name: 'docs', can: 'read' }, { stack: STACK }).tools).not.toContain('Bash');
    expect(executorDefinition({ name: 'explore', can: 'read' }).tools).not.toContain('Bash');
    const o = { ...ORCHESTRATOR, stack: STACK };
    expect(executorBashRefusal(o, 'explore', 'token-goat symbol useThing')).toBeUndefined();
    expect(executorBashRefusal(o, 'explore', 'gls symbol src/a.ts useThing')).toBeUndefined();
    for (const cmd of ['token-goat index', 'rm -rf src', 'token-goat symbol x; rm -rf /', 'gls symbol a b > out.txt', 'cat $(token-goat symbol x)']) expect(executorBashRefusal(o, 'explore', cmd)).toMatch(/You only read/);
    // An executor that may run commands, and the lead, aren't refused here.
    expect(executorBashRefusal(o, 'test', 'npm test')).toBeUndefined();
    expect(executorBashRefusal(o, undefined, 'rm -rf src')).toBeUndefined();
  });

  it('an executor’s Read of a 3,000-line file is refused with the token-goat hint (the hook, live)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lean-read-'));
    const big = path.join(dir, 'big.ts');
    writeFileSync(big, Array.from({ length: 3000 }, (_, i) => `export const x${i} = ${i};`).join('\n'));
    const o = await optionsFor({ orchestrator: { ...ORCHESTRATOR, stack: STACK } }, dir);
    const hook = o.hooks!.PreToolUse![0]!.hooks[0]! as HookCallback;
    const call = (toolInput: Record<string, unknown>, agent?: string) =>
      hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: toolInput, tool_use_id: 'tu1', session_id: 's1', transcript_path: '', cwd: dir, ...(agent ? { agent_id: 'a1', agent_type: agent } : {}) } as never, 'tu1', { signal: new AbortController().signal }) as Promise<{ hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }>;
    const refused = await call({ file_path: big }, 'explore');
    expect(refused.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(refused.hookSpecificOutput?.permissionDecisionReason).toMatch(/3000 lines.*token-goat symbol/);
    // A part of it, the lead, or a sub-agent that isn't an executor: let through.
    expect((await call({ file_path: big, offset: 1, limit: 200 }, 'explore')).hookSpecificOutput?.permissionDecision).not.toBe('deny');
    expect((await call({ file_path: big })).hookSpecificOutput?.permissionDecision).not.toBe('deny');
    expect((await call({ file_path: big }, 'general-purpose')).hookSpecificOutput?.permissionDecision).not.toBe('deny');
  });

  it('the gate stays off without token-goat or gls, and for short files', () => {
    const lines = (n: number) => () => n;
    const o = { ...ORCHESTRATOR, stack: STACK };
    expect(bigReadRefusal(o, 'explore', 'Read', { file_path: 'a.ts' }, lines(BIG_READ_LINES))).toBeUndefined();
    expect(bigReadRefusal(o, 'explore', 'Read', { file_path: 'a.ts' }, lines(BIG_READ_LINES + 1))).toMatch(/read only what you need/);
    expect(bigReadRefusal({ ...ORCHESTRATOR, stack: { tools: ['rtk'], rulesInPrompt: false } }, 'explore', 'Read', { file_path: 'a.ts' }, lines(5000))).toBeUndefined();
    expect(bigReadRefusal(ORCHESTRATOR, 'explore', 'Read', { file_path: 'a.ts' }, lines(5000))).toBeUndefined();
  });

  it('without a stack, the executors are as in phase 2', () => {
    expect(orchestratorAgents(ORCHESTRATOR)).toEqual(orchestratorAgents(ORCHESTRATOR, undefined, new Set()));
    const explore = orchestratorAgents(ORCHESTRATOR)!.explore!;
    expect(explore).not.toHaveProperty('mcpServers');
    expect(explore).not.toHaveProperty('omitClaudeMd');
    expect(explore.prompt).toMatch(/never run commands/);
  });
});

describe('the checklist with the rules only in the executors', () => {
  const HOME = '/home/me';
  const FILE = `${HOME}/.claude/CLAUDE.md`;
  const pretend = (text: string) => {
    const files: Record<string, string> = { [FILE]: text };
    const deps = {
      platform: 'linux',
      inWsl: false,
      home: HOME,
      env: { PATH: '/usr/bin' },
      exists: (f: string) => f in files,
      readFile: (f: string) => files[f],
      listDir: () => [],
      writeFile: (f: string, t: string) => void (files[f] = t),
      run: async () => ({ code: 0, out: '' }),
      now: () => Date.UTC(2026, 10, 15, 12, 0, 0),
    } as unknown as ChecklistDeps;
    return { deps, files };
  };
  const MINE = `# Me\n\nAnswer in Portuguese.\n${STACK_RULES_BLOCK}\n## Git\n\nSmall commits.\n`;

  it('a block left in your CLAUDE.md is a warning, and its Fix takes it out with a backup', async () => {
    const { deps, files } = pretend(MINE);
    expect(claudeMdItem(deps).state).toBe('ok');
    const item = claudeMdItem(deps, 'executors');
    expect(item).toMatchObject({ state: 'warn', why: 'inGlobal', fix: 'ask' });
    const r = await askFix('claudeMd', { checks: [], stackRules: 'executors' }, deps);
    expect(r).toEqual({ ok: true, changed: [FILE] });
    expect(files[FILE]).toBe('# Me\n\nAnswer in Portuguese.\n\n## Git\n\nSmall commits.\n');
    expect(Object.keys(files).some((f) => f.startsWith(`${FILE}.bak-`) && files[f] === MINE)).toBe(true);
    expect(claudeMdItem(deps, 'executors').state).toBe('ok');
  });

  it('takes out only the stack’s section', () => {
    expect(withoutStackBlock('# Me\n## Stack (every project)\nrules\n')).toBe('# Me\n');
    expect(withoutStackBlock('# Me\n')).toBe('# Me\n');
  });
});
