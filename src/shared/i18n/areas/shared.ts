import type { Message } from '../message.js';

/** Helper texts in src/shared and the phone's lib/ (docs/i18n.md). Keys start with `shared.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
