import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/shared/i18n/index.js';
import { PANES, SETTINGS } from '../packages/mac/src/dialogs/settings-index.js';
import { saidPanes, saidSettings } from '../packages/mac/src/dialogs/settings-said.js';
import { hitAnchors, searchSettings } from '../packages/mac/src/lib/settings-search.js';

// Settings search matches the words in the app's language beside the English (docs/i18n.md).

afterEach(() => setLocale('en'));

const search = (q: string) => searchSettings(q, saidSettings(SETTINGS), saidPanes(PANES), 'Abrir o painel');

describe('Settings search in Brazilian Portuguese', () => {
  it('finds a pane by its name and its other words', () => {
    setLocale('pt-BR');
    expect(search('aparência')[0]?.pane.id).toBe('appearance');
    expect(search('atalhos')[0]?.pane.id).toBe('keyboard');
    expect(search('aparência')[0]?.hits[0]?.label).toBe('Aparência');
  });

  it('finds a row by its label as the pane says it, and jumps to its English anchor', () => {
    setLocale('pt-BR');
    const hit = search('seu nome').flatMap((r) => r.hits).find((h) => h.entry?.label === 'Your name');
    expect(hit?.label).toBe('Seu nome');
    expect(hitAnchors(hit!)).toEqual([{ kind: 'row', anchor: 'your-name' }]);
  });

  it('still finds the English words', () => {
    setLocale('pt-BR');
    expect(search('shortcuts')[0]?.pane.id).toBe('keyboard');
    expect(search('your name').flatMap((r) => r.hits).some((h) => h.entry?.label === 'Your name')).toBe(true);
  });

  it('says nothing new in English', () => {
    expect(saidSettings(SETTINGS).filter((e) => e.said?.label)).toEqual([]);
    expect(saidPanes(PANES).filter((p) => p.said)).toEqual([]);
  });

  it('says most rows in Portuguese', () => {
    setLocale('pt-BR');
    const said = saidSettings(SETTINGS);
    const missing = said.filter((e) => !e.said?.label).map((e) => `${e.pane}: ${e.label}`);
    // Labels that are the same in both languages (Shell, Terminal, Beluga…) have no `said`.
    expect(missing.length / said.length).toBeLessThan(0.2);
  });
});
