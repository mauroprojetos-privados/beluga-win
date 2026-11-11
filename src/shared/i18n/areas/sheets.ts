import type { Message } from '../message.js';

/** The Mac's sheets and dialogs (not the native ones) (docs/i18n.md). Keys start with `sheets.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
