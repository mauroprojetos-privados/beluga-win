import type { Message } from '../message.js';

/** The phone's main screens: tabs, Home, Needs You (docs/i18n.md). Keys start with `phone.`. */
export const en = {} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {};
