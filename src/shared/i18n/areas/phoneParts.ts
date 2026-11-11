import type { Message } from '../message.js';

/** The phone's components (docs/i18n.md). Keys start with `phoneParts.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
