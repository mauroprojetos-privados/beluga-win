import type { Message } from '../message.js';

/** The Mac's chat: the composer and what waits in the chat (Attention) (docs/i18n.md). Keys start with `composer.`. */
export const en = {} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {};
