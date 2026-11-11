import type { Message } from '../message.js';

/** The Mac's window: Inspector, Toolbar, the right panel, the project tree (docs/i18n.md). Keys start with `layout.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
