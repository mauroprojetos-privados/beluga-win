# Your stack

Your agents lean on a few services and tools besides the model. Beluga keeps them looked at, starts what's down, tells you what it can't fix, and sets each new project up for them. Settings › Stack shows it all.

## What it looks at

| | How it's looked at | Started by Beluga |
|---|---|---|
| **Ollama** (local models: OpenViking's embeddings and summaries) | `GET http://127.0.0.1:11434/api/tags` answers | In WSL or on Windows: the Windows app, `ollama app.exe`, through PowerShell. On a Mac: `open -a Ollama`. On Linux: `ollama serve`, detached |
| **OpenViking** (context memory; also a user-scope MCP, `openviking`, at `/mcp`) | its address from `~/.openviking/ovcli.conf` (else `127.0.0.1:1933`) answers `/health` with anything below 500 (its MCP endpoint's 406 counts) | `openviking-server` in a session of its own, its output in `~/.openviking/server.log`, the way it's started by hand |
| **hooktop** (your agents' tool calls, subagents, CPU and RAM) | `127.0.0.1:4317` answers (its 401 counts) | `systemctl --user start hooktop` when that unit exists |
| **RTK**, **token-goat**, **GitNexus**, **graphify**, **gls** (graph-loop-solo) | on your login PATH, or in `~/.local/bin`, `~/.cargo/bin`, `~/.npm-global/bin`, `~/.bun/bin` | never: Settings › Stack says how to install each |

It looks when the daemon starts, every 5 minutes, and on Check Now (Settings › Stack, or Needs You's Check Again). A service that's down is started **once per outage**, then given 30 seconds to answer. What's still down or missing becomes:

- **one Needs You item** (kind `stack`, id `stack:<ids>`): what isn't ready and how to fix each, with Check Again (`stack.check`). It reaches the phone as a card and a nudge. Dismissing it hides that set only, so a different outage asks again;
- **one notice** (Problems), told again only when the set changes, or after everything was fine.

It's cleared as soon as a look finds everything up. **Settings › Stack › Start services that are down** (`stackRepair`, on by default) turns the starting off; the looking and telling stay.

The rules for using these tools (GitNexus before reading code, the reading order through token-goat and graphify, RTK's habits) live in your global `~/.claude/CLAUDE.md`, which every run of yours loads. Beluga writes none of them into projects.

## Setting a project up

When a project is added or made, and **Settings › Stack › Set up new projects** (`stackBootstrap`, on by default) is on, it runs in the background (`core/stack/bootstrap.ts`) and never holds up the add:

1. **Git.** A plain folder added in the Add Projects sheet becomes a git project by itself (`projects.initGit`: git on `main`, a .gitignore, a first commit) instead of the sheet offering it. Your home folder and the disk are still refused. `beluga project add` in a terminal still only says how (a first commit of everything is a lot to do unasked from a command).
2. **Out of git.** `.gitnexus/`, `.graphify-out/`, `.graph_loop_run` and `.graph_loop_memory.db` go in `.git/info/exclude`, never in `.gitignore`.
3. **beluga.json**, only when the project has none (nor `klaud.json` or `conductor.json`): its `setup` is the install Beluga detects, then `gitnexus analyze --index-only`, then `gls graphify ensure`, each only when its tool is installed. Each new worktree then installs and indexes itself.
4. **CLAUDE.md**, only when the project has none and has an `AGENTS.md`: `@AGENTS.md`, so the agent reads the project's own rules. Beluga never loads a project's `.claude/` settings, so on a Claude run it adds the project's `CLAUDE.md` (and `CLAUDE.local.md`, or `AGENTS.md` alone) to the run's instructions itself, `@imports` filled in, inside the folder and never a secret file (`agent/project-instructions.ts`). Codex reads `AGENTS.md` on its own.
5. **Indexes.** `gitnexus analyze --index-only` and `gls graphify ensure` in the project.
6. **OpenViking** gets the documentation only (README*, AGENTS.md, CLAUDE.md, `docs/`, `roadmap/`) under `viking://resources/<project>`, queued without waiting. The code is GitNexus's and graphify's.

Nothing is committed: the toast says which files are new. Running it again (a project's ••• › **Set Up Stack**, `stack.setupProject`) only refreshes the indexes. When a worktree is archived or deleted, `gitnexus remove <its folder>` takes it out of GitNexus's registry, so it doesn't grow with every worktree. A project's own index stays.

## Checklist

Installed and answering isn't the same as working. The checklist (`core/stack/checklist.ts`, roadmap/modo-orquestrador.md › Fase 0b) says, for 19 items, ✓ (works), ⚠ (works less), ✗ (doesn't work) or "doesn't apply", what stops working and how it's fixed. It runs a minute after the daemon starts and once a day (each project's main checkout), after a project is set up, on a new worktree (that worktree), after a merge (its project), and from **Settings › Stack › Checklist › Check the Stack** or a project's ••• › **Check Stack** (`stack.checklist`). A run takes a while (`gls index --check` alone can take minutes when token-goat's map is stale), so it runs in the background and the state fills in place by place. Each run and each rebuild is recorded in the blackbox with how long it took.

**This computer** (once, for every project):

| # | Item | How it's checked | Fix |
|---|---|---|---|
| 1 | Tools installed | the look above | how to install (Needs You's stack item) |
| 2 | Services running | the look above (Ollama is item 3) | started once per outage |
| 3 | Ollama, where it's used | needed when a combo has an Ollama target (`local` with `ollama` or no endpoint) or OpenViking's embeddings are Ollama's (`~/.openviking/ov.conf`). Asked over HTTP (`/api/tags`, then `/api/show` for each model's `tools` capability), never by its program: WSL reaches the Windows Ollama at `127.0.0.1:11434` with no `ollama` in WSL | says what stops working: ⚠ for a combo (it runs on its next target), ✗ for OpenViking's search; ⚠ when no model can call tools |
| 4 | RTK's hook | `~/.claude/settings.json` has `PreToolUse` Bash → `rtk …` | on your yes: `rtk init -g` |
| 5 | GitNexus's hooks | `PreToolUse` Grep, Glob, Bash and `PostToolUse` Bash run a `gitnexus-hook.cjs` that exists | on your yes: `gitnexus setup --coding-agent claude` |
| 6 | The stack's MCPs | `gitnexus` and `openviking` in `~/.claude.json`'s `mcpServers`; `claude mcp list` says they connect | on your yes: `claude mcp add -s user gitnexus -- gitnexus mcp` (OpenViking's: says how) |
| 7 | Stack rules in your CLAUDE.md | `~/.claude/CLAUDE.md` has `## Stack` (and token-goat's block when it's installed); each `@import` resolves | on your yes: appends the `## Stack` block; never rewrites yours |

**Each project and worktree** (each worktree has indexes of its own):

| # | Item | How it's checked | Fix (by itself) |
|---|---|---|---|
| 8 | GitNexus index | its entry in `~/.gitnexus/registry.json` against `git rev-parse HEAD` | `gitnexus analyze --index-only` |
| 9 | graphify index | `.graphify-out/` and `gls index --check` | `gls graphify build` the first time, then `gls graphify ensure` |
| 10 | token-goat map | `gls index --check`; a `TimeoutExpired … rode: token-goat index` is a stale map (⚠), not a broken tool | `token-goat index` |
| 11 | Index folders out of git | `.gitnexus/`, `.graphify-out/`, `.graph_loop_run`, `.graph_loop_memory.db` and `.claude/worktrees/` in the shared `.git/info/exclude` (a worktree's is its main checkout's) | appended |
| 12 | beluga.json indexes new worktrees | its `setup` runs `gitnexus analyze` and `gls graphify ensure` (main checkout only) | on your yes: the missing commands appended to `setup` (a new beluga.json when there's none) |
| 13 | Docs in OpenViking | sent, and after the last commit to README*, AGENTS.md, CLAUDE.md, `docs/` or `roadmap/` (when Beluga sent them: `~/.beluga/stack-checklist.json`) | sent again |
| 14 | GitNexus registry | no registered folder of this project that's gone | `gitnexus remove --force <folder>` |

Indexes (8–10) are rebuilt in the background, never in the agents' run queue (graphify took about 4 minutes and token-goat about 3 on a 440-file repository): the item says "rebuilding" and nothing waits for you. When the rebuild ends, the place is checked again; one that fails waits for you, and is tried again the next day or on Fix.

**Sub-agents** (`core/stack/agents.ts` reads `.claude/agents/*.md`: yours, each project's and each bot's):

| # | Item | How it's checked | Fix |
|---|---|---|---|
| 15 | Sub-agents' tools | an agent with `tools:` needs Bash (RTK, token-goat, gls, GitNexus's CLI) or the stack's MCPs; with neither it's "no stack". Bash only is ✓ ("CLI only"). No `tools:` gets everything | on your yes: `mcp__gitnexus__*` appended to `tools:` |
| 16 | Sub-agents' model | a reading agent (no Edit/Write) without `model:` runs on the main model, unless `CLAUDE_CODE_SUBAGENT_MODEL` is set (here or in `~/.claude/settings.json`'s `env`) | on your yes: `model: haiku` |
| 17 | Hooks in sub-agents | Claude Code runs your hooks for a sub-agent's tool calls too, so this follows 4 and 5 (checked by configuration, not by a test run) | advice only |
| 18 | Stack rules in sub-agents | an agent with its own `tools:` whose prompt says nothing about the stack. A project's CLAUDE.md didn't reach Beluga's Claude runs at all before `src/agent/project-instructions.ts` | advice only |
| 19 | Codex and OpenCode | they get neither Claude's hooks nor its CLAUDE.md: `~/.codex/config.toml` needs `[mcp_servers.gitnexus]`, OpenCode's `opencode.json` a `gitnexus` MCP (each only when installed) | advice only |

**What fixes itself, and what asks.** Only what's the project's own and changes nothing of yours fixes itself: indexes (8–10), excludes (11), docs in OpenViking (13), GitNexus's registry (14). Anything that touches a file of yours (`~/.claude/settings.json`, `~/.claude.json`, `~/.claude/CLAUDE.md`, `.claude/agents/*.md`, `beluga.json`) changes only on your yes: Settings › Stack's **Fix** asks first, then `stack.fix` copies the file next to it (`<file>.bak-YYYYMMDD-HHMMSS`) before changing it.

**Needs You.** What didn't fix itself is one `stack` item, grouped by project (this computer first), with Check Again; one notice per new set. Items 1–2 are left to the item above, 17–19 to Settings (advice), and what's rebuilding never shows. The phone shows the card (its `stack` card) and can run the checklist again (`stack.checklist` is `phone`), but never fixes (`stack.fix` is `mac`).

## The model for each kind of work

Routing (docs/routing.md) picks a combo per kind of work and per plan role. **Claude by Kind of Work** (`core/routing/presets.ts`) sets it with Claude only:

| Combo | Chain | Kinds | Roles |
|---|---|---|---|
| Claude: Opus first (`claude-opus`) | Opus → Sonnet | Ultrabrain (planning, design, unknown bugs) | the plan's head |
| Claude: Sonnet first (`claude-sonnet`) | Sonnet → Opus → Haiku | Deep, Visual, Review | milestones, checks, PR review |
| Claude: Haiku first (`claude-haiku`) | Haiku → Sonnet | Quick, Docs, Explore | |

The chain is what fails over when a model hits its usage limit. It's set **once by itself**, as soon as Claude is ready on this computer (installed and signed in), with or without a network, and you never chose combos for kinds or roles. Never in the demo, and never on a computer without Claude (`~/.beluga/stack.json` remembers it, so clearing them later sticks). After that, it's a button in Settings › Agent › Combos › By kind of work (`routing.useClaudeByKind`). Your own combos are kept; the three are added beside them.

## Code

- `src/core/stack-store.ts`: the shared state (`stack`), browser-safe.
- `src/core/stack/probe.ts`: looking and starting, all through `StackDeps` (the tests' pretend machine).
- `src/core/stack/monitor.ts`: when to look, start, tell; setting projects up; running the checklist, rebuilding indexes and fixing.
- `src/core/stack/bootstrap.ts`: setting a project up.
- `src/core/stack/checklist.ts`: the checklist's 19 items and their fixes, all through `ChecklistDeps` (`StackDeps` plus listing and writing files).
- `src/core/stack/agents.ts`: sub-agents' frontmatter (`tools:`, `model:`), read and edited.
- `src/core/stack/launch.ts`: started with the daemon (not in the demo); when the checklist runs.
- `src/companion/needs-you.ts` `stackItems`; the phone's `stack` card in `components/Needs.tsx`.
- `packages/mac/src/dialogs/StackSettings.tsx`: Settings › Stack, with the Checklist.
- Tests: `tests/stack.test.ts`, `tests/stack-checklist.test.ts`.
