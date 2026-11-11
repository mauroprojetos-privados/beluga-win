import type { Message } from '../message.js';

/** The Mac's chat: its items, steps, strips and banners (docs/i18n.md). Keys start with `chat.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
