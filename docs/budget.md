# Token budgets

How many tokens a conversation, your day, a project's day and a bot's day may spend, and what Beluga
does when one is reached. Phase 4 of the "modo orquestrador" plan: in November 2026 one engine spent
13.0M tokens in a day, with ten conversations at once, auto-continue restarting runs alone after a
reset, and no budget anywhere.

Tokens are input, output and cache writes, as Usage counts them (cache reads are nearly free and
left out). The cost in USD is information only.

## Setting one

The same block in three places:

```json
"budget": { "conversation": 2000000, "day": 15000000, "near": "downgrade" }
```

| Where | `conversation` | `day` | `near` |
|---|---|---|---|
| Settings › Agent › Token budget (`settings.json` `budget`) | each conversation of yours | all your conversations today | what happens at any budget |
| A project's `beluga.json` (`budget`) | can only **lower** yours (it comes with the repository) | the project's conversations today | used only when you set none |
| A bot's `bot.json` (`budget`) | wins over yours (your own folder) | the bot's chats and the worktrees of work it dispatched, today | wins over yours |

Unset fields: no budget there. `near` defaults to `ask`. When the orchestrator block lands
(`src/core/routing/orchestrator.ts`) the same object is `orchestrator.budget`.

## What happens

- **80%** of a budget: said once in the conversation ("This conversation’s token budget: 1.7M of 2M (85%)").
- **80% of your plan's 5-hour window**: one notification per window, budgets or not.
- **At a budget**, by `near`:
  - `downgrade`: the run stops and the failover (`core/routing/failover.ts`) tells it to continue;
    its next run passes the budget's gate on the combo's next target that can run, or on a cheaper
    Claude model (Opus → Sonnet → Haiku). Already the cheapest: it goes on as it is. Moving to
    another runtime, the run takes that runtime's own session when the conversation has one, else
    starts with the recent conversation carried, as a combo's failover does.
  - `ask`: the run stops (or doesn't start) and Needs You asks, with a notification, on the phone
    too: **Continue** (half the budget again, past what's spent), **Go On Cheaper** (past the budget
    on a cheaper target, from now on in that conversation) or **Stop**. The stopped card in the chat
    offers Continue and Go On Cheaper too.
  - `stop`: the run stops (or doesn't start); its card says which budget. Continue on the card gives
    it more, as from Needs You.
- **95% of your plan's 5-hour window**: a run on a combo skips that plan's targets, before the
  limit rather than after it.
- **Nothing restarts on its own past a budget**: auto-continue after a usage limit resets, and a
  combo's failover after one, both skip a conversation whose budget is reached, and say so once.

What Continue allowed and which conversations go on cheaper are kept in Settings (`budgetAllow`,
`budgetCheaper`); Settings › Agent › Token budget clears them. A day's allowance falls away the next day.

`parallelRuns` defaults to 4 (it was 10) for anyone who never chose.

## Where it's counted

- A workspace's conversation (`ws:`): its own usage (`WorkspaceUsage`, with its days).
- Every other conversation of yours (a bot's chats, Your Mac's, the Sentinel chat's): the ledger in
  the state (`core/budget/store.ts`), saved in `~/.beluga/spend.json`.
- The day: the workspaces' days plus the ledger's today.

## Where it shows

- **Mac**: a chip beside the context meter ("1.2M / 2M", amber from 80%, red at the budget; every
  budget on hover); Usage › Right now › Budget; Settings › Agent › Token budget; the stopped run's card.
- **Phone** (1.57): Home's Budget card under Usage (`HomeView.budget`), a conversation's band once
  it's near (`ConvView.budget`), and the Needs You card (`kind: 'budget'`), answered through
  `budget.answer`. The phone never sets a budget.

## Code

- `src/shared/budget.ts`: the block, the rules, the words (browser-safe).
- `src/core/budget/model.ts`: budgets against what was spent, read from the state (the daemon and the screens).
- `src/core/budget/guard.ts`: the gate every run of yours passes as it starts (`agent-host.ts`
  `deps.budget`), the check on each usage report, the warnings, the ledger's file.
- `src/core/budget/store.ts`: the ledger.
- API: `budget.status` and `budget.answer` (`src/ipc/budget-api.ts`), both `phone` in `src/companion/coverage.ts`.
