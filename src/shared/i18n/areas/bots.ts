import type { Message } from '../message.js';

/** The Bots sidebar and Bot Studio (docs/i18n.md). Keys start with `bots.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
