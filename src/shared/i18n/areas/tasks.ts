import type { Message } from '../message.js';

/** The Mac's task page (docs/i18n.md). Keys start with `tasks.`. */
export const en = {} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {};
