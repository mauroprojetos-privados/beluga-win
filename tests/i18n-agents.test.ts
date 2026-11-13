import { afterEach, describe, expect, it } from 'vitest';
import { buildLanguageAppend } from '../src/agent/prompt.js';
import { runInstructions } from '../src/agent/run-instructions.js';
import { inLanguage, setSideLanguage, sideLanguage } from '../src/agent/side-language.js';
import { worktreeNameSystem } from '../src/agent/namer.js';
import type { AgentRunInput } from '../src/agent/types.js';

afterEach(() => setSideLanguage(() => 'en'));

describe('agents speak your language', () => {
  it('says nothing more when everything is English', () => {
    expect(buildLanguageAppend()).toBe('');
    expect(buildLanguageAppend({ answerIn: 'en', commitIn: 'en' })).toBe('');
  });

  it('answers in the app’s language, and commits in the project’s', () => {
    const both = buildLanguageAppend({ answerIn: 'pt-BR', commitIn: 'en' });
    expect(both).toMatch(/^\n\nLanguage: answer the user in Brazilian Portuguese/);
    expect(both).toContain('pull request titles and descriptions, and code comments are written in English');
    const commits = buildLanguageAppend({ answerIn: 'en', commitIn: 'pt-BR' });
    expect(commits).not.toContain('answer the user in');
    expect(commits).toContain('written in Brazilian Portuguese');
  });

  it('goes into every run’s instructions', () => {
    const input = { prompt: 'oi', language: { answerIn: 'pt-BR', commitIn: 'en' } } as unknown as AgentRunInput;
    expect(runInstructions(input, 'kay')).toContain('answer the user in Brazilian Portuguese');
    expect(runInstructions({ prompt: 'hi' } as unknown as AgentRunInput, 'kay')).not.toContain('Language:');
  });

  it('has the side calls answer in it too', () => {
    expect(sideLanguage()).toBe('en');
    expect(inLanguage('You name chats.', 'the name')).toBe('You name chats.');
    setSideLanguage(() => 'pt-BR');
    expect(inLanguage('You name chats.', 'the name')).toBe('You name chats. Write the name in Brazilian Portuguese.');
    expect(worktreeNameSystem('pt-BR')).toContain('lowercase Brazilian Portuguese words joined by hyphens, without accents');
    expect(worktreeNameSystem('en')).toContain('lowercase English words');
  });
});
