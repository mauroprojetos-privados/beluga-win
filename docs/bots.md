# Bots: orchestrators that plan and dispatch

A **bot** is a persistent, named conversation that talks with you, plans, hands each part to the
right agent and model, and follows the work up, without writing project code itself. Most of what a
bot does Beluga already had: Plans, worktrees, the checker, Needs You, combos. What's new is the bot.

The main chat stays. Bots are a layer on top:

- **Your Mac is the first bot.** Settings › Bots › Your Mac gives it a persona, its own combo, a map
  of categories (or difficulty) for what it dispatches, and an autonomy. Everything is off or empty
  by default: with nothing set, Your Mac is Your Mac as it always was.
- **Project chats and worktrees stay as they are.** To work on a task yourself, talk to its agent
  directly, without any bot.
- **Other bots are optional.** They appear only when you make one (New Bot): one per project, a
  researcher, a deploy bot, a Supabase specialist. Each is the same kind of conversation as Your Mac,
  with another folder.

Routing Phases 6, 6b and 6c in `roadmap/roteamento-inteligente.md`; the combos, difficulty and roles
they build on are in [routing.md](routing.md).

## A bot is a folder

The files are the source of truth, and Bot Studio is an editor of them. What you set on the screen
becomes a file in the bot's folder, and what someone edits in the files (you, an agent) shows on the
screen. So a bot can be versioned, copied, shared and edited by hand, and its folder works outside
Beluga too: everything but `bot.json` is in Claude Code's own formats.

```
~/.beluga/bots/supa/            ← the bot "Supa" (Your Mac's folder is ~/.beluga/assistant/work)
├── bot.json                    identity and routing (src/core/bots/schema.ts, with `version`)
├── CLAUDE.md                   persona and rules
├── .mcp.json                   its tools; secrets as ${env:NAME}, never the value
├── .claude/skills/<name>/      one folder per skill (SKILL.md and what it needs)
├── .claude/agents/<name>.md    its sub-agents
├── knowledge.json              its sources and when they were indexed
├── knowledge/                  copies of the sources
├── memory.md                   what it learned
└── .git/                       its history: each save is a commit
```

`bot.json` holds only what has no natural place elsewhere:

| Field | What |
|---|---|
| `version` | the format (1); a newer Beluga's file is read for what this one knows, and said so |
| `name`, `icon`, `color`, `description` | how it shows; `description` is also how other bots know what to hand it |
| `combo` | the combo it thinks and talks with (unset: your agent) |
| `categories` | category → `combo:<id>` or `bot:<id>`, for the tasks it dispatches |
| `difficulty` | `simple` / `normal` / `hard` → combo, for a task with no category (unset: Settings' own map) |
| `autonomy` | `ask`, `run-stop-on-fail` or `autopilot` |
| `projects` | project ids it acts in (their folders are added to its runs); empty: like Your Mac |

A field that doesn't fit (a hand edit's typo) is dropped alone and named in the bot's problems; an
unreadable file reads as a bot with nothing set.

The folder's git keeps only the bot's own files (its `.gitignore` is an allow-list), so Your Mac's
`work/`, which also holds its scratch and whatever it makes, commits nothing else. Without git on the
computer, saves still work, without history.

## How a bot runs

`src/core/bots/bots.ts`. A bot's runs (your own only):

- **work in its folder** (`cwd`), with `--add-dir` for each project it acts in. Edits in its own
  folder need no approval (it keeps `memory.md` that way); edits in a project folder ask you, as
  anywhere: a bot reads and delegates.
- **load only its own MCP servers**: its `.mcp.json`, `${env:NAME}` filled in from your secrets,
  passed with `--strict-mcp-config` (`AgentPlace.mcp`), so your servers and another bot's never reach
  it. Beluga's own tools still come. A bot with no `.mcp.json` keeps yours, as before. Claude Code is
  the runtime that loads them; a bot whose combo can run on another runtime is warned that its MCPs
  don't load there.
- **load its skills and sub-agents**: the folder's `.claude/skills` (as a project's) and, for a bot's
  folder only, `.claude/agents`, through the shadow plugin (`skill-plugins.ts`).
