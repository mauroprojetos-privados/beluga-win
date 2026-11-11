import { type Key, t } from '@beluga/shared/i18n/index.js';
import { keyOfEnglish } from '../lib/i18n.js';
import { trayName } from '../lib/os-words.js';
import type { PaneInfo, Said, SettingEntry, SettingsPane } from '../lib/settings-search.js';

/**
 * Settings search in the app's language (docs/i18n.md). The index (settings-index.ts) is English:
 * its labels are the panes' own English words, which the jump's anchors are made from. Here each
 * entry gains `said`, the same words as the pane says them now (the catalog sentence whose English
 * is the label, the group, the detail), and each pane its name and other words; the search matches
 * both and shows the said ones.
 */

/** A sentence in the app's language, when the catalog has its English and says it differently. */
function sayEnglish(english: string | undefined): string | undefined {
  if (!english) return undefined;
  const key = keyOfEnglish(english);
  const said = key ? t(key) : undefined;
  return said && said !== english ? said : undefined;
}

function saidOf(words: { label?: string | undefined; group?: string | undefined; detail?: string | undefined }, keywords?: string): Said | undefined {
  const said: { -readonly [K in keyof Said]: Said[K] } = {};
  const label = sayEnglish(words.label);
  const group = sayEnglish(words.group);
  const detail = sayEnglish(words.detail);
  if (label) said.label = label;
  if (group) said.group = group;
  if (detail) said.detail = detail;
  if (keywords) said.keywords = keywords;
  return Object.keys(said).length ? said : undefined;
}

/** The index's entries with their words in the app's language (as they are in English). */
export function saidSettings<P extends SettingsPane>(entries: readonly SettingEntry<P>[]): SettingEntry<P>[] {
  return entries.map((e) => {
    const said = saidOf(e);
    return said ? { ...e, said } : e;
  });
}

/** A pane's name in the app's language (Settings.tsx's sidebar says the same). */
function paneLabel(pane: SettingsPane): string {
  if (pane === 'menubar') return trayName();
  if (pane === 'bots') return t('settings.search.panes.bots');
  return t(`settings.panes.${pane}` as Key);
}

/** The panes with their names and other words in the app's language. */
export function saidPanes<P extends SettingsPane>(panes: readonly PaneInfo<P>[]): PaneInfo<P>[] {
  return panes.map((p) => {
    const label = paneLabel(p.id);
    const keywords = t(`settings.search.keywords.${p.id}` as Key);
    const said: { -readonly [K in keyof Said]: Said[K] } = {};
    if (label !== p.label) said.label = label;
    if (keywords !== p.keywords) said.keywords = keywords;
    return Object.keys(said).length ? { ...p, said } : p;
  });
}
