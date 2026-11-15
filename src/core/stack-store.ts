/**
 * Your stack (docs/stack.md), in the shared state: the services and tools your agents lean on
 * (Ollama, OpenViking, hooktop; rtk, token-goat, GitNexus, graphify, graph-loop-solo's gls), as the daemon last found
 * them. The daemon looks (core/stack/monitor.ts); Settings › Stack and Needs You show it.
 * Browser-safe: the Mac app reads it.
 */

/** The services, looked at over the network on this computer. */
export const STACK_SERVICES = ['ollama', 'openviking', 'hooktop'] as const;
/** The tools, looked for on your login PATH. */
export const STACK_TOOLS = ['rtk', 'token-goat', 'gitnexus', 'graphify', 'gls'] as const;
export const STACK_CHECKS = [...STACK_SERVICES, ...STACK_TOOLS] as const;

export type StackService = (typeof STACK_SERVICES)[number];
export type StackTool = (typeof STACK_TOOLS)[number];
export type StackCheckId = (typeof STACK_CHECKS)[number];

/** `up`: it answers (a service) or is installed (a tool); `down`: a service that doesn't answer; `missing`: not installed. */
export type StackState = 'up' | 'down' | 'missing';

export interface StackCheck {
  readonly id: StackCheckId;
  readonly kind: 'service' | 'tool';
  readonly state: StackState;
  /** Beluga started it during this outage (it may still be coming up). */
  readonly started?: boolean;
}

export interface StackView {
  /** Empty until the first look. */
  readonly checks: readonly StackCheck[];
  /** When it last looked (ms). */
  readonly checkedAt?: number;
  /** A look is under way. */
  readonly checking: boolean;
  /** The checklist, as it was last run (unset until then). */
  readonly checklist?: StackChecklist;
}

export interface StackSlice {
  readonly stack: StackView;
}

export const initialStack: StackSlice = { stack: { checks: [], checking: false } };

export type StackAction = { type: 'stack'; stack: StackView };

export const isService = (id: StackCheckId): id is StackService => (STACK_SERVICES as readonly string[]).includes(id);

/** What's down or missing now. */
export const stackProblems = (view: StackView): readonly StackCheck[] => view.checks.filter((c) => c.state !== 'up');

/** The i18n key part for a check's id (`token-goat` → `tokenGoat`). */
export const stackKey = (id: StackCheckId): string => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/**
 * The stack's checklist (docs/stack.md › Checklist, core/stack/checklist.ts): 19 items that say whether
 * the stack works on this computer (1–7), in each project and worktree (8–14) and for sub-agents
 * (15–19), not only whether it's installed. Numbered in this order.
 */
export const CHECKLIST_ITEMS = [
  'tools',
  'services',
  'ollamaNeeded',
  'rtkHook',
  'gitnexusHooks',
  'mcps',
  'claudeMd',
  'gitnexusIndex',
  'graphifyIndex',
  'tokenGoatMap',
  'excludes',
  'belugaJson',
  'docs',
  'gitnexusRegistry',
  'agentTools',
  'agentModels',
  'subagentHooks',
  'subagentRules',
  'otherRuntimes',
] as const;
export type ChecklistItemId = (typeof CHECKLIST_ITEMS)[number];

/** An item's number in the checklist (1–19). */
export const checklistNumber = (id: ChecklistItemId): number => CHECKLIST_ITEMS.indexOf(id) + 1;

/** `ok` ✓, `warn` ⚠ (works, but less), `fail` ✗ (doesn't work), `skip`: doesn't apply here. */
export type ChecklistState = 'ok' | 'warn' | 'fail' | 'skip';

/**
 * How it's fixed: `auto` it fixes itself (the project's own, nothing of yours changes: indexes,
 * excludes, docs in OpenViking, GitNexus's registry); `ask` only on your yes (Fix), with a backup,
 * since it changes a file of yours (~/.claude/settings.json, ~/.claude/CLAUDE.md, .claude/agents/*.md,
 * beluga.json).
 */
export type ChecklistFix = 'auto' | 'ask';

/** Why an item isn't ✓: the i18n key part `stack.why.<why>`. */
export const CHECKLIST_WHYS = [
  'missing',
  'down',
  'ollamaOff',
  'noToolsModel',
  'noHook',
  'hookFileGone',
  'notRegistered',
  'notAnswering',
  'noBlock',
  'brokenImport',
  'stale',
  'notBuilt',
  'rebuilding',
  'rebuildFailed',
  'noTool',
  'notExcluded',
  'noFile',
  'noIndexSetup',
  'notSent',
  'old',
  'sendFailed',
  'leftovers',
  'noStack',
  'inheritsLead',
  'noRules',
  'missingConfig',
] as const;
export type ChecklistWhy = (typeof CHECKLIST_WHYS)[number];

export interface ChecklistItem {
  readonly id: ChecklistItemId;
  readonly state: ChecklistState;
  /** Why it isn't ✓ (unset when it is). */
  readonly why?: ChecklistWhy;
  /** What it found, as the tool or file says it (names, paths, a tool's last lines): not translated. */
  readonly detail?: string;
  /** How it's fixed, when it can be. */
  readonly fix?: ChecklistFix;
  /** It's fixing itself now (an index rebuilding in the background). */
  readonly fixing?: boolean;
  /** Only advice: shown in Settings › Stack, never in Needs You. */
  readonly advisory?: boolean;
}

/** One project's checkout (its main folder or a worktree, each with its own indexes) and its items. */
export interface ChecklistPlace {
  /** The project's id for its main checkout, the worktree's id for a worktree. */
  readonly id: string;
  readonly projectId: string;
  /** "erp-rewrite", or "erp-rewrite › fix-login" for a worktree. */
  readonly name: string;
  readonly dir: string;
  readonly items: readonly ChecklistItem[];
}

export interface StackChecklist {
  /** This computer: 1–7, and 15–19 for your own agents and your bots'. */
  readonly machine: readonly ChecklistItem[];
  /** Each project and worktree: 8–14, and 15–16 for the project's own agents. */
  readonly places: readonly ChecklistPlace[];
  readonly checkedAt?: number;
  /** A run is under way (indexes are slow: `gls index --check` can take minutes). */
  readonly checking?: boolean;
}

/** What a checklist item makes wait for you: not ✓, not fixing itself, not advice, and not 1–2 (the checks above already say those). */
export const checklistOpen = (item: ChecklistItem): boolean => (item.state === 'warn' || item.state === 'fail') && !item.fixing && !item.advisory && item.id !== 'tools' && item.id !== 'services';

/** What's waiting for you in the checklist, by place ('' for this computer), in order. */
export function checklistProblems(list: StackChecklist | undefined): { readonly place?: ChecklistPlace; readonly items: readonly ChecklistItem[] }[] {
  if (!list) return [];
  const out: { place?: ChecklistPlace; items: readonly ChecklistItem[] }[] = [];
  const machine = list.machine.filter(checklistOpen);
  if (machine.length) out.push({ items: machine });
  for (const place of list.places) {
    const items = place.items.filter(checklistOpen);
    if (items.length) out.push({ place, items });
  }
  return out;
}
