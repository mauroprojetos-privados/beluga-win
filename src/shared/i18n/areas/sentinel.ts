import type { Message } from '../message.js';

/** Sentinel's screens (docs/i18n.md). Keys start with `sentinel.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
