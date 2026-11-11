import type { Message } from '../message.js';

/** The Mac's views: chat view, files, diffs, reader, history, overview (docs/i18n.md). Keys start with `views.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
