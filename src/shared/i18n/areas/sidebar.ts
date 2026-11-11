import type { Message } from '../message.js';

/** The Mac's sidebar, its search and the notification center (Needs You, the bell), the request popup (docs/i18n.md). Keys start with `sidebar.`. */
export const en = {} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {};
