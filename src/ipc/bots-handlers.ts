import { botsOf } from '../core/bots/registry.js';
import type { Bots } from '../core/bots/bots.js';
import { MCP_JSON, MEMORY, PERSONA } from '../core/bots/folder.js';
import { botStatusLine } from '../core/bots/schema.js';
import { addInstalledMcp, applyDraft, botView, checkTools, copySkill, draftBot, exportBot, importBot, installedMcps, patchBot, saveFile, saveSkill, yourSkills } from '../core/bots/studio.js';
import type { Session } from '../core/session.js';
import type { Args, Method } from './api.js';

/** What each `bots.*` method does (see bots-api.ts). */

type BotsMethod = Extract<Method, `bots.${string}`>;
type BotsHandlers = { readonly [M in BotsMethod]: (s: Session, ...args: Args<M>) => unknown };

const bots = (s: Session): Bots => {
  const b = botsOf(s);
  if (!b) throw new Error('Bots need the Beluga app');
  return b;
};

export const BOTS_HANDLERS = {
  'bots.list': (s) => bots(s).list(),
  'bots.status': (s, id) => {
    const info = bots(s).list().find((b) => b.id === id);
    if (!info) throw new Error('That bot was deleted');
    const line = botStatusLine(info.status);
    return { ...(info.status ? { status: info.status } : {}), ...(line ? { line } : {}) };
  },
  'bots.get': (s, id) => botView(bots(s), id),
  'bots.create': (s, input) => bots(s).create(input),
  'bots.delete': async (s, id) => {
    // Its runs stop first: nothing they say after lands anywhere.
    for (const channel of [`bot:${id}`, `bot:${id}:test`]) {
      s.host.stopRun(channel);
      s.host.forgetContext(channel);
    }
    await bots(s).remove(id);
  },
  'bots.edit.bot': (s, id, patch, expect) => patchBot(bots(s), id, patch, expect),
  'bots.edit.persona': (s, id, text, expect) => saveFile(bots(s), id, PERSONA, text.trim() ? text : undefined, expect, 'Persona'),
  'bots.edit.mcp': (s, id, text, expect) => saveFile(bots(s), id, MCP_JSON, text.trim() ? text : undefined, expect, 'Tools'),
  'bots.edit.addMcp': (s, id, name, expect) => addInstalledMcp(bots(s), id, name, expect),
  'bots.edit.secret': (s, id, name, value) => {
    bots(s).folder(id);
    bots(s).setSecret(name, value ?? undefined);
  },
  'bots.edit.skill': (s, id, name, text, expect) => saveSkill(bots(s), id, 'skill', name, text ?? null, expect),
  'bots.edit.copySkill': (s, id, from) => copySkill(bots(s), id, from),
  'bots.edit.agent': (s, id, name, text, expect) => saveSkill(bots(s), id, 'agent', name, text ?? null, expect),
  'bots.edit.memory': (s, id, text, expect) => saveFile(bots(s), id, MEMORY, text, expect, text.trim() ? 'Memory' : 'Memory cleared'),
  'bots.installed': () => ({ skills: yourSkills(), mcps: installedMcps() }),
  'bots.knowledge.addFile': async (s, id, file) => {
    const b = bots(s);
    const source = b.knowledge(id).addFile(file);
    await commitKnowledge(b, id, `Knowledge: ${source.name}`);
    return source;
  },
  'bots.knowledge.addText': async (s, id, name, text) => {
    const b = bots(s);
    const source = b.knowledge(id).addText(name, text);
    await commitKnowledge(b, id, `Knowledge: ${source.name}`);
    return source;
  },
  'bots.knowledge.addUrl': async (s, id, url) => {
    const b = bots(s);
    const source = await b.knowledge(id).addUrl(url);
    await commitKnowledge(b, id, `Knowledge: ${source.name}`);
    return source;
  },
  'bots.knowledge.remove': async (s, id, source) => {
    const b = bots(s);
    b.knowledge(id).remove(source);
    await commitKnowledge(b, id, 'Knowledge: a source removed');
  },
  'bots.knowledge.reindex': async (s, id) => {
    const b = bots(s);
    const indexed = await b.knowledge(id).reindex();
    await b.folder(id).commit('Knowledge indexed');
    b.refresh();
    return indexed;
  },
  'bots.knowledge.search': (s, id, query) => bots(s).knowledge(id).search(query, 8),
  'bots.validate': (s, id) => checkTools(bots(s), id),
  'bots.versions': (s, id) => bots(s).folder(id).versions(),
  'bots.undo': async (s, id) => {
    const b = bots(s);
    const v = await b.folder(id).undo();
    b.refresh();
    return v;
  },
  'bots.restore': async (s, id, version) => {
    const b = bots(s);
    const v = await b.folder(id).restore(version);
    b.refresh();
    return v;
  },
  'bots.export': (s, id) => exportBot(bots(s), id),
  'bots.import': (s, base64) => importBot(bots(s), base64),
  'bots.draft': async (s, description, id) => {
    const b = bots(s);
    const existing = id ? { bot: b.file(id), persona: b.folder(id).persona() } : undefined;
    return draftBot((req) => s.completeWithClaude(req), description, existing);
  },
  'bots.applyDraft': (s, id, files) => applyDraft(bots(s), id ?? undefined, files),
} satisfies BotsHandlers;

/** Knowledge changed: indexed again (so a search finds it now), then saved as one commit. */
async function commitKnowledge(b: Bots, id: string, message: string): Promise<void> {
  await b.knowledge(id).reindex().catch(() => undefined);
  await b.folder(id).commit(message);
  b.refresh();
}
