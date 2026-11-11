import { z } from 'zod';
import { BOT_AUTONOMIES, BOT_ID, BotTarget, CATEGORY, SKILL_NAME } from '../core/bots/schema.js';
import { COMBO_ID, DifficultyCombos } from '../core/routing/model.js';

/**
 * Bots (core/bots, docs/bots.md): Your Mac and the bots you make, each a folder of files. Reading
 * them and what they do is the phone's too (and chatting with one is `session.submit` in its
 * conversation, `bot:<id>`); making, editing, exporting and importing them is Bot Studio's, on the
 * Mac and in the web. Every save is a commit in the bot's own git; `expect` is the file's
 * fingerprint as read (`bots.get`'s `prints`), so a file changed since is refused, not overwritten.
 * Browser-safe: zod only.
 */

const bot = z.string().regex(BOT_ID);
const expect = z.string().max(64).optional();
const text = z.string().max(200_000);

/** What the Identity and Model tabs change in bot.json: set replaces, null clears. */
const BotPatch = z
  .object({
    name: z.string().trim().min(1).max(40).nullable(),
    icon: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    description: z.string().trim().max(300).nullable(),
    combo: z.string().regex(COMBO_ID).nullable(),
    categories: z.record(z.string().regex(CATEGORY), BotTarget).nullable(),
    difficulty: DifficultyCombos.nullable(),
    autonomy: z.enum(BOT_AUTONOMIES).nullable(),
    projects: z.array(z.string().min(1).max(200)).max(50).nullable(),
  })
  .partial()
  .strict();

export const BOTS_API = {
  // ---- reading (the phone too)
  // Every bot, Your Mac first, with what it's doing and what's wrong with its files (the shared state's `bots` too). → BotInfo[]
  'bots.list': { args: z.tuple([]) },
  // One bot's status: the plan it dispatched last and the sidebar's line. → { status?, line? }
  'bots.status': { args: z.tuple([bot]) },

  // ---- Bot Studio (the Mac and the web)
  // A bot's files as its tabs show them, with each file's fingerprint. → BotView
  'bots.get': { args: z.tuple([bot]) },
  // New Bot: a folder with a bot.json naming it. → its id
  'bots.create': { args: z.tuple([z.object({ name: z.string().trim().min(1).max(40), icon: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).optional(), description: z.string().max(300).optional() }).strict()]) },
  // Delete a bot for good (its folder, its chats). Your Mac can't be.
  'bots.delete': { args: z.tuple([bot]) },
  // bot.json: Identity (name, icon, colour, what it's for, projects) and Model (combo, categories, difficulty, autonomy). → the version
  'bots.edit.bot': { args: z.tuple([bot, BotPatch, expect]) },
  // CLAUDE.md, its persona. → the version
  'bots.edit.persona': { args: z.tuple([bot, text, expect]) },
  // .mcp.json, its tools (a secret written in it is refused: ${env:NAME} instead). → the version
  'bots.edit.mcp': { args: z.tuple([bot, text, expect]) },
  // One of your MCP servers added to its .mcp.json, its values moved into secrets. → the version
  'bots.edit.addMcp': { args: z.tuple([bot, z.string().min(1).max(200), expect]) },
  // A secret .mcp.json names (${env:NAME}): set, or null to clear. Kept in ~/.beluga/env.json, never in the folder.
  'bots.edit.secret': { args: z.tuple([bot, z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.string().max(8000).nullish()]) },
  // A skill (.claude/skills/<name>/SKILL.md), or null to remove it. Its header is checked. → the version
  'bots.edit.skill': { args: z.tuple([bot, z.string().regex(SKILL_NAME), text.nullish(), expect]) },
  // Copy one of your skills (~/.claude/skills) or another bot's into this one. → the version
  'bots.edit.copySkill': { args: z.tuple([bot, z.object({ bot: bot.optional(), name: z.string().regex(SKILL_NAME) }).strict()]) },
  // A sub-agent (.claude/agents/<name>.md), or null to remove it. → the version
  'bots.edit.agent': { args: z.tuple([bot, z.string().regex(SKILL_NAME), text.nullish(), expect]) },
  // memory.md (empty clears it). → the version
  'bots.edit.memory': { args: z.tuple([bot, text, expect]) },
  // Your skills and MCP servers a bot can take. → { skills, mcps }
  'bots.installed': { args: z.tuple([]) },
  // Its knowledge: a file on this computer (by path), words you pasted or a file's text the screen read, a web page; removing one; indexing again; a test search.
  'bots.knowledge.addFile': { args: z.tuple([bot, z.string().min(1).max(4000)]) },
  'bots.knowledge.addText': { args: z.tuple([bot, z.string().trim().min(1).max(200), z.string().min(1).max(2_200_000)]) },
  'bots.knowledge.addUrl': { args: z.tuple([bot, z.string().url().max(2000)]) },
  'bots.knowledge.remove': { args: z.tuple([bot, z.string().regex(/^[a-z0-9-]{1,48}$/)]) },
  'bots.knowledge.reindex': { args: z.tuple([bot]) },
  'bots.knowledge.search': { args: z.tuple([bot, z.string().min(1).max(500)]) },
  // Whether each of its MCP servers connects, with the reason when one doesn't. → [{ name, status, error?, tools? }]
  'bots.validate': { args: z.tuple([bot]) },
  // Its saves (each a commit in its folder's git), newest first; Undo the last; back to one.
  'bots.versions': { args: z.tuple([bot]) },
  'bots.undo': { args: z.tuple([bot]) },
  'bots.restore': { args: z.tuple([bot, z.string().regex(/^[0-9a-f]{4,40}$/)]) },
  // A bot as a .zip without its secrets → { name, base64, secrets }; and one back in → { id, missing }.
  'bots.export': { args: z.tuple([bot]) },
  'bots.import': { args: z.tuple([z.string().min(1).max(90_000_000)]) },
  // Create with Claude: a first version of a bot's files from a description (`bot`: improve that one) → { files, notes? }, shown as a diff; then accept it.
  'bots.draft': { args: z.tuple([z.string().trim().min(3).max(4000), bot.optional()]) },
  'bots.applyDraft': { args: z.tuple([bot.nullish(), z.record(z.string().max(300), z.string().max(200_000))]) },
} as const;
