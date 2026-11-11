# Combos: routing work across agents and models

A **combo** is a named, ordered list of agents and models. A conversation, a task or a plan picks a
combo instead of one model, and each run goes to the first target in the list that can run at that
moment. It is how you spend the cheap plan first and keep the strong one for when you need it,
or keep work on your own computer and fall back to a cloud agent only if you must.

Beluga decides which agent and model a run uses. Retries per request and key rotation are a
gateway's job (Magpie, 9router, LiteLLM): plug one in as an endpoint in **Settings › Agent › Local
models** and it becomes a target like any other. Subscriptions (Claude Code, Codex) always run on
their own runtime, signed in as you, and never behind a proxy.

## What a combo is

`src/core/routing/model.ts`:

- `RouteTarget { runtime; model?; effort?; endpoint? }`: a runtime (`claude`, `codex`, `opencode`,
  `copilot`, `local`), the model it runs (unset: the runtime's own default; on an endpoint, its first
  model), the effort, and for `local` the endpoint by id (`ollama`; unset: any endpoint you added,
  Ollama last).
- `Combo { id; name; targets; privacy? }`, with `privacy` one of:
  - `any` (the default): every target may take the work;
  - `no-third-party`: only runtimes whose work goes to their own vendor (Claude, Codex, Copilot) and
    endpoints on this computer (a loopback address); not OpenCode, nor a remote endpoint or gateway;
  - `local-only`: only endpoints on this computer.

Combos are kept in `settings.json` (`combos`) and synced to your other computers with your other
settings. A malformed entry (a hand edit, a newer Beluga's) is dropped alone; an unreadable list
reads as unset.

### The defaults

Until you change one, Beluga shows three, each without the targets this computer can't run (a
runtime that isn't installed, an endpoint that isn't set up), and without a combo left empty:

| Combo | Targets, in order |
|---|---|
| Economy | Claude · Sonnet → Codex → your endpoint → Ollama |
| Strong | Claude · Opus → Codex · High → Claude · Sonnet |
| Local first | Ollama → your endpoint → Claude · Haiku |

They're worked out again from what runs here until you save a change (any edit saves the whole
list); **Use the Defaults** goes back to them.

## Where a run goes

When a run starts in a conversation that picked a combo (`AgentRef.combo`), Beluga walks the combo
in order and takes the first target that:

1. **runs here and is signed in**: the same check the pickers grey a runtime with (`state.runtimes`,
   `src/shared/agent-runtimes.ts`);
2. **answers**, for an endpoint: Beluga looks at every endpoint every 30 seconds
   (`src/core/local-endpoints.ts`), and one that doesn't answer or has no models is skipped;
3. **isn't at its usage limit**: a run of yours that stopped on a limit is the record. Its card keeps
   the agent it ran on and the reset the limit named (`shared/auto-continue.ts` `limitResumeAt`, a
   guess plus a margin when the limit didn't say); until then, that target is skipped. A limit counts
   against a runtime's plan (every Claude model shares Claude's) or one endpoint. A later run on the
   same plan that finished clears it early;
4. **is allowed by the combo's privacy**.

The place's agent, model and effort become that target's (a target's effort wins over the
conversation's; with none, the conversation's own). The worktree resumes that runtime's own session,
as a picked agent does (`resumeFor`); moving between runtimes starts that runtime's conversation
fresh. If nothing can run, the run doesn't start: its card says why, target by target ("Nothing in
Economy can run now: Claude · Sonnet: At its usage limit until 14:05; Codex: Codex isn't signed in").

Resolution happens where the run's place is made (`WorkspaceController.place`, and
`AgentHost.routePlace` for any other place), so `routedBackend` (`src/agent/runtime/router.ts`)
and `modelFor` see a concrete runtime and model, as for any picked agent.

### What the run records

The run's card carries the target it ran on with the combo: `AgentRef.combo` and `comboName` next
to the target's `runtime`, `model` and `label`. Screens say it as "Economy · Codex"
(`shared/agent-label.ts` `comboWords`), the badge on its answers. Usage can split by combo and target
from the same cards later.

## Where you pick one

- **Settings › Agent › Combos**: the list, each with its chain and what it would run on now (or why
  nothing can). New Combo, Edit… (rename, add targets, move them up and down, remove them, privacy),
  Delete, Use the Defaults.
