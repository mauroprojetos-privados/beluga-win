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

The phone (companion protocol 1.51) gets `comboName` on an agent: a run's answers say "Economy ·
Codex", and a task's page says which target its worktree's newest run went to.

## Not yet

- Handing a run to the next target when it hits its limit mid-run, and a Needs You item when every
  target is used up (Phase 2).
- Picking a combo by how hard a task is (Phase 3), per role (plan head, milestone agent, checker, PR
  reviewer: Phase 4), and Usage split by combo and target (Phase 5).
