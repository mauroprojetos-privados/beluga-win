import type { Message } from '../message.js';

/** Combos, the model picker, Usage › Combos (routing) (docs/i18n.md). Keys start with `routing.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
