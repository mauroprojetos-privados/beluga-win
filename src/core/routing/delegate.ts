import { type DelegateCan, type DelegatePlace, clipAnswer, delegatePrompt, delegateSystem, delegateTools, delegateVerdict, effectiveCan } from '../../agent/delegate-gate.js';
import { CompletionError, type Complete } from '../../agent/runtime/types.js';
import { classifyRun } from '../../shared/run-failure.js';
import { type Combo, type ReadyTarget, type RouteWorld, targetLabel, targetNow } from './model.js';
import { labelOf } from './orchestrator.js';

/**
 * Orchestrator mode, phase 3 (roadmap/modo-orquestrador.md; docs/routing.md "Executors on other
 * models"): the lead hands a read-only or run-only task to an executor on another runtime (Codex, a
 * local endpoint, OpenCode) through `mcp__beluga_mac__delegate`, waits, and gets a short summary
 * back, inside the same turn.
 *
 * One process per delegation: the runtime's one-shot call (CompletionRequest, `complete`), closed when
 * it answers, with a time limit and a token cap. It goes through the executor's combo in order, as a
 * run on a combo does (failover.ts): a target that can't run now (not signed in, at its limit, its
 * endpoint down) is passed over, before the call or when the call says so, and the answer names the
 * target that answered. A target that ran and then failed, ran out of time or of tokens ends the
 * delegation there: the next one would pay for the same work again.
 */

/** How long one delegation may take, every target it tries included. */
export const DELEGATE_TIMEOUT_MS = 5 * 60_000;
/** The tokens one delegation may spend (input, output, cache writes): past them it stops. */
export const DELEGATE_MAX_TOKENS = 400_000;
/** Turns the executor gets: enough to search or run and diagnose, never a whole task (phase 2's too). */
export const DELEGATE_MAX_TURNS = 30;

/** The executor a delegation goes to, as the run's orchestrator has it. */
export interface DelegateExecutor {
  readonly name: string;
  readonly can: DelegateCan;
  readonly description?: string;
  /** Its combo's id: the targets tried in order. */
  readonly combo: string;
}

export interface DelegateRequest {
  readonly executor: DelegateExecutor;
  readonly task: string;
  readonly paths?: readonly string[];
  readonly place: DelegatePlace;
  /** The lead's run: stopping it stops the delegation. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
}

export interface DelegateDeps {
  /** Your combos now (routing/model.ts combosIn). */
  readonly combos: () => readonly Combo[];
  /** The runtimes and limits now (worldOf): asked again before each target. */
  readonly world: () => RouteWorld;
  /** A runtime's one-shot call; undefined: this Beluga doesn't run it. */
  readonly complete: (runtime: string) => Complete | undefined;
  /** A target is about to be asked ("Codex"), and why the ones before it were passed over. */
  readonly onTarget?: (target: { readonly label: string; readonly runtime: string; readonly model?: string }, passed: readonly Passed[]) => void;
  /** Tokens this delegation spent since the last call (every target's), for Usage and the budgets. */
  readonly onTokens?: (added: number) => void;
}

/** A target passed over, and why. */
export interface Passed {
  readonly label: string;
  readonly why: string;
}

export type DelegateOutcome =
  | { readonly ok: true; readonly answer: string; readonly target: string; readonly runtime: string; readonly model?: string; readonly tokens: number; readonly passed: readonly Passed[] }
  | { readonly ok: false; readonly why: string; readonly stopped?: 'timeout' | 'tokens' | 'aborted'; readonly target?: string; readonly tokens: number; readonly passed: readonly Passed[] };

