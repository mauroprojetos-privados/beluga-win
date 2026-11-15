# Compaction

A long conversation re-reads its whole context on every turn. Compacting asks the agent to summarize
its working memory (decisions, open tasks, files touched, unresolved errors: `COMPACT_INSTRUCTIONS`)
and go on from the summary. The chat stays on screen, with a divider where it happened.

Code: `src/shared/context-usage.ts` (the numbers, pure), `src/core/compactor.ts` (when and how),
`src/core/context-log.ts` (the meter and the divider), `src/agent/runtime/claude/runner.ts` (Claude
Code's own auto-compact).

## The threshold

`autoCompactAt` in `~/.beluga/settings.json` is either a percent of the window (70–95, default 85)
or `{ "tokens": 160000, "pct": 85 }`. Whichever is reached first fires (`compactLimit`):

| Window | `85` (the default) | `{ "tokens": 100000 }` |
|---|---|---|
| 1M (Opus/Sonnet 4.6+, Claude 5, `[1m]`) | **160k** (the token default for windows past 200k) | 100k |
| 200k | 170k (85%) | 100k |

Without the token default, a 1M model would compact only near 850k, and every turn until then reads
all of it. Settings › Claude › Context has the percent slider and "Or at (tokens)".

Beluga's compactor checks the threshold between turns, in the conversation's queue: when a run ends
past it, or before the next message goes, `/compact` runs first. Claude Code's own auto-compact is
told the same limit, so a long single turn compacts there too: Beluga passes
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` (the window in tokens, which Claude Code caps at the model's) and
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (the percent of it), worked out from the threshold and the window of
the run's model, or the window Claude Code reported for the conversation (`compactEnv`). An
`env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` in your own `~/.claude/settings.json` is applied by Claude Code
itself and may win over Beluga's.

## Every conversation

All of your agent's runs go through the agent host's lanes, and so through the compactor: a project's
chat and worktrees, Your Mac's chats, bots (`bot:<id>`), sentinel runs (in worktrees or Your Mac's
chats), a plan's home and its tasks (`core/plans/watchdog.ts` wakes them through `askOwnClaude`), and
child threads (`core/threads/launch.ts`: `requestAgent` or `runFor`). `tests/compactor.test.ts`
checks a 1M conversation at 170k compacts before its next turn in a project, a bot, a sentinel's
chat and a `runFor` run.

Not covered: a dialogue's turns between your agents (`runDialogueTurn`) and the gateway's own runner
(`core/gateway/serve.ts`) run outside the lanes and pass no threshold.

## On by default, as your choice

Auto-compact used to be on by default without anyone choosing it, and a migration
(`core/settings.ts` `migrated`) turns off every `autoCompact: true` saved without `autoCompactChosen`.
It now asks once: once your agent has worked (a conversation has a context number), Needs You shows
"Beluga compacts long conversations so they don't use up your plan. Turn it on?" (kind
`autocompact`), on the Mac's bell and the phone, with Turn On and Keep Off
(`session.chooseAutoCompact`). Either answer, or the switch in Settings, sets `autoCompactChosen`, and
the card never comes back. Turning it off is respected as before.

## When the context isn't reported

A run that sends no `context` event would never be due. The compactor then uses the run's `usage`
(input + cache read + cache write: the last turn's when a runtime gives `last`, else the run's totals,
an upper bound) as the context, and writes the gap to the black box (`compactor: no context event…`).

## A summary that is still big

If the context right after compacting is still past the threshold, compacting again each turn
wouldn't help. Beluga says so in the chat ("The summary is still big…"), doesn't auto-compact that
conversation again until it has grown a quarter of the threshold past the summary, and Needs You
offers **Start Fresh** (kind `compact`, `session.freshFromSummary`): a new conversation in the same
place (a worktree, Your Mac's chat, a bot's chat) whose first message is the summary.

## Screens

- The Mac's context meter shows where it compacts in tokens ("At 160k (16%)") and marks it on the bar
  (`packages/mac/src/chat/ContextMeter.tsx`).
- The phone's conversation gets `context: { used, window, compactAt?, compacting? }` (protocol 1.57,
  `src/companion/views.ts`) and shows "Context 172k · compacts at 160k" above the composer once it's
  past half of that. Both Needs You kinds have their own cards (`packages/companion/components/Needs.tsx`).
