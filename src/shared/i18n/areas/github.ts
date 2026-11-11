import type { Message } from '../message.js';

/** Issues, pull requests, CI, the gateway's requests, Claude Code's sessions (docs/i18n.md). Keys start with `github.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
