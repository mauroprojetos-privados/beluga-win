import type { Message } from '../message.js';

/** Friends, groups, chats, calls and the team (docs/i18n.md). Keys start with `network.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
