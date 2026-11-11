import type { Message } from '../message.js';

/** The Mac's Settings panes beyond Settings.tsx (docs/i18n.md). Keys start with `prefs.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