- **are told who they are**: its persona (`CLAUDE.md`) and the end of its memory go in the run's
  brief, with its map of categories, its autonomy and the other bots it can hand work to.

Your Mac's runs get the same additions from its folder when something is set (`MacAssistant`'s
`bot` dep); a chat a sentinel opened with an agent of its own keeps that agent.

Its conversation is `bot:<id>` (Your Mac's stay `mac:assistant…`), kept in
`~/.beluga/bot-chats/<id>/` (its agent session and history, secret to the phone like the rest of
`~/.beluga`). Bot Studio's Test chat is `bot:<id>:test`: the same folder, tools, skills and
knowledge, but nothing that starts work in a project.

## Planning and dispatching

A bot that plans and dispatches (anything of the above set) gets **`plan_dispatch`**
(`mcp__beluga_mac__plan_dispatch`): the whole plan in one call, milestones in order, each task with a
**category** from its map or a **difficulty**. Beluga makes a normal Plan
(`PlansWork.createWritten`): its own conversation in the project (the head that checks milestones),
the draft written as the bot's. Then, by the bot's autonomy:

| Autonomy | The plan |
|---|---|
| Ask First (`ask`) | a draft at Check-ins, waiting for your **Approve** beside the bot's chat |
| Run, Stop on Failure | approved now, on Autopilot: it stops only where a check fails |
| Autopilot | approved now, on Autopilot; the bot adds the fixes when a check fails |

Each task's route is worked out when it starts (`dispatch.ts` `routeTask`, asked by the pilot through
`PilotDeps.route`): its category in the bot's map (a combo, or another bot and that bot's combo),
else its difficulty in the bot's map, else in Settings' (Combos › By how hard a task is), else the
plan's agent. A bot's plan runs **one worktree per task**, so each task gets its own route; the
plan's history says which ("HEX-12 “Fix the hook”: deep → Strong"). A task handed to another bot
(`supabase` → Supa) runs in its worktree with that bot's MCPs, its folder added and its persona in
the brief (`Bots.workFor`).

`~/.beluga/bot-chats/dispatch.json` records which bot made which plan and each task's category. From
it:

- **the sidebar's line** under the bot: "2 of 6 done · waiting on Contrast check", from the plan's
  own view (a task asking you, a milestone's check, a task of yours), or "Plan ready: … · waiting for
  your Approve";
- **the plan beside its chat**: the same canvas as the plan's page, with Approve while it waits and
  Open Plan for the rest (× hides it for the session);
- **Needs You names the bot**: an approval or a question in the bot's chat, in a plan it dispatched or
  in one of that plan's worktrees carries the bot (`BotInfo.behind`, `NeedsYou.bot`), so the phone's
  card reads "Your Mac › … · your Claude".

## Knowledge

`src/core/bots/knowledge.ts`. A bot's documentation is searched **by passage**, never pasted whole:
its tool **`knowledge_search`** answers with the passages that match, each with its source, and says
where it searched. The tool is made per bot, with that bot's folder, so a bot never reads another's.

- **Sources** (`knowledge.json`): a file (copied into `knowledge/`), words you pasted, a web page
  (fetched once, its HTML turned to text). A file `isSecretPath` calls a secret (a `.env`, a key) is
  refused when added and skipped when indexed.
- **OpenViking**, when it runs here: `ov health` answers (`$BELUGA_OPENVIKING` names its `ov`, or
  `off`). Index Again adds each source under `viking://resources/beluga-bots/<id>/` and searches go to
  `ov find` there.
- **Otherwise a local full-text index** (BM25 over ~900-character passages, in the folder's
  `.index/`, never committed or exported). It's also built every time, so a search falls back to it
  when OpenViking stops answering.

The Knowledge tab says which is used. On the WSL engine OpenViking is installed but not set up yet
(`openviking-server init`), so the local index is what runs until then.

## Bot Studio

Settings › Bots (the Mac app and `beluga web`): Your Mac first, then your bots, then New Bot. For the
one picked:

| Tab | What | File |
|---|---|---|
| Identity | name, what it's for, icon and colour, projects it acts in; the persona | `bot.json`, `CLAUDE.md` |
| Model | its own combo, categories → combo or bot, by how hard, autonomy | `bot.json` |
| Tools | its MCP servers and whether each connects (Check Them), Add one of yours (its tokens and headers moved into secrets), Secrets, the `.mcp.json` itself | `.mcp.json`, `env.json` |
| Skills | skills and sub-agents: new, edit (the header is checked), remove, copy one of yours | `.claude/skills/`, `.claude/agents/` |
| Knowledge | drop files, a web page, what's indexed and with what, Index Again, Try a search | `knowledge.json`, `knowledge/` |
| Memory | read, edit, clear | `memory.md` |
| Test | a chat that touches no project, with the tools, skills and knowledge searches it used | — |

- **Round trip.** The daemon watches the bots' folders (and Your Mac's files in `work/`); an edit
  outside Beluga reaches the screens at once (`BotInfo.rev`). A tab you were editing keeps your words
  and warns that the file changed; a save made against the old version is refused
  (`BotConflict`), never written over the new one.
