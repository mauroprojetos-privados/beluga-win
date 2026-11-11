import type { Message } from '../message.js';

/** What the daemon says: toasts and Needs You buttons (docs/i18n.md). Keys start with `daemon.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
