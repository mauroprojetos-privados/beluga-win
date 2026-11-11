import type { Message } from '../message.js';

/** The Mac's Settings window (docs/i18n.md). Keys start with `settings.`. */
export const en = {} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {};
