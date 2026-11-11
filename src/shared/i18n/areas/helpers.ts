import type { Message } from '../message.js';

/** Helper texts shared by screens: modes, statuses, trust, categories, the computer's words, times (docs/i18n.md). Keys start with `helpers.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