- **History.** Each save is a commit in the bot's git ("Persona", "Model", "Skill rls"…): **Undo**
  goes back one, **Versions…** to any (as a new commit on top: nothing is lost).
- **Validation.** Each bot's problems are listed with the reason: a `.mcp.json` that doesn't read, a
  secret it names that isn't set, a skill or sub-agent whose header Claude Code can't read, a category
  pointing to a combo or bot that was deleted, a combo that can leave Claude Code (its MCPs wouldn't
  load). Check Them asks Claude Code whether each server connects, and why not.
- **Export and import.** Export is a `.zip` of the bot's own files without secrets (they're
  `${env:NAME}` in `.mcp.json`; the values stay in `~/.beluga/env.json`). Import makes a new bot of
  it and says which secrets it needs.
- **Create with Claude Code.** Describe the bot; Claude drafts its files (persona, skills, suggested MCPs
  and documentation pages) and you see each as a diff before accepting it. A bot's Improve with
  Claude does the same on the bot you have. **Templates**: Supabase, Expo / Android, Deploy and PR
  reviewer (`src/core/bots/templates.ts`), applied the same way.

## API

`src/ipc/bots-api.ts`; the phone column is `src/companion/coverage.ts`.

| Method | Phone | What |
|---|---|---|
| `bots.list`, `bots.status` | ✓ | the bots and what each is doing (also the shared state's `bots`) |
| `bots.get` | Mac | a bot's files for Bot Studio, with each file's fingerprint for conflict checks |
| `bots.create`, `bots.delete` | Mac | New Bot; delete one for good (not Your Mac) |
| `bots.edit.bot`, `.persona`, `.mcp`, `.addMcp`, `.secret`, `.skill`, `.copySkill`, `.agent`, `.memory` | Mac | the tabs' saves (each a commit; `expect` refuses a stale save) |
| `bots.installed` | Mac | your skills and MCP servers a bot can take |
| `bots.knowledge.addFile`, `.addText`, `.addUrl`, `.remove`, `.reindex`, `.search` | Mac | its knowledge |
| `bots.validate` | Mac | whether each MCP connects |
| `bots.versions`, `bots.undo`, `bots.restore` | Mac | its history |
| `bots.export`, `bots.import` | Mac | a `.zip` without secrets, and back |
| `bots.draft`, `bots.applyDraft` | Mac | Create with Claude Code (and templates) |

Chatting with a bot is `session.submit` in its conversation, from the Mac or the phone.

## The phone

Companion protocol 1.52 (additive): Home's **Bots** list (`HomeView.bots`: Your Mac first, each with
its line and its plan), each bot's chat (`conv:bot:<id>`, written in like Your Mac's), and the bot on
a Needs You (`NeedsYou.bot`). An older phone leaves them out; an older Mac sends neither. Editing a
bot, its knowledge, tools and skills stays on the Mac.

## Not done yet

- Bot triggers (a bot acting on a schedule or an event through Sentinels).
- A lane for other runtimes' own MCP configuration: today only Claude Code loads a bot's MCPs.
- Knowledge from a whole repository (files, pages and pasted text only), and OpenViking's levels
  (L0/L1/L2) shown in the Knowledge tab.
- Several chats per bot (one chat and its Test chat each, besides Your Mac's tabs).
