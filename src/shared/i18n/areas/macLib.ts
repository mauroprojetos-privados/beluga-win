import type { Message } from '../message.js';

/** Helper texts in the Mac's lib/ models (docs/i18n.md). Keys start with `macLib.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