- **The composer's agent picker**: a Combos tab above the runtimes, for this conversation (or a new
  worktree's own pick). New conversations keep your agent's model.
- **New Task › Agent** and **Start with ▸**: a Combos section above the models.

A combo picked before it was deleted doesn't run: the run says to pick another agent.

## API

`src/ipc/routing-api.ts`:

| Method | Phone | What |
|---|---|---|
| `routing.combos` | ✓ | your combos, each target with why it can't run now, and what each would run on |
| `routing.runRoute` | ✓ | the combo and target a conversation's newest run on a combo used (or one run's) |
| `routing.setCombos` | Mac | save the whole list |
| `routing.resetCombos` | Mac | back to the defaults |
| `routing.retry` | ✓ | Needs You's Try Again on a used-up combo: on now with the first target that can run |
| `routing.usage` | ✓ | your runs through combos, by combo and target |

The phone (companion protocol 1.51) gets `comboName` on an agent: a run's answers say "Economy ·
Codex", a task's page says which target its worktree's newest run went to and how hard the task is
(`difficulty`), and a used-up combo is a Needs You card of kind `combo` with Try Again.

## When a target hits its limit (Phase 2)

`src/core/routing/failover.ts` (`ComboFailover`, started with auto-continue in `daemon/core.ts`): when a
run on a combo stops on its usage limit, its card records the limited target, so the conversation's
next run already skips it. Beluga then tells the next target that can run to continue ("Continue
where you left off."), once per stopped run. On another runtime, which can't read the session, the
recent conversation goes with that message, as after a quiet switch (`WorkspaceController.carryOnCombo`).
The chat says it: "Claude is at its usage limit: Economy · Codex goes on (Economy)." It follows
Settings' **Continue after the limit**, and leaves child threads a stop reached alone.

When nothing in the combo can run, you hear so once (a needs-you notification), and the
conversation waits in **Needs You** (`needs-you.ts`, kind `combo`) with the reason target by target and
**Try Again** (`routing.retry`, on the phone too). The card goes away by itself when a target can run
again; at the reset auto-continue sends the conversation on, as for any limit.

## By how hard a task is (Phase 3)

The task drafter (`agent/task-drafter.ts`) also says how hard a task looks: `simple`, `normal` or
`hard`, kept on the task (`Issue.difficulty`). **Settings › Agent › Combos › By how hard a task is**
maps each to a combo (`prefs.difficultyCombos`). A task that names no agent of its own starts on the
combo for its difficulty; none mapped, your agent, as before.

## By role (Phase 4)

**Settings › Agent › Combos › By role** (`prefs.roleCombos`): the combo each of these runs on.

- **Plan head**: a new plan's own conversation.
- **Milestones**: a plan's milestone agents and its tasks, when the plan names no agent.
- **Checker**: a milestone's check and a draft's review, over the plan's agent. A combo that starts
  with another vendor makes it a cross-vendor check.
- **PR reviewer**: the pull-request review (a side call), on that combo's first target that can run.

## Usage by combo and target (Phase 5)

Each run's card keeps what it spent (`usage: { tokens, cost }`): the session adds what each of its
usage reports grew by (the reports are running totals per conversation; `Workbench.onUsage` works
out the growth, as a workspace's usage does). Tokens are input, output and cache writes; the cost is
in USD, 0 on your own endpoint.

`comboUsage` reads your runs' cards: per combo, runs, tokens, cost, how many stopped on a limit and
the time they took, split by the target each went to. **Usage › Combos** draws it (a bar per target
for its share of the combo's tokens), Settings › Agent › Combos says it under each combo ("12 runs ·
1.2M tokens · $3.40: Codex 8 (850k), Claude · Sonnet 4 (350k, 1 at its limit)"), and
`routing.usage` gives it to the phone. It counts the runs the log holds; runs from before this kept no
tokens.

## Bots (Phases 6, 6b and 6c)

A bot plans and dispatches with all of the above: its own combo for its conversation, and a map of
**categories** (`quick`, `deep`, `supabase`…) to a combo or to another bot for the tasks it hands
out, else their difficulty. Your Mac is the first bot; the others are folders in `~/.beluga/bots`.
See [bots.md](bots.md).
