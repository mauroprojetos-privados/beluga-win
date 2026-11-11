import type { Message } from '../message.js';

/** The phone's other screens (docs/i18n.md). Keys start with `phoneApp.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
