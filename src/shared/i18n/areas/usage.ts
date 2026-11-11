import type { Message } from '../message.js';

/** The Mac's Usage screen (docs/i18n.md). Keys start with `usage.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
