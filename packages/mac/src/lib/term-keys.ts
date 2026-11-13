import type { ImportedKey, TermAction } from '../../../../src/terminal/import/keys.js';
import { type KeyPress, chordLabel, chordsOf } from './shortcuts-model.js';
import { type Key, t } from '../../../../src/shared/i18n/index.js';

/**
 * The terminal view's keys (BLG-537): what iTerm2 and Ghostty both do by default (⌘T a tab, ⌘D a
 * split, ⌥⌘← the pane to the left…), with the keys you brought from your own terminal over them.
 * While the keyboard is in the terminal they win over Beluga's own shortcuts. Pure.
 */

export type { TermAction };

export interface TermKey {
  readonly chord: string;
  readonly action: TermAction;
  /** Brought from your terminal ('Ghostty'), else Beluga's. */
  readonly from?: string;
}

/** Beluga's terminal keys: the ones iTerm2 and Ghostty share. */
export const DEFAULT_TERM_KEYS: readonly TermKey[] = [
  { chord: 'Cmd+T', action: 'new_tab' },
  { chord: 'Cmd+W', action: 'close' },
  { chord: 'Shift+Cmd+]', action: 'next_tab' },
  { chord: 'Shift+Cmd+[', action: 'prev_tab' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ chord: `Cmd+${n}`, action: `tab:${n}` as TermAction })),
  { chord: 'Cmd+D', action: 'split_right' },
  { chord: 'Shift+Cmd+D', action: 'split_down' },
  { chord: 'Alt+Cmd+Left', action: 'focus_left' },
  { chord: 'Alt+Cmd+Right', action: 'focus_right' },
  { chord: 'Alt+Cmd+Up', action: 'focus_up' },
  { chord: 'Alt+Cmd+Down', action: 'focus_down' },
  { chord: 'Cmd+[', action: 'focus_prev' },
  { chord: 'Cmd+]', action: 'focus_next' },
  { chord: 'Shift+Cmd+Enter', action: 'zoom' },
  { chord: 'Cmd+F', action: 'find' },
  { chord: 'Cmd+K', action: 'clear' },
  { chord: 'Cmd+=', action: 'font_up' },
  { chord: 'Shift+Cmd+=', action: 'font_up' },
  { chord: 'Cmd+-', action: 'font_down' },
  { chord: 'Cmd+0', action: 'font_reset' },
  { chord: 'Cmd+Enter', action: 'newest_visual' },
];

/** Your terminal's keys over Beluga's: one of yours replaces Beluga's on the same key (or turns it off). */
export function termKeysOf(imported: readonly ImportedKey[] | undefined, from = ''): TermKey[] {
  const mine = new Map((imported ?? []).map((k) => [k.chord, k] as const));
  const out: TermKey[] = DEFAULT_TERM_KEYS.filter((k) => !mine.has(k.chord));
  for (const k of mine.values()) if (k.action !== 'unbind') out.push({ chord: k.chord, action: k.action, ...(from ? { from } : {}) });
  return out;
}

/** What a key press does in the terminal, if anything. */
export function termKeyFor(keys: readonly TermKey[], e: KeyPress): TermKey | undefined {
  const chords = chordsOf(e);
  return chords.length ? keys.find((k) => chords.includes(k.chord)) : undefined;
}

/** Each action's words, in the app's language when said (macLib.termKeys.*). */
const LABELS: Readonly<Record<string, Key>> = {
  new_tab: 'macLib.termKeys.new_tab',
  close: 'macLib.termKeys.close',
  next_tab: 'macLib.termKeys.next_tab',
  prev_tab: 'macLib.termKeys.prev_tab',
  split_right: 'macLib.termKeys.split_right',
  split_down: 'macLib.termKeys.split_down',
  focus_left: 'macLib.termKeys.focus_left',
  focus_right: 'macLib.termKeys.focus_right',
  focus_up: 'macLib.termKeys.focus_up',
  focus_down: 'macLib.termKeys.focus_down',
  focus_prev: 'macLib.termKeys.focus_prev',
  focus_next: 'macLib.termKeys.focus_next',
  zoom: 'macLib.termKeys.zoom',
  find: 'macLib.termKeys.find',
  clear: 'macLib.termKeys.clear',
  font_up: 'macLib.termKeys.font_up',
  font_down: 'macLib.termKeys.font_down',
  font_reset: 'macLib.termKeys.font_reset',
  copy: 'macLib.termKeys.copy',
  paste: 'macLib.termKeys.paste',
  select_all: 'macLib.termKeys.select_all',
  newest_visual: 'macLib.termKeys.newest_visual',
};

/** A key's action in words ("Split right", "Tab 3", "Types Esc b"). */
export function actionLabel(action: TermAction): string {
  if (action.startsWith('tab:')) return t('macLib.termKeys.tab', { n: action.slice(4) });
  if (action.startsWith('text:')) return t('macLib.termKeys.types', { text: visible(action.slice(5)) });
  const key = LABELS[action];
  return key ? t(key) : action;
}

/** Characters as people read them (Esc, ⏎, ⇥, ^A). */
function visible(text: string): string {
  return [...text]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c === 0x1b) return 'Esc ';
      if (c === 0x0d || c === 0x0a) return '⏎';
      if (c === 0x09) return '⇥';
      if (c === 0x7f) return '⌫';
      if (c < 0x20) return `^${String.fromCharCode(c + 64)}`;
      return ch;
    })
    .join('')
    .trim();
}

/** The keys, grouped for Settings: tabs, panes, the rest, then what types something. */
export function termKeyRows(keys: readonly TermKey[]): Array<{ label: string; keys: string; from?: string }> {
  const byAction = new Map<string, TermKey[]>();
  for (const k of keys) byAction.set(k.action, [...(byAction.get(k.action) ?? []), k]);
  const order = (a: string): number => (a.startsWith('text:') ? 100 : a.startsWith('tab:') ? 3 : Object.keys(LABELS).indexOf(a));
  return [...byAction]
    .filter(([a]) => !a.startsWith('tab:') || a === 'tab:1')
    .sort(([a], [b]) => order(a) - order(b))
    .map(([action, list]) => ({
      label: action === 'tab:1' ? t('macLib.termKeys.tabs') : actionLabel(action as TermAction),
      keys: action === 'tab:1' ? `${chordLabel('Cmd+1')} … ${chordLabel('Cmd+9')}` : list.map((k) => chordLabel(k.chord)).join('  '),
      ...(list.some((k) => k.from) ? { from: list.find((k) => k.from)!.from! } : {}),
    }));
}
