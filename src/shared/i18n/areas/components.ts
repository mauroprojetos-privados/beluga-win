import type { Message } from '../message.js';

/** The Mac's shared components and onboarding (docs/i18n.md). Keys start with `components.`. */
export const en = {
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
};
