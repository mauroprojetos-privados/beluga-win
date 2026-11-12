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
2. **Out of git.** `.gitnexus/`, `.graphify-out/` and `.graph_loop_run` go in `.git/info/exclude`, never in `.gitignore`.
3. **beluga.json**, only when the project has none (nor `klaud.json` or `conductor.json`): its `setup` is the install Beluga detects, then `gitnexus analyze --index-only`, then `gls graphify ensure`, each only when its tool is installed. Each new worktree then installs and indexes itself.
4. **CLAUDE.md**, only when the project has none and has an `AGENTS.md`: `@AGENTS.md`, so Claude Code reads the project's own rules.
5. **Indexes.** `gitnexus analyze --index-only` and `gls graphify ensure` in the project.
6. **OpenViking** gets the documentation only (README*, AGENTS.md, CLAUDE.md, `docs/`, `roadmap/`) under `viking://resources/<project>`, queued without waiting. The code is GitNexus's and graphify's.

Nothing is committed: the toast says which files are new. Running it again (a project's ••• › **Set Up Stack**, `stack.setupProject`) only refreshes the indexes. When a worktree is archived or deleted, `gitnexus remove <its folder>` takes it out of GitNexus's registry, so it doesn't grow with every worktree. A project's own index stays.

## The model for each kind of work

Routing (docs/routing.md) picks a combo per kind of work and per plan role. **Claude by Kind of Work** (`core/routing/presets.ts`) sets it with Claude only:

| Combo | Chain | Kinds | Roles |
|---|---|---|---|
| Claude: Opus first (`claude-opus`) | Opus → Sonnet | Ultrabrain (planning, design, unknown bugs) | the plan's head |
| Claude: Sonnet first (`claude-sonnet`) | Sonnet → Opus → Haiku | Deep, Visual, Review | milestones, checks, PR review |
| Claude: Haiku first (`claude-haiku`) | Haiku → Sonnet | Quick, Docs, Explore | |

The chain is what fails over when a model hits its usage limit. It's set **once by itself** when the daemon starts and you never chose combos for kinds or roles (`~/.beluga/stack.json` remembers it, so clearing them later sticks). After that, it's a button in Settings › Agent › Combos › By kind of work (`routing.useClaudeByKind`). Your own combos are kept; the three are added beside them.

## Code

- `src/core/stack-store.ts`: the shared state (`stack`), browser-safe.
- `src/core/stack/probe.ts`: looking and starting, all through `StackDeps` (the tests' pretend machine).
- `src/core/stack/monitor.ts`: when to look, start, tell; setting projects up.
- `src/core/stack/bootstrap.ts`: setting a project up.
- `src/core/stack/launch.ts`: started with the daemon (not in the demo).
- `src/companion/needs-you.ts` `stackItems`; the phone's `stack` card in `components/Needs.tsx`.
- Tests: `tests/stack.test.ts`.
