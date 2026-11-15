import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProjectInstructionsAppend, PROJECT_INSTRUCTIONS_MAX, projectInstructions } from '../src/agent/project-instructions.js';

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beluga-pi-'));
  dirs.push(root);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("a project's own instructions on a Claude run", () => {
  it('brings CLAUDE.md with its @imports filled in, so rules kept in AGENTS.md reach the agent', () => {
    const root = project({ 'CLAUDE.md': '@AGENTS.md\n\n## Comandos\n- `pnpm check`\n', 'AGENTS.md': '# Regras\n## Regra de Ouro: Isolamento de Módulos\n' });
    const text = projectInstructions(root);
    expect(text).toContain('Regra de Ouro: Isolamento de Módulos');
    expect(text).toContain('pnpm check');
    expect(text).not.toMatch(/^@AGENTS\.md$/m);
  });

  it('falls back to AGENTS.md alone, and adds CLAUDE.local.md after CLAUDE.md', () => {
    expect(projectInstructions(project({ 'AGENTS.md': 'only agents' }))).toBe('only agents');
    expect(projectInstructions(project({ 'CLAUDE.md': 'shared', 'CLAUDE.local.md': 'mine' }))).toBe('shared\n\nmine');
  });

  it('never imports from outside the folder, a secret file, itself, or inside a code block', () => {
    const outside = project({ 'secret.md': 'OUTSIDE' });
    const root = project({
      'CLAUDE.md': `@../${path.basename(outside)}/secret.md\n@.env\n@CLAUDE.md\n\`\`\`\n@docs/a.md\n\`\`\`\n@docs/a.md\n`,
      '.env': 'TOKEN=x',
      'docs/a.md': 'from docs',
    });
    const text = projectInstructions(root);
    expect(text).not.toContain('OUTSIDE');
    expect(text).not.toContain('TOKEN=x');
    expect(text.match(/from docs/g)).toHaveLength(1);
    expect(text).toContain('```\n@docs/a.md\n```');
  });

  it('adds nothing for a folder without instructions, and caps a long one', () => {
    expect(buildProjectInstructionsAppend(project({}))).toBe('');
    expect(buildProjectInstructionsAppend(path.join(os.tmpdir(), 'beluga-pi-missing-folder'))).toBe('');
    const long = projectInstructions(project({ 'CLAUDE.md': 'x'.repeat(PROJECT_INSTRUCTIONS_MAX + 500) }));
    expect(long.length).toBeLessThan(PROJECT_INSTRUCTIONS_MAX + 100);
    expect(long).toContain('[…cut');
    expect(buildProjectInstructionsAppend(project({ 'CLAUDE.md': 'rule one' }))).toContain('<project-instructions>\nrule one\n</project-instructions>');
  });
});
