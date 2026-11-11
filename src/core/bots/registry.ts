import type { Bots } from './bots.js';

/** Which bots serve a session (the daemon's), so the API and the agent's runs can reach them. */
const all = new WeakMap<object, Bots>();

export const attachBots = (session: object, bots: Bots): void => void all.set(session, bots);
export const detachBots = (session: object): void => void all.delete(session);
export const botsOf = (session: object): Bots | undefined => all.get(session);
