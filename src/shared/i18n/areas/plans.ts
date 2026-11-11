import type { Message } from '../message.js';

/** The Mac's plan page (docs/i18n.md). Keys start with `plans.`. */
export const en = {} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {};