/** "Not installed", "spawn ENOENT": the runtime isn't there to run. */
const NOT_THERE = /\b(ENOENT|EACCES|not installed|isn't set up|is not set up|not found on PATH|command not found|spawn \S+)\b/i;

/**
 * Why a target couldn't run at all (so the combo's next one is asked), or undefined when it ran and
 * failed (the delegation ends there). `spent`: the tokens it used before failing.
 */
export function cannotRun(err: unknown, spent: number): string | undefined {
  const detail = err instanceof CompletionError ? (err.detail ?? '') : err instanceof Error ? err.message : String(err);
  if (detail) {
    const f = classifyRun({ error: detail });
    if (f.kind === 'usage_limit') return 'At its usage limit';
    if (f.kind === 'signed_out') return "Isn't signed in";
    if (f.kind === 'network') return "Couldn't be reached";
    if (NOT_THERE.test(detail)) return "Isn't set up here";
  }
  // Failed before doing anything: it never got to work.
  if (spent === 0 && (!(err instanceof CompletionError) || err.kind === 'failed')) return detail ? `Couldn't start (${detail.split('\n')[0]!.slice(0, 160)})` : "Couldn't start";
  return undefined;
}

/** Hand one task to an executor on its combo: the first target that can run answers. */
export async function delegate(deps: DelegateDeps, req: DelegateRequest): Promise<DelegateOutcome> {
  const passed: Passed[] = [];
  let tokens = 0;
  const combo = deps.combos().find((c) => c.id === req.executor.combo);
  if (!combo) return { ok: false, why: `The executor ${req.executor.name} has no combo any more (${req.executor.combo}).`, tokens, passed };
  const can = effectiveCan(req.executor.can, req.place);
  const limit = new AbortController();
  let stopped: 'timeout' | 'tokens' | 'aborted' | undefined;
  const stop = (why: 'timeout' | 'tokens' | 'aborted'): void => {
    stopped ??= why;
    limit.abort();
  };
  const timer = setTimeout(() => stop('timeout'), req.timeoutMs ?? DELEGATE_TIMEOUT_MS);
  timer.unref?.();
  const onAbort = (): void => stop('aborted');
  if (req.signal?.aborted) stop('aborted');
  req.signal?.addEventListener('abort', onAbort, { once: true });
  const cap = req.maxTokens ?? DELEGATE_MAX_TOKENS;
  try {
    for (const t of combo.targets) {
      if (stopped) break;
      const world = deps.world();
      const label = targetLabel(t, world.runtimes);
      const now = targetNow(t, world, combo.privacy);
      if (!now.ok) {
        passed.push({ label, why: now.why });
        continue;
      }
      const complete = deps.complete(now.ready.agent.runtime);
      if (!complete) {
        passed.push({ label, why: "Isn't set up here" });
        continue;
      }
      const ready: ReadyTarget = now.ready;
      const words = labelOf(ready.agent, ready.model);
      deps.onTarget?.({ label: words, runtime: ready.agent.runtime, ...(ready.model ? { model: ready.model } : {}) }, [...passed]);
      // This target's running total, as its call reports it: only the growth is new.
      let mine = 0;
      try {
        const answer = await complete({
          prompt: delegatePrompt(req.task, req.paths),
          system: delegateSystem({ ...req.executor, can }, req.place),
          cwd: req.place.cwd,
          ...(ready.model ? { model: ready.model } : {}),
          tools: delegateTools(can),
          vetTool: (tool, input) => delegateVerdict(can, req.place, tool, input),
          maxTurns: DELEGATE_MAX_TURNS,
          signal: limit.signal,
          onTokens: (total) => {
            const added = total - mine;
            if (added <= 0) return;
            mine = total;
            tokens += added;
            deps.onTokens?.(added);
            if (tokens > cap) stop('tokens');
          },
        });
        if (stopped) break;
        return { ok: true, answer: clipAnswer(answer), target: words, runtime: ready.agent.runtime, ...(ready.model ? { model: ready.model } : {}), tokens, passed };
      } catch (err) {
        if (stopped) return { ok: false, why: stoppedWords(stopped, req, cap), stopped, target: words, tokens, passed };
        const why = cannotRun(err, mine);
        if (why) {
          passed.push({ label: words, why });
          continue;
        }
        const said = err instanceof CompletionError ? (err.kind === 'max_turns' ? `ran out of its ${DELEGATE_MAX_TURNS} turns` : err.kind === 'no_answer' ? 'ended without an answer' : `failed${err.detail ? `: ${err.detail.split('\n')[0]!.slice(0, 200)}` : ''}`) : err instanceof Error ? err.message.slice(0, 200) : String(err);
        return { ok: false, why: `${words} ${said}.`, target: words, tokens, passed };
      }
    }
    if (stopped) return { ok: false, why: stoppedWords(stopped, req, cap), stopped, tokens, passed };
    return { ok: false, why: `Nothing in ${combo.name} can run now: ${passed.map((p) => `${p.label}: ${p.why}`).join('; ') || 'it has no targets'}.`, tokens, passed };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
  }
}

function stoppedWords(stopped: 'timeout' | 'tokens' | 'aborted', req: DelegateRequest, cap: number): string {
  if (stopped === 'timeout') return `It took longer than ${Math.round((req.timeoutMs ?? DELEGATE_TIMEOUT_MS) / 1000)} s and was stopped. Ask for less at once, or do it yourself.`;
  if (stopped === 'tokens') return `It spent more than ${Math.round(cap / 1000)}k tokens and was stopped. Ask for less at once, or do it yourself.`;
  return 'Stopped.';
}

/** What the lead reads back: the answer and who gave it, or why there is none. */
export function outcomeText(executor: string, o: DelegateOutcome): string {
  const passed = o.passed.length ? ` (${o.passed.map((p) => `${p.label}: ${p.why}`).join('; ')})` : '';
  if (o.ok) return `${executor} answered on ${o.target}${passed}.\n\n${o.answer}`;
  return `${executor} didn't answer${o.target ? ` (${o.target})` : ''}: ${o.why}${o.stopped ? '' : passed}`;
}
