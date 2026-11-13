import type { Message } from '../message.js';
import * as computers from './prefs/computers.js';
import * as agents from './prefs/agents.js';
import * as terminal from './prefs/terminal.js';
import * as keys from './prefs/keys.js';

/**
 * The Mac's Settings panes beyond Settings.tsx (docs/i18n.md). Keys start with `prefs.`, kept in
 * parts under `prefs/` by the panes they belong to.
 */
export const en = {
  ...computers.en,
  ...agents.en,
  ...terminal.en,
  ...keys.en,
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
  ...computers.ptBR,
  ...agents.ptBR,
  ...terminal.ptBR,
  ...keys.ptBR,
};
