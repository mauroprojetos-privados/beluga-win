import type { Message } from '../message.js';

/** The Mac's native-style sheets and alerts (dialogs/native) (docs/i18n.md). Keys start with `native.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
