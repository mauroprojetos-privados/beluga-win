import type { Message } from '../message.js';

/** The Mac's project home, worktrees, phone and computers (docs/i18n.md). Keys start with `project.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
